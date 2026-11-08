import json

from django import forms
from django.contrib import admin, messages
from django.http import FileResponse
from django.shortcuts import redirect
from django.urls import path, reverse
from django.utils.dateparse import parse_date
from django.utils.html import format_html, format_html_join
from unfold.admin import ModelAdmin, TabularInline

from core.admin_mixins import SelectablePageSizeAdminMixin
from core.models import Collaborator
from projects.models import Project
from .mail import send_daily_update_emails
from .models import DailyUpdate, DailyUpdateAllocation, ProjectDailyUpdate, tomorrow
from .pdf import build_daily_updates_pdf
from .project_client_mail import build_project_update_body, send_project_daily_update_email
from .project_pdf import build_project_daily_update_pdf


class DailyUpdateAllocationForm(forms.ModelForm):
    class Meta:
        model = DailyUpdateAllocation
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["project"].queryset = Project.objects.filter(
            status__in=(Project.STATUS_IN_PROGRESS, Project.STATUS_PLANNING)
        ).select_related("site")
        self.fields["collaborators"].queryset = Collaborator.objects.filter(is_active=True).order_by("person__name")

    def clean(self):
        cleaned_data = super().clean()
        project = cleaned_data.get("project")
        collaborators = cleaned_data.get("collaborators")
        if project and collaborators:
            invalid = collaborators.exclude(person__company_id=project.company_id)
            if invalid.exists():
                self.add_error(
                    "collaborators",
                    "Todos os Técnicos devem pertencer à mesma Empresa do Projeto selecionado.",
                )
        return cleaned_data


class DailyUpdateAllocationInline(TabularInline):
    model = DailyUpdateAllocation
    form = DailyUpdateAllocationForm
    fields = ("project", "collaborators")
    autocomplete_fields = ("project", "collaborators")
    extra = 1
    min_num = 1
    validate_min = True
    verbose_name = "Projeto e Técnicos"
    verbose_name_plural = "Projetos e Técnicos"


@admin.register(DailyUpdate)
class DailyUpdateAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    change_list_template = "admin/updates/dailyupdate/change_list.html"
    inlines = (DailyUpdateAllocationInline,)
    actions = ("send_daily_update_emails_action",)
    list_display = (
        "allocation_date",
        "projects_display",
        "site_display",
        "collaborators_display",
        "created_by",
        "created_at",
    )
    list_filter = ("allocation_date", "allocations__project__company", "allocations__project__site")
    search_fields = (
        "allocations__project__code",
        "allocations__project__name",
        "allocations__project__po",
        "allocations__project__site__code",
        "allocations__project__site__name",
        "allocations__collaborators__person__name",
    )
    readonly_fields = ("site_readonly", "description_display", "created_by", "created_at", "updated_at")
    fields = (
        "allocation_date",
        "site_readonly",
        "description_display",
        "created_by",
        "created_at",
        "updated_at",
    )
    date_hierarchy = "allocation_date"

    def get_urls(self):
        return [
            path(
                "pdf-consolidado/",
                self.admin_site.admin_view(self.consolidated_pdf_view),
                name="updates_dailyupdate_consolidated_pdf",
            )
        ] + super().get_urls()

    def changelist_view(self, request, extra_context=None):
        extra_context = extra_context or {}
        extra_context["pdf_default_date"] = tomorrow().isoformat()
        return super().changelist_view(request, extra_context=extra_context)

    def consolidated_pdf_view(self, request):
        allocation_date = parse_date(request.GET.get("date", ""))
        if not allocation_date:
            messages.error(request, "Informe uma data válida para gerar o PDF.")
            return redirect(reverse("admin:updates_dailyupdate_changelist"))

        updates = (
            DailyUpdate.objects.filter(allocation_date=allocation_date)
            .select_related("created_by")
            .prefetch_related("allocations__project__site", "allocations__collaborators")
        )
        if not updates.exists():
            messages.warning(request, "Não existem Atualizações Diárias para a data selecionada.")
            return redirect(reverse("admin:updates_dailyupdate_changelist"))

        filename = f"atualizacao-diaria-{allocation_date:%Y-%m-%d}.pdf"
        return FileResponse(
            build_daily_updates_pdf(updates, allocation_date),
            content_type="application/pdf",
            as_attachment=False,
            filename=filename,
        )

    @admin.action(description="Enviar e-mail aos técnicos alocados")
    def send_daily_update_emails_action(self, request, queryset):
        total_sent, total_skipped = 0, []
        for daily_update in queryset:
            sent, skipped = send_daily_update_emails(daily_update)
            total_sent += len(sent)
            total_skipped.extend(skipped)

        if total_sent:
            messages.success(request, f"{total_sent} e-mail(s) enviado(s) com sucesso.")
        if total_skipped:
            nomes = ", ".join(sorted(set(total_skipped)))
            messages.warning(
                request,
                f"Técnico(s) sem e-mail cadastrado, envio ignorado para: {nomes}.",
            )
        if not total_sent and not total_skipped:
            messages.warning(request, "Nenhum técnico alocado nas Atualizações Diárias selecionadas.")

    def save_model(self, request, obj, form, change):
        if not obj.created_by_id:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        form.instance.refresh_description()

    @admin.display(description="Projetos")
    def projects_display(self, obj):
        projects = [allocation.project for allocation in obj.allocations.select_related("project").order_by("project__name")]
        if not projects:
            return "—"
        links = format_html_join(
            ", ",
            '<a href="/admin/projects/project/{}/overview/">{}</a>',
            ((project.pk, project.name) for project in projects[:2]),
        )
        suffix = format_html(" e mais {}", len(projects) - 2) if len(projects) > 2 else ""
        return format_html("{}{}", links, suffix)

    @admin.display(description="Sites", empty_value="—")
    def site_display(self, obj):
        return ", ".join(obj.sites) or None

    @admin.display(description="Site do Projeto", empty_value="Definido após selecionar o Projeto")
    def site_readonly(self, obj):
        if not obj or not obj.pk:
            return None
        return ", ".join(obj.sites) or None

    @admin.display(description="Técnicos")
    def collaborators_display(self, obj):
        allocations = list(obj.allocations.select_related("project").prefetch_related("collaborators"))
        if not allocations:
            return "—"
        summaries = []
        for allocation in allocations[:2]:
            names = list(allocation.collaborators.values_list("person__name", flat=True))
            visible = names[:2]
            suffix = f" +{len(names) - 2}" if len(names) > 2 else ""
            summaries.append(f"{allocation.project.name}: {', '.join(visible)}{suffix}")
        if len(allocations) > 2:
            summaries.append(f"mais {len(allocations) - 2} projeto(s)")
        return " | ".join(summaries)

    @admin.display(description="Descritivo para Envio")
    def description_display(self, obj):
        if not obj or not obj.pk:
            return "O descritivo será gerado após salvar a Atualização Diária."
        return format_html(
            '<div style="white-space: pre-wrap; max-width: 900px; user-select: text">{}</div>',
            obj.description or obj.build_description(),
        )

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .select_related("created_by")
            .prefetch_related("allocations__project__site", "allocations__collaborators")
            .distinct()
        )


@admin.register(ProjectDailyUpdate)
class ProjectDailyUpdateAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    actions = ("send_project_update_emails_action",)
    list_display = (
        "date",
        "project",
        "client_display",
        "status_display",
        "created_by",
        "created_at",
    )
    list_filter = ("date", "project__client", "project__company")
    search_fields = (
        "project__code",
        "project__name",
        "project__client__legal_name",
        "project__client__trade_name",
        "summary",
    )
    autocomplete_fields = ("project",)
    filter_horizontal = ("collaborators",)
    readonly_fields = ("preview_display", "created_by", "sent_at", "created_at", "updated_at")
    date_hierarchy = "date"

    class Media:
        js = ("updates/js/generate-update-button.js",)

    def response_add(self, request, obj, post_url_continue=None):
        # Ao criar, os campos calculados (colaboradores, percentual, atividades
        # etc.) só existem depois do primeiro save. Em vez de mandar o usuário
        # de volta para a lista, já abrimos a tela de edição com tudo
        # preenchido — sem precisar salvar e reabrir manualmente.
        request.POST = request.POST.copy()
        request.POST["_continue"] = "1"
        messages.info(request, "Atualização gerada a partir do projeto. Revise os campos abaixo antes de enviar.")
        return super().response_add(request, obj, post_url_continue)

    def get_fields(self, request, obj=None):
        if obj is None:
            # Na criação os campos abaixo ainda não existem: são preenchidos
            # automaticamente a partir do projeto assim que a atualização é salva.
            return ("project", "date", "summary")
        return (
            "project",
            "date",
            "collaborators",
            "completion_percent",
            "activities_text",
            "certification_done",
            "project_finished",
            "summary",
            "preview_display",
            "created_by",
            "sent_at",
            "created_at",
            "updated_at",
        )

    def get_urls(self):
        return [
            path(
                "<int:object_id>/pdf/",
                self.admin_site.admin_view(self.download_pdf_view),
                name="updates_projectdailyupdate_pdf",
            )
        ] + super().get_urls()

    def download_pdf_view(self, request, object_id):
        project_update = self.get_object(request, object_id)
        if project_update is None:
            messages.error(request, "Atualização Diária de Projeto não encontrada.")
            return redirect(reverse("admin:updates_projectdailyupdate_changelist"))

        filename = f"atualizacao-projeto-{project_update.project.code or project_update.project_id}-{project_update.date:%Y-%m-%d}.pdf"
        return FileResponse(
            build_project_daily_update_pdf(project_update),
            content_type="application/pdf",
            as_attachment=False,
            filename=filename,
        )

    @admin.display(description="Cliente")
    def client_display(self, obj):
        client = obj.project.client
        return str(client) if client else "—"

    @admin.display(description="Prévia do E-mail")
    def preview_display(self, obj):
        if not obj or not obj.pk:
            return "A prévia será gerada após salvar a Atualização Diária de Projeto."
        body = build_project_update_body(obj)
        pdf_url = reverse("admin:updates_projectdailyupdate_pdf", args=[obj.pk])
        js_body = json.dumps(body)
        return format_html(
            '<div style="white-space: pre-wrap; max-width: 900px; user-select: text">{}</div>'
            '<div style="margin-top: 10px; display:flex; gap: 14px; align-items:center">'
            '<a href="{}" target="_blank" style="color:#F16023; font-weight: 600">Baixar PDF (papel timbrado)</a>'
            '<button type="button" onclick="navigator.clipboard.writeText({}); '
            "this.textContent='Copiado!'; setTimeout(() => {{ this.textContent='Copiar Texto'; }}, 1500);\" "
            'style="background:#F16023;color:#fff;border:none;padding:6px 14px;'
            'border-radius:6px;cursor:pointer;font-size:13px">Copiar Texto</button>'
            "</div>",
            body,
            pdf_url,
            js_body,
        )

    @admin.display(description="Situação")
    def status_display(self, obj):
        if obj.is_sent:
            return format_html('<span style="color:#16a34a">Enviado em {}</span>', obj.sent_at.strftime("%d/%m/%Y %H:%M"))
        return format_html('<span style="color:#d97706">Não enviado</span>')

    def save_model(self, request, obj, form, change):
        if not obj.created_by_id:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    @admin.action(description="Enviar por e-mail ao(s) responsável(is) do cliente")
    def send_project_update_emails_action(self, request, queryset):
        total_sent, total_skipped, no_responsible = 0, [], []
        for project_update in queryset.select_related("project", "project__client"):
            if not project_update.project.client_id:
                no_responsible.append(str(project_update))
                continue
            sent, skipped = send_project_daily_update_email(project_update)
            total_sent += len(sent)
            total_skipped.extend(skipped)
            if not sent and not skipped:
                no_responsible.append(str(project_update))

        if total_sent:
            messages.success(request, f"{total_sent} e-mail(s) enviado(s) com sucesso.")
        if total_skipped:
            nomes = ", ".join(sorted(set(total_skipped)))
            messages.warning(
                request,
                f"Responsável(is) sem e-mail cadastrado, envio ignorado para: {nomes}.",
            )
        if no_responsible:
            itens = ", ".join(no_responsible)
            messages.warning(
                request,
                f"Sem cliente ou responsável ativo cadastrado para: {itens}.",
            )
