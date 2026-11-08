from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models


class User(AbstractUser):
    email = models.EmailField("e-mail", unique=True)
    company = models.ForeignKey(
        "core.Company",
        verbose_name="empresa",
        on_delete=models.PROTECT,
        related_name="users",
        null=True,
        blank=True,
    )
    client = models.ForeignKey(
        "core.Client",
        verbose_name="cliente vinculado",
        on_delete=models.SET_NULL,
        related_name="portal_users",
        null=True,
        blank=True,
        help_text=(
            "Vincule um Cliente para transformar este usuário num usuário-cliente: ele só verá/editará/"
            "excluirá os Projetos deste Cliente (e dos Sites abaixo, se algum for marcado)."
        ),
    )
    client_sites = models.ManyToManyField(
        "core.Site",
        verbose_name="sites permitidos",
        blank=True,
        related_name="portal_users",
        help_text="Restringe o usuário-cliente a estes Sites do Cliente vinculado. Vazio = todos os Sites do Cliente.",
    )
    must_change_password = models.BooleanField(
        "precisa trocar a senha",
        default=False,
        help_text="Marcado automaticamente para usuários recém-criados — força a troca de senha no próximo "
        "login, antes de liberar o acesso ao resto do sistema.",
    )
    client_categories = models.ManyToManyField(
        "core.Category",
        verbose_name="categorias permitidas",
        blank=True,
        related_name="portal_users",
        help_text="Restringe quais Categorias (cadastro) o usuário-cliente vê/edita/exclui. Vazio = sem restrição.",
    )
    manager_sites = models.ManyToManyField(
        "core.Site",
        verbose_name="sites do gestor",
        blank=True,
        related_name="manager_users",
        help_text=(
            "Restringe este usuário interno (gestor) a visualizar/editar apenas os Projetos e dados dos Sites "
            "marcados. O usuário continua sendo equipe interna (sem vínculo de Cliente) — as permissões Django "
            "continuam valendo. Deixe em branco para acesso irrestrito a todos os Sites."
        ),
    )

    class Meta:
        verbose_name = "usuário"
        verbose_name_plural = "usuários"

    def clean(self):
        super().clean()
        if self.pk and self.client_id:
            invalid = [site for site in self.client_sites.all() if site.client_id != self.client_id]
            if invalid:
                names = ", ".join(str(site) for site in invalid)
                raise ValidationError({"client_sites": f"Site(s) que não pertencem ao Cliente vinculado: {names}."})
