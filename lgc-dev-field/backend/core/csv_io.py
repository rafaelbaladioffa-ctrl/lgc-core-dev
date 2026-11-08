"""Lógica genérica de exportação/importação CSV para os Cadastros Gerais,
compartilhada entre o Django Admin (core/admin_mixins.py) e a API REST
(api/views.py). As colunas são derivadas automaticamente dos campos
editáveis do model — sem precisar mapear coluna por coluna a cada novo
cadastro. Campos de relação (ForeignKey) são exportados/importados pelo
texto do __str__ do registro relacionado.
"""

import csv
import io
from datetime import datetime

from django.db import transaction

CSV_DELIMITER = ";"

# Limite de tamanho para upload de CSV (proteção contra DoS por arquivo
# gigante consumindo memória/tempo de processamento na importação).
MAX_CSV_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB

# Caracteres que, se estiverem no início de uma célula, fazem Excel/Google
# Sheets interpretar o valor como fórmula (CSV/DDE injection).
_FORMULA_LEAD_CHARS = ("=", "+", "-", "@", "\t", "\r")


def neutralize_formula(value: str) -> str:
    """Prefixa com um apóstrofo valores que começam com caractere de fórmula,
    para que Excel/Sheets os trate como texto literal em vez de executar."""
    if value and value[0] in _FORMULA_LEAD_CHARS:
        return f"'{value}"
    return value


class _PersonField:
    """Campo 'virtual' usado por get_csv_fields para achatar as colunas de
    core.Person (nome/e-mail/telefone/empresa) diretamente no CSV de
    Collaborator/Responsible/ClientResponsible — esses modelos não têm mais
    essas colunas próprias (viraram uma FK 'person', ver core/models.py),
    mas o CSV continua com as mesmas colunas de sempre para quem importa/
    exporta essas planilhas."""

    LABELS = {"name": "Nome", "email": "E-mail", "phone": "Telefone", "company": "Empresa"}

    def __init__(self, base_name, sub_name):
        from .models import Company

        self.name = f"{base_name}__{sub_name}"
        self.attname = self.name
        self.verbose_name = self.LABELS[sub_name]
        self.is_relation = sub_name == "company"
        self.related_model = Company if self.is_relation else None
        self.null = sub_name != "name"
        self.base_name = base_name
        self.sub_name = sub_name

    def get_internal_type(self):
        return "EmailField" if self.sub_name == "email" else "CharField"


def get_csv_fields(model):
    from .models import Person

    fields = []
    for field in model._meta.fields:
        if field.name == "id" or not field.editable:
            continue
        if field.is_relation and field.related_model is Person:
            fields.extend(_PersonField(field.name, sub) for sub in ("name", "email", "phone", "company"))
        else:
            fields.append(field)
    return fields


def _match_by_str(related_model, raw, verbose_name):
    match = next(
        (candidate for candidate in related_model.objects.all() if str(candidate) == raw),
        None,
    )
    if match is None:
        raise ValueError(f'{verbose_name}: não encontrado "{raw}".')
    return match


def _resolve_person(data):
    """Reaproveita um Person existente (por e-mail, senão por nome+empresa)
    ou cria um novo — para que importar Colaborador/Responsável/Responsável
    do Cliente via CSV não duplique a mesma pessoa em vários registros."""
    from .models import Person

    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("Nome: obrigatório.")
    email = (data.get("email") or "").strip()
    company = data.get("company")

    person = Person.objects.filter(email__iexact=email).first() if email else None
    if person is None:
        person = Person.objects.filter(name__iexact=name, company=company).first()
    if person is None:
        return Person.objects.create(name=name, email=email, phone=data.get("phone") or "", company=company)

    changed = False
    if email and not person.email:
        person.email = email
        changed = True
    if data.get("phone") and not person.phone:
        person.phone = data["phone"]
        changed = True
    if company and not person.company_id:
        person.company = company
        changed = True
    if changed:
        person.save()
    return person


def serialize_csv_value(obj, field):
    if isinstance(field, _PersonField):
        person = getattr(obj, field.base_name, None)
        if person is None:
            return ""
        value = getattr(person, field.sub_name, None)
        return neutralize_formula(str(value)) if value else ""
    if field.is_relation:
        related = getattr(obj, field.name)
        return neutralize_formula(str(related)) if related is not None else ""
    value = getattr(obj, field.attname)
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Sim" if value else "Não"
    if hasattr(value, "strftime"):
        return value.strftime("%d/%m/%Y %H:%M") if hasattr(value, "hour") else value.strftime("%d/%m/%Y")
    return neutralize_formula(str(value))


def build_csv_content(model, queryset):
    """Retorna o conteúdo CSV completo (com BOM UTF-8) como string, pronto
    para ser escrito numa resposta HTTP ou arquivo."""
    fields = get_csv_fields(model)
    buffer = io.StringIO()
    buffer.write("﻿")
    writer = csv.writer(buffer, delimiter=CSV_DELIMITER)
    writer.writerow([str(field.verbose_name) for field in fields])
    for obj in queryset:
        writer.writerow([serialize_csv_value(obj, field) for field in fields])
    return buffer.getvalue()


def parse_csv_value(row, field):
    raw = (row.get(str(field.verbose_name)) or row.get(field.name) or "").strip()
    if field.is_relation:
        if not raw:
            if field.null:
                return None
            raise ValueError(f"{field.verbose_name}: obrigatório.")
        related_model = field.related_model
        match = next(
            (candidate for candidate in related_model.objects.all() if str(candidate) == raw),
            None,
        )
        if match is None:
            raise ValueError(f'{field.verbose_name}: não encontrado "{raw}".')
        return match

    internal_type = field.get_internal_type()
    if internal_type == "BooleanField":
        # Campo booleano nullable (ex: TaskTemplateRule.preterminated) e
        # célula vazia: "" significa "não informado/não considerar" (None),
        # diferente de "Não" (False) — só se aplica quando o model permite
        # null; um booleano obrigatório com célula vazia continua caindo no
        # comportamento de sempre (célula ausente = falso).
        if field.null and not raw:
            return None
        return raw.strip().casefold() not in ("", "não", "nao", "0", "false")
    if internal_type == "DateField":
        if not raw:
            return None
        for date_format in ("%d/%m/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(raw, date_format).date()
            except ValueError:
                continue
        raise ValueError(f'{field.verbose_name}: data inválida "{raw}" (use DD/MM/AAAA).')
    if internal_type == "DateTimeField":
        if not raw:
            return None
        for date_format in ("%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(raw, date_format)
            except ValueError:
                continue
        raise ValueError(f'{field.verbose_name}: data/hora inválida "{raw}".')
    if internal_type in ("DecimalField", "FloatField"):
        return raw.replace(",", ".") if raw else None
    if internal_type in ("IntegerField", "PositiveIntegerField", "PositiveSmallIntegerField", "BigIntegerField"):
        return int(raw) if raw else None
    return raw


def import_csv_rows(model, file_content):
    """Importa os registros descritos em `file_content` (texto do CSV,
    delimitador sniffado automaticamente). Cria um registro por linha via
    full_clean()+save(); linhas com erro não interrompem as demais.
    Retorna (created, errors) — errors é uma lista de strings 'Linha N: ...'."""
    if len(file_content.encode("utf-8")) > MAX_CSV_UPLOAD_BYTES:
        raise ValueError(f"Arquivo CSV muito grande (máximo {MAX_CSV_UPLOAD_BYTES // (1024 * 1024)} MB).")

    fields = get_csv_fields(model)
    sample = file_content[:4096]
    delimiter = csv.Sniffer().sniff(sample, delimiters=";,\t").delimiter
    rows = csv.DictReader(io.StringIO(file_content), delimiter=delimiter)
    if not rows.fieldnames:
        raise ValueError("O arquivo CSV está vazio ou em um formato inválido.")

    created = 0
    errors = []
    for line_number, row in enumerate(rows, start=2):
        try:
            with transaction.atomic():
                values = {}
                person_data = {}
                person_base_name = None
                for field in fields:
                    if isinstance(field, _PersonField):
                        person_base_name = field.base_name
                        person_data[field.sub_name] = parse_csv_value(row, field)
                    else:
                        values[field.name] = parse_csv_value(row, field)
                if person_base_name:
                    values[person_base_name] = _resolve_person(person_data)
                obj = model(**values)
                obj.full_clean()
                obj.save()
                created += 1
        except Exception as exc:
            errors.append(f"Linha {line_number}: {exc}")
    return created, errors
