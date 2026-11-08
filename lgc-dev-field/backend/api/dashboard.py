"""Endpoints agregados para o módulo de Dashboard: Performance de Projetos
e Performance Técnica (colaboradores). Somente leitura.

A lógica de agregação em si vive em projects/analytics.py, compartilhada
com a tela equivalente no Django Admin (ver projects/admin.py).

Definições usadas nos indicadores (documentadas aqui porque não existe
uma regra de negócio única e óbvia no domínio):

- "Horas trabalhadas" de uma tarefa usa ProjectTask.worked_hours, que já
  cai para a duração prevista quando a tarefa foi concluída sem
  apontamento real (ver projects.models.ProjectTask.worked_hours).
- "Links executados" de um colaborador soma RackPosition.links de todos
  os Rack Positions vinculados às tarefas CONCLUÍDAS em que o colaborador
  está alocado. É a única fonte de contagem de links no nível de
  tarefa/colaborador hoje (Project.link_count é um total do projeto
  inteiro, sem granularidade por tarefa ou colaborador). Se uma tarefa
  cobre vários Rack Positions, todos entram na soma; se vários
  colaboradores estão na mesma tarefa, cada um recebe o total (não é
  dividido) — é uma aproximação intencional, ajustável depois se o
  critério de negócio for outro.
"""

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.analytics import build_projects_performance, build_technical_performance, parse_date


class HasDashboardPermission(IsAuthenticated):
    required_perm = None

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.user.is_superuser:
            return True
        return request.user.has_perm(self.required_perm)


class ProjectsPerformancePermission(HasDashboardPermission):
    required_perm = "projects.view_project"


class TechnicalPerformancePermission(HasDashboardPermission):
    required_perm = "core.view_collaborator"


class ProjectsPerformanceView(APIView):
    """GET /api/dashboard/projects/

    Filtros (query params, todos opcionais): company, client, status,
    date_from, date_to (aplicados em Project.created_at)."""

    permission_classes = [ProjectsPerformancePermission]

    def get(self, request):
        data = build_projects_performance(
            user=request.user,
            company_id=request.query_params.get("company"),
            client_id=request.query_params.get("client"),
            status=request.query_params.get("status"),
            date_from=parse_date(request.query_params.get("date_from")),
            date_to=parse_date(request.query_params.get("date_to")),
        )
        return Response(data)


class TechnicalPerformanceView(APIView):
    """GET /api/dashboard/technical/

    Filtros (query params, todos opcionais): company, date_from, date_to.
    Quando date_from/date_to são informados, "tarefas concluídas",
    "horas trabalhadas" e "links executados" consideram apenas tarefas
    com término real (actual_end) dentro do período; "tarefas totais"
    sempre reflete todas as tarefas já atribuídas ao colaborador."""

    permission_classes = [TechnicalPerformancePermission]

    def get(self, request):
        data = build_technical_performance(
            user=request.user,
            company_id=request.query_params.get("company"),
            date_from=parse_date(request.query_params.get("date_from")),
            date_to=parse_date(request.query_params.get("date_to")),
        )
        return Response(data)
