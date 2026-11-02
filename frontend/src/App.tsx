import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CollaboratorsPage } from "./pages/CollaboratorsPage";
import { CollaboratorFormPage } from "./pages/CollaboratorFormPage";
import { JobTitlesPage } from "./pages/JobTitlesPage";
import { WorkSchedulesPage } from "./pages/WorkSchedulesPage";
import { SectorsPage } from "./pages/SectorsPage";
import { SectorFormPage } from "./pages/SectorFormPage";
import { CostCentersPage } from "./pages/CostCentersPage";
import { CostCenterFormPage } from "./pages/CostCenterFormPage";
import { JobTitleFormPage } from "./pages/JobTitleFormPage";
import { WorkScheduleFormPage } from "./pages/WorkScheduleFormPage";
import { ClientsPage } from "./pages/ClientsPage";
import { ClientFormPage } from "./pages/ClientFormPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectFormPage } from "./pages/ProjectFormPage";
import { RequestsPortalPage } from "./pages/RequestsPortalPage";
import { NewRequestPage } from "./pages/NewRequestPage";
import { MyRequestsPage } from "./pages/MyRequestsPage";
import { RequestsQueuePage } from "./pages/RequestsQueuePage";
import { RequestDetailPage } from "./pages/RequestDetailPage";
import { MyRequestApprovalsPage } from "./pages/MyRequestApprovalsPage";
import { DelegationsPage } from "./pages/DelegationsPage";
import { RequestsDashboardPage } from "./pages/RequestsDashboardPage";
import { ProjectsDashboardPage } from "./pages/ProjectsDashboardPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { SatelliteFormPage } from "./pages/SatelliteFormPage";
import { SensitiveAccessLogPage } from "./pages/SensitiveAccessLogPage";
import { UsersPage } from "./pages/UsersPage";
import { UserFormPage } from "./pages/UserFormPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { RolesPage } from "./pages/RolesPage";

function PrivateRoute({
  children,
  permission,
}: {
  children: React.ReactElement;
  permission?: string;
}) {
  const { user, hasPermission } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  // Temporary password set by admin/RH (PLANNING.md 4.7) — nothing else is reachable until it's
  // changed, regardless of where the user was headed.
  if (user.mustChangePassword)
    return <Navigate to="/change-password" replace />;
  // The sidebar hides modules the user lacks permission for, but that's cosmetic — without this
  // check, typing the URL directly (e.g. /integrations) still rendered the page, which then
  // either errored or showed an empty, misleading screen instead of being blocked outright.
  if (permission && !hasPermission(permission))
    return <Navigate to="/dashboard" replace />;
  return <ErrorBoundary key={location.pathname}>{children}</ErrorBoundary>;
}

function RequireAuthOnly({ children }: { children: React.ReactElement }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/change-password"
        element={
          <RequireAuthOnly>
            <ChangePasswordPage />
          </RequireAuthOnly>
        }
      />
      <Route
        path="/dashboard"
        element={
          <PrivateRoute>
            <DashboardPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/collaborators"
        element={
          <PrivateRoute permission="collaborator:read">
            <CollaboratorsPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/collaborators/new"
        element={
          <PrivateRoute permission="collaborator:create">
            <CollaboratorFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/collaborators/:id/edit"
        element={
          <PrivateRoute permission="collaborator:update">
            <CollaboratorFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/job-titles"
        element={
          <PrivateRoute permission="job_title:read">
            <JobTitlesPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/job-titles/new"
        element={
          <PrivateRoute permission="job_title:create">
            <JobTitleFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/job-titles/:id/edit"
        element={
          <PrivateRoute permission="job_title:update">
            <JobTitleFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/work-schedules"
        element={
          <PrivateRoute permission="work_schedule:read">
            <WorkSchedulesPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/work-schedules/new"
        element={
          <PrivateRoute permission="work_schedule:create">
            <WorkScheduleFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/work-schedules/:id/edit"
        element={
          <PrivateRoute permission="work_schedule:update">
            <WorkScheduleFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/sectors"
        element={
          <PrivateRoute permission="sector:read">
            <SectorsPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/sectors/new"
        element={
          <PrivateRoute permission="sector:create">
            <SectorFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/sectors/:id/edit"
        element={
          <PrivateRoute permission="sector:update">
            <SectorFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/cost-centers"
        element={
          <PrivateRoute permission="cost_center:read">
            <CostCentersPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/cost-centers/new"
        element={
          <PrivateRoute permission="cost_center:create">
            <CostCenterFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/cost-centers/:id/edit"
        element={
          <PrivateRoute permission="cost_center:update">
            <CostCenterFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/clients"
        element={
          <PrivateRoute permission="client:read">
            <ClientsPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/clients/new"
        element={
          <PrivateRoute permission="client:create">
            <ClientFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/clients/:id/edit"
        element={
          <PrivateRoute permission="client:update">
            <ClientFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/projects"
        element={
          <PrivateRoute permission="project:read">
            <ProjectsPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/projects/new"
        element={
          <PrivateRoute permission="project:create">
            <ProjectFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/projects/dashboard"
        element={
          <PrivateRoute permission="project:read">
            <ProjectsDashboardPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/requests"
        element={
          <PrivateRoute permission="request:read">
            <RequestsPortalPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/requests/new"
        element={
          <PrivateRoute permission="request:create">
            <NewRequestPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/requests/mine"
        element={
          <PrivateRoute permission="request:read">
            <MyRequestsPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/requests/queue"
        element={
          <PrivateRoute permission="request:read">
            <RequestsQueuePage />
          </PrivateRoute>
        }
      />
      <Route
        path="/requests/dashboard"
        element={
          <PrivateRoute permission="request:read">
            <RequestsDashboardPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/requests/:id"
        element={
          <PrivateRoute permission="request:read">
            <RequestDetailPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/my-approvals"
        element={
          <PrivateRoute permission="request:read">
            <MyRequestApprovalsPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/delegations"
        element={
          <PrivateRoute permission="delegation:read">
            <DelegationsPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/integrations"
        element={
          <PrivateRoute permission="integration:read">
            <IntegrationsPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/integrations/new"
        element={
          <PrivateRoute permission="integration:manage">
            <SatelliteFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/sensitive-access-log"
        element={
          <PrivateRoute permission="collaborator:read_sensitive">
            <SensitiveAccessLogPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/users"
        element={
          <PrivateRoute permission="user:read">
            <UsersPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/roles"
        element={
          <PrivateRoute permission="user:read">
            <RolesPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/users/new"
        element={
          <PrivateRoute permission="user:create">
            <UserFormPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/users/:id/edit"
        element={
          <PrivateRoute permission="user:update">
            <UserFormPage />
          </PrivateRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </ThemeProvider>
  );
}
