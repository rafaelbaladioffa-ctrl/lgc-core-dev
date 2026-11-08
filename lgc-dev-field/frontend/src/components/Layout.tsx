import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { notificationsApi, searchApi, type GlobalSearchResult } from "../api/resources";
import type { Notification } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useTabs } from "../context/TabsContext";
import { type Locale, LOCALE_LABELS, useI18n } from "../i18n";
import { CADASTROS_PERMS, MASTER_DATA_PERMS, PERMS, hasAnyPerm, hasPerm } from "../utils/permissions";
import { registerPushNotifications } from "../utils/pushNotifications";
import AccountModal from "./AccountModal";
import TabBar from "./TabBar";
import Icon from "./ui/Icon";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  permission?: string;
  permissions?: string[];
  superuserOnly?: boolean;
}

import type { Translations } from "../i18n/translations";

function buildNavGroups(t: Translations): { title: string; items: NavItem[] }[] {
  return [
    {
      title: t.nav.centralOperacoes,
      items: [
        { to: "/operacao-do-dia", label: t.nav.operacaoDoDia, icon: "alt_route", permission: PERMS.viewOperationsBoard },
        { to: "/timeline-operacional", label: t.nav.timelineOperacional, icon: "schedule", permission: PERMS.viewOperationsBoard },
      ],
    },
    {
      title: t.nav.indicadores,
      items: [
        { to: "/gestao-sites", label: t.nav.gestaoSites, icon: "space_dashboard", permission: PERMS.viewProject },
        { to: "/relatorios-indicadores", label: t.nav.relatoriosIndicadores, icon: "bar_chart", permission: PERMS.viewOperationsBoard },
        { to: "/indicadores/tendencias", label: t.nav.tendencias, icon: "show_chart", permission: PERMS.viewOperationsBoard },
      ],
    },
    {
      title: t.nav.projeto,
      items: [
        { to: "/projetos", label: t.nav.projetosAtivos, icon: "folder", permission: PERMS.viewProject },
        { to: "/projetos?tab=history", label: t.nav.historicoProjestos, icon: "history_edu", permission: PERMS.viewProject },
      ],
    },
    {
      title: t.nav.atualizacoes,
      items: [
        { to: "/atualizacoes-diarias", label: t.nav.atualizacoesDiarias, icon: "event_note", permission: PERMS.viewDailyUpdate },
        { to: "/atualizacoes-projeto", label: t.nav.atualizacoesProjetos, icon: "description", permission: PERMS.viewProjectUpdate },
      ],
    },
    {
      title: t.nav.sistema,
      items: [
        { to: "/dashboard", label: t.nav.dashboard, icon: "dashboard", permissions: [PERMS.viewProject, PERMS.viewCollaborator] },
        { to: "/cadastros", label: t.nav.cadastrosGerais, icon: "inventory_2", permissions: CADASTROS_PERMS },
        { to: "/cadastros-mestres", label: t.nav.cadastrosMestres, icon: "schema", permissions: MASTER_DATA_PERMS },
        { to: "/bot-whatsapp", label: "Bot WhatsApp", icon: "smart_toy", permission: PERMS.viewBotMessageTemplate },
      ],
    },
    {
      title: t.nav.tecnico,
      items: [{ to: "/minhas-tarefas", label: t.nav.minhasTarefas, icon: "checklist", permission: PERMS.viewMyTasks }],
    },
    {
      title: t.nav.seguranca,
      items: [{ to: "/auditoria", label: t.nav.log, icon: "history", superuserOnly: true }],
    },
  ];
}

function currentBreadcrumb(pathname: string, search: string, t: Translations) {
  const areaLabels: Record<string, { area: string; areaHref: string; page: string }> = {
    "/gestao-sites": { area: t.nav.indicadores, areaHref: "/indicadores/tendencias", page: t.nav.gestaoSites },
    "/operacao-do-dia": { area: t.nav.centralOperacoes, areaHref: "/operacao-do-dia", page: t.nav.operacaoDoDia },
    "/timeline-operacional": { area: t.nav.centralOperacoes, areaHref: "/operacao-do-dia", page: t.nav.timelineOperacional },
    "/relatorios-indicadores": { area: t.nav.indicadores, areaHref: "/indicadores/tendencias", page: t.nav.relatoriosIndicadores },
    "/indicadores/tendencias": { area: t.nav.indicadores, areaHref: "/indicadores/tendencias", page: t.nav.tendencias },
    "/dashboard": { area: t.nav.sistema, areaHref: "/dashboard", page: t.nav.dashboard },
    "/atualizacoes-diarias": { area: t.nav.atualizacoes, areaHref: "/atualizacoes-diarias", page: t.nav.atualizacoesDiarias },
    "/atualizacoes-projeto": { area: t.nav.atualizacoes, areaHref: "/atualizacoes-diarias", page: t.nav.atualizacoesProjetos },
    "/cadastros": { area: t.nav.sistema, areaHref: "/cadastros", page: t.nav.cadastrosGerais },
    "/cadastros-mestres": { area: t.nav.sistema, areaHref: "/cadastros-mestres", page: t.nav.cadastrosMestres },
    "/bot-whatsapp": { area: t.nav.sistema, areaHref: "/bot-whatsapp", page: "Bot WhatsApp" },
    "/minhas-tarefas": { area: t.nav.tecnico, areaHref: "/minhas-tarefas", page: t.nav.minhasTarefas },
    "/auditoria": { area: t.nav.seguranca, areaHref: "/auditoria", page: t.nav.log },
  };
  if (pathname === "/projetos") {
    const tab = new URLSearchParams(search).get("tab");
    return { area: t.nav.projeto, areaHref: "/projetos", page: tab === "history" ? t.nav.historicoProjestos : t.nav.projetosAtivos };
  }
  const match = Object.keys(areaLabels).find((key) => pathname.startsWith(key));
  if (match) return areaLabels[match];
  if (pathname.startsWith("/projetos/")) return { area: t.nav.projeto, areaHref: "/projetos", page: t.breadcrumb.detalhe };
  return { area: t.breadcrumb.erp, areaHref: "/", page: "" };
}

function isItemActive(item: NavItem, pathname: string, search: string): boolean {
  const [itemPath, itemQuery] = item.to.split("?");
  if (pathname !== itemPath) return false;
  const tab = new URLSearchParams(search).get("tab") || "";
  const itemTab = new URLSearchParams(itemQuery || "").get("tab") || "";
  return tab === itemTab;
}

type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("erp_theme") as Theme | null;
  return stored && THEMES.includes(stored) ? stored : "light";
}

const EMPTY_RESULTS: GlobalSearchResult = { projects: [], sites: [], tasks: [] };

export default function Layout() {
  const { user, logout: authLogout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { openTab, clearTabs } = useTabs();
  const { t, locale, setLocale } = useI18n();

  function logout() {
    clearTabs();
    authLogout();
  }
  const breadcrumb = currentBreadcrumb(location.pathname, location.search, t);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const key = `erp_sidebar_collapsed_${user?.id ?? "anon"}`;
      return JSON.parse(localStorage.getItem(key) || "{}");
    } catch { return {}; }
  });
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GlobalSearchResult>(EMPTY_RESULTS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(() =>
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(`erp_sidebar_mini_${user?.id ?? "anon"}`) === "1"; } catch { return false; }
  });
  const settingsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("erp_theme", theme);
  }, [theme]);

  useEffect(() => {
    function loadUnreadCount() {
      notificationsApi.unreadCount().then((data) => setUnreadCount(data.count));
    }
    loadUnreadCount();
    const timer = setInterval(loadUnreadCount, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notifOpen) return;
    setNotifLoading(true);
    notificationsApi
      .list()
      .then((data) => setNotifications(data.results))
      .finally(() => setNotifLoading(false));
  }, [notifOpen]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(`erp_sidebar_mini_${user?.id ?? "anon"}`, next ? "1" : "0"); } catch {}
      return next;
    });
  }, [user?.id]);


  useEffect(() => {
    const term = searchQuery.trim();
    if (term.length < 2) {
      setSearchResults(EMPTY_RESULTS);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchApi
        .search(term)
        .then((data) => {
          if (!cancelled) setSearchResults(data);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const groups = useMemo(() => {
    return buildNavGroups(t).map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.superuserOnly) return !!user?.is_superuser;
        return item.permissions ? hasAnyPerm(user, item.permissions) : hasPerm(user, item.permission!);
      }),
    })).filter((group) => group.items.length > 0);
  }, [user, t]);

  function isGroupOpen(title: string) {
    return !collapsedGroups[title];
  }

  function toggleGroup(title: string) {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [title]: !prev[title] };
      try { localStorage.setItem(`erp_sidebar_collapsed_${user?.id ?? "anon"}`, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const hasAnyModule = buildNavGroups(t).some((group) =>
    group.items.some((item) => (item.superuserOnly ? user?.is_superuser : item.permissions ? hasAnyPerm(user, item.permissions) : hasPerm(user, item.permission!)))
  );

  const displayName = user?.full_name || user?.username || "";
  const email = user?.email || user?.username || "";
  const role = user?.is_superuser ? t.layout.roleAdmin : t.layout.roleUsuario;
  const initials = (displayName || email).slice(0, 2).toUpperCase();

  const hasResults = searchResults.projects.length > 0 || searchResults.sites.length > 0 || searchResults.tasks.length > 0;
  const term = searchQuery.trim();

  function goTo(path: string, tabLabel?: string, tabIcon?: string) {
    navigate(path);
    setSearchOpen(false);
    setSearchQuery("");
    if (tabLabel) {
      openTab({ id: path, label: tabLabel, path, icon: tabIcon || "folder" });
    }
  }

  function openNotification(notification: Notification) {
    setNotifOpen(false);
    if (!notification.is_read) {
      notificationsApi.markRead(notification.id).then(() => {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      });
    }
    if (notification.url) navigate(notification.url);
  }

  function handleMarkAllRead() {
    notificationsApi.markAllRead().then(() => {
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    });
  }

  function formatNotifDate(value: string) {
    const date = new Date(value);
    return date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="app-shell">
      <header className="shellbar">
        <button className="mobile-menu-btn" aria-label={t.layout.abrirMenu} onClick={() => setMobileMenuOpen(true)}>
          <Icon name="menu" style={{ fontSize: 22 }} />
        </button>
        <Link to="/dashboard" className="shellbar-brand" style={{ textDecoration: "none" }}>
          <img src="/brand-industrial/axis-logo-dark.svg" alt="Axis Field" className="shellbar-brand-logo" />
        </Link>

        <div className="shellbar-search" ref={searchRef} style={{ position: "relative" }}>
          <Icon name="search" style={{ fontSize: 17 }} />
          <input
            type="text"
            placeholder={t.search.placeholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
          />
          {searchOpen && term.length >= 2 && (
            <div className="search-dropdown">
              {searching && <div className="search-dropdown-empty">{t.search.buscando}</div>}
              {!searching && !hasResults && <div className="search-dropdown-empty">{t.search.semResultadosPara(term)}</div>}
              {!searching && searchResults.projects.length > 0 && (
                <div className="search-dropdown-group">
                  <div className="search-dropdown-title">{t.search.projetos}</div>
                  {searchResults.projects.map((p) => (
                    <button key={`p-${p.id}`} className="search-dropdown-item" onClick={() => goTo(`/projetos/${p.id}`, p.name || p.code, "folder")}>
                      <Icon name="folder" style={{ fontSize: 17 }} />
                      <div>
                        <div className="search-dropdown-item-title">
                          {p.name} {p.po && <span className="search-dropdown-item-muted">· PO {p.po}</span>}
                        </div>
                        <div className="search-dropdown-item-muted">
                          {p.code} {p.client && `· ${p.client}`} {p.site && `· ${p.site}`}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!searching && searchResults.sites.length > 0 && (
                <div className="search-dropdown-group">
                  <div className="search-dropdown-title">{t.search.sites}</div>
                  {searchResults.sites.map((s) => (
                    <button key={`s-${s.id}`} className="search-dropdown-item" onClick={() => goTo("/cadastros")}>
                      <Icon name="location_on" style={{ fontSize: 17 }} />
                      <div>
                        <div className="search-dropdown-item-title">{s.name}</div>
                        <div className="search-dropdown-item-muted">
                          {s.code} {s.client && `· ${s.client}`} {s.city && `· ${s.city}`}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!searching && searchResults.tasks.length > 0 && (
                <div className="search-dropdown-group">
                  <div className="search-dropdown-title">{t.search.tarefas}</div>
                  {searchResults.tasks.map((t) => (
                    <button key={`t-${t.id}`} className="search-dropdown-item" onClick={() => goTo(`/projetos/${t.project_id}`)}>
                      <Icon name="checklist" style={{ fontSize: 17 }} />
                      <div>
                        <div className="search-dropdown-item-title">{t.task_name}</div>
                        <div className="search-dropdown-item-muted">
                          {t.project_code} — {t.project_name} · {t.status_display}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shellbar-spacer" />
        {pushPermission !== "granted" && pushPermission !== "denied" && (
          <button
            className="shellbar-icon-btn"
            aria-label={t.notif.ativarNotificacoes}
            title={t.notif.ativarNotificacoes}
            onClick={async () => {
              const ok = await registerPushNotifications();
              setPushPermission(Notification.permission);
              if (!ok && Notification.permission === "denied") {
                alert(t.layout.notifBloqueadas);
              }
            }}
          >
            <Icon name="add_alert" style={{ fontSize: 18 }} />
          </button>
        )}
        <div ref={notifRef} style={{ position: "relative" }}>
          <button className="shellbar-icon-btn" aria-label={t.notif.titulo} onClick={() => setNotifOpen((v) => !v)} style={{ position: "relative" }}>
            <Icon name="notifications" style={{ fontSize: 18 }} />
            {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
          </button>
          {notifOpen && (
            <div className="search-dropdown" style={{ right: 0, left: "auto", width: 340 }}>
              <div className="settings-dropdown-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 4px" }}>
                <span>{t.notif.titulo}</span>
                {unreadCount > 0 && (
                  <button className="btn btn-outline btn-sm" style={{ padding: "2px 8px", fontSize: 11 }} onClick={handleMarkAllRead}>
                    {t.notif.marcarLidas}
                  </button>
                )}
              </div>
              {notifLoading && <div className="search-dropdown-empty">{t.common.carregando}</div>}
              {!notifLoading && notifications.length === 0 && <div className="search-dropdown-empty">{t.notif.semNotificacoes}</div>}
              {!notifLoading &&
                notifications.map((n) => (
                  <button
                    key={n.id}
                    className="search-dropdown-item"
                    onClick={() => openNotification(n)}
                    style={{ background: n.is_read ? undefined : "var(--blue-soft)" }}
                  >
                    <Icon name="notifications" style={{ fontSize: 17 }} />
                    <div>
                      <div className="search-dropdown-item-title">{n.title}</div>
                      <div className="search-dropdown-item-muted">{n.message}</div>
                      <div className="search-dropdown-item-muted">{formatNotifDate(n.created_at)}</div>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </div>
        <div ref={settingsRef} style={{ position: "relative" }}>
          <button className="shellbar-icon-btn" aria-label={t.layout.configuracoes} onClick={() => setSettingsOpen((v) => !v)}>
            <Icon name="settings" style={{ fontSize: 18 }} />
          </button>
          {settingsOpen && (
            <div className="settings-dropdown">
              <div className="settings-dropdown-title">{t.settings.tema}</div>
              <div className="settings-theme-toggle">
                <button
                  className={theme === "light" ? "active" : ""}
                  onClick={() => setTheme("light")}
                >
                  <Icon name="light_mode" style={{ fontSize: 16 }} />
                  {t.settings.claro}
                </button>
                <button
                  className={theme === "dark" ? "active" : ""}
                  onClick={() => setTheme("dark")}
                >
                  <Icon name="dark_mode" style={{ fontSize: 16 }} />
                  {t.settings.escuro}
                </button>
              </div>
              <div className="settings-dropdown-sep" />
              <div className="settings-dropdown-title">{t.settings.idioma}</div>
              <div className="settings-locale-select">
                {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
                  <button
                    key={loc}
                    className={locale === loc ? "active" : ""}
                    onClick={() => setLocale(loc)}
                  >
                    {LOCALE_LABELS[loc]}
                  </button>
                ))}
              </div>
              <div className="settings-dropdown-sep" />
              <button
                className="settings-dropdown-item"
                onClick={() => {
                  setSettingsOpen(false);
                  setAccountOpen(true);
                }}
              >
                <Icon name="account_circle" style={{ fontSize: 18 }} />
                {t.settings.minhaConta}
              </button>
              <button className="settings-dropdown-item" onClick={logout}>
                <Icon name="logout" style={{ fontSize: 18 }} />
                {t.settings.sair}
              </button>
            </div>
          )}
        </div>
        <div className="shellbar-avatar" title={displayName}>
          {initials}
        </div>
      </header>

      {accountOpen && <AccountModal onClose={() => setAccountOpen(false)} />}

      <TabBar />


      <div className="app-below-shell">
        {mobileMenuOpen && <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} />}
        <aside className={`sidebar${mobileMenuOpen ? " sidebar-open" : ""}${sidebarCollapsed ? " sidebar-mini" : ""}`}>
          <div className="sidebar-mobile-head">
            <span>{t.layout.menuMobile}</span>
            <button className="sidebar-close-btn" aria-label={t.layout.fecharMenu} onClick={() => setMobileMenuOpen(false)}>
              <Icon name="close" style={{ fontSize: 18 }} />
            </button>
          </div>

          {!sidebarCollapsed && !hasAnyModule && (
            <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "0 10px" }}>
              {t.layout.semModulo}
            </p>
          )}

          {groups.map((group, idx) => {
            const open = isGroupOpen(group.title);
            return (
              <div key={group.title || idx} className="sidebar-group">
                {!sidebarCollapsed && (
                  <button
                    type="button"
                    className="sidebar-group-title sidebar-group-toggle"
                    onClick={() => toggleGroup(group.title)}
                    aria-expanded={open}
                  >
                    <span>{group.title}</span>
                    <Icon name={open ? "expand_less" : "expand_more"} style={{ fontSize: 16 }} />
                  </button>
                )}
                {(open || sidebarCollapsed) &&
                  group.items.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`sidebar-link${isItemActive(item, location.pathname, location.search) ? " active" : ""}`}
                      title={sidebarCollapsed ? item.label : undefined}
                    >
                      <Icon name={item.icon} />
                      {!sidebarCollapsed && <span className="sidebar-link-label">{item.label}</span>}
                      {!sidebarCollapsed && (
                        <button
                          className="sidebar-link-tab-btn"
                          aria-label={t.layout.abrirEmGuia(item.label)}
                          title={t.layout.abrirEmGuiaTip}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // abre a guia e permanece na tela atual
                            openTab({ id: item.to, label: item.label, path: item.to, icon: item.icon });
                          }}
                        >
                          <Icon name="add" style={{ fontSize: 13 }} />
                        </button>
                      )}
                    </Link>
                  ))}
              </div>
            );
          })}

          <div className="sidebar-spacer" />

          {!sidebarCollapsed && (
            <>
              <button className="sidebar-collapse-link" onClick={toggleSidebarCollapsed}>
                {t.layout.recolher}
              </button>
              <div className="sidebar-footer">
                <div className="sidebar-footer-user">
                  <div className="sidebar-footer-avatar">{initials}</div>
                  <div>
                    <div className="sidebar-user">{displayName}</div>
                    <div className="sidebar-org">{role} &middot; Axis Field</div>
                  </div>
                </div>
                <button className="sidebar-logout" onClick={logout}>
                  <Icon name="logout" style={{ fontSize: 16 }} />
                  {t.settings.sair}
                </button>
              </div>
            </>
          )}
          {sidebarCollapsed && (
            <div className="sidebar-footer-mini">
              <button className="sidebar-logout sidebar-logout-mini" onClick={logout} title={t.settings.sair}>
                <Icon name="logout" style={{ fontSize: 16 }} />
              </button>
              <button
                className="sidebar-logout sidebar-logout-mini"
                aria-label={t.layout.expandirMenu}
                onClick={toggleSidebarCollapsed}
                title={t.layout.expandirMenu}
              >
                <Icon name="chevron_right" style={{ fontSize: 18 }} />
              </button>
            </div>
          )}
        </aside>

        <div className="app-main">
          <div className="crumbbar">
            {breadcrumb.page ? (
              <Link to={breadcrumb.areaHref} className="crumb-link">{breadcrumb.area}</Link>
            ) : (
              <span>{breadcrumb.area}</span>
            )}
            {breadcrumb.page && (
              <>
                <Icon name="chevron_right" style={{ fontSize: 15 }} />
                <b>{breadcrumb.page}</b>
              </>
            )}
            <div className="crumbbar-right">
              <span className="topbar-user-email">{email}</span>
            </div>
          </div>
          <main className="app-content">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
