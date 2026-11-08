"""Regras de envio configuráveis pela web (horário, filtros de projeto,
destinatários e formato) para o relatório diário de projeto do bot."""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Category, Client, Collaborator, Region, Responsible, Site
from projects.models import Project

from .models import BotBroadcastRule, BotSubscriber
from .permissions import BotSharedSecretPermission
from .views import (
    WORKDAY_END,
    WORKDAY_START,
    _active_subscribers,
    _parse_target_date,
    build_allocation_technicians,
    build_daily_project_report_projects,
    build_daily_tasks_projects,
    build_project_updates_projects,
)

# Flag do BotSubscriber usada quando a regra não define destinatários próprios.
RECIPIENT_FLAG = {
    "daily_project_report": "receives_daily_project_report",
    "daily_tasks": "receives_daily_tasks",
    "project_updates": "receives_project_updates",
    "operations_print": "receives_operations_print",
}
# Formatos aceitos por tipo de mensagem.
ALLOWED_CONTENT = {
    "daily_project_report": {"text", "image"},
    "daily_tasks": {"text"},
    "project_updates": {"text"},
    "allocation": {"text"},
    "operations_print": {"image"},
}

BOT_INTERNAL_URL = os.getenv("BOT_INTERNAL_URL", "http://whatsapp-bot:3001")


class BotBroadcastRuleSerializer(serializers.ModelSerializer):
    send_time = serializers.TimeField(format="%H:%M", input_formats=["%H:%M", "%H:%M:%S"])
    client_ids = serializers.PrimaryKeyRelatedField(source="clients", queryset=Client.objects.all(), many=True, required=False)
    category_ids = serializers.PrimaryKeyRelatedField(source="categories", queryset=Category.objects.all(), many=True, required=False)
    site_ids = serializers.PrimaryKeyRelatedField(source="sites", queryset=Site.objects.all(), many=True, required=False)
    region_ids = serializers.PrimaryKeyRelatedField(source="regions", queryset=Region.objects.all(), many=True, required=False)
    responsible_ids = serializers.PrimaryKeyRelatedField(
        source="responsibles", queryset=Responsible.objects.filter(kind=Responsible.KIND_CSTR), many=True, required=False
    )
    manager_ids = serializers.PrimaryKeyRelatedField(source="managers", queryset=Collaborator.objects.all(), many=True, required=False)
    recipient_ids = serializers.PrimaryKeyRelatedField(source="recipients", queryset=BotSubscriber.objects.all(), many=True, required=False)

    class Meta:
        model = BotBroadcastRule
        fields = (
            "id", "name", "is_active", "message_type", "date_offset_days", "content_type", "send_time", "weekdays", "statuses",
            "client_ids", "category_ids", "include_no_category", "region_ids", "responsible_ids", "manager_ids", "site_ids", "recipient_ids", "image_caption",
        )

    def validate(self, attrs):
        message_type = attrs.get("message_type") or getattr(self.instance, "message_type", "daily_project_report")
        content_type = attrs.get("content_type") or getattr(self.instance, "content_type", "text")
        if content_type not in ALLOWED_CONTENT.get(message_type, set()):
            raise serializers.ValidationError({"content_type": "Formato não disponível para este tipo de mensagem."})
        return attrs

    def validate_weekdays(self, value):
        if not isinstance(value, list) or any(not isinstance(d, int) or not 0 <= d <= 6 for d in value):
            raise serializers.ValidationError("Use números de 0 (segunda) a 6 (domingo).")
        return sorted(set(value))

    def validate_statuses(self, value):
        valid = {key for key, _label in Project.STATUS_CHOICES}
        if not isinstance(value, list) or any(s not in valid for s in value):
            raise serializers.ValidationError("Status de projeto inválido.")
        return value


class BotBroadcastRuleViewSet(viewsets.ModelViewSet):
    queryset = BotBroadcastRule.objects.prefetch_related("clients", "categories", "sites", "recipients")
    serializer_class = BotBroadcastRuleSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        read_only = request.method in ("GET", "HEAD", "OPTIONS")
        perm = "bot.view_botmessagetemplate" if read_only else "bot.change_botmessagetemplate"
        if not request.user.has_perm(perm):
            raise PermissionDenied("Sem permissão.")

    @action(detail=False, methods=["get"])
    def options(self, request):
        """Listas usadas pelos filtros da tela."""
        return Response(
            {
                "clients": [
                    {"id": c.pk, "name": c.trade_name or c.legal_name or f"Cliente {c.pk}"}
                    for c in Client.objects.order_by("trade_name", "legal_name")
                ],
                "categories": [{"id": c.pk, "name": c.name} for c in Category.objects.exclude(name="").order_by("name")],
                "sites": [{"id": s.pk, "name": s.name} for s in Site.objects.order_by("name")],
                "regions": [{"id": r.pk, "name": r.name} for r in Region.objects.order_by("name")],
                "responsibles": [
                    {"id": r.pk, "name": r.person.name}
                    for r in Responsible.objects.filter(kind=Responsible.KIND_CSTR, is_active=True)
                    .select_related("person")
                    .order_by("person__name")
                ],
                "managers": [
                    {"id": c.pk, "name": c.person.name}
                    for c in Collaborator.objects.filter(is_active=True, direct_reports__isnull=False)
                    .select_related("person")
                    .distinct()
                    .order_by("person__name")
                ],
                "statuses": [{"id": key, "name": label} for key, label in Project.STATUS_CHOICES],
                "subscribers": [
                    {"id": s.pk, "name": s.name, "target": s.group_jid or s.phone}
                    for s in BotSubscriber.objects.filter(is_active=True).order_by("name")
                ],
            }
        )

    @action(detail=False, methods=["post"])
    def test(self, request):
        """Envio de teste imediato: usa a regra COMO ESTÁ NA TELA (salva ou
        não) e manda só para o telefone/grupo informado, sem tocar nos
        destinatários reais. Cria uma regra temporária inativa para o bot
        ler os filtros e a apaga ao terminar."""
        target = str(request.data.get("to", "")).strip()
        if not target:
            return Response({"detail": "Informe o telefone ou o ID do grupo (@g.us)."}, status=400)
        if not settings.WHATSAPP_BOT_SECRET:
            return Response({"detail": "Bot não configurado."}, status=503)
        serializer = self.get_serializer(data={**(request.data.get("rule") or {}), "is_active": False})
        serializer.is_valid(raise_exception=True)
        rule = serializer.save()
        try:
            query = urllib.parse.urlencode({"rule": rule.pk, "to": target})
            req = urllib.request.Request(
                f"{BOT_INTERNAL_URL}/trigger-rule?{query}",
                headers={"X-Bot-Token": settings.WHATSAPP_BOT_SECRET},
            )
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    payload = json.loads(resp.read().decode("utf-8") or "{}")
            except urllib.error.HTTPError as exc:
                if exc.code == 503:
                    detail = "O bot ainda está inicializando, tente novamente."
                else:
                    detail = f"O bot recusou o envio (HTTP {exc.code})."
                return Response({"detail": detail}, status=502)
            except (urllib.error.URLError, TimeoutError, ValueError):
                return Response({"detail": "Não foi possível falar com o bot."}, status=502)
        finally:
            rule.delete()
        return Response({"detail": payload.get("message", "Envio de teste disparado.")})


class BotRulesScheduleView(APIView):
    """GET /api/bot/broadcasts/rules/ — regras ativas e seus horários, lido
    pelo agendador do bot a cada minuto."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        rules = BotBroadcastRule.objects.filter(is_active=True)
        return Response(
            [
                {
                    "id": r.pk,
                    "name": r.name,
                    "message_type": r.message_type,
                    "content_type": r.content_type,
                    "send_time": r.send_time.strftime("%H:%M"),
                    "weekdays": r.weekdays,
                }
                for r in rules
            ]
        )


class BotRuleBroadcastView(APIView):
    """GET /api/bot/broadcasts/rule/<id>/?date= — dados e destinatários de
    uma regra, calculados na hora do envio. O conteúdo muda conforme o tipo
    de mensagem da regra."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request, pk):
        rule = get_object_or_404(BotBroadcastRule, pk=pk)
        target_date, error = _parse_target_date(request, default_days_ahead=rule.date_offset_days)
        if error:
            return error
        message_type = rule.message_type
        payload = {
            "rule": {
                "id": rule.pk,
                "name": rule.name,
                "message_type": message_type,
                "content_type": rule.content_type,
                "image_caption": rule.image_caption,
            },
            "date": target_date.isoformat(),
        }
        if message_type == "daily_project_report":
            payload["projects"] = build_daily_project_report_projects(target_date, rule=rule)
        elif message_type == "daily_tasks":
            payload["projects"] = build_daily_tasks_projects(target_date, rule=rule)
        elif message_type == "project_updates":
            payload["projects"] = build_project_updates_projects(target_date, rule=rule)
            payload["workday_start"] = WORKDAY_START
            payload["workday_end"] = WORKDAY_END
        elif message_type == "allocation":
            # Com destinatários escolhidos (ex.: um grupo), vai UM resumo para
            # eles; sem destinatários, cada técnico recebe a própria mensagem.
            recipients = list(rule.recipients.filter(is_active=True).order_by("name").values("name", "phone", "group_jid"))
            payload["recipients"] = recipients
            payload["technicians"] = build_allocation_technicians(target_date, rule=rule, require_phone=not recipients)
        elif message_type == "operations_print":
            payload["sites"] = list(rule.sites.values("id", "name"))
        flag = RECIPIENT_FLAG.get(message_type)
        if flag:
            recipients = list(rule.recipients.filter(is_active=True).order_by("name").values("name", "phone", "group_jid"))
            payload["recipients"] = recipients or _active_subscribers(flag)
        return Response(payload)


class BotSubscriberSerializer(serializers.ModelSerializer):
    class Meta:
        model = BotSubscriber
        fields = (
            "id", "name", "phone", "group_jid", "is_active",
            "receives_daily_tasks", "receives_project_updates", "receives_operations_print", "receives_daily_project_report",
        )

    def validate(self, attrs):
        phone = attrs.get("phone", getattr(self.instance, "phone", ""))
        group_jid = attrs.get("group_jid", getattr(self.instance, "group_jid", ""))
        if not phone and not group_jid:
            raise serializers.ValidationError({"phone": "Informe um telefone ou o ID de um grupo do WhatsApp."})
        if group_jid and not group_jid.endswith("@g.us"):
            raise serializers.ValidationError({"group_jid": 'O ID de grupo precisa terminar em "@g.us".'})
        return attrs


class BotSubscriberViewSet(viewsets.ModelViewSet):
    """Destinatários dos envios (pessoas e grupos). Mesma permissão da tela
    de modelos de mensagem."""

    queryset = BotSubscriber.objects.all()
    serializer_class = BotSubscriberSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        read_only = request.method in ("GET", "HEAD", "OPTIONS")
        perm = "bot.view_botmessagetemplate" if read_only else "bot.change_botmessagetemplate"
        if not request.user.has_perm(perm):
            raise PermissionDenied("Sem permissão.")

    @action(detail=False, methods=["get"])
    def groups(self, request):
        """Grupos de WhatsApp em que o bot é membro (nome + ID), para
        escolher o destino sem precisar descobrir o JID na mão."""
        if not settings.WHATSAPP_BOT_SECRET:
            return Response({"detail": "Bot não configurado."}, status=503)
        req = urllib.request.Request(f"{BOT_INTERNAL_URL}/groups", headers={"X-Bot-Token": settings.WHATSAPP_BOT_SECRET})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return Response(json.loads(resp.read().decode("utf-8") or "[]"))
        except urllib.error.HTTPError as exc:
            if exc.code == 503:
                detail = "O bot ainda está inicializando, tente novamente."
            else:
                detail = f"O bot recusou (HTTP {exc.code})."
            return Response({"detail": detail}, status=502)
        except (urllib.error.URLError, TimeoutError, ValueError):
            return Response({"detail": "Não foi possível falar com o bot."}, status=502)


class BotMenuTestView(APIView):
    """POST /api/bot/message-templates/test-menu/ {to} — manda o menu /bot
    (como está salvo) para um número, para conferir o texto."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.user.has_perm("bot.change_botmessagetemplate"):
            raise PermissionDenied("Sem permissão.")
        target = str(request.data.get("to", "")).strip()
        if not target:
            return Response({"detail": "Informe o telefone ou o ID do grupo (@g.us)."}, status=400)
        if not settings.WHATSAPP_BOT_SECRET:
            return Response({"detail": "Bot não configurado."}, status=503)
        req = urllib.request.Request(
            f"{BOT_INTERNAL_URL}/trigger-bot-menu?{urllib.parse.urlencode({'to': target})}",
            headers={"X-Bot-Token": settings.WHATSAPP_BOT_SECRET},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as exc:
            detail = "O bot ainda está inicializando, tente novamente." if exc.code == 503 else f"O bot recusou o envio (HTTP {exc.code})."
            return Response({"detail": detail}, status=502)
        except (urllib.error.URLError, TimeoutError, ValueError):
            return Response({"detail": "Não foi possível falar com o bot."}, status=502)
        return Response({"detail": payload.get("message", "Menu enviado.")})
