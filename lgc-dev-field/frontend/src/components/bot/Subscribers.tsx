import SearchSelect from "../ui/SearchSelect";
import { useEffect, useState } from "react";
import { botSubscribersApi } from "../../api/resources";
import type { BotGroup, BotSubscriber } from "../../api/types";
import Icon from "../ui/Icon";

const LABEL = { fontSize: 12, fontWeight: 700, color: "var(--text-muted)" } as const;

const FLAGS: { key: keyof BotSubscriber; label: string }[] = [
  { key: "receives_daily_project_report", label: "Relatório diário de projeto" },
  { key: "receives_daily_tasks", label: "Tarefas do dia" },
  { key: "receives_project_updates", label: "Atualização de projetos" },
  { key: "receives_operations_print", label: "Print da operação" },
];

function emptySubscriber(): BotSubscriber {
  return {
    name: "",
    phone: "",
    group_jid: "",
    is_active: true,
    receives_daily_tasks: true,
    receives_project_updates: true,
    receives_operations_print: true,
    receives_daily_project_report: true,
  };
}

function SubscriberCard({
  initial,
  groups,
  onSaved,
  onDeleted,
}: {
  initial: BotSubscriber;
  groups: BotGroup[];
  onSaved: (s: BotSubscriber) => void;
  onDeleted: (id?: number) => void;
}) {
  const [sub, setSub] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const isGroup = !!sub.group_jid;

  function patch(change: Partial<BotSubscriber>) {
    setFeedback(null);
    setSub((prev) => ({ ...prev, ...change }));
  }

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      const saved = sub.id ? await botSubscribersApi.update(sub.id, sub) : await botSubscribersApi.create(sub);
      setSub(saved);
      onSaved(saved);
      setFeedback({ kind: "ok", text: "Salvo." });
    } catch (err: unknown) {
      const data = (err as { response?: { data?: unknown } }).response?.data;
      setFeedback({ kind: "error", text: data ? JSON.stringify(data) : "Não foi possível salvar." });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!sub.id) return onDeleted(undefined);
    if (!window.confirm(`Excluir "${sub.name}"?`)) return;
    await botSubscribersApi.remove(sub.id);
    onDeleted(sub.id);
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 12, opacity: sub.is_active ? 1 : 0.75 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={LABEL}>Nome</div>
          <input className="input" value={sub.name} onChange={(e) => patch({ name: e.target.value })} style={{ width: "100%", marginTop: 6 }} />
        </div>
        <div>
          <div style={LABEL}>Tipo de destino</div>
          <SearchSelect
            options={[{ value: "person", label: "Pessoa (telefone)" }, { value: "group", label: "Grupo do WhatsApp" }]}
            value={isGroup ? "group" : "person"}
            onChange={(v) => patch(v === "group" ? { phone: "", group_jid: sub.group_jid || "@g.us" } : { group_jid: "" })}
            clearable={false}
            style={{ marginTop: 6 }}
          />
        </div>
        {isGroup ? (
          <div>
            <div style={LABEL}>Grupo</div>
            <SearchSelect
              options={groups.map((g) => ({ value: g.jid, label: g.nome }))}
              value={groups.some((g) => g.jid === sub.group_jid) ? sub.group_jid : ""}
              onChange={(v) => v && patch({ group_jid: String(v) })}
              placeholder={groups.length ? "Escolher um grupo do bot…" : "Nenhum grupo carregado"}
              clearable={false}
              style={{ marginTop: 6 }}
            />
            <input className="input" value={sub.group_jid} onChange={(e) => patch({ group_jid: e.target.value })} placeholder="ou cole o ID (termina em @g.us)" style={{ width: "100%", marginTop: 6 }} />
          </div>
        ) : (
          <div>
            <div style={LABEL}>Telefone com DDD</div>
            <input className="input" value={sub.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="(11) 99999-9999" style={{ width: "100%", marginTop: 6 }} />
          </div>
        )}
      </div>

      <div style={{ ...LABEL, marginBottom: 6 }}>Recebe por padrão (quando a regra não escolhe destinatários)</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
        {FLAGS.map((f) => (
          <label key={f.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={!!sub[f.key]} onChange={(e) => patch({ [f.key]: e.target.checked } as Partial<BotSubscriber>)} />
            {f.label}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !sub.name.trim()} type="button">
          <Icon name="save" style={{ fontSize: 17 }} />
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button className="btn" onClick={remove} type="button">
          <Icon name="delete" style={{ fontSize: 17 }} />
          Excluir
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)", marginLeft: "auto" }}>
          <input type="checkbox" checked={sub.is_active} onChange={(e) => patch({ is_active: e.target.checked })} />
          Ativo
        </label>
        {feedback && <span style={{ fontSize: 13, color: feedback.kind === "ok" ? "var(--green)" : "var(--red)" }}>{feedback.text}</span>}
      </div>
    </div>
  );
}

function SubscriberRow({
  sub,
  onEdit,
  onToggle,
  onDelete,
}: {
  sub: BotSubscriber;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const defaults = FLAGS.filter((f) => sub[f.key]).map((f) => f.label);
  return (
    <div className="card" style={{ padding: "12px 16px", marginBottom: 10, display: "flex", gap: 14, alignItems: "center", opacity: sub.is_active ? 1 : 0.6 }}>
      <Icon name={sub.group_jid ? "groups" : "person"} style={{ fontSize: 22, color: "var(--text-muted)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{sub.name}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
          {sub.group_jid ? `Grupo · ${sub.group_jid}` : sub.phone}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Recebe por padrão: {defaults.length ? defaults.join(", ") : "nada"}
        </div>
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-muted)" }}>
        <input type="checkbox" checked={sub.is_active} onChange={onToggle} />
        {sub.is_active ? "Ativo" : "Pausado"}
      </label>
      <button className="btn" type="button" onClick={onEdit}>
        <Icon name="edit" style={{ fontSize: 17 }} />
        Editar
      </button>
      <button className="btn" type="button" onClick={onDelete} title="Excluir">
        <Icon name="delete" style={{ fontSize: 17 }} />
      </button>
    </div>
  );
}

export default function Subscribers() {
  const [subs, setSubs] = useState<BotSubscriber[] | null>(null);
  // null = tela da lista; senão, o destinatário aberto na tela de cadastro/edição.
  const [editing, setEditing] = useState<{ key: number; sub: BotSubscriber } | null>(null);
  const [nextKey, setNextKey] = useState(1);
  const [notice, setNotice] = useState("");
  const [groups, setGroups] = useState<BotGroup[]>([]);
  const [groupsError, setGroupsError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    botSubscribersApi
      .list()
      .then(setSubs)
      .catch(() => setError("Não foi possível carregar os destinatários."));
    botSubscribersApi
      .groups()
      .then(setGroups)
      .catch((err) => setGroupsError(err?.response?.data?.detail || "Não foi possível listar os grupos do bot agora."));
  }, []);

  if (error) return <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>;
  if (!subs) return <p style={{ color: "var(--text-muted)" }}>Carregando...</p>;

  function openEditor(sub: BotSubscriber) {
    setNotice("");
    setEditing({ key: nextKey, sub });
    setNextKey((k) => k + 1);
  }

  async function toggleActive(sub: BotSubscriber) {
    if (!sub.id) return;
    const updated = await botSubscribersApi.update(sub.id, { ...sub, is_active: !sub.is_active });
    setSubs((prev) => (prev || []).map((x) => (x.id === updated.id ? updated : x)));
  }

  async function removeSub(sub: BotSubscriber) {
    if (!sub.id || !window.confirm(`Excluir "${sub.name}"?`)) return;
    await botSubscribersApi.remove(sub.id);
    setSubs((prev) => (prev || []).filter((x) => x.id !== sub.id));
  }

  // ---- tela de cadastro / edição
  if (editing) {
    return (
      <div>
        <button className="btn" type="button" onClick={() => setEditing(null)} style={{ marginBottom: 14 }}>
          <Icon name="arrow_back" style={{ fontSize: 17 }} />
          Voltar para os destinatários cadastrados
        </button>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>{editing.sub.id ? "Editar destinatário" : "Novo destinatário"}</h3>
        {groupsError && <p style={{ color: "var(--orange)", fontSize: 12.5, margin: "0 0 10px" }}>{groupsError}</p>}
        <SubscriberCard
          key={editing.key}
          initial={editing.sub}
          groups={groups}
          onSaved={(saved) => {
            setSubs((prev) => {
              const list = prev || [];
              const next = list.some((x) => x.id === saved.id) ? list.map((x) => (x.id === saved.id ? saved : x)) : [...list, saved];
              return next.sort((a, b) => a.name.localeCompare(b.name));
            });
            setNotice(`"${saved.name}" salvo.`);
            setEditing(null);
          }}
          onDeleted={(id) => {
            if (id) setSubs((prev) => (prev || []).filter((x) => x.id !== id));
            setEditing(null);
          }}
        />
      </div>
    );
  }

  // ---- tela da lista de destinatários cadastrados
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12.5, maxWidth: 640 }}>
          Pessoas ou grupos de WhatsApp que recebem os envios. Nas regras você pode escolher destinatários específicos; sem escolha, valem as
          caixas "recebe por padrão" de cada um.
        </p>
        <button className="btn btn-primary" type="button" onClick={() => openEditor(emptySubscriber())}>
          <Icon name="add" style={{ fontSize: 17 }} />
          Novo destinatário
        </button>
      </div>
      {notice && <p style={{ color: "var(--green)", fontSize: 13, margin: "0 0 10px" }}>{notice}</p>}

      {subs.map((s) => (
        <SubscriberRow key={s.id} sub={s} onEdit={() => openEditor(s)} onToggle={() => toggleActive(s)} onDelete={() => removeSub(s)} />
      ))}
      {subs.length === 0 && <div className="empty-state">Nenhum destinatário cadastrado.</div>}
    </div>
  );
}
