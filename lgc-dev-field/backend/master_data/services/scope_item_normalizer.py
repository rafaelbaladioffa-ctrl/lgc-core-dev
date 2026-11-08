"""Normalização determinística de campos derivados de um ScopeItem —
service reutilizável e independente de HTTP/DRF/Django models (mesmo
espírito de task_rule_resolver.py: opera em qualquer objeto com os
atributos certos, sem importar ScopeItem, para não criar dependência
circular com master_data.models). Chamado por ScopeItem.clean() (que por
sua vez é chamado pelo full_clean() usado no Admin, na importação de CSV,
e no ScopeItemCrudSerializer.validate()) e por qualquer consumidor futuro
que precise normalizar um item de escopo antes de persistir (ex:
importação em massa, parser de SOW, IA).

Deriva só os dois campos explicitamente especificados: `cable_family` a
partir de `cable_spec`, e `medium` a partir de `cable_family`. NUNCA deriva
`preterminated` silenciosamente, mesmo quando a família tem um valor
conhecido (ex: CableFamily.preterminated) — esse atributo pode variar por
execução real (a mesma família COP-CAT6 pode ser usada terminada em campo
OU pré-terminada, dependendo do item concreto de escopo), então só o valor
informado explicitamente pelo usuário (ou futuramente pela IA) é usado."""


class ScopeItemNormalizationError(Exception):
    """`cable_spec` informado é de uma família diferente de `cable_family`
    informada — entrada inconsistente, não uma simples ausência de
    derivação possível."""


def normalize_scope_item(item):
    """Recebe um ScopeItem (salvo ou não) e preenche EM MEMÓRIA os campos
    deriváveis que ainda estiverem vazios, atualizando
    `item.normalization_metadata` para registrar a origem de cada valor
    derivado (ex: {"medium": {"source": "cable_family", "derived": true}}).
    Não salva o item — quem chama decide quando persistir. Levanta
    ScopeItemNormalizationError se `cable_spec` e `cable_family`
    informados forem inconsistentes entre si (mesma regra de
    TaskTemplateRule.clean(), aqui reaproveitada para o mesmo tipo de
    inconsistência)."""

    if item.cable_spec_id and item.cable_family_id and item.cable_spec.cable_family_id != item.cable_family_id:
        raise ScopeItemNormalizationError(
            f'A especificação "{item.cable_spec.code}" pertence à família '
            f'"{item.cable_spec.cable_family.code}", diferente da família informada '
            f'("{item.cable_family.code}").'
        )

    metadata = dict(item.normalization_metadata or {})

    if item.cable_spec_id and not item.cable_family_id:
        item.cable_family = item.cable_spec.cable_family
        metadata["cable_family"] = {"source": "cable_spec", "derived": True}

    if not item.medium and item.cable_family_id and item.cable_family.medium:
        item.medium = item.cable_family.medium
        metadata["medium"] = {"source": "cable_family", "derived": True}

    item.normalization_metadata = metadata
    return item
