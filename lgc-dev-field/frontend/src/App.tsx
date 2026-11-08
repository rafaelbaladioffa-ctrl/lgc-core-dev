import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import RequirePermission from "./components/RequirePermission";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { TabsProvider } from "./context/TabsContext";
import { useI18n } from "./i18n";
import AuditLog from "./pages/AuditLog";
import BotWhatsApp from "./pages/BotWhatsApp";
import IndicatorsTrends from "./pages/IndicatorsTrends";
import ResetPassword from "./pages/ResetPassword";
import CadastrosPage from "./pages/cadastros/CadastrosPage";
import Dashboard from "./pages/Dashboard";
import DailyUpdates from "./pages/DailyUpdates";
import Login from "./pages/Login";
import MasterDataPage from "./pages/master-data/MasterDataPage";
import MyTasks from "./pages/MyTasks";
import OperationsBoard from "./pages/OperationsBoard";
import OperationsReportsPage from "./pages/OperationsReports";
import ManagementReportPage from "./pages/ManagementReport";
import TimelineOperacional from "./pages/TimelineOperacional";
import ProjectDetail from "./pages/ProjectDetail";
import ProjectsList from "./pages/ProjectsList";
import ProjectUpdates from "./pages/ProjectUpdates";
import SitesMap from "./pages/SitesMap";
import SitesPanel from "./pages/SitesPanel";
import { CADASTROS_PERMS, MASTER_DATA_PERMS, PERMS, hasAnyPerm, hasPerm } from "./utils/permissions";

function RequireSuperuser({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useI18n();
  if (!user?.is_superuser) {
    return <p style={{ padding: 32, color: "#526174" }}>{t.permission.superuserOnly}</p>;
  }
  return <>{children}</>;
}

function HomeRedirect() {
  const { user } = useAuth();
  const { t } = useI18n();
  if (hasPerm(user, PERMS.viewProject)) return <Navigate to="/dashboard" replace />;
  if (hasPerm(user, PERMS.viewDailyUpdate)) return <Navigate to="/atualizacoes-diarias" replace />;
  if (hasPerm(user, PERMS.viewProjectUpdate)) return <Navigate to="/atualizacoes-projeto" replace />;
  if (hasPerm(user, PERMS.viewMyTasks)) return <Navigate to="/minhas-tarefas" replace />;
  if (hasAnyPerm(user, CADASTROS_PERMS)) return <Navigate to="/cadastros" replace />;
  return <p style={{ padding: 32, color: "#526174" }}>{t.layout.semModulo}</p>;
}

function RequireAnyPermission({ permissions, children }: { permissions: string[]; children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useI18n();
  if (!hasAnyPerm(user, permissions)) {
    return <p style={{ padding: 32, color: "#526174" }}>{t.permission.semModulo}</p>;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <TabsProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/redefinir-senha/:uid/:token" element={<ResetPassword />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<HomeRedirect />} />
          <Route
            path="/operacao-do-dia"
            element={
              <RequirePermission permission={PERMS.viewOperationsBoard}>
                <OperationsBoard />
              </RequirePermission>
            }
          />
          <Route
            path="/timeline-operacional"
            element={
              <RequirePermission permission={PERMS.viewOperationsBoard}>
                <TimelineOperacional />
              </RequirePermission>
            }
          />
          <Route
            path="/relatorios-indicadores"
            element={
              <RequirePermission permission={PERMS.viewOperationsBoard}>
                <OperationsReportsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/relatorios-indicadores/gerencial"
            element={
              <RequirePermission permission={PERMS.viewOperationsBoard}>
                <ManagementReportPage />
              </RequirePermission>
            }
          />
          <Route
            path="/indicadores/tendencias"
            element={
              <RequirePermission permission={PERMS.viewOperationsBoard}>
                <IndicatorsTrends />
              </RequirePermission>
            }
          />
          <Route
            path="/gestao-sites"
            element={
              <RequirePermission permission={PERMS.viewProject}>
                <SitesPanel />
              </RequirePermission>
            }
          />
          <Route
            path="/dashboard"
            element={
              <RequireAnyPermission permissions={[PERMS.viewProject, PERMS.viewCollaborator]}>
                <Dashboard />
              </RequireAnyPermission>
            }
          />
          <Route
            path="/projetos"
            element={
              <RequirePermission permission={PERMS.viewProject}>
                <ProjectsList />
              </RequirePermission>
            }
          />
          <Route
            path="/projetos/:id"
            element={
              <RequirePermission permission={PERMS.viewProject}>
                <ProjectDetail />
              </RequirePermission>
            }
          />
          <Route
            path="/atualizacoes-diarias"
            element={
              <RequirePermission permission={PERMS.viewDailyUpdate}>
                <DailyUpdates />
              </RequirePermission>
            }
          />
          <Route
            path="/atualizacoes-projeto"
            element={
              <RequirePermission permission={PERMS.viewProjectUpdate}>
                <ProjectUpdates />
              </RequirePermission>
            }
          />
          <Route
            path="/minhas-tarefas"
            element={
              <RequirePermission permission={PERMS.viewMyTasks}>
                <MyTasks />
              </RequirePermission>
            }
          />
          <Route
            path="/cadastros"
            element={
              <RequireAnyPermission permissions={CADASTROS_PERMS}>
                <CadastrosPage />
              </RequireAnyPermission>
            }
          />
          <Route
            path="/cadastros-mestres"
            element={
              <RequireAnyPermission permissions={MASTER_DATA_PERMS}>
                <MasterDataPage />
              </RequireAnyPermission>
            }
          />
          <Route
            path="/bot-whatsapp"
            element={
              <RequirePermission permission={PERMS.viewBotMessageTemplate}>
                <BotWhatsApp />
              </RequirePermission>
            }
          />
          <Route
            path="/sites/mapa"
            element={
              <RequirePermission permission={PERMS.viewSite}>
                <SitesMap />
              </RequirePermission>
            }
          />
          <Route
            path="/auditoria"
            element={
              <RequireSuperuser>
                <AuditLog />
              </RequireSuperuser>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </TabsProvider>
    </AuthProvider>
  );
}
