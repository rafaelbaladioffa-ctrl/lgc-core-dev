from projects.models import ProjectTask


class MyTask(ProjectTask):
    """Proxy de ProjectTask usado apenas para dar ao módulo Técnico
    (Admin e API) suas próprias permissões (technical.view_mytask,
    technical.change_mytask), independentes das permissões gerais de
    projects.ProjectTask usadas na gestão de projetos."""

    class Meta:
        proxy = True
        app_label = "technical"
        verbose_name = "Minha Tarefa"
        verbose_name_plural = "Minhas Tarefas"
