FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install --no-install-recommends -y gettext gosu \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system django \
    && adduser --system --ingroup django django

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip && pip install -r /tmp/requirements.txt

COPY backend /app
COPY docker/backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
    && mkdir -p /app/staticfiles /app/media \
    && chown -R django:django /app

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
# Usa a variável PORT quando definida pela plataforma de hospedagem (ex: Railway,
# que atribui a porta dinamicamente); cai para 8000 localmente (docker compose),
# onde PORT não é definida. Precisa de "sh -c" para o shell expandir a variável
# em tempo de execução — forma exec (array) não faz essa substituição.
CMD ["sh", "-c", "gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 3 --timeout 60"]
