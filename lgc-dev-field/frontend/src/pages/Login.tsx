import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { savedUsername } from "../api/client";
import { passwordResetApi } from "../api/resources";
import { useAuth } from "../context/AuthContext";
import { usePageText } from "../i18n";

const TEXT = {
  "pt-BR": {
    title: "Acesse o sistema",
    user: "Usuário",
    password: "Senha",
    remember: "Salvar usuário",
    forgot: "Esqueci minha senha",
    enter: "Entrar",
    entering: "Entrando...",
    invalidCredentials: "Usuário ou senha inválidos.",
    recoverTitle: "Recuperar senha",
    emailLabel: "E-mail cadastrado",
    sendInstructions: "Enviar instruções",
    sending: "Enviando...",
    sendError: "Erro ao enviar. Tente novamente.",
  },
  "en-US": {
    title: "Sign in",
    user: "Username",
    password: "Password",
    remember: "Remember username",
    forgot: "Forgot my password",
    enter: "Sign in",
    entering: "Signing in...",
    invalidCredentials: "Invalid username or password.",
    recoverTitle: "Recover password",
    emailLabel: "Registered e-mail",
    sendInstructions: "Send instructions",
    sending: "Sending...",
    sendError: "Error sending. Please try again.",
  },
  "es-ES": {
    title: "Acceder al sistema",
    user: "Usuario",
    password: "Contraseña",
    remember: "Guardar usuario",
    forgot: "Olvidé mi contraseña",
    enter: "Entrar",
    entering: "Entrando...",
    invalidCredentials: "Usuario o contraseña inválidos.",
    recoverTitle: "Recuperar contraseña",
    emailLabel: "Correo registrado",
    sendInstructions: "Enviar instrucciones",
    sending: "Enviando...",
    sendError: "Error al enviar. Intente nuevamente.",
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

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const p = usePageText(TEXT);
  const [username, setUsername] = useState(savedUsername.get());
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(() => Boolean(savedUsername.get()));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMsg, setForgotMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      if (remember) {
        savedUsername.set(username);
      } else {
        savedUsername.clear();
      }
      navigate("/");
    } catch {
      setError(p.invalidCredentials);
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

      <form
        onSubmit={handleSubmit}
        style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 16, padding: "36px 32px", width: "100%", maxWidth: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
      >
        <div style={{ marginBottom: 20 }}>
          <img src="/brand-industrial/axis-logo-light.svg" alt="Axis Field" style={{ height: 34 }} />
        </div>

        <div style={{ fontSize: 18, fontWeight: 800, color: "#0d1f30", marginBottom: 20 }}>{p.title}</div>

        <label style={{ fontSize: 11.5, fontWeight: 600, color: "#3a4a56", display: "block", marginBottom: 5 }}>{p.user}</label>
        <input
          className="input"
          style={{ width: "100%", marginBottom: 14, background: "#f6f8fa", border: "1px solid #d8e0e8" }}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />

        <label style={{ fontSize: 11.5, fontWeight: 600, color: "#3a4a56", display: "block", marginBottom: 5 }}>{p.password}</label>
        <input
          type="password"
          className="input"
          style={{ width: "100%", background: "#f6f8fa", border: "1px solid #d8e0e8" }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, marginBottom: 4 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#7a8a96", cursor: "pointer" }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: "#e05b2b" }} />
            {p.remember}
          </label>
          <button
            type="button"
            onClick={() => setShowForgot((v) => !v)}
            style={{ background: "none", border: "none", fontSize: 12.5, color: "#e05b2b", cursor: "pointer", padding: 0 }}
          >
            {p.forgot}
          </button>
        </div>

        {showForgot && (
          <div style={{ marginTop: 10, padding: "14px", borderRadius: 10, background: "#f6f8fa", border: "1px solid #d8e0e8" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0d1f30", marginBottom: 10 }}>{p.recoverTitle}</div>
            {forgotMsg ? (
              <div style={{ fontSize: 12.5, color: forgotMsg.ok ? "#1a6b3a" : "#c0392b", lineHeight: 1.55 }}>{forgotMsg.text}</div>
            ) : (
              <>
                <label style={{ fontSize: 11.5, fontWeight: 600, color: "#3a4a56", display: "block", marginBottom: 5 }}>{p.emailLabel}</label>
                <input
                  type="email"
                  className="input"
                  placeholder="seu@email.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  style={{ width: "100%", marginBottom: 10, background: "#fff", border: "1px solid #d8e0e8" }}
                />
                <button
                  type="button"
                  disabled={forgotLoading}
                  onClick={async () => {
                    if (!forgotEmail.trim()) return;
                    setForgotLoading(true);
                    try {
                      const res = await passwordResetApi.request(forgotEmail.trim());
                      setForgotMsg({ ok: true, text: res.detail });
                    } catch {
                      setForgotMsg({ ok: false, text: p.sendError });
                    } finally {
                      setForgotLoading(false);
                    }
                  }}
                  style={{ width: "100%", height: 36, borderRadius: 8, background: "#e05b2b", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: forgotLoading ? "not-allowed" : "pointer" }}
                >
                  {forgotLoading ? p.sending : p.sendInstructions}
                </button>
              </>
            )}
          </div>
        )}

        {error && <p style={{ color: "#c0392b", fontSize: 13, marginTop: 8 }}>{error}</p>}

        <button
          type="submit"
          disabled={loading}
          style={{ width: "100%", height: 42, borderRadius: 9, background: loading ? "#c0452a" : "#e05b2b", color: "#fff", fontSize: 14.5, fontWeight: 700, border: "none", cursor: loading ? "not-allowed" : "pointer", marginTop: 20, letterSpacing: ".02em" }}
        >
          {loading ? p.entering : p.enter}
        </button>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: "#aab5c0" }}>Axis Field · v2.0</div>
      </form>
    </div>
  );
}
