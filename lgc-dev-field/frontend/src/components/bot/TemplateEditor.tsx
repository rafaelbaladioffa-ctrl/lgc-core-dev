import { useEffect, useMemo, useState, type ReactNode } from "react";
import { botMessagesApi } from "../../api/resources";
import type { BotMessageTemplate } from "../../api/types";
import Icon from "../ui/Icon";

interface EditorCopy {
  showTitle: boolean;
  titleLabel: string;
  introLabel: string;
  introHint?: string;
  fieldsLabel: string;
  footerLabel: string;
}

const DEFAULT_COPY: EditorCopy = {
  showTitle: true,
  titleLabel: "Título",
  introLabel: "Texto inicial",
  fieldsLabel: "Informações da mensagem",
  footerLabel: "Texto final",
};

const COPY: Partial<Record<BotMessageTemplate["message_type"], Partial<EditorCopy>>> = {
  allocation: {
    showTitle: false,
    introLabel: "Abertura da mensagem",
    introHint: "Use {nome} para o nome do técnico e {data} para a data da alocação.",
    fieldsLabel: "Informações de cada projeto",
  },
  interactive_menu: {
    showTitle: false,
    introLabel: "Saudação",
    fieldsLabel: "Opções do menu (desmarque para esconder)",
    footerLabel: "Rodapé",
  },
};

const LABEL = { fontSize: 12, fontWeight: 700, color: "var(--text-muted)" } as const;

/** Editor visual do texto de um tipo de mensagem (título, textos, campos
 * habilitados) com prévia do WhatsApp ao lado. */
export default function TemplateEditor({ messageType, children }: { messageType: BotMessageTemplate["message_type"]; children?: ReactNode }) {
  const copy = { ...DEFAULT_COPY, ...(COPY[messageType] || {}) };
  const [draft, setDraft] = useState<BotMessageTemplate | null>(null);
  const [preview, setPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(null);
    setSaved(false);
    setError("");
    botMessagesApi
      .list()
      .then((data) => setDraft(data.find((t) => t.message_type === messageType) || null))
      .catch(() => setError("Não foi possível carregar o texto desta mensagem."));
  }, [messageType]);

  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => {
      botMessagesApi.preview(draft).then((data) => setPreview(data.preview)).catch(() => setPreview(""));
    }, 200);
    return () => clearTimeout(timer);
  }, [draft]);

  const enabledCount = useMemo(() => draft?.field_definitions.filter((f) => draft.enabled_fields[f.key]).length || 0, [draft]);

  function update(patch: Partial<BotMessageTemplate>) {
    setSaved(false);
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      setDraft(await botMessagesApi.update(draft));
      setSaved(true);
    } catch {
      setError("Não foi possível salvar o texto.");
    } finally {
      setSaving(false);
    }
  }

  if (error && !draft) return <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>;
  if (!draft) return <p style={{ color: "var(--text-muted)" }}>Carregando...</p>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 16, alignItems: "start" }}>
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{enabledCount} campo(s) selecionado(s)</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" }}>
            <input type="checkbox" checked={draft.is_active} onChange={(e) => update({ is_active: e.target.checked })} />
            Usar este modelo
          </label>
        </div>

        {copy.showTitle && (
          <>
            <label style={LABEL}>{copy.titleLabel}</label>
            <input className="input" value={draft.title} onChange={(e) => update({ title: e.target.value })} style={{ width: "100%", margin: "6px 0 12px" }} />
          </>
        )}

        <label style={LABEL}>{copy.introLabel}</label>
        {copy.introHint && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{copy.introHint}</div>}
        <textarea className="input" value={draft.intro_text} onChange={(e) => update({ intro_text: e.target.value })} style={{ width: "100%", minHeight: 64, margin: "6px 0 12px" }} />

        <div style={{ ...LABEL, marginBottom: 8 }}>{copy.fieldsLabel}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
          {draft.field_definitions.map((field) => (
            <label key={field.key} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "9px 10px", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
              <input type="checkbox" checked={!!draft.enabled_fields[field.key]} onChange={() => update({ enabled_fields: { ...draft.enabled_fields, [field.key]: !draft.enabled_fields[field.key] } })} />
              {field.label}
            </label>
          ))}
        </div>

        <label style={LABEL}>{copy.footerLabel}</label>
        <textarea className="input" value={draft.footer_text} onChange={(e) => update({ footer_text: e.target.value })} style={{ width: "100%", minHeight: 64, marginTop: 6 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={save} disabled={saving} type="button">
            <Icon name="save" style={{ fontSize: 17 }} />
            {saving ? "Salvando..." : "Salvar texto"}
          </button>
          {saved && <span style={{ color: "var(--green)", fontSize: 13 }}>Texto salvo.</span>}
          {error && <span style={{ color: "var(--red)", fontSize: 13 }}>{error}</span>}
        </div>
        {children}
      </div>

      <div className="card" style={{ padding: 18, position: "sticky", top: 88 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Icon name="chat" style={{ fontSize: 18, color: "var(--green)" }} />
          <b>Prévia WhatsApp</b>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, minHeight: 260, fontFamily: "inherit", fontSize: 13, lineHeight: 1.45, color: "var(--text)" }}>
          {preview || "Selecione os campos para gerar uma prévia."}
        </pre>
      </div>
    </div>
  );
}
