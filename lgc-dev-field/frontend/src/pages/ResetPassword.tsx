import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { passwordResetApi } from "../api/resources";
import { usePageText } from "../i18n";

const TEXT = {
  "pt-BR": {
    title: "Redefinir senha", subtitle: "Escolha uma nova senha para sua conta.",
    newPass: "Nova senha", confirm: "Confirmar senha",
    submit: "Salvar nova senha", saving: "Salvando...",
    doneTitle: "Senha redefinida!", doneSubtitle: "Sua senha foi alterada com sucesso.",
    goLogin: "Ir para o login",
    errEmpty: "Informe a nova senha.", errMismatch: "As senhas não coincidem.",
    errInvalidLink: "Link inválido.", errDefault: "Erro ao redefinir a senha. O link pode ter expirado.",
  },
  "en-US": {
    title: "Reset password", subtitle: "Choose a new password for your account.",
    newPass: "New password", confirm: "Confirm password",
    submit: "Save new password", saving: "Saving...",
    doneTitle: "Password reset!", doneSubtitle: "Your password has been changed successfully.",
    goLogin: "Go to login",
    errEmpty: "Please enter a new password.", errMismatch: "Passwords do not match.",
    errInvalidLink: "Invalid link.", errDefault: "Error resetting password. The link may have expired.",
  },
  "es-ES": {
    title: "Restablecer contraseña", subtitle: "Elige una nueva contraseña para tu cuenta.",
    newPass: "Nueva contraseña", confirm: "Confirmar contraseña",
    submit: "Guardar nueva contraseña", saving: "Guardando...",
    doneTitle: "¡Contraseña restablecida!", doneSubtitle: "Tu contraseña ha sido cambiada con éxito.",
    goLogin: "Ir al inicio de sesión",
    errEmpty: "Ingresa la nueva contraseña.", errMismatch: "Las contraseñas no coinciden.",
    errInvalidLink: "Enlace inválido.", errDefault: "Error al restablecer la contraseña. El enlace puede haber expirado.",
  },
};

const NODES = [
  { cx: 60,  cy: 48,  r: 5,   color: "#e05b2b" },
  { cx: 185, cy: 118, r: 3.5, color: "#1e7a4a" },
  { cx: 330, cy: 72,  r: 5.5, color: "#e05b2b" },
  { cx: 520, cy: 155, r: 3.5, color: "#1e7a4a" },
  { cx: 640, cy: 55,  r: 3.5, color: "#1e4a72", stroke: "#4a8fb5" },
  { cx: 148, cy: 210, r: 3.5, color: "#1e4a72", stroke: "#4a8fb5" },
  { cx: 290, cy: 305, r: 4.5, color: "#e05b2b" },
  { cx: 565, cy: 325, r: 3.5, color: "#1e7a4a" },
  { cx: 65,  cy: 328, r: 3.5, color: "#1e4a72", stroke: "#4a8fb5" },
  { cx: 750, cy: 220, r: 3.5, color: "#1e7a4a" },
  { cx: 700, cy: 340, r: 3.5, color: "#1e4a72", stroke: "#4a8fb5" },
  { cx: 420, cy: 280, r: 3,   color: "#1e4a72", stroke: "#4a8fb5" },
];

const EDGES = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,2],[5,6],[6,3],[3,7],[6,8],[3,9],[9,10],[7,10],[6,11],[11,3],
];

export default function ResetPassword() {
  const { uid, token } = useParams<{ uid: string; token: string }>();
  const navigate = useNavigate();
  const p = usePageText(TEXT);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!password) { setError(p.errEmpty); return; }
    if (password !== confirm) { setError(p.errMismatch); return; }
    if (!uid || !token) { setError(p.errInvalidLink); return; }
    setLoading(true);
    try {
      await passwordResetApi.confirm(uid, token, password);
      setDone(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || p.errDefault);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#07111f", padding: 16, position: "relative", overflow: "hidden" }}>
      <svg
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.38, pointerEvents: "none" }}
        viewBox="0 0 800 400"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        {EDGES.map(([a, b], i) => (
          <line key={i} x1={NODES[a].cx} y1={NODES[a].cy} x2={NODES[b].cx} y2={NODES[b].cy} stroke="#1e4a72" strokeWidth="1" />
        ))}
        {NODES.map((n, i) => (
          <circle key={i} cx={n.cx} cy={n.cy} r={n.r} fill={n.color} stroke={n.stroke ?? "none"} strokeWidth={n.stroke ? 1 : 0} />
        ))}
      </svg>

      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 16, padding: "36px 32px", width: "100%", maxWidth: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ marginBottom: 20 }}>
          <img src="/brand-industrial/axis-logo-light.svg" alt="Axis Field" style={{ height: 34 }} />
        </div>

        {done ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#0d1f30", marginBottom: 8 }}>{p.doneTitle}</div>
            <div style={{ fontSize: 13, color: "#7a8a96", marginBottom: 24 }}>{p.doneSubtitle}</div>
            <button
              onClick={() => navigate("/login")}
              style={{ width: "100%", height: 42, borderRadius: 9, background: "#e05b2b", color: "#fff", fontSize: 14.5, fontWeight: 700, border: "none", cursor: "pointer" }}
            >
              {p.goLogin}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0d1f30", marginBottom: 4 }}>{p.title}</div>
            <div style={{ fontSize: 13, color: "#7a8a96", marginBottom: 24 }}>{p.subtitle}</div>

            <label style={{ fontSize: 11.5, fontWeight: 600, color: "#3a4a56", display: "block", marginBottom: 5 }}>{p.newPass}</label>
            <input
              type="password"
              className="input"
              style={{ width: "100%", marginBottom: 14, background: "#f6f8fa", border: "1px solid #d8e0e8" }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />

            <label style={{ fontSize: 11.5, fontWeight: 600, color: "#3a4a56", display: "block", marginBottom: 5 }}>{p.confirm}</label>
            <input
              type="password"
              className="input"
              style={{ width: "100%", background: "#f6f8fa", border: "1px solid #d8e0e8" }}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />

            {error && <p style={{ color: "#c0392b", fontSize: 13, marginTop: 10 }}>{error}</p>}

            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", height: 42, borderRadius: 9, background: loading ? "#c0452a" : "#e05b2b", color: "#fff", fontSize: 14.5, fontWeight: 700, border: "none", cursor: loading ? "not-allowed" : "pointer", marginTop: 20 }}
            >
              {loading ? p.saving : p.submit}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
