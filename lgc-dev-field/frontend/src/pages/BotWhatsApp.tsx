import { useState } from "react";
import { botMessagesApi } from "../api/resources";
import BroadcastRules, { type RuleType } from "../components/bot/BroadcastRules";
import Subscribers from "../components/bot/Subscribers";
import TemplateEditor from "../components/bot/TemplateEditor";
import Icon from "../components/ui/Icon";

type Feature = RuleType | "interactive_menu" | "subscribers";

const FEATURES: { key: Feature; title: string; subtitle: string; icon: string }[] = [
  { key: "daily_project_report", title: "Relatório diário de projeto", subtitle: "Texto por projeto ou print", icon: "summarize" },
  { key: "daily_tasks", title: "Tarefas do dia", subtitle: "Resumo gerencial dos projetos alocados", icon: "checklist" },
  { key: "project_updates", title: "Atualização de projetos", subtitle: "Mensagem por projeto do dia", icon: "description" },
  { key: "allocation", title: "Alocação aos técnicos", subtitle: "Cada técnico recebe a sua", icon: "badge" },
  { key: "operations_print", title: "Print da operação", subtitle: "Imagem da Central de Operações", icon: "photo_camera" },
  { key: "interactive_menu", title: "Menu /bot", subtitle: "Conversa que o técnico inicia", icon: "forum" },
  { key: "subscribers", title: "Destinatários e grupos", subtitle: "Quem recebe os envios", icon: "groups" },
];

const BROADCAST_TYPES: Feature[] = ["daily_project_report", "daily_tasks", "project_updates", "allocation", "operations_print"];

function MenuTest() {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await botMessagesApi.testMenu(to.trim());
      setFeedback({ kind: "ok", text: result.detail });
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { detail?: string } } }).response?.data;
      setFeedback({ kind: "error", text: data?.detail || "Não foi possível enviar o menu." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>Testar o menu (salve o texto antes)</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Telefone com DDD ou ID do grupo (@g.us)" style={{ width: 300 }} />
        <button className="btn" onClick={send} disabled={!to.trim() || busy} type="button">
          <Icon name="send" style={{ fontSize: 17 }} />
          {busy ? "Enviando..." : "Enviar menu de teste"}
        </button>
      </div>
      {feedback && <p style={{ margin: "8px 0 0", fontSize: 13, color: feedback.kind === "ok" ? "var(--green)" : "var(--red)" }}>{feedback.text}</p>}
    </div>
  );
}

export default function BotWhatsApp() {
  const [feature, setFeature] = useState<Feature>("daily_project_report");
  const [tab, setTab] = useState<"rules" | "text">("rules");
  const active = FEATURES.find((f) => f.key === feature)!;
  const isBroadcast = BROADCAST_TYPES.includes(feature);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: "var(--text)" }}>Bot WhatsApp</h1>
        <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
          Central de controle do bot: escolha uma função, defina quando e para quem ela é enviada, o que entra na mensagem e teste na hora.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div className="card" style={{ padding: 10 }}>
          {FEATURES.map((f) => {
            const on = f.key === feature;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setFeature(f.key);
                  setTab("rules");
                }}
                style={{
                  width: "100%",
                  border: on ? "1px solid var(--orange)" : "1px solid transparent",
                  background: on ? "rgba(255, 111, 32, 0.08)" : "transparent",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  gap: 10,
                  textAlign: "left",
                  cursor: "pointer",
                  color: "var(--text)",
                }}
              >
                <Icon name={f.icon} style={{ fontSize: 20, color: on ? "var(--orange)" : "var(--text-muted)" }} />
                <span>
                  <b style={{ display: "block", fontSize: 13 }}>{f.title}</b>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{f.subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>{active.title}</h2>

          {isBroadcast && (
            <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: "1px solid var(--border)" }}>
              {(
                [
                  ["rules", "Quando e para quem"],
                  ["text", "Texto da mensagem"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  style={{
                    padding: "9px 14px",
                    fontSize: 13,
                    fontWeight: tab === key ? 700 : 500,
                    cursor: "pointer",
                    background: "transparent",
                    color: tab === key ? "var(--orange)" : "var(--text-muted)",
                    border: "none",
                    borderBottom: tab === key ? "2px solid var(--orange)" : "2px solid transparent",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {isBroadcast && tab === "rules" && <BroadcastRules key={feature} messageType={feature as RuleType} />}
          {isBroadcast && tab === "text" && <TemplateEditor key={feature} messageType={feature as RuleType} />}
          {feature === "interactive_menu" && (
            <TemplateEditor key="menu" messageType="interactive_menu">
              <MenuTest />
            </TemplateEditor>
          )}
          {feature === "subscribers" && <Subscribers />}
        </div>
      </div>
    </div>
  );
}
