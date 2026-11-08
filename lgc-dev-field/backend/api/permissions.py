from rest_framework.permissions import SAFE_METHODS, BasePermission, DjangoModelPermissions


class IsSuperUser(BasePermission):
    """Restringe o acesso a superusuários — usado no Log de Auditoria, que
    no Django Admin só é visível (leitura) para superusuário, sem exceção
    por grupo/permissão."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_superuser)


class ViewAwareModelPermissions(DjangoModelPermissions):
    """Igual ao DjangoModelPermissions, mas também exige a permissão
    'view_<model>' para métodos seguros (GET/HEAD/OPTIONS), em vez de
    liberar leitura para qualquer usuário autenticado.
    """

    def __init__(self):
        super().__init__()
        self.perms_map = dict(self.perms_map)
        self.perms_map["GET"] = ["%(app_label)s.view_%(model_name)s"]
        self.perms_map["OPTIONS"] = ["%(app_label)s.view_%(model_name)s"]
        self.perms_map["HEAD"] = ["%(app_label)s.view_%(model_name)s"]


class RequireChangePermissionForActions:
    """Mixin para ViewSets: exige a permissão 'change_<model>' do Django
    para as actions customizadas listadas em `change_permission_actions`
    (ex: enviar e-mail, gerar PDF), já que essas ações alteram o estado
    do registro mas não são um POST/PUT/PATCH/DELETE padrão do DRF.
    """

    change_permission_actions: tuple[str, ...] = ()

    def get_permissions(self):
        permissions = super().get_permissions()
        if self.action in self.change_permission_actions:
            permissions.append(_HasChangePermission())
        return permissions


class _HasChangePermission(DjangoModelPermissions):
    perms_map = {method: ["%(app_label)s.change_%(model_name)s"] for method in ("GET", "POST", "PUT", "PATCH", "DELETE")}

    def has_permission(self, request, view):
        if not hasattr(view, "get_queryset"):
            return False
        # DjangoModelPermissions ignora métodos "seguros" por padrão; aqui
        # forçamos a checagem também para GET (usado pela action de PDF).
        if request.method not in SAFE_METHODS:
            return super().has_permission(request, view)
        queryset = view.get_queryset()
        perms = self.get_required_permissions("PUT", queryset.model)
        return request.user and request.user.has_perms(perms)


MANAGE_PROJECT_TASKS_PERM = "projects.manage_project_tasks"


class _AnyOfPermissions(BasePermission):
    """Passa quando TODAS as permissões padrão da ação passam OU quando o usuário tem a
    permissão dedicada (ex.: 'gerenciar tarefas do projeto')."""

    def __init__(self, default_permissions, dedicated_perm):
        self.default_permissions = default_permissions
        self.dedicated_perm = dedicated_perm

    def _has_dedicated(self, request):
        user = request.user
        return bool(user and user.is_authenticated and user.has_perm(self.dedicated_perm))

    def has_permission(self, request, view):
        return self._has_dedicated(request) or all(p.has_permission(request, view) for p in self.default_permissions)

    def has_object_permission(self, request, view, obj):
        return self._has_dedicated(request) or all(
            p.has_object_permission(request, view, obj) for p in self.default_permissions
        )


class AllowManageProjectTasks:
    """Mixin para ViewSets: nas ações de `manage_task_actions`, além das permissões padrão
    (que exigem add_/change_ do modelo), aceita quem tem a permissão dedicada
    'projects.manage_project_tasks'. Serve para o gestor despachar e ajustar tarefas sem
    precisar poder criar/excluir projetos ou tarefas."""

    manage_task_actions: tuple[str, ...] = ()

    def get_permissions(self):
        permissions = super().get_permissions()
        if self.action in self.manage_task_actions:
            return [_AnyOfPermissions(permissions, MANAGE_PROJECT_TASKS_PERM)]
        return permissions


class RequireViewPermissionForActions:
    """Mixin para ViewSets: exige só a permissão 'view_<model>' do Django
    para as actions customizadas listadas em `view_permission_actions` —
    usado por ações somente-leitura que usam POST por conveniência (ex:
    simular/consultar algo sem persistir nada), e que por isso NÃO devem
    herdar a exigência padrão do DjangoModelPermissions para POST
    ('add_<model>'), que não faz sentido para uma ação que não cria nada.
    """

    view_permission_actions: tuple[str, ...] = ()

    def get_permissions(self):
        permissions = super().get_permissions()
        if self.action in self.view_permission_actions:
            permissions = [_HasViewPermission()]
        return permissions


class _HasViewPermission(DjangoModelPermissions):
    perms_map = {method: ["%(app_label)s.view_%(model_name)s"] for method in ("GET", "POST", "PUT", "PATCH", "DELETE")}

    def has_permission(self, request, view):
        if not hasattr(view, "get_queryset"):
            return False
        queryset = view.get_queryset()
        perms = self.get_required_permissions("GET", queryset.model)
        return bool(request.user and request.user.has_perms(perms))


def require_perms(*perms):
    """Classe de permissão para APIViews sem queryset: exige todas as
    permissões Django informadas (ex: "projects.add_projecttask")."""

    class _RequirePerms(BasePermission):
        def has_permission(self, request, view):
            return bool(request.user and request.user.is_authenticated and request.user.has_perms(perms))

    return _RequirePerms


class DenyClientScopedUsers(BasePermission):
    """Nega acesso a usuários-cliente (User.client preenchido).
    Gestores com escopo de site são equipe interna e passam normalmente."""

    def has_permission(self, request, view):
        from core.access_scope import is_client_scoped

        return bool(request.user and request.user.is_authenticated) and not is_client_scoped(request.user)


class CableImportPermission(BasePermission):
    """Fluxo guiado de cabos (Cadastros Mestres). Não tem permissões próprias:
    herda as permissões do cadastro de Família de Cabo, porque o fluxo grava
    famílias, aliases e especificações. Leitura exige view; criar a importação
    exige add; aprovar/rejeitar/editar exige change; finalizar exige add nos
    três modelos gravados."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return user.has_perm("master_data.view_cablefamily")
        if getattr(view, "action", None) == "finalize":
            return all(
                user.has_perm(perm)
                for perm in ("master_data.add_cablefamily", "master_data.add_cablealias", "master_data.add_cablespec")
            )
        if getattr(view, "action", None) == "create":
            return user.has_perm("master_data.add_cablefamily")
        return user.has_perm("master_data.change_cablefamily")


class CableWizardPermission(BasePermission):
    """Cadastro guiado de modelo de cabo (passo a passo). Sem permissões
    próprias: usa as do cadastro de cabos. Opções exigem view; a prévia exige
    add de Família; o cadastro exige add de Família, Alias e Especificação."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return user.has_perm("master_data.view_cablefamily")
        if getattr(view, "wizard_action", "") == "preview":
            return user.has_perm("master_data.add_cablefamily")
        return all(
            user.has_perm(perm)
            for perm in ("master_data.add_cablefamily", "master_data.add_cablealias", "master_data.add_cablespec")
        )
