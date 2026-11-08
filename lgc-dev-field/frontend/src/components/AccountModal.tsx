import { useState, type FormEvent } from "react";
import { meApi } from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n";
import Modal from "./ui/Modal";

export default function AccountModal({ onClose }: { onClose: () => void }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const displayName = user?.full_name || user?.username || "";
  const email = user?.email || user?.username || "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!oldPassword || !newPassword) {
      setError(t.account.errCamposObrigatorios);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t.account.errSenhasMismatch);
      return;
    }
    setSaving(true);
    try {
      const result = await meApi.changePassword(oldPassword, newPassword);
      setSuccess(result.detail || t.account.sucesso);
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || t.account.errDefault);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t.account.titulo} subtitle={`${displayName} · ${email}`} onClose={onClose} width={440}>
      <form onSubmit={handleSubmit}>
        <label className="form-label" style={{ marginTop: 0 }}>
          {t.account.senhaAtual}
        </label>
        <input
          className="input"
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          autoComplete="current-password"
        />

        <label className="form-label">{t.account.novaSenha}</label>
        <input
          className="input"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />

        <label className="form-label">{t.account.confirmarSenha}</label>
        <input
          className="input"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />

        {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
        {success && <p style={{ color: "var(--green)", fontSize: 13, marginTop: 10 }}>{success}</p>}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-outline" onClick={logout}>
            {t.account.sairConta}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? t.account.salvando : t.account.salvarSenha}
          </button>
        </div>
      </form>
    </Modal>
  );
}
