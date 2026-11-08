"""Apontamento por bloco do técnico (ver dispatch.blocks): GET sugere a janela, POST registra."""
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import get_collaborator_role
from dispatch.blocks import BlockError, register_work_block, suggest_block_window
from projects.models import ProjectTask


class _TechnicianOnly(IsAuthenticated):
    """Mesma permissão do andamento em Minhas Tarefas (technical.change_mytask)."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.user.is_superuser or request.user.has_perm("technical.change_mytask")


class WorkBlockSuggestionView(APIView):
    permission_classes = [_TechnicianOnly]

    def get(self, request):
        collaborator = get_collaborator_role(request.user)
        if collaborator is None:
            return Response({"detail": "Usuário sem Técnico vinculado."}, status=403)
        start, end = suggest_block_window(collaborator)
        return Response({"start": start, "end": end})


class WorkBlockView(APIView):
    """POST: start, end (opcional, padrão agora), tasks [{task_id, complete, outcome, quantity_done}]."""

    permission_classes = [_TechnicianOnly]

    def post(self, request):
        collaborator = get_collaborator_role(request.user)
        if collaborator is None:
            return Response({"detail": "Usuário sem Técnico vinculado."}, status=403)
        data = request.data
        now = timezone.now()

        def parse(value, label):
            parsed = parse_datetime(value) if isinstance(value, str) else None
            if parsed is None:
                raise BlockError(f"{label} inválido.")
            return timezone.make_aware(parsed) if timezone.is_naive(parsed) else parsed

        try:
            start = parse(data.get("start"), "Início")
            end = min(parse(data["end"], "Fim") if data.get("end") else now, now)
            entries = []
            for item in data.get("tasks") or []:
                task = get_object_or_404(ProjectTask, pk=item.get("task_id"))
                entries.append(
                    {
                        "task": task,
                        "complete": bool(item.get("complete", True)),
                        "outcome": item.get("outcome") or "",
                        "quantity_done": (item.get("quantity_done") or "")[:100],
                    }
                )
            result = register_work_block(collaborator=collaborator, entries=entries, start=start, end=end)
        except BlockError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"detail": "Bloco registrado.", "tasks": result})
