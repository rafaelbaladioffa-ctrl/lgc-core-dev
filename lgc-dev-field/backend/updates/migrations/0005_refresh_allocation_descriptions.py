from django.db import migrations


def refresh_descriptions(apps, schema_editor):
    DailyUpdate = apps.get_model("updates", "DailyUpdate")
    for update in DailyUpdate.objects.select_related("created_by"):
        sender = ""
        if update.created_by_id:
            full_name = f"{update.created_by.first_name} {update.created_by.last_name}".strip()
            sender = full_name or update.created_by.username
        lines = [
            "ATUALIZAÇÃO DIÁRIA",
            "",
            f"Data da alocação: {update.allocation_date:%d/%m/%Y}",
            "",
            "PROJETOS:",
        ]
        allocations = update.allocations.select_related("project", "project__site").prefetch_related("collaborators")
        for allocation in allocations.order_by("project__name"):
            project = allocation.project
            code = f" ({project.code})" if project.code else ""
            site = project.site.name if project.site else "Não informado"
            collaborators = ", ".join(allocation.collaborators.order_by("name").values_list("name", flat=True))
            lines.extend(
                (
                    f"• {project.name}{code}",
                    f"  PO: {project.po or 'Não informada'}",
                    f"  Site: {site}",
                    f"  Colaboradores: {collaborators or 'Não informados'}",
                    "",
                )
            )
        if sender:
            lines.append(f"Enviado por: {sender}")
        update.description = "\n".join(lines)
        update.save(update_fields=("description",))


class Migration(migrations.Migration):
    dependencies = [("updates", "0004_dailyupdate_allocations")]
    operations = [migrations.RunPython(refresh_descriptions, migrations.RunPython.noop)]
