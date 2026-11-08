import os
from datetime import timedelta
from pathlib import Path

from django.templatetags.static import static


BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "unsafe-development-key"
    else:
        raise RuntimeError(
            "DJANGO_SECRET_KEY não foi definida. Configure essa variável de ambiente antes de subir em produção "
            "(DJANGO_DEBUG=0)."
        )
ALLOWED_HOSTS = [item.strip() for item in os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if item.strip()]
CSRF_TRUSTED_ORIGINS = [item.strip() for item in os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if item.strip()]

INSTALLED_APPS = [
    "unfold",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "axes",
    "audit.apps.AuditConfig",
    "core",
    "users",
    "projects",
    "updates",
    "technical",
    "dispatch",
    "bot",
    "master_data",
    "axis_integration",
    "api",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "audit.middleware.AuditContextMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Precisa ser o último middleware (exigência do django-axes).
    "axes.middleware.AxesMiddleware",
]

# django-axes intercepta o authenticate() padrão do Django — usado tanto
# pelo login do Django Admin quanto pelo TokenObtainPairView do
# simplejwt (que chama authenticate() internamente) — então uma única
# configuração cobre o brute force nos dois pontos de entrada.
AUTHENTICATION_BACKENDS = [
    "axes.backends.AxesStandaloneBackend",
    "django.contrib.auth.backends.ModelBackend",
]

# Evita cair em /accounts/profile/ (padrão do Django, sem view registrada
# nesse sistema) quando alguém loga entrando direto por /admin/login/ em vez
# de /admin/ (que já redireciona com o "next" certo automaticamente).
LOGIN_REDIRECT_URL = "/admin/"

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_EMAIL = os.getenv("VAPID_EMAIL", "mailto:admin@example.com")

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB", "erp"),
        "USER": os.getenv("POSTGRES_USER", "erp"),
        "PASSWORD": os.getenv("POSTGRES_PASSWORD", "erp"),
        "HOST": os.getenv("POSTGRES_HOST", "db"),
        "PORT": os.getenv("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "pt-br"
LANGUAGES = (("pt-br", "Português do Brasil"),)
LOCALE_PATHS = (BASE_DIR / "locale",)
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "users.User"

UNFOLD = {
    "SITE_TITLE": "Axis Field",
    "SITE_HEADER": "Axis Field",
    "SITE_SUBHEADER": "Gestão de projetos e operações",
    "SITE_LOGO": {
        "light": lambda request: static("core/img/consultimer-logo-light.png"),
        "dark": lambda request: static("core/img/consultimer-logo-branco.png"),
    },
    "SITE_FAVICONS": [
        {"rel": "icon", "sizes": "32x32", "type": "image/png", "href": lambda request: static("core/img/favicon-32.png")},
        {"rel": "icon", "sizes": "16x16", "type": "image/png", "href": lambda request: static("core/img/favicon-16.png")},
        {"rel": "apple-touch-icon", "href": lambda request: static("core/img/apple-touch-icon.png")},
    ],
    "SITE_SYMBOL": "hub",
    "SHOW_HISTORY": True,
    "SHOW_VIEW_ON_SITE": False,
    "STYLES": [lambda request: static("core/css/consultimer-theme.css")],
    "COLORS": {
        "primary": {
            "50": "255 247 237",
            "100": "255 237 213",
            "200": "254 215 170",
            "300": "253 186 116",
            "400": "251 146 60",
            "500": "245 133 48",
            "600": "241 96 35",
            "700": "218 74 19",
            "800": "194 65 12",
            "900": "154 52 18",
            "950": "67 20 7",
        },
    },
}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PAGINATION_CLASS": "api.pagination.DefaultPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.ScopedRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        # Camada extra de defesa (além do django-axes) especificamente no
        # endpoint de login: barra rajadas rápidas por IP antes mesmo de o
        # axes contar as tentativas falhas no banco.
        "login": "5/min",
        # Cada chamada é real e paga no provider de IA.
        "ai_test": "5/hour",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
}

# IPs de proxies confiáveis (ex.: de onde chega o túnel Cloudflare). Só
# requisições vindas deles têm o CF-Connecting-IP aceito como IP real.
TRUSTED_PROXY_IPS = {item.strip() for item in os.getenv("TRUSTED_PROXY_IPS", "").split(",") if item.strip()}

# --- Proteção contra brute force (django-axes) ---------------------------
# Bloqueia o PAR usuário+IP após N falhas (Admin e /api/token/). Bloquear só
# pelo usuário permitiria que qualquer um travasse a conta de terceiros;
# desbloqueio manual: Admin > Axes > Access attempts, ou `manage.py axes_reset_username`.
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = timedelta(minutes=30)
AXES_LOCKOUT_PARAMETERS = [["username", "ip_address"]]
AXES_CLIENT_IP_CALLABLE = "core.client_ip.get_client_ip"
AXES_RESET_ON_SUCCESS = True
AXES_RESET_COOL_OFF_ON_FAILURE_DURING_LOCKOUT = True
AXES_LOCKOUT_TEMPLATE = None
AXES_VERBOSE = True

# URL pública do frontend (links de e-mail, ex.: redefinição de senha). Vazio = usa o Origin.
FRONTEND_URL = os.getenv("FRONTEND_URL", "").rstrip("/")

CORS_ALLOWED_ORIGINS = [
    item.strip()
    for item in os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
    if item.strip()
]

EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "1") == "1"
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "apikey")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "atualizacoes@consultimer.com")

# Segundo remetente, exclusivo para e-mails de autenticação (recuperação de
# senha). Qualquer variável AUTH_EMAIL_* vazia herda a do remetente principal
# acima (atualizações diárias e de projeto), então a conta separada é opcional.
AUTH_EMAIL_HOST = os.getenv("AUTH_EMAIL_HOST") or EMAIL_HOST
AUTH_EMAIL_PORT = int(os.getenv("AUTH_EMAIL_PORT") or EMAIL_PORT)
AUTH_EMAIL_USE_TLS = (os.getenv("AUTH_EMAIL_USE_TLS") or ("1" if EMAIL_USE_TLS else "0")) == "1"
AUTH_EMAIL_HOST_USER = os.getenv("AUTH_EMAIL_HOST_USER") or EMAIL_HOST_USER
AUTH_EMAIL_HOST_PASSWORD = os.getenv("AUTH_EMAIL_HOST_PASSWORD") or EMAIL_HOST_PASSWORD
AUTH_FROM_EMAIL = os.getenv("AUTH_FROM_EMAIL") or DEFAULT_FROM_EMAIL

# Segredo compartilhado usado pelo bot do WhatsApp para chamar a API sem
# fazer login normal (ver api/views.BotSharedSecretPermission).
WHATSAPP_BOT_SECRET = os.getenv("WHATSAPP_BOT_SECRET", "")
if not WHATSAPP_BOT_SECRET and not DEBUG:
    raise RuntimeError(
        "WHATSAPP_BOT_SECRET não foi definida. Configure essa variável de ambiente antes de subir em produção "
        "(DJANGO_DEBUG=0)."
    )

# Provider de IA usado pelo parser de SOW (Planejamento > Importar SOW —
# ver master_data/services/sow_parser/ai_parser.py). Lido diretamente via
# os.getenv() nesse módulo (não por settings.AI_*) para manter o parser
# testável sem depender de configuração Django; declarado aqui só para
# documentar as variáveis esperadas no .env do servidor. AI_API_KEY vazia
# (padrão) faz o módulo funcionar em modo DETERMINISTIC_ONLY, sem IA —
# nunca quebra o fluxo de importação. Nunca logar/persistir a chave.
AI_PROVIDER = os.getenv("AI_PROVIDER", "openrouter")
AI_API_KEY = os.getenv("AI_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "")
AI_BASE_URL = os.getenv("AI_BASE_URL", "https://openrouter.ai/api/v1")
AI_TIMEOUT_SECONDS = os.getenv("AI_TIMEOUT_SECONDS", "60")
AI_MAX_RETRIES = os.getenv("AI_MAX_RETRIES", "2")
# Headers opcionais recomendados pelo OpenRouter (identificação da
# aplicação chamadora) — nunca segredos, seguros para aparecer no .env.
OPENROUTER_HTTP_REFERER = os.getenv("OPENROUTER_HTTP_REFERER", "")
OPENROUTER_APP_NAME = os.getenv("OPENROUTER_APP_NAME", "Axis Field")

SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
# HSTS: instrui browsers a nunca usar HTTP para este domínio.
# max-age=31536000 = 1 ano. Ativo apenas em produção (DEBUG=False).
if not DEBUG:
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True

# --- Sessão do Django Admin: mesmo comportamento de login do frontend ---------
# Nunca fica logado ao reabrir o navegador (cookie de sessão, não persistente).
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
# Desloga automaticamente após 10 minutos sem nenhuma requisição nova.
SESSION_COOKIE_AGE = 10 * 60
# Renova a contagem dos 10 minutos a cada requisição (vira um timeout por
# inatividade, não um limite fixo de sessão).
SESSION_SAVE_EVERY_REQUEST = True

# --- Integração com o Axis Core (docs/integracao-core-field.md §3) --------
# Webhook: o Core assina o corpo com HMAC-SHA256 (X-Axis-Signature) usando este segredo.
# Vazio = o receptor responde 503. Nunca versionar o valor.
AXIS_WEBHOOK_SECRET = os.getenv("AXIS_WEBHOOK_SECRET", "")
# Retentativas do Core chegam horas depois; fora desta janela o evento é tratado como replay.
AXIS_WEBHOOK_MAX_AGE_HOURS = int(os.getenv("AXIS_WEBHOOK_MAX_AGE_HOURS") or 72)
# API de consulta do Core (carga inicial `manage.py axis_sync` e dados que o evento não traz).
# AXIS_API_URL termina em /api/v1 (ex.: http://localhost:3000/api/v1); AXIS_API_KEY é a chave do satélite.
AXIS_API_URL = os.getenv("AXIS_API_URL", "").rstrip("/")
AXIS_API_KEY = os.getenv("AXIS_API_KEY", "")
AXIS_API_TIMEOUT = int(os.getenv("AXIS_API_TIMEOUT") or 15)
# Empresa do Field em que entram os clientes, cargos e colaboradores criados a partir do Core (MI-01). Vazia = a
# primeira empresa ativa (o Core é unidade única, A3).
AXIS_DEFAULT_COMPANY_ID = int(os.getenv("AXIS_DEFAULT_COMPANY_ID") or 0) or None

# --- Field -> Core (PT-08; docs/integracao-core-field.md §5) --------------------------------
# Segredo com que o Field assina os eventos `field.project.*` (X-Field-Signature = HMAC-SHA256 do corpo).
# É o segredo HMAC cadastrado no Core para o satélite Field. Vazio = os eventos ficam na fila (outbox) sem envio.
AXIS_OUTBOUND_SECRET = os.getenv("AXIS_OUTBOUND_SECRET", "")
AXIS_OUTBOUND_TIMEOUT = int(os.getenv("AXIS_OUTBOUND_TIMEOUT") or 10)
# Depois de N falhas o evento vira `dead` (aparece no admin; `axis_outbox_dispatch --retry-dead` reabre).
AXIS_OUTBOUND_MAX_ATTEMPTS = int(os.getenv("AXIS_OUTBOUND_MAX_ATTEMPTS") or 12)
# Tentativa de envio logo após o commit (além do comando agendado). Desligue em testes.
AXIS_OUTBOUND_IMMEDIATE = os.getenv("AXIS_OUTBOUND_IMMEDIATE", "1").lower() not in ("0", "false", "no")
# Plano da SOW e envio imediato do outbox rodam em thread depois do commit (não seguram a resposta). 0 = na hora (testes).
AXIS_BACKGROUND_TASKS = os.getenv("AXIS_BACKGROUND_TASKS", "1").lower() not in ("0", "false", "no")
# Tempo máximo para baixar o PDF da SOW no Core (s) e tamanho máximo aceito (MB).
AXIS_SOW_DOWNLOAD_TIMEOUT = int(os.getenv("AXIS_SOW_DOWNLOAD_TIMEOUT") or 30)
AXIS_SOW_MAX_MB = int(os.getenv("AXIS_SOW_MAX_MB") or 25)

# API de horas reais para o Financeiro (`GET /api/integration/labor-hours`, PT-10): o Financeiro envia esta
# chave em `X-Api-Key`. Vazia = a rota responde 503. Nunca versionar o valor.
FIELD_INTEGRATION_API_KEY = os.getenv("FIELD_INTEGRATION_API_KEY", "")
