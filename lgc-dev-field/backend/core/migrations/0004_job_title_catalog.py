import django.db.models.deletion
from django.db import migrations, models


def migrate_existing_job_titles(apps, schema_editor):
    Collaborator = apps.get_model("core", "Collaborator")
    JobTitle = apps.get_model("core", "JobTitle")

    for collaborator in Collaborator.objects.exclude(job_title=""):
        job_title, _ = JobTitle.objects.get_or_create(
            company_id=collaborator.company_id,
            name=collaborator.job_title,
        )
        collaborator.job_title_new = job_title
        collaborator.save(update_fields=("job_title_new",))


class Migration(migrations.Migration):
    dependencies = [("core", "0003_remove_category_unique_category_name_per_company_and_more")]

    operations = [
        migrations.CreateModel(
            name="JobTitle",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="criado em")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="atualizado em")),
                ("is_active", models.BooleanField(default=True, verbose_name="ativo")),
                ("name", models.CharField(blank=True, max_length=100, verbose_name="nome")),
                ("description", models.TextField(blank=True, verbose_name="descricao")),
                ("company", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="%(class)ss", to="core.company", verbose_name="empresa")),
            ],
            options={"verbose_name": "cargo", "verbose_name_plural": "cargos", "ordering": ("name",)},
        ),
        migrations.AddField(
            model_name="collaborator",
            name="job_title_new",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="collaborators", to="core.jobtitle", verbose_name="cargo"),
        ),
        migrations.RunPython(migrate_existing_job_titles, migrations.RunPython.noop),
        migrations.RemoveField(model_name="collaborator", name="job_title"),
        migrations.RenameField(model_name="collaborator", old_name="job_title_new", new_name="job_title"),
        migrations.AddConstraint(
            model_name="jobtitle",
            constraint=models.UniqueConstraint(condition=~models.Q(name=""), fields=("company", "name"), name="unique_job_title_name_per_company"),
        ),
    ]
