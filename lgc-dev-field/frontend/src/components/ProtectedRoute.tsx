import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import ForcePasswordChange from "../pages/ForcePasswordChange";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) return <p style={{ padding: 32 }}>Carregando...</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <ForcePasswordChange />;
  return children;
}
