import { useState, type FormEvent } from "react";
import { meApi } from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { usePageText } from "../i18n";

const TEXT = {
  "pt-BR": {
    notice: "Este é seu primeiro acesso — antes de continuar, defina uma nova senha.",
    current: "Senha atual (a que você recebeu)",
    newPass: "Nova senha",
    confirm: "Confirmar nova senha",
    mismatch: "A confirmação não confere com a nova senha.",
    empty: "Preencha a senha atual e a nova senha.",
    submit: "Trocar senha e entrar",
    saving: "Salvando...",
    logout: "Sair",
    defaultError: "Não foi possível alterar a senha.",
  },
  "en-US": {
    notice: "This is your first access — please set a new password before continuing.",
    current: "Current password (the one you received)",
    newPass: "New password",
    confirm: "Confirm new password",
    mismatch: "Confirmation does not match the new password.",
    empty: "Please enter your current and new password.",
    submit: "Change password and sign in",
    saving: "Saving...",
    logout: "Sign out",
    defaultError: "Unable to change password.",
  },
  "es-ES": {
    notice: "Este es tu primer acceso — define una nueva contraseña antes de continuar.",
    current: "Contraseña actual (la que recibiste)",
    newPass: "Nueva contraseña",
    confirm: "Confirmar nueva contraseña",
    mismatch: "La confirmación no coincide con la nueva contraseña.",
    empty: "Completa la contraseña actual y la nueva.",
    submit: "Cambiar contraseña e ingresar",
    saving: "Guardando...",
    logout: "Cerrar sesión",
    defaultError: "No fue posible cambiar la contraseña.",
  },
};

export default function ForcePasswordChange() {
  const { logout, refreshUser } = useAuth();
  const p = usePageText(TEXT);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!oldPassword || !newPassword) {
      setError(p.empty);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(p.mismatch);
      return;
    }
    setSaving(true);
    try {
      await meApi.changePassword(oldPassword, newPassword);
      await refreshUser();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || p.defaultError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--navy)", padding: 16 }}>
      <form onSubmit={handleSubmit} className="card" style={{ padding: 36, width: "100%", maxWidth: 380, background: "#fff" }}>
        <div style={{ marginBottom: 22 }}>
          <img src="/brand-industrial/axis-logo-light.svg" alt="Axis Field" style={{ height: 34 }} />
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 22 }}>{p.notice}</p>

        <label className="form-label" style={{ margin: "0 0 6px" }}>{p.current}</label>
        <input className="input" style={{ width: "100%" }} type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoComplete="current-password" autoFocus />

        <label className="form-label">{p.newPass}</label>
        <input className="input" style={{ width: "100%" }} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />

        <label className="form-label">{p.confirm}</label>
        <input className="input" style={{ width: "100%" }} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />

        {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-outline" onClick={logout}>{p.logout}</button>
          <button type="submit" disabled={saving} className="btn btn-primary">{saving ? p.saving : p.submit}</button>
        </div>
      </form>
    </div>
  );
}
