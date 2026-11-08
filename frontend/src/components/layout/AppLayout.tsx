import { Fragment, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { NotificationsDropdown } from "./NotificationsDropdown";

interface NavLinkItem { to: string; label: string; icon: string; permission?: string; }
interface NavGroup { key: string; label: string; icon: string; children: NavLinkItem[]; }
type NavEntry = NavLinkItem | NavGroup;

const NAV_ENTRIES: NavEntry[] = [
  { to: "/dashboard", label: "Dashboard", icon: "▦" },
  { key: "pessoas", label: "Pessoas", icon: "☆", children: [
    { to: "/collaborators", label: "Colaboradores", icon: "☆", permission: "collaborator:read" },
    { to: "/job-titles", label: "Cargos", icon: "◎", permission: "job_title:read" },
    { to: "/work-schedules", label: "Jornadas de Trabalho", icon: "◷", permission: "work_schedule:read" },
    { to: "/sectors", label: "Setores", icon: "▣", permission: "sector:read" },
  ] },
  { key: "clientes-projetos", label: "Clientes e Projetos", icon: "◈", children: [
    { to: "/clients", label: "Clientes", icon: "◈", permission: "client:read" },
    { to: "/projects", label: "Projetos", icon: "⚑", permission: "project:read" },
  ] },
  { key: "requisicoes", label: "Requisições", icon: "✎", children: [
    { to: "/requests", label: "Requisições", icon: "✎", permission: "request:read" },
    { to: "/my-approvals", label: "Minhas Aprovações", icon: "✔", permission: "request:read" },
    { to: "/delegations", label: "Delegações", icon: "⇉", permission: "delegation:read" },
    { to: "/request-categories", label: "Catálogo de requisições", icon: "☰", permission: "request_category:update" },
  ] },
  { key: "administracao", label: "Administração", icon: "⚙", children: [
    { to: "/users", label: "Usuários", icon: "🔑", permission: "user:read" },
    { to: "/roles", label: "Grupos e permissões", icon: "⛭", permission: "user:read" },
    { to: "/cost-centers", label: "Centros de Custo", icon: "⧈", permission: "cost_center:read" },
    { to: "/integrations", label: "Integrações", icon: "⇄", permission: "integration:read" },
    { to: "/sensitive-access-log", label: "Log de acesso sensível", icon: "🛡", permission: "collaborator:read_sensitive" },
  ] },
];

const NAV_GROUPS_STORAGE_KEY = "axis.nav.groups";

function isGroup(entry: NavEntry): entry is NavGroup { return "children" in entry; }
function isActivePath(pathname: string, to: string) { return pathname === to || pathname.startsWith(`${to}/`); }

function readStoredGroups(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(NAV_GROUPS_STORAGE_KEY) ?? "{}") as Record<string, boolean>; } catch { return {}; }
}

function initials(email?: string) { return email ? email.split("@")[0].slice(0, 2).toUpperCase() : "?"; }

export function AppLayout({ breadcrumb, children }: { breadcrumb: string[]; children: ReactNode }) {
  const { user, logout, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [storedGroups, setStoredGroups] = useState<Record<string, boolean>>(readStoredGroups);

  const canSee = (item: NavLinkItem) => !item.permission || hasPermission(item.permission);
  const entries = NAV_ENTRIES.flatMap<NavEntry>((entry) => {
    if (!isGroup(entry)) return canSee(entry) ? [entry] : [];
    const children = entry.children.filter(canSee);
    if (children.length === 0) return [];
    if (children.length === 1) return [children[0]];
    return [{ ...entry, children }];
  });

  const toggleGroup = (key: string, open: boolean) => {
    const next = { ...storedGroups, [key]: !open };
    setStoredGroups(next);
    try { localStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify(next)); } catch { /* preferência só local */ }
  };

  const renderLink = (item: NavLinkItem) => <NavLink key={item.to} to={item.to} onClick={() => setMobileNavOpen(false)}><span aria-hidden className="axis-nav-icon">{item.icon}</span>{item.label}</NavLink>;

  const renderEntry = (entry: NavEntry) => {
    if (!isGroup(entry)) return renderLink(entry);
    const hasActive = entry.children.some((child) => isActivePath(location.pathname, child.to));
    const open = storedGroups[entry.key] ?? hasActive;
    const panelId = `axis-nav-group-${entry.key}`;
    return <div key={entry.key} className="axis-nav-group">
      <button type="button" className={`axis-nav-group-toggle${hasActive ? " axis-nav-group-active" : ""}`} aria-expanded={open} aria-controls={panelId} onClick={() => toggleGroup(entry.key, open)}><span aria-hidden className="axis-nav-icon">{entry.icon}</span><span className="axis-nav-group-label">{entry.label}</span><span aria-hidden className="axis-nav-chevron">▸</span></button>
      {open && <div id={panelId} className="axis-nav-children">{entry.children.map(renderLink)}</div>}
    </div>;
  };

  return <div className="axis-app-shell">
    <header className="axis-app-topbar">
      <div className="axis-app-topbar-brand"><img src="/brand-industrial/axis-logo-dark.svg" alt="Axis ERP + SGI" /></div>
      <button className="axis-mobile-nav-toggle" aria-label={mobileNavOpen ? "Fechar menu" : "Abrir menu"} aria-controls="axis-app-sidebar" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? "×" : "☰"}</button>
      <div className="axis-app-topbar-search"><input aria-label="Buscar" placeholder="Buscar no Axis..." /></div>
      <div className="axis-app-topbar-actions"><button className="axis-topbar-button" onClick={toggleTheme} title="Alternar tema">{theme === "light" ? "☾" : "☀"}</button><NotificationsDropdown /><div className="axis-app-user"><span className="axis-app-avatar">{initials(user?.email)}</span><div><strong>{user?.email}</strong><small>{user?.roles.join(", ")}</small></div></div><button className="axis-topbar-button" onClick={() => void logout()}>Sair</button></div>
    </header>
    <div className="axis-app-body"><aside id="axis-app-sidebar" className={`axis-app-sidebar${mobileNavOpen ? " axis-app-sidebar-open" : ""}`}><nav>{entries.map(renderEntry)}</nav><div className="axis-sidebar-footer"><img src="/brand-industrial/axis-symbol.svg" alt="" /><span>Axis ERP + SGI</span></div></aside><div className="axis-app-content"><nav className="axis-breadcrumb" aria-label="breadcrumb">{breadcrumb.map((crumb, i) => <Fragment key={`${crumb}-${i}`}>{i > 0 && <span>/</span>}<strong>{crumb}</strong></Fragment>)}</nav><main className="axis-app-main">{children}</main></div></div>
  </div>;
}
