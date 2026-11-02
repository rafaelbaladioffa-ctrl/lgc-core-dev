import { Fragment, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { NotificationsDropdown } from "./NotificationsDropdown";

interface NavItem { to: string; label: string; icon: string; permission?: string; children?: NavItem[]; }

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "▦" },
  { to: "/collaborators", label: "Colaboradores", icon: "☆", permission: "collaborator:read" },
  { to: "/job-titles", label: "Cargos", icon: "◎", permission: "job_title:read" },
  { to: "/work-schedules", label: "Jornadas de Trabalho", icon: "◷", permission: "work_schedule:read" },
  { to: "/sectors", label: "Setores", icon: "▣", permission: "sector:read" },
  { to: "/cost-centers", label: "Centros de Custo", icon: "⧈", permission: "cost_center:read" },
  { to: "/clients", label: "Clientes", icon: "◈", permission: "client:read" },
  { to: "/projects", label: "Projetos", icon: "⚑", permission: "project:read" },
  { to: "/requests", label: "Requisições", icon: "⚑︎", permission: "request:read" },
  { to: "/my-approvals", label: "Minhas Aprovações", icon: "✔", permission: "request:read" },
  { to: "/delegations", label: "Delegações", icon: "⇉", permission: "delegation:read" },
  { to: "/integrations", label: "Integrações", icon: "⇄", permission: "integration:read" },
  { to: "/users", label: "Usuários", icon: "🔑", permission: "user:read" },
  { to: "/roles", label: "Grupos e permissões", icon: "⚙", permission: "user:read" },
  { to: "/sensitive-access-log", label: "Log de acesso sensível", icon: "🛡", permission: "collaborator:read_sensitive" },
];

function initials(email?: string) { return email ? email.split("@")[0].slice(0, 2).toUpperCase() : "?"; }

export function AppLayout({ breadcrumb, children }: { breadcrumb: string[]; children: ReactNode }) {
  const { user, logout, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const items = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));
  return <div className="axis-app-shell">
    <header className="axis-app-topbar">
      <div className="axis-app-topbar-brand"><img src="/brand-industrial/axis-logo-dark.svg" alt="Axis ERP + SGI" /></div>
      <button className="axis-mobile-nav-toggle" aria-label={mobileNavOpen ? "Fechar menu" : "Abrir menu"} aria-controls="axis-app-sidebar" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? "×" : "☰"}</button>
      <div className="axis-app-topbar-search"><input aria-label="Buscar" placeholder="Buscar no Axis..." /></div>
      <div className="axis-app-topbar-actions"><button className="axis-topbar-button" onClick={toggleTheme} title="Alternar tema">{theme === "light" ? "☾" : "☀"}</button><NotificationsDropdown /><div className="axis-app-user"><span className="axis-app-avatar">{initials(user?.email)}</span><div><strong>{user?.email}</strong><small>{user?.roles.join(", ")}</small></div></div><button className="axis-topbar-button" onClick={() => void logout()}>Sair</button></div>
    </header>
    <div className="axis-app-body"><aside id="axis-app-sidebar" className={`axis-app-sidebar${mobileNavOpen ? " axis-app-sidebar-open" : ""}`}><nav>{items.map((item) => <Fragment key={item.to}><NavLink to={item.to} end={item.to === "/requests"} onClick={() => setMobileNavOpen(false)}><span aria-hidden className="axis-nav-icon">{item.icon}</span>{item.label}</NavLink>{item.children && location.pathname.startsWith("/requests") && <div className="axis-nav-children">{item.children.map((child) => <NavLink key={child.to} to={child.to} end onClick={() => setMobileNavOpen(false)}><span aria-hidden className="axis-nav-icon">{child.icon}</span>{child.label}</NavLink>)}</div>}</Fragment>)}</nav><div className="axis-sidebar-footer"><img src="/brand-industrial/axis-symbol.svg" alt="" /><span>Axis ERP + SGI</span></div></aside><div className="axis-app-content"><nav className="axis-breadcrumb" aria-label="breadcrumb">{breadcrumb.map((crumb, i) => <Fragment key={`${crumb}-${i}`}>{i > 0 && <span>/</span>}<strong>{crumb}</strong></Fragment>)}</nav><main className="axis-app-main">{children}</main></div></div>
  </div>;
}
