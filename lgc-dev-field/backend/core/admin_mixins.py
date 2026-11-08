import csv

from django import forms
from django.contrib import admin, messages
from django.contrib.admin.views.main import ChangeList
from django.http import HttpResponse
from django.shortcuts import redirect
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html

from .csv_io import build_csv_content, get_csv_fields, import_csv_rows


class SelectablePageSizeChangeList(ChangeList):
    PAGE_SIZES = {"10": 10, "50": 50, "100": 100, "all": 1_000_000_000}

    def __init__(
        self,
        request,
        model,
        list_display,
        list_display_links,
        list_filter,
        date_hierarchy,
        search_fields,
        list_select_related,
        list_per_page,
        list_max_show_all,
        list_editable,
        model_admin,
        sortable_by,
        search_help_text,
    ):
        self.selected_page_size = request.GET.get("per_page", "10")
        if self.selected_page_size not in self.PAGE_SIZES:
            self.selected_page_size = "10"
        list_per_page = self.PAGE_SIZES[self.selected_page_size]
        super().__init__(
            request,
            model,
            list_display,
            list_display_links,
            list_filter,
            date_hierarchy,
            search_fields,
            list_select_related,
            list_per_page,
            list_max_show_all,
            list_editable,
            model_admin,
            sortable_by,
            search_help_text,
        )

    def get_filters_params(self, params=None):
        lookup_params = super().get_filters_params(params)
        lookup_params.pop("per_page", None)
        return lookup_params


class SelectablePageSizeAdminMixin:
    list_per_page = 10
    change_list_template = "admin/change_list_with_page_size.html"

    def get_changelist(self, request, **kwargs):
        return SelectablePageSizeChangeList

    def get_list_display(self, request):
        list_display = tuple(super().get_list_display(request))
        if "edit_link" not in list_display:
            list_display += ("edit_link",)
        return list_display

    @admin.display(description="Editar")
    def edit_link(self, obj):
        opts = obj._meta
        url = reverse(
            f"admin:{opts.app_label}_{opts.model_name}_change",
            args=(obj.pk,),
            current_app=self.admin_site.name,
        )
        return format_html('<a href="{}">Editar</a>', url)


class CSVImportForm(forms.Form):
    csv_file = forms.FileField(
        label="Arquivo CSV",
        widget=forms.ClearableFileInput(
            attrs={"class": "csv-picker__input", "accept": ".csv,text/csv"}
        ),
    )


class CSVImportExportMixin:
    """Adiciona 'Importar CSV' e 'Exportar CSV' a qualquer ModelAdmin de
    Cadastros Gerais, derivando as colunas automaticamente dos campos
    editáveis do model — sem precisar mapear coluna por coluna a cada novo
    cadastro. Campos de relação (ForeignKey) são exportados/importados pelo
    texto do __str__ do registro relacionado.
    """

    change_list_template = "admin/core/csv_buttons_change_list.html"

    def get_csv_fields(self):
        return get_csv_fields(self.model)

    def get_urls(self):
        opts = self.model._meta
        custom_urls = [
            path(
                "export-csv/",
                self.admin_site.admin_view(self.export_csv_view),
                name=f"{opts.app_label}_{opts.model_name}_export_csv",
            ),
            path(
                "import-csv/",
                self.admin_site.admin_view(self.import_csv_view),
                name=f"{opts.app_label}_{opts.model_name}_import_csv",
            ),
        ]
        return custom_urls + super().get_urls()

    def export_csv_view(self, request):
        opts = self.model._meta
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{opts.model_name}.csv"'
        response.write(build_csv_content(self.model, self.get_queryset(request)))
        return response

    def import_csv_view(self, request):
        opts = self.model._meta
        form = CSVImportForm(request.POST or None, request.FILES or None)
        fields = self.get_csv_fields()

        if request.method == "POST" and form.is_valid():
            uploaded_file = form.cleaned_data["csv_file"]
            try:
                content = uploaded_file.read().decode("utf-8-sig")
                created, errors = import_csv_rows(self.model, content)

                if created:
                    self.message_user(request, f"{created} registro(s) importado(s) com sucesso.")
                if errors:
                    self.message_user(request, " | ".join(errors[:5]), level=messages.ERROR)
                if created and not errors:
                    return redirect(f"admin:{opts.app_label}_{opts.model_name}_changelist")
            except (UnicodeDecodeError, csv.Error, ValueError) as exc:
                self.message_user(request, str(exc), level=messages.ERROR)

        context = {
            **self.admin_site.each_context(request),
            "title": f"Importar {opts.verbose_name_plural} via CSV",
            "opts": opts,
            "form": form,
            "columns": [str(field.verbose_name) for field in fields],
            "changelist_url": reverse(f"admin:{opts.app_label}_{opts.model_name}_changelist"),
        }
        return TemplateResponse(request, "admin/core/csv_import.html", context)
