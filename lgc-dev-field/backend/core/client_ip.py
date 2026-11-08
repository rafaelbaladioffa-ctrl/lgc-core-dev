import ipaddress

from django.conf import settings


def _valid_ip(value):
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def get_client_ip(request):
    """IP real do cliente. CF-Connecting-IP só é aceito quando a conexão vem
    de um proxy listado em TRUSTED_PROXY_IPS — sem isso, qualquer cliente que
    alcance o backend direto poderia forjar o cabeçalho."""
    remote_addr = request.META.get("REMOTE_ADDR", "")
    if remote_addr in settings.TRUSTED_PROXY_IPS:
        forwarded = _valid_ip(request.META.get("HTTP_CF_CONNECTING_IP", ""))
        if forwarded:
            return forwarded
    return remote_addr
