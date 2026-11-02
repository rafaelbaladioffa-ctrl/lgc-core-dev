import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppLayout } from "../../components/layout/AppLayout";
import { bpmApi, type BpmRequest } from "./api";
import { statusLabel, SlaBar } from "./BpmPages";
import {
  DynamicForm,
  SectionedDynamicForm,
  applyFormAccess,
  type BpmFormSection,
} from "./DynamicForm";
import { useDraftAutosave, type DraftSnapshot } from "./useDraftAutosave";
import {
  buildCommand,
  executeCommand,
  isCommandAction,
  type CommandAttempt,
} from "./commands";

async function asBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}
export function BpmDraftEditorPage() {
  const { id } = useParams();
  const [loaded, setLoaded] = useState<BpmRequest>();
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    setError("");
    setLoaded(undefined);
    if (id)
      void bpmApi
        .request(id)
        .then((r) => {
          if (alive) setLoaded(r);
        })
        .catch(() => {
          if (alive) setError("Não foi possível carregar");
        });
    return () => {
      alive = false;
    };
  }, [id, reloadToken]);
  useEffect(() => {
    if (error) feedbackRef.current?.focus();
  }, [error]);
  return (
    <AppLayout breadcrumb={["Requisições", loaded?.code ?? "Carregando"]}>
      <div ref={feedbackRef} tabIndex={-1}>
        {error && <p role="alert">{error}</p>}
        {error && (
          <button onClick={() => setReloadToken((value) => value + 1)}>
            Tentar novamente
          </button>
        )}
      </div>
      {loaded ? (
        <BpmRecordEditor key={loaded.id} initial={loaded} />
      ) : (
        !error && (
          <p role="status" aria-live="polite">
            Carregando…
          </p>
        )
      )}
    </AppLayout>
  );
}

export function BpmRecordEditor({ initial }: { initial: BpmRequest }) {
  const [record, setRecord] = useState(initial),
    [snapshot, setSnapshot] = useState<DraftSnapshot>({
      title: initial.title,
      description: initial.description,
      fields: initial.fields,
    });
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [resolution, setResolution] = useState(""),
    [comment, setComment] = useState(""),
    [timeline, setTimeline] = useState<any[]>([]);
  const transition = useRef<CommandAttempt | null>(null);
  const [transitionConflict, setTransitionConflict] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const commentAttempt = useRef<{
    body: string;
    expectedVersion: number;
    commandKey: string;
    commandId: string;
  } | null>(null);
  const [comments, setComments] = useState<Array<{ id: string; body: string }>>(
    (initial as any).comments ?? [],
  );

  // P02 state
  const [correctionFields, setCorrectionFields] = useState<Record<string, unknown>>(
    initial.fields,
  );
  const [p2ActionPanel, setP2ActionPanel] = useState<{
    activityId: string;
    action: "returnForCorrection" | "requestInformation";
    text: string;
  } | null>(null);
  const [answerText, setAnswerText] = useState("");

  const autosave = useDraftAutosave(
    async (body) =>
      bpmApi.draft(record.id, {
        ...body,
        fields: Object.fromEntries(
          Object.entries(body.fields).filter(
            ([key]) =>
              !["read", "hidden", "readonly"].includes(
                String(record.formAccess?.[key]),
              ),
          ),
        ),
      }),
    initial.currentVersion,
  );
  useEffect(() => {
    if (error || transitionConflict || autosave.state === "conflict")
      feedbackRef.current?.focus();
  }, [error, transitionConflict, autosave.state]);

  // Normalize P01/P02 schema into sections with access map applied
  const sections: BpmFormSection[] = applyFormAccess(
    record.schema,
    record.formAccess,
  );
  const hasSections = sections.length > 1 || !!sections[0]?.title;
  const flatFields = sections.flatMap((s) => s.fields);

  const editable =
    record.status === "rascunho" &&
    !!record.allowedActions?.includes("saveDraft");

  const patch = (value: Partial<DraftSnapshot>) => {
    const next = { ...latest.current, ...value };
    latest.current = next;
    setSnapshot(next);
    autosave.schedule(next);
  };
  const save = async () => {
    try {
      await autosave.retry();
      setError("");
    } catch (e: any) {
      if (e?.response?.status === 409) setTransitionConflict(true);
      setError(e.message ?? "Falha ao salvar");
    }
  };
  useEffect(() => {
    void bpmApi
      .timeline(record.id)
      .then(setTimeline)
      .catch(() => undefined);
  }, [record.id, record.currentVersion]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (autosave.state !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [autosave.state]);

  const reload = async () => {
    const next = await bpmApi.request(record.id);
    setRecord(next);
    autosave.currentVersion.current = next.currentVersion;
    setCorrectionFields(next.fields);
  };

  const run = async (action: string, target = record.id) => {
    if (busy || transitionConflict || !isCommandAction(action)) return;
    if (
      transition.current &&
      (transition.current.action !== action ||
        transition.current.target !== target)
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (!transition.current) {
        const version = await autosave.flush();
        transition.current = buildCommand(
          action,
          target,
          {
            expectedVersion: version,
            commandKey: crypto.randomUUID(),
            commandId: crypto.randomUUID(),
          },
          resolution,
          assigneeId,
        );
      }
      const attempt = transition.current;
      await executeCommand(bpmApi, attempt);
      transition.current = null;
      await reload();
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 409) {
        transition.current = null;
        setTransitionConflict(true);
      } else if (status >= 400 && status < 500) {
        transition.current = null;
      }
      const data = e?.response?.data;
      let detail: string;
      if (e?.response?.status === 409) {
        detail = "Conflito: edição preservada. Recarregue para resolver.";
      } else if (data?.fields && typeof data.fields === "object") {
        detail = Object.entries(data.fields as Record<string, string>)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" | ");
      } else if (data?.message) {
        detail = Array.isArray(data.message) ? data.message.join("; ") : String(data.message);
      } else if (typeof data === "string") {
        detail = data;
      } else {
        detail = e.message ?? "Falha: repetir preserva a tentativa.";
      }
      setError(detail);
    } finally {
      setBusy(false);
    }
  };

  // === P02 handlers ===

  const handleReturnForCorrection = async (activityId: string, reason: string) => {
    setBusy(true);
    setError("");
    try {
      await bpmApi.returnForCorrection(activityId, {
        expectedVersion: record.currentVersion,
        commandKey: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        reason,
      });
      setP2ActionPanel(null);
      await reload();
    } catch (e: any) {
      setError(e.message ?? "Falha ao devolver para correção.");
    } finally {
      setBusy(false);
    }
  };

  const handleRequestInformation = async (activityId: string, question: string) => {
    setBusy(true);
    setError("");
    try {
      await bpmApi.requestInformation(activityId, {
        expectedVersion: record.currentVersion,
        commandKey: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        question,
      });
      setP2ActionPanel(null);
      await reload();
    } catch (e: any) {
      setError(e.message ?? "Falha ao solicitar informação.");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCorrection = async () => {
    setBusy(true);
    setError("");
    try {
      await bpmApi.saveCorrection(record.id, {
        expectedVersion: record.currentVersion,
        commandKey: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        fields: correctionFields,
      });
      await reload();
    } catch (e: any) {
      setError(e.message ?? "Falha ao salvar correção.");
    } finally {
      setBusy(false);
    }
  };

  const handleResubmit = async () => {
    setBusy(true);
    setError("");
    try {
      await bpmApi.resubmit(record.id, {
        expectedVersion: record.currentVersion,
        commandKey: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
      });
      await reload();
    } catch (e: any) {
      setError(e.message ?? "Falha ao reenviar.");
    } finally {
      setBusy(false);
    }
  };

  const handleRespondInformation = async () => {
    if (!answerText.trim()) return;
    setBusy(true);
    setError("");
    try {
      await bpmApi.respondInformation(record.id, {
        expectedVersion: record.currentVersion,
        commandKey: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
        answer: answerText,
      });
      setAnswerText("");
      await reload();
    } catch (e: any) {
      setError(e.message ?? "Falha ao responder.");
    } finally {
      setBusy(false);
    }
  };

  // === Upload ===

  const uploads = useRef<any[]>([]);
  const addComment = async () => {
    if (busy || transition.current || transitionConflict) return;
    setBusy(true);
    try {
      const version = await autosave.flush();
      commentAttempt.current ??= {
        body: comment,
        expectedVersion: version,
        commandKey: crypto.randomUUID(),
        commandId: crypto.randomUUID(),
      };
      const result = await bpmApi.comment(record.id, commentAttempt.current);
      setComments((items) => [
        ...items,
        { id: result.commentId, body: commentAttempt.current!.body },
      ]);
      autosave.currentVersion.current = result.currentVersion;
      setComment("");
      commentAttempt.current = null;
      setError("");
      setTimeline(await bpmApi.timeline(record.id));
    } catch (e: any) {
      if (e?.response?.status === 409) setTransitionConflict(true);
      if (e?.response?.status >= 400 && e?.response?.status < 500)
        commentAttempt.current = null;
      setError(e.message ?? "Falha ao comentar. Repetir preserva a tentativa.");
    } finally {
      setBusy(false);
    }
  };
  const upload = async (
    key?: string,
    files?: FileList,
    previousId?: string,
  ) => {
    setBusy(true);
    setError("");
    try {
      await autosave.retry();
      if (files && key && uploads.current.length === 0)
        uploads.current = await Promise.all(
          Array.from(files).map(async (file) => ({
            filename: file.name,
            contentBase64: await asBase64(file),
            fieldKey: key,
            previousId,
            expectedVersion: autosave.currentVersion.current,
            commandKey: crypto.randomUUID(),
            commandId: crypto.randomUUID(),
          })),
        );
      while (uploads.current.length) {
        const attempt = uploads.current[0];
        if (!attempt.started) {
          attempt.payload = {
            ...attempt,
            expectedVersion: autosave.currentVersion.current,
          };
          attempt.started = true;
        }
        const a = await bpmApi.attachment(record.id, attempt.payload);
        autosave.currentVersion.current = a.currentVersion;
        const fieldKey = attempt.fieldKey;
        const ids = (
          (latest.current.fields[fieldKey] as string[]) ?? []
        ).filter((id) => id !== attempt.previousId && id !== a.id);
        patch({
          fields: { ...latest.current.fields, [fieldKey]: [...ids, a.id] },
        });
        setRecord((r) => ({
          ...r,
          attachments: [
            ...(r.attachments ?? []).filter((existing) => existing.id !== a.id),
            a,
          ],
        }));
        await autosave.flush();
        uploads.current.shift();
      }
    } catch (e: any) {
      setError(e.message ?? "Falha no upload; os dados foram preservados.");
    } finally {
      setBusy(false);
    }
  };

  const p2Disabled = busy || transitionConflict || !!transition.current;
  const activeActivity = record.activities?.find((activity) =>
    ["available", "claimed"].includes(activity.state),
  );
  const actionLabels: Record<string, string> = {
    cc_aprovacao_inicial: "Aprovar abertura da requisição",
    suprimentos_cotacao: "Enviar cotações para aprovação",
    cc_aprova_cotacao: "Aprovar cotação e indicar fornecedor",
    solicitante_aprova_cotacao: "Aprovar cotação escolhida",
    suprimentos_compra: "Registrar compra efetuada",
    solicitante_confirma_recebimento: "Confirmar recebimento do material",
  };
  const phaseLabels: Record<string, string> = {
    triage: "Triagem",
    execution: "Execução",
    approval: "Aprovação",
  };
  const stateLabels: Record<string, string> = {
    available: "Aguardando atendente",
    assigned: "Atribuída",
    in_progress: "Em andamento",
    completed: "Concluída",
    waiting: "Aguardando",
  };

  return (
    <section className="lecom-request-page">
      <header className="lecom-request-header">
        <div>
          <div className="lecom-request-heading">
            <Link to="/requests/bpm" aria-label="Voltar para minhas atividades">←</Link>
            <h1>{record.title || "Solicitação"}</h1>
          </div>
          <p className="lecom-request-meta">
            <span className="lecom-request-code">{record.code}</span>
            [Renato] {record.category?.name ?? "Solicitação de Compras"} - aberto em {new Date(record.createdAt ?? Date.now()).toLocaleString("pt-BR")} por Administrador
          </p>
        </div>
        <div className="lecom-request-actions">
          <button type="button" title="Salvar" onClick={() => void save()} disabled={!editable || busy}>▣</button>
          <button type="button" title="Mais ações">•••</button>
        </div>
      </header>
      <div className="lecom-request-status">
        <span aria-hidden>ⓘ</span>
        <strong>{statusLabel[record.status] ?? record.status}</strong>
        <span>· Ciclo 1 · Início em {new Date(record.createdAt ?? Date.now()).toLocaleString("pt-BR")}</span>
      </div>
      {activeActivity?.assigneeName && !activeActivity.assignedToCurrentUser && (
        <div className="lecom-possession-banner">
          Aguardando: {activeActivity.assigneeName}
        </div>
      )}
      <div ref={feedbackRef} tabIndex={-1}>
        {error && <p role="alert">{error}</p>}
        {transitionConflict && (
          <p role="alert">Conflito detectado. Suas edições foram preservadas.</p>
        )}
      </div>

      <div className="lecom-request-body">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "var(--space-5)", alignItems: "start" }}>

          {/* ===== LEFT: form + P02 sections ===== */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

            {/* Draft editor */}
            {editable ? (
              <fieldset
                className="lecom-request-form"
                disabled={busy || transitionConflict || autosave.state === "conflict" || !!transition.current}
              >
                <label className="lecom-field lecom-title-field">
                  Título
                  <input value={snapshot.title} onChange={(e) => patch({ title: e.target.value })} />
                </label>
                <label className="lecom-field lecom-description-field">
                  Descrição
                  <textarea value={snapshot.description} onChange={(e) => patch({ description: e.target.value })} />
                </label>
                {hasSections ? (
                  <SectionedDynamicForm
                    errors={(autosave.lastError.current as any)?.response?.data?.error?.fields ?? {}}
                    sections={sections}
                    values={snapshot.fields}
                    onChange={(key, value) => patch({ fields: { ...latest.current.fields, [key]: value } })}
                    onUpload={(key, files) => void upload(key, files)}
                  />
                ) : (
                  <DynamicForm
                    errors={(autosave.lastError.current as any)?.response?.data?.error?.fields ?? {}}
                    fields={flatFields}
                    values={snapshot.fields}
                    onChange={(key, value) => patch({ fields: { ...latest.current.fields, [key]: value } })}
                    onUpload={(key, files) => void upload(key, files)}
                  />
                )}
              </fieldset>
            ) : (
              <fieldset className="lecom-request-form" disabled>
                <label className="lecom-field lecom-title-field">
                  Título
                  <input value={record.title} readOnly />
                </label>
                <label className="lecom-field lecom-description-field">
                  Descrição
                  <textarea value={record.description} readOnly />
                </label>
                {hasSections ? (
                  <SectionedDynamicForm
                    sections={sections.map(s => ({ ...s, fields: s.fields.map(f => ({ ...f, readOnly: true })) }))}
                    values={(record.fields as Record<string, unknown>) ?? {}}
                    onChange={() => {}}
                  />
                ) : (
                  <DynamicForm
                    fields={flatFields.map(f => ({ ...f, readOnly: true }))}
                    values={(record.fields as Record<string, unknown>) ?? {}}
                    onChange={() => {}}
                  />
                )}
              </fieldset>
            )}

            {/* P02: Correction editor */}
            {record.allowedActions?.includes("saveCorrection") && (
              <section className="lecom-request-form" aria-label="Correção solicitada">
                <h2 style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-base)", fontWeight: 600 }}>Correção solicitada</h2>
                <p style={{ margin: "0 0 var(--space-3)", color: "var(--foreground-muted)", fontSize: "var(--text-sm)" }}>Corrija os campos indicados e reenvie a requisição.</p>
                {hasSections ? (
                  <SectionedDynamicForm sections={sections} values={correctionFields} onChange={(key, value) => setCorrectionFields((prev) => ({ ...prev, [key]: value }))} />
                ) : (
                  <DynamicForm fields={flatFields} values={correctionFields} onChange={(key, value) => setCorrectionFields((prev) => ({ ...prev, [key]: value }))} />
                )}
                <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
                  <button disabled={p2Disabled} onClick={() => void handleSaveCorrection()}>Salvar correção</button>
                  {record.allowedActions?.includes("resubmit") && (
                    <button disabled={p2Disabled} onClick={() => void handleResubmit()}>Reenviar</button>
                  )}
                </div>
              </section>
            )}

            {/* P02: Information response */}
            {record.allowedActions?.includes("respondInformation") && (
              <section className="lecom-request-form" aria-label="Informação solicitada">
                <h2 style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-base)", fontWeight: 600 }}>Informação solicitada</h2>
                {record.activities?.map((a) =>
                  (a as any).question ? (
                    <blockquote key={a.id} style={{ margin: "0 0 var(--space-3)", padding: "var(--space-3)", background: "var(--surface-secondary)", borderLeft: "3px solid var(--primary)", borderRadius: "var(--radius-xs)" }}>{(a as any).question}</blockquote>
                  ) : null,
                )}
                <label className="lecom-field">
                  Resposta
                  <textarea disabled={p2Disabled} value={answerText} onChange={(e) => setAnswerText(e.target.value)} />
                </label>
                <button disabled={p2Disabled || !answerText.trim()} onClick={() => void handleRespondInformation()} style={{ marginTop: "var(--space-3)" }}>Responder</button>
              </section>
            )}
          </div>

          {/* ===== RIGHT: action panel + SLA ===== */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>

            {/* Autosave + draft actions */}
            {editable && (
              <div className="lecom-request-form" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <p role="status" style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--foreground-muted)" }}>{autosave.state}</p>
                <button
                  disabled={busy || transitionConflict || !!transition.current || autosave.state === "conflict"}
                  onClick={() => void save()}
                >
                  Salvar agora
                </button>
                {(transitionConflict || autosave.state === "conflict") && (
                  <button onClick={() => window.location.reload()}>Descartar e recarregar</button>
                )}
                {transition.current && (
                  <button disabled={busy} onClick={() => void run(transition.current!.action, transition.current!.target)}>Repetir tentativa</button>
                )}
                {record.allowedActions?.includes("submit") && (
                  <button
                    disabled={busy || transitionConflict || !!transition.current || uploads.current.length > 0 || ["error", "conflict"].includes(autosave.state)}
                    onClick={() => void run("submit")}
                  >
                    Revisar e enviar
                  </button>
                )}
              </div>
            )}

            {/* Activities panel */}
            {record.activities?.map((a) => (
              <div key={a.id} className="lecom-request-form" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", paddingBottom: "var(--space-2)", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontWeight: 700, fontSize: "var(--text-sm)" }}>{phaseLabels[a.phase] ?? a.phase}</span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--foreground-muted)", background: "var(--surface-secondary)", padding: "2px 8px", borderRadius: 999 }}>{stateLabels[a.state] ?? a.state}</span>
                </div>

                {/* Responsável */}
                {(record as any).assignmentTargets?.length > 0 && (
                  <label className="lecom-field">
                    Responsável
                    <select disabled={busy || transitionConflict || !!transition.current} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                      <option value="">Selecione</option>
                      {(record as any).assignmentTargets.map((p: { id: string; label: string }) => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                {/* Resolution — only for complete/close/cancel */}
                {(a.allowedActions.includes("complete") || ["close", "cancel"].some(ac => record.allowedActions?.includes(ac))) && (
                  <label className="lecom-field">
                    Resolução ou motivo
                    <textarea disabled={busy || transitionConflict || !!transition.current} value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} />
                  </label>
                )}

                {/* Action buttons */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                  {a.allowedActions.map((action) => (
                    <button
                      key={action}
                      disabled={p2Disabled}
                      onClick={() => {
                        if (action === "returnForCorrection" || action === "requestInformation") {
                          setP2ActionPanel({ activityId: a.id, action, text: "" });
                        } else if (isCommandAction(action)) {
                          void run(action, a.id);
                        }
                      }}
                    >
                      {({
                        claim: "Assumir",
                        complete: actionLabels[a.nodeId ?? ""] ?? "Concluir",
                        release: "Liberar",
                        reassign: "Reatribuir",
                        returnForCorrection: "Devolver",
                        requestInformation: "Pedir informação",
                      } as Record<string, string>)[action] ?? action}
                    </button>
                  ))}
                </div>

                {/* P02 inline action panel */}
                {p2ActionPanel?.activityId === a.id && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", padding: "var(--space-3)", background: "var(--surface-secondary)", borderRadius: "var(--radius-sm)" }}>
                    <label className="lecom-field">
                      {p2ActionPanel.action === "returnForCorrection" ? "Motivo da devolução" : "Pergunta para o solicitante"}
                      <textarea disabled={busy} value={p2ActionPanel.text} onChange={(e) => setP2ActionPanel({ ...p2ActionPanel, text: e.target.value })} rows={3} />
                    </label>
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <button disabled={busy || p2ActionPanel.text.trim().length < 3} onClick={() => { if (p2ActionPanel.action === "returnForCorrection") void handleReturnForCorrection(a.id, p2ActionPanel.text); else void handleRequestInformation(a.id, p2ActionPanel.text); }}>Confirmar</button>
                      <button disabled={busy} onClick={() => setP2ActionPanel(null)}>Cancelar</button>
                    </div>
                  </div>
                )}

                {/* Incidents */}
                {(record as any).incidents?.map((incident: { id: string; type: string }) => (
                  <p key={incident.id} role="alert" style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--danger)" }}>
                    Incidente: {incident.type}. Selecione um responsável elegível e reatribua.
                  </p>
                ))}
              </div>
            ))}

            {/* Close / Cancel (request-level) */}
            {["close", "cancel"].some(a => record.allowedActions?.includes(a)) && (
              <div className="lecom-request-form" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                {!record.activities?.some(a => a.allowedActions.includes("complete")) && (
                  <label className="lecom-field">
                    Motivo
                    <textarea disabled={busy || transitionConflict || !!transition.current} value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} />
                  </label>
                )}
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  {["close", "cancel"].filter(a => record.allowedActions?.includes(a)).map(action => (
                    <button key={action} disabled={p2Disabled} onClick={() => void run(action)}>
                      {action === "close" ? "Encerrar" : "Cancelar requisição"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* SLA */}
            {record.sla && record.sla.length > 0 && (
              <div className="lecom-request-form">
                <h3 style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--foreground-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>SLA</h3>
                <SlaBar sla={record.sla} />
                <Link to="/requests/bpm/sla" style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-2)", display: "inline-block" }}>Dashboard SLA</Link>
              </div>
            )}
          </div>
        </div>

        {/* ===== FULL WIDTH: Anexos, Comentários, Timeline ===== */}
        <div style={{ marginTop: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>

          {/* Anexos */}
          <section className="lecom-request-form">
            <h2 style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-base)", fontWeight: 600 }}>Anexos</h2>
            {record.attachments?.length === 0 && <p style={{ margin: 0, color: "var(--foreground-muted)", fontSize: "var(--text-sm)" }}>Nenhum anexo.</p>}
            {uploads.current.length > 0 && <button disabled={busy || autosave.state === "conflict"} onClick={() => void upload()}>Repetir upload</button>}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {record.attachments?.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-2) 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span style={{ flex: 1, fontSize: "var(--text-sm)" }}>{a.filename} <span style={{ color: "var(--foreground-muted)", fontSize: "var(--text-xs)" }}>v{a.version}</span></span>
                  <button onClick={() => void bpmApi.download(record.id, a.id).then((blob) => { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = a.filename; link.click(); URL.revokeObjectURL(url); }).catch(() => setError("Falha no download"))}>Baixar</button>
                  {editable && (a as any).fieldKey && (
                    <label style={{ fontSize: "var(--text-xs)", cursor: "pointer" }}>
                      Substituir
                      <input type="file" disabled={busy} style={{ display: "none" }} onChange={(e) => e.target.files && void upload((a as any).fieldKey, e.target.files, a.id)} />
                    </label>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Comentários */}
          <section className="lecom-request-form">
            <h2 style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-base)", fontWeight: 600 }}>Comentários</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
              {comments.length === 0 && <p style={{ margin: 0, color: "var(--foreground-muted)", fontSize: "var(--text-sm)" }}>Nenhum comentário ainda.</p>}
              {comments.map((item) => (
                <div key={item.id} style={{ padding: "var(--space-2) var(--space-3)", background: "var(--surface-secondary)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)" }}>{item.body}</div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
              <label className="lecom-field" style={{ flex: 1 }}>
                Novo comentário
                <textarea
                  disabled={busy || transitionConflict || !!transition.current || !!commentAttempt.current}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                />
              </label>
              <button
                disabled={busy || transitionConflict || !!transition.current || (!comment.trim() && !commentAttempt.current)}
                onClick={() => void addComment()}
                style={{ alignSelf: "flex-end" }}
              >
                Comentar
              </button>
            </div>
          </section>

          {/* Timeline */}
          <section className="lecom-request-form">
            <h2 style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-base)", fontWeight: 600 }}>Timeline</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              {timeline.map((e) => (
                <div key={e.id} style={{ display: "flex", gap: "var(--space-3)", fontSize: "var(--text-xs)", padding: "var(--space-1) 0", borderBottom: "1px solid var(--border-subtle)" }}>
                  <span style={{ color: "var(--foreground-muted)", whiteSpace: "nowrap" }}>{new Date(e.occurredAt).toLocaleString("pt-BR")}</span>
                  <span>{e.type.replace("activity.", "").replace("request.", "").replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          </section>

          <Link to="/requests/bpm" style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}>← Voltar para atividades</Link>
        </div>
      </div>
    </section>
  );
}
