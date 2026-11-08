"""Endpoint do Painel de Gestão de Sites — somente leitura. Lógica em
projects/sites_panel.py; visão de negócio em docs/painel-gestao-sites.md."""

from django.utils.dateparse import parse_date
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.sites_panel import build_sites_panel

from .dashboard import ProjectsPerformancePermission

FILTER_PARAMS = ("country", "region", "client", "site", "responsible", "status")


class SitesPanelView(APIView):
    """GET /api/dashboard/sites/?group_by=site|region|client|responsible (várias separadas por vírgula combinam os grupos)

    Filtros opcionais: country (um ou vários, separados por vírgula), region, client, site, responsible,
    status=execution|planning, date=YYYY-MM-DD. O bloco de técnicos só vem
    para quem pode ver a Central de Operações
    (projects.view_projecttaskassignment)."""

    permission_classes = [ProjectsPerformancePermission]

    def get(self, request):
        params = request.query_params
        date = parse_date(params.get("date") or "") if params.get("date") else None
        filters = {k: params.get(k) for k in FILTER_PARAMS if params.get(k)}
        for key in ("region", "client", "site", "responsible"):
            if key in filters and not filters[key].isdigit():
                filters.pop(key)
        user = request.user
        include_technicians = user.is_superuser or user.has_perm("projects.view_projecttaskassignment")
        data = build_sites_panel(
            user,
            group_by=params.get("group_by", "site"),
            today=date,
            filters=filters,
            include_technicians=include_technicians,
        )
        return Response(data)
