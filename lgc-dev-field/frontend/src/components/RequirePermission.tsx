import type { ReactElement } from "react";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n";
import { hasPerm } from "../utils/permissions";

export default function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactElement;
}) {
  const { user } = useAuth();
  const { t } = useI18n();
  if (!hasPerm(user, permission)) {
    return <p style={{ padding: 32, color: "#526174" }}>{t.permission.semAcesso}</p>;
  }
  return children;
}
