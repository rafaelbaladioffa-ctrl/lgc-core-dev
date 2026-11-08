"""Endpoints dos ajustes administrativos da timeline (somente superusuário).

Regras de negócio e gravação em dispatch.adjustments; aqui só validação de entrada."""
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Collaborator
from dispatch.adjustments import AdjustmentError, adjust_status_window, register_execution, remove_execution, replace_status_events
from dispatch.models import TechnicianStatusEvent, TimelineAdjustment
from projects.models import ProjectTask, ProjectTaskAssignment

from .permissions import IsSuperUser


def _parse_dt(value, label):
    parsed = parse_datetime(value) if isinstance(value, str) else None
    if parsed is None:
        raise AdjustmentError(f"{label} inválido.")
    return timezone.make_aware(parsed) if timezone.is_naive(parsed) else parsed


def _adjustment_row(a):
    return {
        "id": a.pk,
        "created_at": a.created_at,
        "user": a.user.get_username() if a.user_id else None,
        "collaborator": a.collaborator_id,
        "collaborator_name": a.collaborator.person.name if a.collaborator.person_id else str(a.collaborator),
        "date": a.date,
        "kind": a.kind,
        "kind_display": a.get_kind_display(),
        "reason": a.reason,
    }


class ExecutionAdjustmentView(APIView):
    """POST: registra/corrige a execução de um técnico numa tarefa, com horas válidas.
    Body: collaborator_id, task_id, start, end, pauses [{start, end}], reason."""

    permission_classes = [IsSuperUser]

    def post(self, request):
        data = request.data
        collaborator = get_object_or_404(Collaborator, pk=data.get("collaborator_id"))
        task = get_object_or_404(ProjectTask, pk=data.get("task_id"))
        try:
            pauses = [
                (_parse_dt(p.get("start"), "Início da pausa"), _parse_dt(p.get("end"), "Fim da pausa"))
                for p in (data.get("pauses") or [])
            ]
            adjustment = register_execution(
                user=request.user,
                collaborator=collaborator,
                task=task,
                start=_parse_dt(data.get("start"), "Início"),
                end=_parse_dt(data.get("end"), "Fim"),
                pauses=pauses,
                reason=data.get("reason"),
            )
        except AdjustmentError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"id": adjustment.pk, "detail": "Execução ajustada."})


class ExecutionRemovalView(APIView):
    """POST: exclui o apontamento do técnico numa tarefa (volta a pendente) e apaga a barra.
    Body: collaborator_id, task_id, reason."""

    permission_classes = [IsSuperUser]

    def post(self, request):
        data = request.data
        collaborator = get_object_or_404(Collaborator, pk=data.get("collaborator_id"))
        task = get_object_or_404(ProjectTask, pk=data.get("task_id"))
        try:
            adjustment = remove_execution(user=request.user, collaborator=collaborator, task=task, reason=data.get("reason"))
        except AdjustmentError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"id": adjustment.pk, "detail": "Apontamento excluído."})


class StatusWindowAdjustmentView(APIView):
    """POST: define o status num trecho do dia (ex.: sair do almoço esquecido).
    Body: collaborator_id, start, end, status, reason."""

    permission_classes = [IsSuperUser]

    def post(self, request):
        data = request.data
        collaborator = get_object_or_404(Collaborator, pk=data.get("collaborator_id"))
        try:
            adjustment = adjust_status_window(
                user=request.user,
                collaborator=collaborator,
                start=_parse_dt(data.get("start"), "Início"),
                end=_parse_dt(data.get("end"), "Fim"),
                status=data.get("status"),
                reason=data.get("reason"),
            )
        except AdjustmentError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"id": adjustment.pk, "detail": "Status ajustado."})


class StatusEventsAdjustmentView(APIView):
    """GET ?collaborator=<id>&date=<YYYY-MM-DD>: os status registrados no dia (para editar).
    POST: grava a lista completa de status do dia — altera, exclui e cadastra de uma vez.
    Body: collaborator_id, date, events [{status, changed_at}], reason."""

    permission_classes = [IsSuperUser]

    def get(self, request):
        collaborator = get_object_or_404(Collaborator, pk=request.query_params.get("collaborator"))
        day = parse_date(request.query_params.get("date") or "") or timezone.localdate()
        events = TechnicianStatusEvent.objects.filter(collaborator=collaborator, date=day).order_by("changed_at", "id")
        return Response(
            [{"status": e.status, "changed_at": e.changed_at, "adjusted": e.is_adjusted} for e in events]
        )

    def post(self, request):
        data = request.data
        collaborator = get_object_or_404(Collaborator, pk=data.get("collaborator_id"))
        day = parse_date(str(data.get("date") or ""))
        if day is None:
            return Response({"detail": "Data inválida."}, status=400)
        try:
            events = [(item.get("status"), _parse_dt(item.get("changed_at"), "Horário")) for item in (data.get("events") or [])]
            deleted_at = [_parse_dt(value, "Horário excluído") for value in (data.get("deleted") or [])]
            adjustment = replace_status_events(
                user=request.user, collaborator=collaborator, day=day, events=events, reason=data.get("reason"),
                deleted_at=deleted_at,
            )
        except AdjustmentError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"id": adjustment.pk, "detail": "Status do dia atualizados."})


class AdjustmentTasksView(APIView):
    """GET ?collaborator=<id>&date=<YYYY-MM-DD>: tarefas que o técnico pode ter executado
    (pendentes/em andamento ou com apontamento no dia), para o formulário de ajuste."""

    permission_classes = [IsSuperUser]

    def get(self, request):
        collaborator = get_object_or_404(Collaborator, pk=request.query_params.get("collaborator"))
        day = parse_date(request.query_params.get("date") or "") or timezone.localdate()
        assignments = (
            ProjectTaskAssignment.objects.filter(collaborator=collaborator)
            .filter(Q(assignment_start__date=day) | ~Q(status__in=(ProjectTask.STATUS_COMPLETED, ProjectTask.STATUS_CANCELED)))
            .select_related("project_task__project", "project_task__task")
            .order_by("queue_order", "project_task_id")[:200]
        )
        return Response(
            [
                {
                    "task_id": a.project_task_id,
                    "name": a.project_task.display_name,
                    "project_name": a.project_task.project.name,
                    "status": a.status,
                    "assignment_start": a.assignment_start,
                    "assignment_end": a.assignment_end,
                    "adjusted": a.is_adjusted,
                }
                for a in assignments
            ]
        )


class AdjustmentHistoryView(APIView):
    """GET ?collaborator=<id>&date=<YYYY-MM-DD> (ambos opcionais): últimos ajustes."""

    permission_classes = [IsSuperUser]

    def get(self, request):
        queryset = TimelineAdjustment.objects.select_related("user", "collaborator__person")
        if request.query_params.get("collaborator"):
            queryset = queryset.filter(collaborator_id=request.query_params["collaborator"])
        day = parse_date(request.query_params.get("date") or "")
        if day:
            queryset = queryset.filter(date=day)
        return Response([_adjustment_row(a) for a in queryset[:100]])
