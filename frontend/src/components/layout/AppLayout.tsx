import { Fragment, useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { NotificationsDropdown } from "./NotificationsDropdown";
import axisIcon from "../../assets/brand/axis-icon.svg";
import {
  bpmApi,
  type BpmCapabilities,
} from "../../features/requisicoes-bpm/api";

export function isBpmNavigationEnabled(
  capabilities: Pick<BpmCapabilities, "enabled">,
) {
  return capabilities.enabled;
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
  permission?: string;
  bpm?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "▦" },
  {
    to: "/collaborators",
    label: "Colaboradores",
    icon: "☆",
    permission: "collaborator:read",
  },
  {
    to: "/job-titles",
    label: "Cargos",
    icon: "◎",
    permission: "job_title:read",
  },
  {
    to: "/work-schedules",
    label: "Jornadas de Trabalho",
    icon: "◷",
    permission: "work_schedule:read",
  },
  { to: "/sectors", label: "Setores", icon: "▣", permission: "sector:read" },
  {
    to: "/cost-centers",
    label: "Centros de Custo",
    icon: "⧈",
    permission: "cost_center:read",
  },
  { to: "/clients", label: "Clientes", icon: "◈", permission: "client:read" },
  { to: "/projects", label: "Projetos", icon: "⚑", permission: "project:read" },
  {
    to: "/requests",
    label: "Requisições",
    icon: "⚑︎",
    permission: "request:read",
  },
  {
    to: "/requests/bpm",
    label: "Processos (piloto)",
    icon: "↻",
    permission: "request:read",
    bpm: true,
  },
  {
    to: "/my-approvals",
    label: "Minhas Aprovações",
    icon: "✔",
    permission: "request:read",
  },
  {
    to: "/delegations",
    label: "Delegações",
    icon: "⇉",
    permission: "delegation:read",
  },
  {
    to: "/integrations",
    label: "Integrações",
    icon: "⇄",
    permission: "integration:read",
  },
  { to: "/users", label: "Usuários", icon: "🔑", permission: "user:read" },
  {
    to: "/roles",
    label: "Grupos e permissões",
    icon: "⚙",
    permission: "user:read",
  },
  {
    to: "/sensitive-access-log",
    label: "Log de acesso sensível",
    icon: "🛡",
    permission: "collaborator:read_sensitive",
  },
];

const TOPBAR_HEIGHT = 48;
const SIDEBAR_WIDTH = 196;
const BREADCRUMB_HEIGHT = 32;

function initials(email?: string): string {
  if (!email) return "?";
  const name = email.split("@")[0];
  return name.slice(0, 2).toUpperCase();
}

export function AppLayout({
  breadcrumb,
  children,
}: {
  breadcrumb: string[];
  children: ReactNode;
}) {
  const { user, logout, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [bpmVisible, setBpmVisible] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void bpmApi
      .capabilities()
      .then((capabilities) => {
        if (active) setBpmVisible(isBpmNavigationEnabled(capabilities));
      })
      .catch(() => {
        if (active) setBpmVisible(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      (!item.permission || hasPermission(item.permission)) &&
      (!item.bpm || bpmVisible),
  );

  return (
    <div
      className="axis-app-shell"
      style={{ display: "flex", flexDirection: "column", minHeight: "100svh" }}
    >
      <header
        className="axis-app-topbar"
        style={{
          height: TOPBAR_HEIGHT,
          flexShrink: 0,
          background: "var(--bg-topbar)",
          color: "var(--text-topbar)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <div className="axis-app-topbar-spacer" style={{ width: SIDEBAR_WIDTH - 16, flexShrink: 0 }} />

        <button
          className="axis-mobile-nav-toggle"
          aria-label={mobileNavOpen ? "Fechar menu" : "Abrir menu"}
          aria-controls="axis-app-sidebar"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen((open) => !open)}
        >
          {mobileNavOpen ? "×" : "☰"}
        </button>

        <div
          className="axis-app-topbar-search"
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "center",
            padding: "0 24px",
          }}
        >
          <input
            placeholder="Buscar..."
            style={{
              width: "100%",
              maxWidth: 420,
              height: 32,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "var(--text-topbar)",
            }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={toggleTheme}
            title="Alternar tema"
            style={{
              border: "1px solid rgba(255,255,255,0.2)",
              background: "transparent",
              borderRadius: "var(--radius)",
              padding: "0 8px",
              height: 26,
              fontSize: 12,
              color: "var(--text-topbar)",
            }}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
          <NotificationsDropdown />
          <div className="axis-app-topbar-identity" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                background: "var(--brand-gradient)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {initials(user?.email)}
            </span>
            <div style={{ textAlign: "left", lineHeight: 1.2 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{user?.email}</div>
              <div style={{ fontSize: 10, opacity: 0.75 }}>
                {user?.roles.join(", ")}
              </div>
            </div>
          </div>
          <button
            onClick={() => void logout()}
            style={{
              border: "1px solid rgba(255,255,255,0.2)",
              background: "transparent",
              borderRadius: "var(--radius)",
              padding: "0 10px",
              height: 26,
              fontSize: 12,
              color: "var(--text-topbar)",
            }}
          >
            Sair
          </button>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside
          id="axis-app-sidebar"
          className={`axis-app-sidebar${mobileNavOpen ? " axis-app-sidebar-open" : ""}`}
          style={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            background: "var(--bg-sidebar)",
            display: "flex",
            flexDirection: "column",
            position: "sticky",
            top: TOPBAR_HEIGHT,
            height: `calc(100svh - ${TOPBAR_HEIGHT}px)`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "16px 16px 12px",
            }}
          >
            <img
              src={axisIcon}
              alt=""
              width={26}
              height={26}
              style={{ borderRadius: 6, flexShrink: 0 }}
            />
            <div>
              <strong
                style={{ fontSize: 15, color: "#fff", letterSpacing: 0.3 }}
              >
                AXIS
              </strong>
              <div
                className="axis-eyebrow"
                style={{ color: "var(--axis-lavender)", fontSize: 9 }}
              >
                ERP | SGI
              </div>
            </div>
          </div>
          <nav style={{ flex: 1, padding: "6px 0", overflowY: "auto" }}>
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileNavOpen(false)}
                style={({ isActive }) => ({
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 16px",
                  fontSize: 12,
                  textDecoration: "none",
                  color: isActive
                    ? "var(--text-sidebar-active)"
                    : "var(--text-sidebar)",
                  background: isActive
                    ? "var(--bg-sidebar-active)"
                    : "transparent",
                  borderLeft: isActive
                    ? "3px solid var(--accent)"
                    : "3px solid transparent",
                })}
              >
                <span
                  aria-hidden
                  style={{ width: 14, textAlign: "center", fontSize: 12 }}
                >
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <nav
            aria-label="breadcrumb"
            style={{
              height: BREADCRUMB_HEIGHT,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              padding: "0 20px",
              fontSize: 11,
              color: "var(--text-muted)",
              background: "var(--bg-elevated)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {breadcrumb.map((crumb, i) => (
              <Fragment key={crumb}>
                {i > 0 && <span style={{ margin: "0 6px" }}>/</span>}
                <span
                  style={
                    i === breadcrumb.length - 1
                      ? { color: "var(--text)", fontWeight: 600 }
                      : undefined
                  }
                >
                  {crumb}
                </span>
              </Fragment>
            ))}
          </nav>

          <main className="axis-app-main" style={{ flex: 1, padding: 18, overflowX: "auto" }}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
