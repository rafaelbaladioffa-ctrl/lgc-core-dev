"""Lógica de agregação do Dashboard (Performance de Projetos e Performance
Técnica), compartilhada entre a API (api/dashboard.py) e a tela do Django
Admin (projects/admin.py). Ver api/dashboard.py para a documentação das
definições de negócio usadas nos indicadores (horas trabalhadas, links
executados etc.) — mantida lá para não duplicar o texto.
"""

from datetime import date

from django.utils import timezone

from core.access_scope import scope_project_queryset
from core.collaborator_scope import scope_collaborators, scope_supervisor_projects
from core.models import Collaborator
from .models import Project, ProjectTask


def parse_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def build_projects_performance(*, company_id=None, client_id=None, status=None, date_from=None, date_to=None, user=None):
    queryset = Project.objects.select_related("company", "client").prefetch_related(
        "project_tasks", "project_tasks__assignments"
    )
    if user is not None:
        # Mesmo escopo das telas de projeto: Cliente/Site/Categoria do usuário e,
        # para Supervisor, só os projetos em que é Responsável CSTR.
        queryset = scope_supervisor_projects(scope_project_queryset(queryset, user), user)

    if company_id:
        queryset = queryset.filter(company_id=company_id)
    if client_id:
        queryset = queryset.filter(client_id=client_id)
    if status:
        queryset = queryset.filter(status=status)
    if date_from:
        queryset = queryset.filter(created_at__date__gte=date_from)
    if date_to:
        queryset = queryset.filter(created_at__date__lte=date_to)

    today = timezone.localdate()
    by_status = {}
    total_worked_hours = 0.0
    total_real_man_hours = 0.0
    total_links = 0
    progress_values = []
    overdue_projects = 0
    rows = []

    for project in queryset:
        tasks = list(project.project_tasks.all())
        total_tasks = len(tasks)
        completed_tasks_list = [t for t in tasks if t.status == ProjectTask.STATUS_COMPLETED]
        completed_tasks = len(completed_tasks_list)
        worked_hours = sum(t.worked_hours for t in tasks)
        real_man_hours = sum(t.real_man_hours for t in tasks)
        tracked_completed = sum(1 for t in completed_tasks_list if t.has_real_time_tracking)
        untracked_completed = completed_tasks - tracked_completed
        tracking_rate = round((tracked_completed / completed_tasks) * 100) if completed_tasks else 0
        progress = round((completed_tasks / total_tasks) * 100) if total_tasks else 0

        by_status[project.status] = by_status.get(project.status, 0) + 1
        total_worked_hours += worked_hours
        total_real_man_hours += real_man_hours
        total_links += project.link_count
        progress_values.append(progress)
        is_overdue = (
            project.planned_end is not None
            and project.planned_end < today
            and project.status not in (Project.STATUS_COMPLETED, Project.STATUS_CANCELED)
        )
        if is_overdue:
            overdue_projects += 1

        rows.append(
            {
                "id": project.pk,
                "code": project.code,
                "name": project.name,
                "status": project.status,
                "status_display": project.get_status_display(),
                "company": str(project.company) if project.company_id else None,
                "client": str(project.client) if project.client_id else None,
                "total_tasks": total_tasks,
                "completed_tasks": completed_tasks,
                "progress_percent": progress,
                "worked_hours": round(worked_hours, 2),
                "real_man_hours": round(real_man_hours, 2),
                "untracked_tasks_count": untracked_completed,
                "tracking_rate": tracking_rate,
                "link_count": project.link_count,
                "planned_end": project.planned_end,
                "is_overdue": is_overdue,
            }
        )

    status_choices = dict(Project.STATUS_CHOICES)
    by_status_list = [
        {"status": key, "status_display": status_choices.get(key, key), "count": value}
        for key, value in sorted(by_status.items())
    ]
    top_projects_by_hours = sorted(rows, key=lambda row: row["worked_hours"], reverse=True)[:10]

    return {
        "summary": {
            "total_projects": len(rows),
            "overdue_projects": overdue_projects,
            "avg_progress_percent": round(sum(progress_values) / len(progress_values)) if progress_values else 0,
            "total_worked_hours": round(total_worked_hours, 2),
            "total_real_man_hours": round(total_real_man_hours, 2),
            "total_links": total_links,
        },
        "by_status": by_status_list,
        "top_projects_by_hours": top_projects_by_hours,
        "projects": rows,
    }


def build_technical_performance(*, company_id=None, date_from=None, date_to=None, user=None):
    collaborators = Collaborator.objects.filter(is_active=True).select_related("person", "person__company", "job_title")
    collaborators = scope_collaborators(collaborators, user)
    if company_id:
        collaborators = collaborators.filter(person__company_id=company_id)
    collaborators = collaborators.prefetch_related(
        "project_tasks",
        "project_tasks__rack_positions",
        "project_tasks__assignments",
        "project_tasks__assignments__collaborator",
    )

    rows = []
    for collaborator in collaborators:
        tasks = list(collaborator.project_tasks.all())
        tasks_total = len(tasks)

        # Conclusões do PRÓPRIO técnico: cada um tem a sua, mesmo quando a
        # tarefa só fecha depois. Ajuste do admin (sem fim registrado pelo
        # técnico) não entra em indicador de técnico.
        own_done = []
        for task in tasks:
            own = next((a for a in task.assignments.all() if a.collaborator_id == collaborator.pk), None)
            if own and own.status == ProjectTask.STATUS_COMPLETED and own.assignment_end:
                own_done.append((task, own))
        if date_from or date_to:
            def _in_range(moment):
                task_date = timezone.localtime(moment).date() if timezone.is_aware(moment) else moment.date()
                if date_from and task_date < date_from:
                    return False
                if date_to and task_date > date_to:
                    return False
                return True

            own_done = [(task, own) for task, own in own_done if _in_range(own.assignment_end)]

        completed_tasks = [task for task, _ in own_done]

        # Horas por técnico: intervalos de execução do próprio técnico (sem
        # pausas). Merge de intervalos evita dupla contagem quando ele tinha
        # tarefas paralelas (10 tarefas das 9h–10h = 1h efetiva, não 10h).
        intervals = []
        untracked_count = 0
        for _task, own in own_done:
            working = own.working_intervals()
            if working:
                intervals.extend(working)
            else:
                untracked_count += 1
        intervals.sort(key=lambda iv: iv[0])
        merged_intervals = []
        for start, end in intervals:
            if merged_intervals and start <= merged_intervals[-1][1]:
                merged_intervals[-1] = (merged_intervals[-1][0], max(merged_intervals[-1][1], end))
            else:
                merged_intervals.append((start, end))
        interval_hours = sum((e - s).total_seconds() for s, e in merged_intervals) / 3600
        hours_worked = round(interval_hours, 2)
        links_executed = sum(rp.links for t in completed_tasks for rp in t.rack_positions.all())

        rows.append(
            {
                "collaborator_id": collaborator.pk,
                "name": collaborator.person.name,
                "registration": collaborator.registration,
                "job_title": str(collaborator.job_title) if collaborator.job_title_id else None,
                "company": str(collaborator.person.company) if collaborator.person.company_id else None,
                "tasks_total": tasks_total,
                "tasks_completed": len(completed_tasks),
                "tasks_untracked": untracked_count,
                "hours_worked": round(hours_worked, 2),
                "links_executed": links_executed,
            }
        )

    rows.sort(key=lambda row: row["hours_worked"], reverse=True)

    summary = {
        "total_collaborators": len(rows),
        "total_tasks_completed": sum(row["tasks_completed"] for row in rows),
        "total_tasks_untracked": sum(row["tasks_untracked"] for row in rows),
        "total_hours_worked": round(sum(row["hours_worked"] for row in rows), 2),
        "total_links_executed": sum(row["links_executed"] for row in rows),
    }

    return {"summary": summary, "collaborators": rows}
