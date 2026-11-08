"""Escopo de acesso do usuário-cliente (ver users.User.client/client_sites/
client_categories, em Usuários e Acessos): restringe QUAIS linhas de
Projeto/Categoria um usuário consegue ver/editar/excluir, além das
permissões padrão do Django (add/change/delete/view).

Um usuário vira "usuário-cliente" quando tem um Cliente vinculado
(User.client) — nesse caso ele só enxerga os Projetos daquele Cliente (e,
se preenchidos, só dos Sites e/ou Categorias marcados nele — client_sites e
client_categories filtram Projeto diretamente, além de restringir o próprio
cadastro de Categorias). Usuários sem Cliente vinculado (equipe interna) não
têm nenhuma restrição adicional.

Usado tanto pelo Django Admin (projects/admin.py, core/admin.py) quanto pela
API (api/views.py) — uma única fonte de verdade para a regra de negócio.
"""


def get_scope_for_user(user):
    """Retorna None se o usuário não tem nenhuma restrição (superusuário,
    anônimo, ou sem restrição configurada). Caso contrário, retorna um dict
    {"clients": set|None, "sites": set[int]|None, "categories": set[int]|None}
    — None numa dimensão específica significa "sem restrição nessa dimensão".

    Dois perfis de restrição existem:
    - Usuário-cliente (User.client preenchido): restrito a um Cliente, e
      opcionalmente a Sites e Categorias desse Cliente.
    - Gestor com escopo de site (User.manager_sites não vazio): usuário
      interno restrito a Sites específicos, sem restrição por Cliente."""
    if not user or not getattr(user, "is_authenticated", False):
        return {"clients": set(), "sites": set(), "categories": set()}
    if user.is_superuser:
        return None
    # Usuário-cliente: restrito a Cliente + Sites/Categorias opcionais.
    if user.client_id:
        site_ids = set(user.client_sites.values_list("id", flat=True))
        category_ids = set(user.client_categories.values_list("id", flat=True))
        return {
            "clients": {user.client_id},
            "sites": site_ids if site_ids else None,
            "categories": category_ids if category_ids else None,
        }
    # Gestor com escopo de site: sem restrição por Cliente, restrito a Sites.
    manager_site_ids = set(user.manager_sites.values_list("id", flat=True))
    if manager_site_ids:
        return {"clients": None, "sites": manager_site_ids, "categories": None}
    return None


def is_client_scoped(user):
    """Retorna True apenas para usuários-cliente (User.client preenchido).
    Gestores com escopo de site são usuários internos — retornam False."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return bool(getattr(user, "client_id", None))


def scope_project_queryset(
    queryset, user, *, field_prefix="", client_field="client_id", site_field="site_id", category_field="category_id"
):
    """Filtra `queryset` pelo escopo de Cliente/Site/Categoria do usuário.
    Use `field_prefix` (ex: "project__") quando o queryset não é de Project
    diretamente, mas tem uma FK para Project (ex: ProjectTask, RackPosition)."""
    scope = get_scope_for_user(user)
    if scope is None:
        return queryset
    if scope["clients"] is not None:
        queryset = queryset.filter(**{f"{field_prefix}{client_field}__in": scope["clients"]})
    if scope["sites"] is not None:
        queryset = queryset.filter(**{f"{field_prefix}{site_field}__in": scope["sites"]})
    if scope["categories"] is not None:
        queryset = queryset.filter(**{f"{field_prefix}{category_field}__in": scope["categories"]})
    return queryset


def scope_category_queryset(queryset, user):
    scope = get_scope_for_user(user)
    if scope is None:
        return queryset
    if scope["categories"] is not None:
        queryset = queryset.filter(id__in=scope["categories"])
    return queryset


def user_can_access_project(user, project):
    if project is None:
        return True
    scope = get_scope_for_user(user)
    if scope is None:
        return True
    if scope["clients"] is not None and project.client_id not in scope["clients"]:
        return False
    if scope["sites"] is not None and project.site_id not in scope["sites"]:
        return False
    if scope["categories"] is not None and project.category_id not in scope["categories"]:
        return False
    return True


def scope_client_queryset(queryset, user, *, client_field="id"):
    """Filtra `queryset` para o(s) Cliente(s) do escopo do usuário. Use
    `client_field="id"` quando o queryset é de Client diretamente, ou o nome
    da FK (ex: "client_id") quando é de um modelo relacionado a Client.
    Gestores com escopo de site (clients=None) não têm restrição por Cliente."""
    scope = get_scope_for_user(user)
    if scope is None:
        return queryset
    if scope["clients"] is None:
        return queryset
    return queryset.filter(**{f"{client_field}__in": scope["clients"]})


def scope_site_queryset(queryset, user, *, client_field="client_id", site_field="id"):
    """Filtra `queryset` de Site (ou relacionado) pelo Cliente e, se
    restrito, pelos Sites marcados no escopo do usuário.
    Gestores com escopo de site (clients=None) são filtrados só por Sites,
    sem restrição por Cliente."""
    scope = get_scope_for_user(user)
    if scope is None:
        return queryset
    if scope["clients"] is not None:
        queryset = queryset.filter(**{f"{client_field}__in": scope["clients"]})
    if scope["sites"] is not None:
        queryset = queryset.filter(**{f"{site_field}__in": scope["sites"]})
    return queryset


def deny_if_client_scoped(queryset, user):
    """Para cadastros internos que um usuário-cliente não deve enxergar de
    forma alguma (Empresas, Colaboradores, Cargos, Responsáveis, Tipos de
    Projeto, Tarefas do catálogo etc): nega acesso total se o usuário for
    usuário-cliente. Gestores com escopo de site são equipe interna e
    enxergam esses cadastros normalmente."""
    if is_client_scoped(user):
        return queryset.none()
    return queryset


def user_can_access_category(user, category):
    if category is None:
        return True
    scope = get_scope_for_user(user)
    if scope is None:
        return True
    if scope["categories"] is not None and category.id not in scope["categories"]:
        return False
    return True


def scope_related_queryset(queryset, user):
    """Restringe as opções de um campo de relação gravável ao escopo do
    usuário-cliente: Projeto, Cliente, Site, Categoria e qualquer modelo com
    FK `project` para Projeto. Outros modelos ficam como estão."""
    from core.models import Category, Client, Site
    from projects.models import Project

    model = queryset.model
    if model is Project:
        return scope_project_queryset(queryset, user)
    if model is Client:
        return scope_client_queryset(queryset, user)
    if model is Site:
        return scope_site_queryset(queryset, user)
    if model is Category:
        return scope_category_queryset(queryset, user)
    project_field = next((f for f in model._meta.get_fields() if f.name == "project" and f.is_relation), None)
    if project_field is not None and project_field.related_model is Project:
        return scope_project_queryset(queryset, user, field_prefix="project__")
    return queryset
