"""Tempo por unidade e workflow por cabo (GET /api/operations/reports/block-times/).

A fonte confiável é o apontamento por bloco (dispatch.WorkBlock): o bloco é um período real em UMA
atividade e UM grupo de material, e a quantidade vem das tarefas concluídas nele — então
tempo por unidade = horas do bloco ÷ unidades produzidas, sem estimar a divisão entre tarefas.

Sem o botão de bloco, o "bloco" é INFERIDO do despacho: as tarefas de um técnico cujos períodos se
sobrepõem (iniciadas juntas, concluídas juntas) formam um pacote. Se todas são da MESMA ATIVIDADE
(materiais podem variar), o tempo do pacote (união dos períodos trabalhados, sem pausas) ÷ a
quantidade total é o tempo por unidade. Cada pacote alimenta a linha "todos os materiais" da atividade
e, quando tem um só grupo de material, também a linha do grupo. Pacote com atividades diferentes não
mede nada.

Enquanto os blocos não existem (ou são poucos), o relatório mostra uma ESTIMATIVA calibrada pela
presença: o apontamento tarefa a tarefa fica limitado a 7 h de trabalho por técnico por dia, na
proporção do que foi apontado. É uma ordem de grandeza, marcada como estimada.

Workflow de um cabo = soma dos minutos por cabo das etapas que o grupo realmente tem no projeto
(etapas do template ativas, na ordem do fluxo). O prazo corrido (espera entre etapas) não entra.
"""

import statistics
from collections import defaultdict
from datetime import timedelta

from core.collaborator_scope import managed_collaborator_ids, supervisor_project_ids
from dispatch.blocks import work_units_label
from dispatch.models import WorkBlock
from master_data.models import CableFamily, GeneratedTask
from projects.models import ProjectTask, ProjectTaskAssignment

from .reports import _local_date, parse_site_ids

MAX_PACKAGE_HOURS = 6.0  # pacote mais longo que isso não é um turno de trabalho contínuo: não mede nada
MIN_BLOCKS = 5  # blocos por atividade × grupo para o número ser "medido" com confiança
DAY_WORK_HOURS = 7.0  # jornada de 8 h menos 1 h de almoço: teto do apontamento tarefa a tarefa por dia
POOLED = "ALL"  # linha da atividade com todos os materiais juntos (despacho por atividade)
# Ordem de exibição do resumo por atividade: as três que mais importam primeiro, depois o fluxo.
SUMMARY_ORDER = (
    "CAB-RUN", "CAB-LABEL", "CAB-CRIMP", "MAT-SEP", "CAB-CUT", "CAB-DRESS", "CAB-PATCH", "CERTIFY", "CAB-MEASURE", "MAT-CHECK",
)
GROUP_LABELS = {**dict(CableFamily.WORK_GROUP_CHOICES), POOLED: "Todos os materiais (conjunto)"}
COMPLETED_OUTCOMES = ("", ProjectTask.COMPLETION_OUTCOME_COMPLETED)


def _cables(task):
    """Cabos do item de escopo da tarefa: denominador comum de todas as etapas do workflow."""
    generated = task.generated_task
    if generated is None:
        return 0.0
    value = generated.scope_item.quantity
    return float(value) if value is not None and float(value) > 0 else 0.0


def _group_of(task):
    generated = task.generated_task
    family = generated.scope_item.cable_family if generated else None
    return family.work_group if family and family.work_group else ""


def _percentile_pair(values):
    if not values:
        return None, None
    if len(values) == 1:
        return values[0], values[0]
    q1, _, q3 = statistics.quantiles(values, n=4, method="inclusive")
    return q1, q3


def _task_qs():
    return ProjectTask.objects.select_related(
        "generated_task__activity", "generated_task__scope_item__cable_family", "project"
    )


def _measured(date_from, date_to, site_ids, project_ids, allowed_ids):
    """{(atividade, grupo): acumulador} a partir dos blocos totalmente concluídos."""
    blocks = (
        WorkBlock.objects.filter(date__gte=date_from, date__lte=date_to)
        .select_related("activity")
        .prefetch_related(
            "assignments__project_task__generated_task__activity",
            "assignments__project_task__generated_task__scope_item__cable_family",
            "assignments__project_task__project",
        )
    )
    if allowed_ids is not None:
        blocks = blocks.filter(collaborator_id__in=allowed_ids)
    acc = {}
    partial = 0
    for block in blocks:
        assignments = list(block.assignments.all())
        if not assignments:
            continue
        if site_ids and not any(a.project_task.project.site_id in site_ids for a in assignments):
            continue
        if project_ids is not None and not any(a.project_task.project_id in project_ids for a in assignments):
            continue
        done = all(
            a.status == ProjectTask.STATUS_COMPLETED and a.completion_outcome in COMPLETED_OUTCOMES for a in assignments
        )
        if not done:
            partial += 1
            continue
        units = 0.0
        unit_label = ""
        cables = 0.0
        for a in assignments:
            value, label = work_units_label(a.project_task)
            units += value
            unit_label = unit_label or label
            cables += _cables(a.project_task)
        if units <= 0 or block.hours <= 0:
            continue
        first = assignments[0].project_task.generated_task
        key = (first.activity.code if first else "", block.work_group)
        row = acc.setdefault(
            key,
            {"activity_name": first.activity.name if first else "", "unit": unit_label, "blocks": 0, "hours": 0.0,
             "units": 0.0, "cables": 0.0, "rates": [], "cable_rates": []},
        )
        row["blocks"] += 1
        row["hours"] += block.hours
        row["units"] += units
        row["cables"] += cables
        row["rates"].append(block.hours * 3600 / units)
        if cables > 0:
            row["cable_rates"].append(block.hours * 60 / cables)
    return acc, partial


def _inferred(date_from, date_to, site_ids, project_ids, allowed_ids, acc):
    """Soma em `acc` os pacotes limpos inferidos do apontamento tarefa a tarefa. Devolve
    {"clean": n, "mixed": n, "too_long": n}."""
    qs = (
        ProjectTaskAssignment.objects.filter(
            status=ProjectTask.STATUS_COMPLETED,
            assignment_start__isnull=False,
            assignment_end__isnull=False,
            assignment_end__date__gte=date_from,
            assignment_end__date__lte=date_to,
            actual_hours__isnull=False,
            work_block__isnull=True,
            time_allocated=False,
            completion_outcome__in=COMPLETED_OUTCOMES,
            project_task__exclude_from_reports=False,
            project_task__generated_task__isnull=False,
        )
        .select_related(
            "project_task__generated_task__activity",
            "project_task__generated_task__scope_item__cable_family",
            "project_task__project",
        )
        .prefetch_related("project_task__assignments")
        .order_by("collaborator_id", "assignment_start")
    )
    if allowed_ids is not None:
        qs = qs.filter(collaborator_id__in=allowed_ids)
    if project_ids is not None:
        qs = qs.filter(project_task__project_id__in=project_ids)
    if site_ids:
        qs = qs.filter(project_task__project__site_id__in=site_ids)

    clusters = []
    current = None
    for a in qs:
        if current and a.collaborator_id == current["collaborator"] and a.assignment_start < current["end"]:
            current["items"].append(a)
            current["end"] = max(current["end"], a.assignment_end)
        else:
            current = {"collaborator": a.collaborator_id, "end": a.assignment_end, "items": [a]}
            clusters.append(current)

    counts = {"clean": 0, "mixed": 0, "too_long": 0}
    for cluster in clusters:
        items = cluster["items"]
        activities = {a.project_task.generated_task.activity.code for a in items}
        groups_in_package = {_group_of(a.project_task) for a in items}
        if len(activities) > 1:
            counts["mixed"] += 1
            continue
        intervals = sorted(iv for a in items for iv in a.working_intervals())
        if not intervals:
            continue
        union = 0.0
        run_start, run_end = intervals[0]
        for start, end in intervals[1:]:
            if start <= run_end:
                run_end = max(run_end, end)
            else:
                union += (run_end - run_start).total_seconds()
                run_start, run_end = start, end
        union += (run_end - run_start).total_seconds()
        hours = union / 3600
        if hours <= 0:
            continue
        if hours > MAX_PACKAGE_HOURS:
            counts["too_long"] += 1
            continue
        units = 0.0
        cables = 0.0
        unit_label = ""
        for a in items:
            task = a.project_task
            value, label = work_units_label(task)
            # A tarefa pode ter mais de um técnico: a quantidade se divide entre quem concluiu.
            done_by = max(1, sum(1 for x in task.assignments.all() if x.status == ProjectTask.STATUS_COMPLETED))
            units += value / done_by
            cables += _cables(task) / done_by
            unit_label = unit_label or label
        if units <= 0:
            continue
        counts["clean"] += 1
        code = next(iter(activities))
        first = items[0].project_task.generated_task
        keys = [(code, POOLED)]
        if len(groups_in_package) == 1:
            keys.append((code, next(iter(groups_in_package))))
        for key in keys:
            row = acc.setdefault(
                key,
                {"activity_name": first.activity.name, "unit": unit_label, "blocks": 0, "hours": 0.0, "units": 0.0,
                 "cables": 0.0, "rates": [], "cable_rates": [], "inferred": 0},
            )
            row["blocks"] += 1
            row["inferred"] = row.get("inferred", 0) + 1
            row["hours"] += hours
            row["units"] += units
            row["cables"] += cables
            row["rates"].append(hours * 3600 / units)
            if cables > 0:
                row["cable_rates"].append(hours * 60 / cables)
    return counts


def _estimated(date_from, date_to, site_ids, project_ids, allowed_ids):
    """Estimativa calibrada pela presença, só do apontamento tarefa a tarefa (sem bloco)."""
    qs = (
        ProjectTaskAssignment.objects.filter(
            status=ProjectTask.STATUS_COMPLETED,
            assignment_end__date__gte=date_from,
            assignment_end__date__lte=date_to,
            actual_hours__isnull=False,
            work_block__isnull=True,
            project_task__exclude_from_reports=False,
            project_task__generated_task__isnull=False,
        )
        .select_related(
            "project_task__generated_task__activity",
            "project_task__generated_task__scope_item__cable_family",
            "project_task__project",
        )
    )
    if allowed_ids is not None:
        qs = qs.filter(collaborator_id__in=allowed_ids)
    if project_ids is not None:
        qs = qs.filter(project_task__project_id__in=project_ids)
    if site_ids:
        qs = qs.filter(project_task__project__site_id__in=site_ids)
    by_day = defaultdict(list)
    for a in qs:
        by_day[(a.collaborator_id, _local_date(a.assignment_end))].append(a)
    acc = {}
    for items in by_day.values():
        reported = sum(float(a.actual_hours) for a in items)
        if reported <= 0:
            continue
        factor = min(1.0, DAY_WORK_HOURS / reported)
        for a in items:
            task = a.project_task
            value, label = work_units_label(task)
            if value <= 0:
                continue
            generated = task.generated_task
            row = acc.setdefault(
                (generated.activity.code, _group_of(task)),
                {"activity_name": generated.activity.name, "unit": label, "records": 0, "hours": 0.0, "units": 0.0, "cables": 0.0},
            )
            row["records"] += 1
            row["hours"] += float(a.actual_hours) * factor
            row["units"] += value
            row["cables"] += _cables(task)
    return acc


def _units_per_cable(groups):
    """{(atividade, grupo): unidades de trabalho por cabo} a partir das tarefas existentes: converte o
    tempo por unidade do conjunto de materiais em minutos por cabo de um grupo específico."""
    totals = defaultdict(lambda: [0.0, 0.0])
    qs = (
        _task_qs()
        .filter(generated_task__scope_item__cable_family__work_group__in=[g for g in groups if g])
        .order_by("-id")[:3000]
    )
    for task in qs:
        value, _label = work_units_label(task)
        cables = _cables(task)
        if value > 0 and cables > 0:
            key = (task.generated_task.activity.code, _group_of(task))
            totals[key][0] += value
            totals[key][1] += cables
    return {k: v[0] / v[1] for k, v in totals.items() if v[1] > 0}


def _workflow_steps(groups):
    """{grupo: [(código da atividade, nome, ordem)]}: etapas que o grupo tem nos projetos, na ordem do fluxo."""
    steps = defaultdict(dict)
    qs = GeneratedTask.objects.filter(
        scope_item__cable_family__work_group__in=[g for g in groups if g], task_template_step__active=True
    ).values_list("scope_item__cable_family__work_group", "activity__code", "activity__name", "step_order")
    for group, code, name, order in qs:
        current = steps[group].get(code)
        steps[group][code] = (code, name, min(order, current[2]) if current else order)
    return {g: sorted(v.values(), key=lambda s: s[2]) for g, v in steps.items()}


def _activity_summary(measured, estimated, previous_measured):
    """Um número por atividade (todos os materiais): medido nos pacotes, senão estimado, com o período
    anterior para comparar."""
    estimated_by_activity = {}
    for (code, _group), e in estimated.items():
        row = estimated_by_activity.setdefault(
            code, {"activity_name": e["activity_name"], "unit": e["unit"], "records": 0, "hours": 0.0, "units": 0.0}
        )
        row["records"] += e["records"]
        row["hours"] += e["hours"]
        row["units"] += e["units"]
    codes = {c for c, g in measured if g == POOLED} | set(estimated_by_activity)
    ordered = sorted(codes, key=lambda c: (SUMMARY_ORDER.index(c) if c in SUMMARY_ORDER else len(SUMMARY_ORDER), c))
    summary = []
    for code in ordered:
        m = measured.get((code, POOLED))
        e = estimated_by_activity.get(code)
        base = m or e
        previous = previous_measured.get((code, POOLED))
        item = {
            "activity_code": code,
            "activity_name": base["activity_name"],
            "unit": base["unit"],
            "measured": None,
            "estimated_sec_per_unit": round(e["hours"] * 3600 / e["units"], 1) if e and e["units"] else None,
            "previous_sec_per_unit": round(previous["hours"] * 3600 / previous["units"], 1) if previous and previous["units"] else None,
        }
        if m:
            q1, q3 = _percentile_pair(m["rates"])
            item["measured"] = {
                "blocks": m["blocks"],
                "hours": round(m["hours"], 2),
                "units": round(m["units"], 1),
                "sec_per_unit": round(m["hours"] * 3600 / m["units"], 1),
                "median_sec_per_unit": round(statistics.median(m["rates"]), 1),
                "p25_sec_per_unit": round(q1, 1),
                "p75_sec_per_unit": round(q3, 1),
                "confident": m["blocks"] >= MIN_BLOCKS,
            }
        summary.append(item)
    return summary


def build_block_times(*, site_id, date_from, date_to, user=None):
    site_ids = parse_site_ids(site_id)
    project_ids = supervisor_project_ids(user)
    allowed_ids = managed_collaborator_ids(user)

    measured, partial_blocks = _measured(date_from, date_to, site_ids, project_ids, allowed_ids)
    block_total = sum(m["blocks"] for m in measured.values())
    packages = _inferred(date_from, date_to, site_ids, project_ids, allowed_ids, measured)
    estimated = _estimated(date_from, date_to, site_ids, project_ids, allowed_ids)

    # Período anterior (mesmo tamanho, logo antes) só para a variação do resumo por atividade.
    span = (date_to - date_from).days + 1
    previous_to = date_from - timedelta(days=1)
    previous_from = previous_to - timedelta(days=span - 1)
    previous_measured, _ = _measured(previous_from, previous_to, site_ids, project_ids, allowed_ids)
    _inferred(previous_from, previous_to, site_ids, project_ids, allowed_ids, previous_measured)
    activity_summary = _activity_summary(measured, estimated, previous_measured)

    rows = []
    for key in sorted(set(measured) | set(estimated)):
        code, group = key
        m = measured.get(key)
        e = estimated.get(key)
        base = m or e
        row = {
            "activity_code": code,
            "activity_name": base["activity_name"],
            "work_group": group,
            "work_group_label": GROUP_LABELS.get(group, "Sem grupo"),
            "unit": base["unit"],
            "measured": None,
            "estimated": None,
        }
        if m:
            q1, q3 = _percentile_pair(m["rates"])
            row["measured"] = {
                "blocks": m["blocks"],
                "inferred": m.get("inferred", 0),
                "hours": round(m["hours"], 2),
                "units": round(m["units"], 1),
                "sec_per_unit": round(m["hours"] * 3600 / m["units"], 1),
                "median_sec_per_unit": round(statistics.median(m["rates"]), 1),
                "p25_sec_per_unit": round(q1, 1),
                "p75_sec_per_unit": round(q3, 1),
                "min_per_cable": round(m["hours"] * 60 / m["cables"], 2) if m["cables"] else None,
                "confident": m["blocks"] >= MIN_BLOCKS,
            }
        if e:
            row["estimated"] = {
                "records": e["records"],
                "hours": round(e["hours"], 2),
                "units": round(e["units"], 1),
                "sec_per_unit": round(e["hours"] * 3600 / e["units"], 1),
                "min_per_cable": round(e["hours"] * 60 / e["cables"], 2) if e["cables"] else None,
            }
        rows.append(row)

    # Workflow de um cabo por grupo: soma dos minutos por cabo de cada etapa (medido, senão estimado).
    index = {(r["activity_code"], r["work_group"]): r for r in rows}
    workflow_steps = _workflow_steps({r["work_group"] for r in rows if r["work_group"] != POOLED})
    needs_pooled = any(
        not (index.get((code, group)) and (index[(code, group)]["measured"] or index[(code, group)]["estimated"]))
        and index.get((code, POOLED), {}).get("measured")
        for group, steps in workflow_steps.items()
        for code, _name, _order in steps
    )
    units_per_cable = _units_per_cable(set(workflow_steps)) if needs_pooled else {}
    workflows = []
    for group, steps in sorted(workflow_steps.items()):
        items = []
        total = 0.0
        missing = []
        all_measured = True
        for code, name, order in steps:
            row = index.get((code, group))
            measured_row = row["measured"] if row else None
            estimated_row = row["estimated"] if row else None
            if measured_row and measured_row["min_per_cable"] is not None:
                minutes, source = measured_row["min_per_cable"], "measured"
                all_measured = all_measured and measured_row["confident"]
            elif (
                index.get((code, POOLED), {}).get("measured")
                and units_per_cable.get((code, group))
            ):
                # Sem medição própria do grupo: usa o tempo por unidade do conjunto de materiais.
                pooled = index[(code, POOLED)]["measured"]
                minutes = round(pooled["sec_per_unit"] * units_per_cable[(code, group)] / 60, 2)
                source = "pooled"
                all_measured = all_measured and pooled["confident"]
            elif estimated_row and estimated_row["min_per_cable"] is not None:
                minutes, source = estimated_row["min_per_cable"], "estimated"
                all_measured = False
            else:
                minutes, source = None, None
                missing.append(name)
                all_measured = False
            if minutes is not None:
                total += minutes
            items.append({"activity_code": code, "activity_name": name, "min_per_cable": minutes, "source": source})
        workflows.append(
            {
                "work_group": group,
                "work_group_label": GROUP_LABELS.get(group, "Sem grupo"),
                "steps": items,
                "total_min_per_cable": round(total, 1),
                "missing": missing,
                "complete": not missing,
                "all_measured": all_measured and not missing,
            }
        )

    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "min_blocks": MIN_BLOCKS,
        "blocks_total": block_total,
        "partial_blocks": partial_blocks,
        "packages": packages,
        "activity_summary": activity_summary,
        "rows": rows,
        "workflows": workflows,
    }
