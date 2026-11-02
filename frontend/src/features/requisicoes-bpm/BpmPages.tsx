import { useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { AppLayout } from "../../components/layout/AppLayout";
import {
  bpmApi,
  type BpmCapabilities,
  type BpmProcess,
  type BpmRequest,
} from "./api";
import { DynamicForm, SectionedDynamicForm, applyFormAccess } from "./DynamicForm";
import { ProcessDesigner, type DesignerState } from "./ProcessDesigner";
import { useAuth } from "../../context/AuthContext";

const box: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
};
const CLOSED_STATUSES = new Set(["encerrada", "cancelada", "concluida"]);
export const statusLabel: Record<string, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  em_triagem: "Em triagem",
  em_atendimento: "Em atendimento",
  aguardando_correcao: "Aguardando correção",
  aguardando_informacao: "Aguardando informação",
  aguardando_solicitante: "Aguardando solicitante",
  concluida: "Concluída",
  encerrada: "Encerrada",
  cancelada: "Cancelada",
};
const ErrorText = ({ error }: { error: unknown }) => {
  if (!error) return null;
  const response = error && typeof error === "object" && "response" in error
    ? (error as { response?: { data?: { error?: { message?: string; errors?: Array<{ path?: string; message?: string }> } } } }).response?.data?.error
    : undefined;
  const detail = response?.errors?.map((item) => `${item.path ?? "dados"}: ${item.message ?? "valor inválido"}`).join("; ");
  return <p role="alert">{detail ?? response?.message ?? (error instanceof Error ? error.message : "Operação não concluída.")}</p>;
};
const Select = ({ label, value, onChange, children }: any) => (
  <label>
    {label}
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  </label>
);
function QueueEditor({
  queue,
  people,
  reload,
}: {
  queue: any;
  people: any[];
  reload: () => void;
}) {
  const [members, setMembers] = useState<string[]>(
    queue.bpmMembers
      .filter((m: any) => m.role === "member")
      .map((m: any) => m.collaboratorId),
  );
  const [managers, setManagers] = useState<string[]>(
    queue.bpmMembers
      .filter((m: any) => m.role === "manager")
      .map((m: any) => m.collaboratorId),
  );
  const [error, setError] = useState<unknown>();
  return (
    <details>
      <summary>Editar fila {queue.name}</summary>
      <ErrorText error={error} />
      {people
        .filter((p) => p.sectorId === queue.sectorId)
        .map((p) => (
          <div key={p.collaboratorId}>
            {p.fullName}
            <label>
              Membro
              <input
                type="checkbox"
                checked={members.includes(p.collaboratorId)}
                onChange={(e) =>
                  setMembers(
                    e.target.checked
                      ? [...members, p.collaboratorId]
                      : members.filter((id) => id !== p.collaboratorId),
                  )
                }
              />
            </label>
            <label>
              Gestor
              <input
                type="checkbox"
                checked={managers.includes(p.collaboratorId)}
                onChange={(e) =>
                  setManagers(
                    e.target.checked
                      ? [...managers, p.collaboratorId]
                      : managers.filter((id) => id !== p.collaboratorId),
                  )
                }
              />
            </label>
          </div>
        ))}
      <button
        onClick={() =>
          void bpmApi
            .updateQueue(queue.id, {
              sectorId: queue.sectorId,
              name: queue.name,
              members,
              managers,
              expectedVersion: queue.revision,
            })
            .then(reload)
            .catch(setError)
        }
      >
        Salvar membresia
      </button>
    </details>
  );
}

export function BpmPortalPage() {
  const [search, setSearch] = useSearchParams();
  const workspaceView = (search.get("workspace") ?? "activities") as "activities" | "inbox" | "alert" | "late" | "opened" | "managed";
  const apiView: "mine" | "queue" = workspaceView === "inbox" || workspaceView === "managed" ? "queue" : "mine";
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cap, setCap] = useState<BpmCapabilities>();
  const [items, setItems] = useState<BpmRequest[]>([]);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void Promise.all([
      bpmApi.capabilities().then((value) => {
        if (active) setCap(value);
      }),
      bpmApi
        .requestsPage(apiView)
        .then((page) => {
          if (active) {
            setItems(page.items);
            setNextCursor(page.nextCursor);
          }
        })
        .catch((value) => {
          if (active) setError(value);
        }),
    ]).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [apiView, reloadToken]);
  const activeItems = items.filter((r) => !CLOSED_STATUSES.has(r.status));
  const now = new Date();
  const dueDate = (r: BpmRequest) => r.slaDueResolutionAt ? new Date(r.slaDueResolutionAt) : null;
  const overdue = (r: BpmRequest) => { const due = dueDate(r); return !!due && due <= now; };
  const risk = (r: BpmRequest) => { const due = dueDate(r); return !!due && !overdue(r) && due.getTime() - now.getTime() < 24 * 60 * 60 * 1000; };
  const visibleItems = workspaceView === "late" ? activeItems.filter(overdue)
    : workspaceView === "alert" ? activeItems.filter(risk)
    : activeItems;
  const counts = {
    activities: activeItems.length,
    onTime: activeItems.filter((r) => !overdue(r) && !risk(r)).length,
    alert: activeItems.filter(risk).length,
    late: activeItems.filter(overdue).length,
  };
  const workspaceLabel = workspaceView === "activities" ? "Minhas atividades" : workspaceView === "inbox" ? "Caixa de entrada" : workspaceView === "alert" ? "Em alerta" : workspaceView === "late" ? "Em atraso" : workspaceView === "opened" ? "Abertos por mim" : "Geridos por mim";
  const groups = [...visibleItems.reduce((map, request) => {
    const key = request.category?.name ?? "Processo sem categoria";
    const group = map.get(key) ?? { name: key, version: request.version, items: [] as BpmRequest[] };
    group.items.push(request);
    map.set(key, group);
    return map;
  }, new Map<string, { name: string; version: number; items: BpmRequest[] }>()).values()];
  const tone = (request: BpmRequest) => overdue(request) ? { bg: "#fca08f", text: "#7f1d1d", label: "Atrasado" } : risk(request) ? { bg: "#ffe47d", text: "#735b00", label: "Em alerta" } : { bg: "#a9d9f2", text: "#075985", label: "No prazo" };
  return (
    <AppLayout breadcrumb={["Requisições", "Processos piloto"]}>
      <div className="lecom-portal-page" style={{ padding: "30px 34px", minHeight: "calc(100svh - 94px)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h1 style={{ fontSize: 25 }}>{workspaceLabel}</h1>
          <button aria-label="Atualizar" onClick={() => setReloadToken((value) => value + 1)} style={{ border: 0, background: "transparent", fontSize: 20 }}>↻</button>
        </div>
        <ErrorText error={error} />
        {error != null && <button onClick={() => setReloadToken((value) => value + 1)} style={{ marginBottom: 16 }}>Tentar novamente</button>}
        {cap && !cap.enabled ? <div style={box}>Piloto desabilitado.</div> : <>
          <div style={{ background: "#fff", borderBottom: "1px solid #ddd", padding: "12px 0", display: "flex", gap: 18, alignItems: "center", margin: "0 -34px 20px", paddingLeft: 34 }}>
            <span style={{ color: "#777", fontSize: 16 }}>☷</span><input aria-label="Filtrar processo ou filtro salvo" placeholder="Filtrar processo ou filtro salvo" style={{ border: 0, background: "transparent", width: 350 }} />
            <Link to="/requests/bpm/new" style={{ marginLeft: "auto", marginRight: 34, color: "#0755a6", fontWeight: 700 }}>+ Abrir processo</Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(150px, 1fr))", gap: 16, marginBottom: 26 }}>
            {[{ label: "Atividades", value: counts.activities, color: "#fff", text: "#111" }, { label: "No prazo", value: counts.onTime, color: "#a9d9f2", text: "#075985" }, { label: "Em alerta", value: counts.alert, color: "#ffe47d", text: "#735b00" }, { label: "Atrasado", value: counts.late, color: "#fca08f", text: "#7f1d1d" }].map((card) => <button key={card.label} onClick={() => card.label === "Em alerta" ? setSearch({ workspace: "alert" }) : card.label === "Atrasado" ? setSearch({ workspace: "late" }) : undefined} style={{ textAlign: "left", border: "1px solid #d7d7d7", borderRadius: 8, background: card.color, color: card.text, padding: "18px 20px", minHeight: 126, boxShadow: "0 1px 2px rgba(0,0,0,.08)" }}><div style={{ fontSize: 17, fontWeight: 700 }}>{card.label}</div><div style={{ fontSize: 48, lineHeight: 1.1, fontWeight: 300, marginTop: 13 }}>{card.value}</div></button>)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><h2 style={{ fontSize: 18 }}>Por processo {workspaceView !== "activities" && <span style={{ fontWeight: 400, color: "#555" }}>› {workspaceLabel}</span>}</h2><div><button aria-pressed={layout === "list"} onClick={() => setLayout("list")} style={{ border: 0, background: layout === "list" ? "#dbe9fb" : "transparent", padding: 8 }}>☷</button><button aria-pressed={layout === "grid"} onClick={() => setLayout("grid")} style={{ border: 0, background: layout === "grid" ? "#dbe9fb" : "transparent", padding: 8 }}>▦</button></div></div>
          {loading && <p role="status">Carregando requisições…</p>}
          {!loading && visibleItems.length === 0 && <p role="status">Nenhuma atividade nesta visão.</p>}
          {!loading && layout === "list" && (workspaceView === "activities" || workspaceView === "opened" || workspaceView === "managed") && <div style={{ display: "grid", gap: 8 }}>{groups.map((group) => { const worst = group.items.find(overdue) ?? group.items.find(risk) ?? group.items[0]; const badge = tone(worst); return <Link key={group.name} to={`/requests/bpm/${worst.id}`} style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1.5fr) 110px 160px 150px", alignItems: "center", gap: 18, background: "#fff", border: "1px solid #d9d9d9", borderRadius: 8, padding: "13px 18px", color: "#111", textDecoration: "none" }}><strong>{group.name}</strong><span>Versão {group.version}</span><span style={{ border: "1px solid #ddd", borderRadius: 5, padding: "5px 12px", textAlign: "center" }}>{group.items.length} {group.items.length === 1 ? "atividade" : "atividades"}</span><span style={{ background: badge.bg, color: badge.text, borderRadius: 5, padding: "5px 10px", textAlign: "center" }}>{group.items.length} {badge.label.toLowerCase()}</span></Link>; })}</div>}
          {!loading && (layout === "grid" || !["activities", "opened", "managed"].includes(workspaceView)) && <div style={{ display: layout === "grid" ? "grid" : "block", gridTemplateColumns: layout === "grid" ? "repeat(4, minmax(190px, 1fr))" : undefined, gap: 12 }}>{visibleItems.map((request) => { const badge = tone(request); return <Link key={request.id} to={`/requests/bpm/${request.id}`} style={{ display: layout === "grid" ? "block" : "grid", gridTemplateColumns: layout === "grid" ? undefined : "80px 1.2fr 1.5fr 1fr 1fr", background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: layout === "grid" ? 17 : "11px 16px", marginBottom: layout === "grid" ? 0 : 0, color: "#111", textDecoration: "none" }}><small style={{ color: "#555" }}>Versão {request.version}</small><strong style={{ color: "#0755a6", marginTop: layout === "grid" ? 22 : 0 }}>{request.title || request.code}</strong>{layout === "list" && <><span>{request.category?.name}</span><span>{request.createdAt ? new Date(request.createdAt).toLocaleString("pt-BR") : "—"}</span></>}<span style={{ marginTop: layout === "grid" ? 26 : 0, background: badge.bg, color: badge.text, borderRadius: 5, padding: "5px 10px", textAlign: "center" }}>{badge.label}</span></Link>; })}</div>}
          {nextCursor && !loading && <button onClick={() => void bpmApi.requestsPage(apiView, nextCursor).then((page) => { setItems((old) => [...old, ...page.items]); setNextCursor(page.nextCursor); }).catch(setError)} style={{ marginTop: 18 }}>Carregar mais</button>}
        </>}
      </div>
    </AppLayout>
  );
}

export function BpmAdminPage() {
  const { user } = useAuth();
  const [processes, setProcesses] = useState<BpmProcess[]>([]);
  const [queues, setQueues] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [error, setError] = useState<unknown>();
  const [queue, setQueue] = useState({
    sectorId: "",
    name: "",
    members: [] as string[],
    managers: [] as string[],
  });
  const [form, setForm] = useState({
    code: "PROC-INTERNO",
    name: "Processo interno simples",
    description: "Processo interno de teste",
    sectorId: "",
    triageQueueId: "",
    executionQueueId: "",
    publisherUserIds: [] as string[],
  });
  const load = () => {
    void Promise.all([
      bpmApi.processes().then(setProcesses),
      bpmApi.queues().then(setQueues),
      bpmApi.collaborators().then(setPeople),
    ]).catch(setError);
  };
  useEffect(() => {
    load();
  }, []);
  const sectors = [...new Set(people.map((p) => p.sectorId))];
  const add = (key: "members" | "managers", value: string) =>
    value &&
    setQueue({ ...queue, [key]: [...new Set([...queue[key], value])] });
  return (
    <AppLayout breadcrumb={["Requisições", "Administração BPM"]}>
      <h1>Administração BPM</h1>
      <ErrorText error={error} />
      <div style={box}>
        <h2>Nova fila</h2>
        <Select
          label="Setor"
          value={queue.sectorId}
          onChange={(v: string) => setQueue({ ...queue, sectorId: v })}
        >
          <option value="">Selecione</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {people.find((p) => p.sectorId === s)?.sectorName ?? s}
            </option>
          ))}
        </Select>
        <input
          placeholder="Nome da fila"
          value={queue.name}
          onChange={(e) => setQueue({ ...queue, name: e.target.value })}
        />
        <Select
          label="Membro"
          value=""
          onChange={(v: string) => add("members", v)}
        >
          <option value="">Adicionar colaborador</option>
          {people
            .filter((p) => p.sectorId === queue.sectorId)
            .map((p) => (
              <option key={p.collaboratorId} value={p.collaboratorId}>
                {p.fullName}
              </option>
            ))}
        </Select>
        <Select
          label="Gestor"
          value=""
          onChange={(v: string) => add("managers", v)}
        >
          <option value="">Adicionar colaborador</option>
          {people
            .filter((p) => p.sectorId === queue.sectorId)
            .map((p) => (
              <option key={p.collaboratorId} value={p.collaboratorId}>
                {p.fullName}
              </option>
            ))}
        </Select>
        <p>
          {queue.members
            .map((id) => people.find((p) => p.collaboratorId === id)?.fullName)
            .join(", ")}
        </p>
        <p>
          {queue.managers
            .map((id) => people.find((p) => p.collaboratorId === id)?.fullName)
            .join(", ")}
        </p>
        <button
          onClick={() =>
            void bpmApi.createQueue(queue).then(load).catch(setError)
          }
        >
          Criar fila
        </button>
      </div>
      <div style={box}>
        <h2>Novo processo</h2>
        <input
          placeholder="Código"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
        />
        <input
          placeholder="Nome"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          placeholder="Descrição"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <Select
          label="Setor"
          value={form.sectorId}
          onChange={(v: string) => setForm({ ...form, sectorId: v })}
        >
          <option value="">Selecione</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {people.find((p) => p.sectorId === s)?.sectorName ?? s}
            </option>
          ))}
        </Select>
        <Select
          label="Fila de triagem"
          value={form.triageQueueId}
          onChange={(v: string) => setForm({ ...form, triageQueueId: v })}
        >
          <option value="">Selecione</option>
          {queues
            .filter((q) => q.sectorId === form.sectorId)
            .map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
        </Select>
        <Select
          label="Fila de execução"
          value={form.executionQueueId}
          onChange={(v: string) => setForm({ ...form, executionQueueId: v })}
        >
          <option value="">Selecione</option>
          {queues
            .filter((q) => q.sectorId === form.sectorId)
            .map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
        </Select>
        <Select
          label="Publicador"
          value=""
          onChange={(v: string) =>
            v &&
            setForm({
              ...form,
              publisherUserIds: [...new Set([...form.publisherUserIds, v])],
            })
          }
        >
          <option value="">Adicionar usuário</option>
          {people
            .filter((p) => p.canPublish)
            .map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.fullName}
              </option>
            ))}
        </Select>
        <button
          onClick={() =>
            void bpmApi.createProcess(form).then(load).catch(setError)
          }
        >
          Criar draft
        </button>
      </div>
      {queues.map((q) => (
        <QueueEditor
          key={`${q.id}:${q.revision}`}
          queue={q}
          people={people}
          reload={load}
        />
      ))}
      {processes.map((p) => (
        <div style={box} key={p.id}>
          <b>
            {p.code} — {p.name}
          </b>
          {p.versions.map((v) => (
            <div key={v.id}>
              <Link to={`/requests/bpm/admin/versions/${v.id}`}>
                Versão {v.version} ({v.bpmStatus})
              </Link>
            </div>
          ))}
          <GrantEditor
            process={p}
            people={people}
            actorUserId={user?.sub ?? ""}
            reload={load}
          />
        </div>
      ))}
    </AppLayout>
  );
}

function GrantEditor({
  process,
  people,
  actorUserId,
  reload,
}: {
  process: BpmProcess;
  people: any[];
  actorUserId: string;
  reload: () => void;
}) {
  const [grants, setGrants] = useState<any[]>(process.grants ?? []);
  const revision = process.configRevision;
  useEffect(() => {
    setGrants(process.grants ?? []);
  }, [process.id, process.configRevision, process.grants]);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [role, setRole] = useState("modeler");
  const add = () => {
    if (!target || grants.some((g) => g.userId === target && g.role === role))
      return;
    setGrants([...grants, { userId: target, role, restrictedRead: false }]);
    setTarget("");
  };
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await bpmApi.grants(process.id, grants, revision);
      reload();
    } catch (e: any) {
      setError(e);
      if (e?.response?.status === 409) reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label={`Acessos de ${process.name}`}
      style={{ marginTop: 12 }}
    >
      <h3>Acessos do processo</h3>
      {grants.map((g, index) => (
        <div key={`${g.userId}:${g.role}`}>
          {people.find((p) => p.userId === g.userId)?.fullName ?? g.userId} —{" "}
          {g.role}
          {g.userId !== actorUserId && (
            <button
              type="button"
              onClick={() => setGrants(grants.filter((_, i) => i !== index))}
            >
              Remover
            </button>
          )}
        </div>
      ))}
      <Select label="Usuário" value={target} onChange={setTarget}>
        <option value="">Selecione usuário ativo</option>
        {people
          .filter(
            (p) =>
              p.userId !== actorUserId &&
              !grants.some((g) => g.userId === p.userId && g.role === role),
          )
          .map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.fullName}
            </option>
          ))}
      </Select>
      <Select label="Papel no processo" value={role} onChange={setRole}>
        {[
          ["modeler", "Modelador"],
          ["publisher", "Publicador"],
          ["operator", "Operador"],
          ["auditor", "Auditor"],
        ].map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <button type="button" onClick={add} disabled={!target}>
        Adicionar acesso
      </button>
      <button type="button" onClick={() => void save()} disabled={busy}>
        Salvar acessos
      </button>
      <ErrorText error={error} />
    </section>
  );
}

export function BpmVersionPage() {
  const { id } = useParams();
  const [v, setV] = useState<any>();
  const [queues, setQueues] = useState<{ id: string; name: string }[]>([]);
  const [designer, setDesigner] = useState<DesignerState>({
    bpmNodes: [],
    bpmEdges: [],
    nodePositions: {},
    fields: [],
    sla: { firstResponseMinutes: 240, resolutionMinutes: 2880 },
  });
  const [error, setError] = useState<unknown>();
  const [preview, setPreview] = useState<Record<string, unknown>>({});
  const [report, setReport] = useState<
    Array<{ path: string; message: string }>
  >([]);
  const navigate = useNavigate();
  const load = () => {
    if (!id) return;
    void Promise.all([
      bpmApi.version(id).then((x) => {
        setV(x);
        setDesigner({
          bpmNodes: x.bpmDefinition?.nodes ?? [],
          bpmEdges: x.bpmDefinition?.edges ?? [],
          nodePositions: x.bpmDefinition?._nodePositions ?? {},
          fields: x.bpmDefinition?.form ?? [],
          sla: x.bpmDefinition?.sla ?? {
            firstResponseMinutes: 240,
            resolutionMinutes: 2880,
          },
        });
      }),
      bpmApi
        .queues()
        .then((qs: any[]) =>
          setQueues(qs.map((q) => ({ id: q.id, name: q.name }))),
        ),
    ]).catch(setError);
  };
  useEffect(() => {
    load();
  }, [id]);
  if (!v)
    return (
      <AppLayout breadcrumb={["Requisições", "Versão"]}>
        <ErrorText error={error} />
        <p>Carregando…</p>
      </AppLayout>
    );
  const save = () =>
    void bpmApi
      .patchVersion(v.id, {
        expectedVersion: v.bpmRevision,
        definition: {
          ...v.bpmDefinition,
          nodes: designer.bpmNodes,
          edges: designer.bpmEdges,
          form: designer.fields,
          sla: designer.sla,
          _nodePositions: designer.nodePositions,
        },
      })
      .then(load)
      .catch(setError);
  return (
    <AppLayout breadcrumb={["Requisições", "Versão"]}>
      <h1>Versão {v.version}</h1>
      <ErrorText error={error} />
      {report.map((entry, i) => (
        <p role="alert" key={i}>
          {entry.path}: {entry.message}
        </p>
      ))}
      <ProcessDesigner
        key={v.bpmRevision}
        bpmNodes={designer.bpmNodes}
        bpmEdges={designer.bpmEdges}
        nodePositions={designer.nodePositions}
        fields={designer.fields}
        sla={designer.sla}
        disabled={v.bpmStatus !== "draft"}
        queues={queues}
        onChange={setDesigner}
      />
      <h2>Prévia do formulário</h2>
      <DynamicForm
        fields={designer.fields as any}
        values={preview}
        onChange={(key, value) => setPreview({ ...preview, [key]: value })}
      />
      {v.bpmStatus === "published" && (
        <button
          onClick={() =>
            void bpmApi
              .cloneVersion(v.category.id, v.category.configRevision, v.version)
              .then((next) =>
                navigate(`/requests/bpm/admin/versions/${next.id}`),
              )
              .catch(setError)
          }
        >
          Clonar para novo rascunho
        </button>
      )}
      <div style={box}>
        <button disabled={v.bpmStatus !== "draft"} onClick={save}>
          Salvar
        </button>
        <button
          disabled={v.bpmStatus !== "draft"}
          onClick={() =>
            void bpmApi
              .validateVersion(v.id, v.bpmRevision)
              .then((r) => {
                setReport(r.errors ?? []);
                setV({ ...v, bpmValidatedHash: r.validatedHash });
              })
              .catch(setError)
          }
        >
          Validar
        </button>
        <button
          disabled={v.bpmStatus !== "draft" || !v.bpmValidatedHash}
          onClick={() =>
            void bpmApi
              .publishVersion(v.id, {
                expectedVersion: v.bpmRevision,
                validatedHash: v.bpmValidatedHash,
              })
              .then(load)
              .catch(setError)
          }
        >
          Publicar
        </button>
        {v.category?.id && (
          <button
            disabled={v.bpmStatus !== "published"}
            onClick={() =>
              void bpmApi
                .enable(v.category.id, v.category.configRevision)
                .then(load)
                .catch(setError)
            }
          >
            Habilitar
          </button>
        )}
      </div>
    </AppLayout>
  );
}

export function BpmNewRequestPage() {
  const attempt = useRef<any>(null);
  const [creating, setCreating] = useState(false);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<BpmProcess[]>([]);
  const [categoryId, setCategoryId] = useState(search.get("categoryId") ?? "");
  const [versionId, setVersionId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    void bpmApi.catalog().then(setItems).catch(setError);
  }, []);
  const process = items.find((p) => p.id === categoryId);
  const rawForm =
    process?.versions.find((v) => v.id === versionId)?.bpmDefinition?.form ??
    [];
  const sections = applyFormAccess(rawForm).map((s) => ({
    ...s,
    fields: s.fields.filter((f) => f.type !== "attachment"),
  }));
  const create = async () => {
    if (creating) return;
    attempt.current ??= {
      categoryId,
      versionId,
      title,
      description,
      fields: structuredClone(fields),
      commandKey: crypto.randomUUID(),
      commandId: crypto.randomUUID(),
    };
    setCreating(true);
    try {
      const result = await bpmApi.createRequest(attempt.current);
      navigate(`/requests/bpm/${result.id}`);
    } catch (e: any) {
      if (e?.response?.status >= 400 && e?.response?.status < 500)
        attempt.current = null;
      setError(e);
    } finally {
      setCreating(false);
    }
  };
  return (
    <AppLayout breadcrumb={["Requisições", "Novo processo"]}>
      <div className="lecom-new-request-page">
      <h1 className="lecom-new-request-title">Nova requisição BPM</h1>
      <ErrorText error={error} />
      <fieldset className="lecom-new-request-form" disabled={creating || !!attempt.current}>
        <label className="lecom-new-process-field">
          Processo
          <select
            aria-label="Processo"
            value={categoryId}
            onChange={(e) => {
              const p = items.find((x) => x.id === e.target.value);
              setCategoryId(e.target.value);
              setVersionId(
                p?.versions.find((x) => x.bpmStatus === "published")?.id ?? "",
              );
              setFields({});
            }}
          >
            <option value="">Selecione um processo</option>
            {items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <SectionedDynamicForm
          sections={sections}
          values={fields}
          onChange={(key, value) => setFields({ ...fields, [key]: value })}
        />
        <p className="lecom-new-request-note">Salve o rascunho para adicionar ou substituir anexos.</p>
        <input className="lecom-new-request-title-field"
          placeholder="Título"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea className="lecom-new-request-description-field"
          placeholder="Descrição"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </fieldset>
      <button disabled={!versionId || creating} onClick={() => void create()}>
        Salvar rascunho
      </button>
      </div>
    </AppLayout>
  );
}

export function SlaBar({ sla }: { sla: NonNullable<BpmRequest["sla"]> }) {
  const res = sla.find((s) => s.metric === "resolution");
  if (!res?.targetAt) return null;
  const target = new Date(res.targetAt);
  const now = new Date();
  const isBreached = res.breachedAt != null || target <= now;
  const elapsed = res.elapsedSeconds;
  const total = (target.getTime() - (now.getTime() - elapsed * 1000)) / 1000;
  const pct = total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 100;
  const color = isBreached ? "var(--color-danger, #e53e3e)" : pct > 80 ? "var(--color-warning, #d97706)" : "var(--color-success, #38a169)";
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
        SLA resolução: {isBreached ? "⚠ Vencido" : `${pct}% usado · vence ${target.toLocaleString("pt-BR")}`}
      </div>
      <div style={{ height: 6, background: "var(--border)", borderRadius: 3 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}


export function BpmSlaPage() {
  const [items, setItems] = useState<BpmRequest[]>([]);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    const fetchAll = async () => {
      const all: BpmRequest[] = [];
      let cursor: string | null | undefined;
      do {
        const page = await bpmApi.requestsPage("queue", cursor ?? undefined);
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      if (active) setItems(all);
    };
    setLoading(true);
    fetchAll().catch(setError).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const now = new Date();

  const open = items.filter((r) => !CLOSED_STATUSES.has(r.status));

  const categorize = (r: BpmRequest) => {
    if (!r.slaDueResolutionAt) return "sem_sla";
    const due = new Date(r.slaDueResolutionAt);
    if (due <= now) return "vencido";
    const msLeft = due.getTime() - now.getTime();
    const msTotal = due.getTime() - new Date(r.createdAt ?? 0).getTime();
    return msTotal > 0 && msLeft / msTotal < 0.2 ? "risco" : "ok";
  };

  const groups = {
    vencido: open.filter((r) => categorize(r) === "vencido"),
    risco: open.filter((r) => categorize(r) === "risco"),
    ok: open.filter((r) => categorize(r) === "ok"),
    sem_sla: open.filter((r) => categorize(r) === "sem_sla"),
  };

  const groupConfig = [
    { key: "vencido", label: "Vencido", color: "#e53e3e" },
    { key: "risco", label: "Em risco (<20% do prazo)", color: "#d97706" },
    { key: "ok", label: "No prazo", color: "#38a169" },
    { key: "sem_sla", label: "Sem SLA definido", color: "var(--text-muted)" },
  ] as const;

  return (
    <AppLayout breadcrumb={["Requisições", "Dashboard SLA"]}>
      <h1>Dashboard de SLA</h1>
      <ErrorText error={error} />
      {loading && <p>Carregando…</p>}
      {!loading && (
        <>
          {/* Summary badges */}
          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            {groupConfig.map(({ key, label, color }) => (
              <div key={key} style={{ ...box, margin: 0, minWidth: 120, textAlign: "center" }}>
                <div style={{ fontSize: 32, fontWeight: 700, color }}>{groups[key].length}</div>
                <div style={{ fontSize: 13 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Per-group lists */}
          {groupConfig.map(({ key, label, color }) =>
            groups[key].length > 0 ? (
              <div key={key}>
                <h3 style={{ color }}>{label} ({groups[key].length})</h3>
                {groups[key].map((r) => {
                  const due = r.slaDueResolutionAt ? new Date(r.slaDueResolutionAt) : null;
                  return (
                    <div
                      key={r.id}
                      style={{ ...box, cursor: "pointer", borderLeft: `4px solid ${color}` }}
                      onClick={() => navigate(`/requests/bpm/${r.id}`)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>
                          <strong>{r.code}</strong> — {r.title || "(sem título)"}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {statusLabel[r.status] ?? r.status}
                        </span>
                      </div>
                      {due && (
                        <div style={{ fontSize: 12, color, marginTop: 4 }}>
                          {due <= now ? "Venceu" : "Vence"} {due.toLocaleString("pt-BR")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null
          )}
          {open.length === 0 && <p>Nenhuma requisição ativa na fila.</p>}
        </>
      )}
    </AppLayout>
  );
}
