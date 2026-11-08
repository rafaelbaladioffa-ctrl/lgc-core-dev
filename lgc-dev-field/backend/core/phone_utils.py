import re


def digits_only(value):
    return re.sub(r"\D", "", value or "")


def format_phone(raw):
    """Normaliza um telefone brasileiro pro padrão "+55 (11) 99999-9999" —
    mesmo algoritmo do formatBrazilPhone do frontend (frontend/src/utils/
    formatPhone.ts), pra o valor ficar padronizado independente de ter sido
    digitado via tela (já formatado pelo input) ou inserido direto por outra
    via (Django Admin, importação de CSV, shell). Só remove um "55" inicial
    quando sobra dígito suficiente pra ainda ser DDD+número válido (evita
    confundir código de país com o DDD 55, que existe de verdade — região de
    Santa Maria/RS)."""
    if not raw:
        return raw
    digits = digits_only(raw)
    if digits.startswith("55") and len(digits) > 11:
        digits = digits[2:]
    digits = digits[:11]
    if not digits:
        return raw

    ddd, rest = digits[:2], digits[2:]
    out = f"+55 ({ddd}"
    if len(digits) >= 2:
        out += ")"
    if rest:
        split_at = 5 if len(rest) > 8 else 4
        out += f" {rest[:split_at]}-{rest[split_at:]}" if len(rest) > split_at else f" {rest}"
    return out


def phones_match(a, b, *, min_length=8):
    """Compara dois telefones ignorando formatação (+55, parênteses,
    espaços, hífen) e presença/ausência de código de país — considera
    igual se os últimos `min_length` dígitos batem, já que o WhatsApp
    sempre manda o número com código de país e o cadastro nem sempre tem."""
    a_digits, b_digits = digits_only(a), digits_only(b)
    if len(a_digits) < min_length or len(b_digits) < min_length:
        return False
    return a_digits[-min_length:] == b_digits[-min_length:]
