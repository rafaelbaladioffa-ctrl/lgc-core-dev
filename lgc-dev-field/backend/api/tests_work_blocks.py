"""Apontamento por bloco do técnico (dispatch.blocks): tempo repartido em sequência, sem sobreposição."""
from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.models import Permission
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.reports import presence_durations
from core.models import Collaborator, Company, Person
from dispatch.models import TechnicianDailyPresence, TechnicianStatusEvent
from projects.models import Project, ProjectTask, ProjectTaskAssignment
from users.models import User

P = TechnicianDailyPresence


class WorkBlockTests(TestCase):
    def setUp(self):
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(company=self.company, name="Projeto Bloco", status=Project.STATUS_IN_PROGRESS)
        self.user = User.objects.create_user(username="tech_block", email="tech_block@example.com", password="x", company=self.company)
        for codename in ("view_mytask", "change_mytask"):
            self.user.user_permissions.add(Permission.objects.get(codename=codename, content_type__app_label="technical"))
        self.tech = Collaborator.objects.create(person=Person.objects.create(name="Técnico Bloco", company=self.company, user=self.user))
        self.client_tech = APIClient()
        self.client_tech.force_authenticate(user=self.user)
        self.day = timezone.localdate() - timedelta(days=2)

    # --- helpers -----------------------------------------------------------

    def at(self, hour, minute=0):
        return timezone.make_aware(datetime(self.day.year, self.day.month, self.day.day, hour, minute))

    def iso(self, hour, minute=0):
        return self.at(hour, minute).isoformat()

    def make_task(self, name, quantity=None, estimated=None, dispatch=True):
        task = ProjectTask.objects.create(
            project=self.project, custom_name=name, order=ProjectTask.objects.count() + 1,
            quantity_planned=Decimal(quantity) if quantity is not None else None,
            estimated_hours=Decimal(estimated) if estimated is not None else None,
        )
        if dispatch:
            ProjectTaskAssignment.objects.create(project_task=task, collaborator=self.tech)
        return task

    def block(self, tasks, start, end, client=None, **extra):
        payload = {
            "start": self.iso(*start), "end": self.iso(*end),
            "tasks": [t if isinstance(t, dict) else {"task_id": t.pk} for t in tasks],
            **extra,
        }
        return (client or self.client_tech).post("/api/my-tasks/block/", payload, format="json")

    def assignment(self, task):
        return ProjectTaskAssignment.objects.get(project_task=task, collaborator=self.tech)

    # --- repartição do tempo ---------------------------------------------

    def test_time_is_split_by_quantity_in_sequence_without_overlap(self):
        a, b, c = self.make_task("A", 10), self.make_task("B", 10), self.make_task("C", 20)

        response = self.block([a, b, c], (8, 0), (10, 0))

        self.assertEqual(response.status_code, 200, response.data)
        assignments = [self.assignment(t) for t in (a, b, c)]
        self.assertEqual([float(x.actual_hours) for x in assignments], [0.5, 0.5, 1.0])
        self.assertEqual(assignments[0].assignment_start, self.at(8))
        self.assertEqual(assignments[0].assignment_end, assignments[1].assignment_start)  # em sequência
        self.assertEqual(assignments[1].assignment_end, assignments[2].assignment_start)
        self.assertEqual(assignments[2].assignment_end, self.at(10))
        for x in assignments:
            self.assertEqual(x.status, ProjectTask.STATUS_COMPLETED)
            self.assertTrue(x.time_allocated)
            self.assertFalse(x.is_adjusted)
        a.refresh_from_db()
        self.assertEqual(a.status, ProjectTask.STATUS_COMPLETED)

    def make_generated_task(self, activity_code, cable_family, quantity, length_m=None):
        from master_data.models import (
            Activity, GeneratedTask, ScopeItem, TaskTemplate, TaskTemplateStep,
        )

        activity = Activity.objects.filter(code=activity_code).first() or Activity.objects.create(
            code=activity_code, name=activity_code, category="INSTALLATION", default_unit="CABLE"
        )
        template, _ = TaskTemplate.objects.get_or_create(code="TST-BLK-TPL", defaults={"name": "Template", "category": "TEST"})
        step, _ = TaskTemplateStep.objects.get_or_create(
            task_template=template, activity=activity,
            defaults={"step_order": 10 + TaskTemplateStep.objects.filter(task_template=template).count()},
        )
        item = ScopeItem.objects.create(
            raw_text=f"item {ProjectTask.objects.count()}", item_type="CABLE", cable_family=cable_family, quantity=quantity, length_m=length_m
        )
        generated = GeneratedTask.objects.create(
            scope_item=item, task_template=template, task_template_step=step, activity=activity, step_order=10,
            name=f"{activity_code} {quantity}", quantity=Decimal(quantity), unit="CABLE",
        )
        task = ProjectTask.objects.create(
            project=self.project, custom_name=generated.name, order=ProjectTask.objects.count() + 1, generated_task=generated,
        )
        ProjectTaskAssignment.objects.create(project_task=task, collaborator=self.tech)
        return task

    def test_block_with_two_activity_types_is_refused(self):
        from master_data.models import CableFamily

        family = CableFamily.objects.create(code="TST-BLK-F", name="Família teste", medium="COPPER", connector_a="RJ45", connector_b="RJ45")
        labels = self.make_generated_task("CAB-LABEL", family, 4)
        crimp = self.make_generated_task("CAB-CRIMP", family, 4)

        response = self.block([labels, crimp], (8, 0), (10, 0))

        self.assertEqual(response.status_code, 400)
        self.assertIn("mistura tipos de atividade", response.data["detail"])
        self.assertEqual(self.assignment(labels).status, ProjectTask.STATUS_NOT_STARTED)
        # cada tipo no seu horário funciona
        self.assertEqual(self.block([labels], (8, 0), (9, 0)).status_code, 200)
        self.assertEqual(self.block([crimp], (9, 0), (10, 0)).status_code, 200)
        self.assertEqual(float(self.assignment(labels).actual_hours), 1.0)
        self.assertEqual(float(self.assignment(crimp).actual_hours), 1.0)

    def test_block_with_two_material_groups_is_refused(self):
        from master_data.models import CableFamily

        copper = CableFamily.objects.create(code="TST-BLK-CU", name="Cobre teste", medium="COPPER", work_group="COPPER_CAT6")
        trunk = CableFamily.objects.create(code="TST-BLK-TR", name="Tronco teste", medium="FIBER", work_group="TRUNK_LC_LARGE")
        a = self.make_generated_task("CAB-RUN", copper, 4)
        b = self.make_generated_task("CAB-RUN", trunk, 4)

        response = self.block([a, b], (8, 0), (10, 0))

        self.assertEqual(response.status_code, 400)
        self.assertIn("mistura grupos de material", response.data["detail"])
        self.assertEqual(self.assignment(a).status, ProjectTask.STATUS_NOT_STARTED)
        self.assertEqual(self.block([a], (8, 0), (9, 0)).status_code, 200)
        self.assertEqual(self.block([b], (9, 0), (10, 0)).status_code, 200)

    def test_block_is_recorded_and_linked_to_its_assignments(self):
        from dispatch.models import WorkBlock
        from master_data.models import CableFamily

        family = CableFamily.objects.create(code="TST-BLK-CU2", name="Cobre teste", medium="COPPER", work_group="COPPER_CAT6")
        a = self.make_generated_task("CAB-RUN", family, 4)
        b = self.make_generated_task("CAB-RUN", family, 6)

        self.assertEqual(self.block([a, b], (8, 0), (10, 0)).status_code, 200)

        block = WorkBlock.objects.get()
        self.assertEqual(block.collaborator, self.tech)
        self.assertEqual(block.work_group, "COPPER_CAT6")
        self.assertEqual(block.activity.code, "CAB-RUN")
        self.assertEqual(block.hours, 2.0)
        self.assertEqual(self.assignment(a).work_block, block)
        self.assertEqual(self.assignment(b).work_block, block)
        self.assertEqual(block.assignments.count(), 2)

    def test_pool_shows_package_fields_and_waits_for_the_previous_step(self):
        from master_data.models import CableFamily, GeneratedTaskDependency

        family = CableFamily.objects.create(code="TST-BLK-PL", name="Tronco teste", medium="FIBER", work_group="TRUNK_LC_LARGE")
        label = self.make_generated_task("CAB-LABEL", family, 4)
        run = self.make_generated_task("CAB-RUN", family, 4, length_m=Decimal(100))
        GeneratedTaskDependency.objects.create(predecessor_task=label.generated_task, successor_task=run.generated_task)
        ProjectTask.objects.filter(pk__in=[label.pk, run.pk]).update(planned_start=timezone.now())
        admin = User.objects.create_superuser(username="pool_admin", email="pool_admin@example.com", password="x")
        client = APIClient()
        client.force_authenticate(user=admin)

        pool = {row["id"]: row for row in client.get("/api/operations/board/", {"site": "all"}).json()["pool"]}

        self.assertEqual(pool[label.pk]["blocked_by"], [])
        self.assertEqual(pool[run.pk]["blocked_by"], ["Aplicar labels"])
        self.assertEqual(pool[run.pk]["activity_code"], "CAB-RUN")
        self.assertTrue(pool[run.pk]["scope_item_code"])
        self.assertNotEqual(pool[run.pk]["scope_item_code"], pool[label.pk]["scope_item_code"])  # cada item de escopo é um cabo
        self.assertEqual(pool[run.pk]["work_group"], "TRUNK_LC_LARGE")
        self.assertEqual(pool[run.pk]["work_group_label"], "Tronco LC grande (36F–72F)")
        self.assertEqual(pool[run.pk]["work_units"], 400.0)  # 4 cabos × 100 m
        self.assertEqual(pool[run.pk]["work_units_label"], "m")
        # Concluída a etapa anterior, a seguinte fica pronta.
        ProjectTask.objects.filter(pk=label.pk).update(status=ProjectTask.STATUS_COMPLETED)
        pool = {row["id"]: row for row in client.get("/api/operations/board/", {"site": "all"}).json()["pool"]}
        self.assertEqual(pool[run.pk]["blocked_by"], [])

    def test_block_times_report_measures_blocks_and_builds_the_workflow(self):
        from master_data.models import CableFamily

        family = CableFamily.objects.create(code="TST-BLK-BT", name="Tronco teste", medium="FIBER", work_group="TRUNK_LC_SMALL")
        labels = self.make_generated_task("CAB-LABEL", family, 4)       # 4 cabos × 8 labels = 32 labels
        CableFamily.objects.filter(pk=family.pk).update(connector_a="LC", connector_b="LC", fiber_count=8)
        runs = self.make_generated_task("CAB-RUN", family, 4, length_m=Decimal(100))  # 400 m
        # 1 h de labels e 2 h de lançamento, cada um no seu bloco.
        self.assertEqual(self.block([labels], (8, 0), (9, 0)).status_code, 200)
        self.assertEqual(self.block([runs], (9, 0), (11, 0)).status_code, 200)
        admin = User.objects.create_superuser(username="bt_admin", email="bt_admin@example.com", password="x")
        client = APIClient()
        client.force_authenticate(user=admin)
        today = timezone.localdate()

        data = client.get(
            "/api/operations/reports/block-times/",
            {"site": "all", "date_from": str(today - timedelta(days=10)), "date_to": str(today)},
        ).json()

        rows = {(r["activity_code"], r["work_group"]): r for r in data["rows"]}
        run = rows[("CAB-RUN", "TRUNK_LC_SMALL")]["measured"]
        self.assertEqual(run["blocks"], 1)
        self.assertEqual(run["hours"], 2.0)
        self.assertEqual(run["units"], 400.0)
        self.assertEqual(run["sec_per_unit"], 18.0)  # 7200 s ÷ 400 m
        self.assertEqual(run["min_per_cable"], 30.0)  # 120 min ÷ 4 cabos
        self.assertFalse(run["confident"])  # menos de 5 blocos
        label = rows[("CAB-LABEL", "TRUNK_LC_SMALL")]["measured"]
        self.assertEqual(label["units"], 32.0)
        self.assertEqual(label["min_per_cable"], 15.0)
        self.assertEqual(data["blocks_total"], 2)

    def _complete(self, task, start, end):
        """Conclui o despacho como o técnico faz pelo app: início e fim reais, sem bloco."""
        assignment = self.assignment(task)
        assignment.assignment_start = start
        assignment.assignment_end = end
        assignment.status = ProjectTask.STATUS_COMPLETED
        assignment.actual_hours = Decimal(str(round((end - start).total_seconds() / 3600, 2)))
        assignment.save()
        task.sync_from_assignments()

    def test_block_times_infers_clean_packages_from_dispatch(self):
        from master_data.models import CableFamily

        family = CableFamily.objects.create(code="TST-BLK-PK", name="Tronco teste", medium="FIBER", work_group="TRUNK_LC_SMALL")
        # Pacote limpo: 3 tarefas de lançamento iniciadas juntas às 8h e concluídas até as 10h (400 m no total).
        a = self.make_generated_task("CAB-RUN", family, 1, length_m=Decimal(100))
        b = self.make_generated_task("CAB-RUN", family, 1, length_m=Decimal(100))
        c = self.make_generated_task("CAB-RUN", family, 2, length_m=Decimal(100))
        self._complete(a, self.at(8), self.at(9))
        self._complete(b, self.at(8), self.at(9, 30))
        self._complete(c, self.at(8), self.at(10))
        # Pacote misturado à tarde (label + lançamento ao mesmo tempo): não mede.
        d = self.make_generated_task("CAB-RUN", family, 1, length_m=Decimal(100))
        e = self.make_generated_task("CAB-LABEL", family, 1)
        self._complete(d, self.at(13), self.at(15))
        self._complete(e, self.at(13), self.at(14))
        admin = User.objects.create_superuser(username="pk_admin", email="pk_admin@example.com", password="x")
        client = APIClient()
        client.force_authenticate(user=admin)
        today = timezone.localdate()

        data = client.get(
            "/api/operations/reports/block-times/",
            {"site": "all", "date_from": str(today - timedelta(days=10)), "date_to": str(today)},
        ).json()

        rows = {(r["activity_code"], r["work_group"]): r for r in data["rows"]}
        run = rows[("CAB-RUN", "TRUNK_LC_SMALL")]["measured"]
        self.assertEqual(run["blocks"], 1)
        self.assertEqual(run["inferred"], 1)
        self.assertEqual(run["hours"], 2.0)  # 8h–10h: a união dos períodos, não a soma 1 + 1,5 + 2
        self.assertEqual(run["units"], 400.0)
        self.assertEqual(run["sec_per_unit"], 18.0)
        self.assertEqual(data["packages"], {"clean": 1, "mixed": 1, "too_long": 0})

    def test_package_with_several_materials_of_one_activity_measures_the_pooled_row(self):
        from master_data.models import CableFamily

        small = CableFamily.objects.create(code="TST-BLK-PM1", name="Tronco pequeno", medium="FIBER", work_group="TRUNK_LC_SMALL")
        large = CableFamily.objects.create(code="TST-BLK-PM2", name="Tronco grande", medium="FIBER", work_group="TRUNK_LC_LARGE")
        # Separar tudo junto: duas famílias, mesma atividade, 8h–10h (4 unidades no total).
        a = self.make_generated_task("MAT-SEP", small, 2)
        b = self.make_generated_task("MAT-SEP", large, 2)
        self._complete(a, self.at(8), self.at(9))
        self._complete(b, self.at(8), self.at(10))
        admin = User.objects.create_superuser(username="pm_admin", email="pm_admin@example.com", password="x")
        client = APIClient()
        client.force_authenticate(user=admin)
        today = timezone.localdate()

        data = client.get(
            "/api/operations/reports/block-times/",
            {"site": "all", "date_from": str(today - timedelta(days=10)), "date_to": str(today)},
        ).json()

        rows = {(r["activity_code"], r["work_group"]): r for r in data["rows"]}
        pooled = rows[("MAT-SEP", "ALL")]["measured"]
        self.assertEqual(pooled["blocks"], 1)
        self.assertEqual(pooled["hours"], 2.0)  # união 8h–10h
        self.assertEqual(pooled["units"], 4.0)
        self.assertEqual(rows[("MAT-SEP", "ALL")]["work_group_label"], "Todos os materiais (conjunto)")
        # Misturou materiais: nenhuma linha por grupo específico foi medida por esse pacote.
        self.assertNotIn(("MAT-SEP", "TRUNK_LC_SMALL"), {k for k, r in rows.items() if r["measured"]})
        self.assertEqual(data["packages"], {"clean": 1, "mixed": 0, "too_long": 0})
        summary = {item["activity_code"]: item for item in data["activity_summary"]}
        self.assertEqual(summary["MAT-SEP"]["measured"]["sec_per_unit"], 1800.0)  # 2 h ÷ 4 unidades
        self.assertIsNone(summary["MAT-SEP"]["previous_sec_per_unit"])

    def test_same_activity_time_follows_the_real_effort_in_labels(self):
        from master_data.models import CableFamily

        utp = CableFamily.objects.create(code="TST-BLK-UTP", name="UTP teste", medium="COPPER", connector_a="RJ45", connector_b="RJ45")
        fiber = CableFamily.objects.create(code="TST-BLK-36F", name="36F teste", medium="FIBER", connector_a="LC", connector_b="LC", fiber_count=36)
        small = self.make_generated_task("CAB-LABEL", utp, 1)    # 1 cabo × 2 labels = 2
        big = self.make_generated_task("CAB-LABEL", fiber, 1)    # 1 cabo × 36 labels = 36

        self.block([small, big], (8, 0), (11, 48))  # 228 min: 2/38 e 36/38 do tempo

        self.assertEqual(round(float(self.assignment(small).actual_hours), 2), 0.2)
        self.assertEqual(round(float(self.assignment(big).actual_hours), 2), 3.6)

    def test_estimated_hours_are_the_preferred_weight_then_equal_split(self):
        x, y = self.make_task("X", 10, estimated=1), self.make_task("Y", 10, estimated=3)
        self.block([x, y], (8, 0), (12, 0))
        self.assertEqual([float(self.assignment(t).actual_hours) for t in (x, y)], [1.0, 3.0])

        p, q = self.make_task("P"), self.make_task("Q")  # sem quantidade nem horas estimadas
        self.block([p, q], (13, 0), (15, 0))
        self.assertEqual([float(self.assignment(t).actual_hours) for t in (p, q)], [1.0, 1.0])

    def test_block_hours_count_once_as_productive_presence(self):
        a, b = self.make_task("A", 10), self.make_task("B", 10)
        TechnicianStatusEvent.objects.create(collaborator=self.tech, date=self.day, status=P.STATUS_AVAILABLE, changed_at=self.at(7))
        TechnicianStatusEvent.objects.create(collaborator=self.tech, date=self.day, status=P.STATUS_OFF_DUTY, changed_at=self.at(17))

        self.block([a, b], (8, 0), (10, 0))

        per_day, _ = presence_durations([self.tech.pk], self.day, self.day, timezone.now())
        durations = per_day[(self.tech.pk, self.day)]
        self.assertEqual(round(durations[P.STATUS_IN_PROGRESS], 2), 2.0)  # o bloco, não a soma das tarefas
        presence = P.objects.get(collaborator=self.tech, date=self.day)
        self.assertEqual(presence.status, P.STATUS_OFF_DUTY)

    def test_unfinished_task_stays_open_and_the_next_block_continues_it(self):
        a = self.make_task("A", 10)

        self.block([{"task_id": a.pk, "complete": False}], (8, 0), (9, 0))
        first = self.assignment(a)
        self.assertEqual(first.status, ProjectTask.STATUS_PAUSED)
        self.assertEqual(first.paused_at, self.at(9))
        self.assertIsNone(first.assignment_end)

        self.block([a], (10, 0), (11, 0))
        done = self.assignment(a)
        self.assertEqual(done.status, ProjectTask.STATUS_COMPLETED)
        self.assertEqual(float(done.actual_hours), 2.0)  # 1h + 1h, sem a pausa entre os blocos
        self.assertEqual(done.paused_seconds, 3600)
        self.assertEqual(len(done.pause_log), 1)

    # --- regras ------------------------------------------------------------

    def test_overlap_with_existing_record_is_refused(self):
        a, b = self.make_task("A", 10), self.make_task("B", 10)
        self.block([a], (8, 0), (9, 0))

        response = self.block([b], (8, 30), (9, 30))

        self.assertEqual(response.status_code, 400)
        self.assertIn("A", response.data["detail"])
        self.assertEqual(self.assignment(b).status, ProjectTask.STATUS_NOT_STARTED)

    def test_invalid_blocks_are_refused_and_nothing_is_saved(self):
        a = self.make_task("A", 10)
        other = self.make_task("Outro", 10, dispatch=False)
        running = self.make_task("Rodando", 10)
        ProjectTaskAssignment.objects.filter(project_task=running).update(status=ProjectTask.STATUS_IN_PROGRESS, assignment_start=self.at(6))
        done = self.make_task("Pronta", 10)
        ProjectTaskAssignment.objects.filter(project_task=done).update(status=ProjectTask.STATUS_COMPLETED)

        self.assertEqual(self.block([], (8, 0), (9, 0)).status_code, 400)                  # sem tarefas
        self.assertEqual(self.block([a], (9, 0), (8, 0)).status_code, 400)                  # fim antes do início
        self.assertEqual(self.block([a], (8, 0), (8, 0)).status_code, 400)                  # sem duração
        self.assertEqual(self.block([other], (8, 0), (9, 0)).status_code, 400)              # não despachada
        self.assertEqual(self.block([running], (8, 0), (9, 0)).status_code, 400)            # em andamento
        self.assertEqual(self.block([done], (8, 0), (9, 0)).status_code, 400)               # já concluída
        self.assertEqual(self.block([a, a], (8, 0), (9, 0)).status_code, 400)               # repetida
        two_days = {"start": self.iso(8), "end": (self.at(8) + timedelta(days=1)).isoformat(), "tasks": [{"task_id": a.pk}]}
        self.assertEqual(self.client_tech.post("/api/my-tasks/block/", two_days, format="json").status_code, 400)
        self.assertEqual(self.assignment(a).status, ProjectTask.STATUS_NOT_STARTED)
        self.assertFalse(TechnicianStatusEvent.objects.filter(collaborator=self.tech).exists())

    def test_permissions(self):
        a = self.make_task("A", 10)
        outsider = User.objects.create_user(username="no_perm", email="no_perm@example.com", password="x", company=self.company)
        client = APIClient()
        client.force_authenticate(user=outsider)
        self.assertEqual(self.block([a], (8, 0), (9, 0), client=client).status_code, 403)
        self.assertEqual(client.get("/api/my-tasks/block/suggestion/").status_code, 403)

        no_collaborator = User.objects.create_superuser(username="adm_blk", email="adm_blk@example.com", password="x")
        client.force_authenticate(user=no_collaborator)  # superusuário sem Técnico vinculado
        self.assertEqual(self.block([a], (8, 0), (9, 0), client=client).status_code, 403)

    def test_suggestion_starts_after_the_last_break_or_record(self):
        fixed_now = timezone.make_aware(datetime(2026, 10, 5, 15, 0))
        with patch("django.utils.timezone.now", side_effect=lambda: fixed_now):
            day = timezone.localdate()

            def t(h, m=0):
                return timezone.make_aware(datetime(day.year, day.month, day.day, h, m))

            P.objects.create(collaborator=self.tech, date=day, status=P.STATUS_AVAILABLE, checked_in_at=t(7))
            for status, when in ((P.STATUS_AVAILABLE, t(7)), (P.STATUS_LUNCH, t(11, 44)), (P.STATUS_AVAILABLE, t(12, 45))):
                TechnicianStatusEvent.objects.create(collaborator=self.tech, date=day, status=status, changed_at=when)
            task = self.make_task("Feita pela manhã", 10)
            ProjectTaskAssignment.objects.filter(project_task=task).update(
                status=ProjectTask.STATUS_COMPLETED, assignment_start=t(8), assignment_end=t(10)
            )

            response = self.client_tech.get("/api/my-tasks/block/suggestion/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["start"], t(12, 45))  # voltou do almoço depois do último apontamento
        self.assertEqual(response.data["end"], fixed_now)
