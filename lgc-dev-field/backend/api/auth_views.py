from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.views import TokenBlacklistView, TokenObtainPairView, TokenRefreshView

from core.client_ip import get_client_ip


class ClientIpScopedRateThrottle(ScopedRateThrottle):
    def get_ident(self, request):
        return get_client_ip(request)


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """Login da API (usuário/senha -> par de tokens JWT). Limitado por
    ScopedRateThrottle (ver DEFAULT_THROTTLE_RATES["login"]) como primeira
    camada de defesa contra brute force; o django-axes complementa
    bloqueando por IP+usuário após N tentativas falhas."""

    throttle_classes = [ClientIpScopedRateThrottle]
    throttle_scope = "login"


class ThrottledTokenRefreshView(TokenRefreshView):
    """Renovação de token. Também limitada para evitar uso do endpoint de
    refresh como vetor alternativo de força bruta contra tokens roubados
    ou adivinhados."""

    throttle_classes = [ClientIpScopedRateThrottle]
    throttle_scope = "login"


class LogoutView(TokenBlacklistView):
    """Invalida o refresh token no servidor (adiciona à blacklist do
    simplejwt). O access token ainda é válido até expirar (8h), mas sem o
    refresh o atacante não consegue renovar a sessão. O frontend também
    apaga os tokens do sessionStorage no mesmo fluxo de logout."""
