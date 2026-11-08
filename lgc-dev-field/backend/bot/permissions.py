import hmac

from django.conf import settings
from rest_framework import permissions


class BotSharedSecretPermission(permissions.BasePermission):
    """Autenticação simples por segredo compartilhado (não é um usuário
    logado) — usada só pelo serviço do bot do WhatsApp, que roda fora do
    navegador e não tem como fazer login normal."""

    def has_permission(self, request, view):
        secret = request.headers.get("X-Bot-Secret", "")
        return bool(settings.WHATSAPP_BOT_SECRET) and hmac.compare_digest(
            secret, settings.WHATSAPP_BOT_SECRET
        )
