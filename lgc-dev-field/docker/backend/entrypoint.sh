#!/bin/sh
set -e

mkdir -p /app/staticfiles /app/media
chown -R django:django /app/staticfiles /app/media

gosu django python manage.py migrate --noinput
if [ -f /app/locale/pt_BR/LC_MESSAGES/unfold_overrides.po ]; then
    msgcat --use-first \
        /app/locale/pt_BR/LC_MESSAGES/unfold_overrides.po \
        /app/locale/pt_BR/LC_MESSAGES/django.po \
        --output-file=/tmp/django.pt_BR.po
    mv /tmp/django.pt_BR.po /app/locale/pt_BR/LC_MESSAGES/django.po
    chown django:django /app/locale/pt_BR/LC_MESSAGES/django.po
fi
gosu django python manage.py compilemessages --locale pt_BR --ignore staticfiles --ignore media || \
    echo "Aviso: falha ao compilar traduções (provável mismatch de permissão dono do bind mount x usuário django no container) — seguindo com o .mo já existente, se houver."
gosu django python manage.py collectstatic --noinput
gosu django python manage.py ensure_superuser

exec gosu django "$@"
