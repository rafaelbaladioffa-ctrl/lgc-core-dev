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
      setError(
        e?.response?.status === 409
          ? "Conflito: edição preservada. Recarregue para resolver."
          : (e.message ?? "Falha: repetir preserva a tentativa."),
      );
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

  return (
    <section style={{ maxWidth: 760, width: "100%" }}>
      <h1>
        {record.code} — {record.title || "rascunho"}
      </h1>
      <p>
        <strong>{statusLabel[record.status] ?? record.status}</strong>
        {" · "}{record.category?.name}{" · "}v{record.version}
      </p>
      <div ref={feedbackRef} tabIndex={-1}>
        {error && <p role="alert">{error}</p>}
        {transitionConflict && (
          <p role="alert">Conflito detectado. Suas edições foram preservadas.</p>
        )}
      </div>

      {/* === Draft editor (P01 + P02 rascunho) === */}
      {editable ? (
        <fieldset
          disabled={
            busy ||
            transitionConflict ||
            autosave.state === "conflict" ||
            !!transition.current
          }
        >
          <label>
            Título
            <input
              value={snapshot.title}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </label>
          <label>
            Descrição
            <textarea
              value={snapshot.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </label>
          {hasSections ? (
            <SectionedDynamicForm
              errors={
                (autosave.lastError.current as any)?.response?.data?.error
                  ?.fields ?? {}
              }
              sections={sections}
              values={snapshot.fields}
              onChange={(key, value) =>
                patch({ fields: { ...latest.current.fields, [key]: value } })
              }
              onUpload={(key, files) => void upload(key, files)}
            />
          ) : (
            <DynamicForm
              errors={
                (autosave.lastError.current as any)?.response?.data?.error
                  ?.fields ?? {}
              }
              fields={flatFields}
              values={snapshot.fields}
              onChange={(key, value) =>
                patch({ fields: { ...latest.current.fields, [key]: value } })
              }
              onUpload={(key, files) => void upload(key, files)}
            />
          )}
        </fieldset>
      ) : (
        record.status === "rascunho" && (
          <>
            <p>{record.title}</p>
            <p>{record.description}</p>
            {Object.entries(record.fields).map(([k, v]) => (
              <p key={k}>
                {k}: {JSON.stringify(v)}
              </p>
            ))}
          </>
        )
      )}

      <p role="status">{autosave.state}</p>
      {editable && (
        <button
          disabled={
            busy ||
            transitionConflict ||
            !!transition.current ||
            autosave.state === "conflict"
          }
          onClick={() => void save()}
        >
          Salvar agora
        </button>
      )}
      {(transitionConflict || autosave.state === "conflict") && (
        <button onClick={() => window.location.reload()}>
          Descartar edição e recarregar
        </button>
      )}
      {transition.current && (
        <button
          disabled={busy}
          onClick={() =>
            void run(transition.current!.action, transition.current!.target)
          }
        >
          Repetir tentativa
        </button>
      )}
      {record.allowedActions?.includes("submit") && (
        <button
          disabled={
            busy ||
            transitionConflict ||
            !!transition.current ||
            uploads.current.length > 0 ||
            ["error", "conflict"].includes(autosave.state)
          }
          onClick={() => void run("submit")}
        >
          Revisar e enviar
        </button>
      )}
      <label>
        Resolução ou motivo
        <textarea
          disabled={busy || transitionConflict || !!transition.current}
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        />
      </label>
      {(record as any).assignmentTargets?.length > 0 && (
        <label>
          Responsável
          <select
            disabled={busy || transitionConflict || !!transition.current}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">Selecione</option>
            {(record as any).assignmentTargets.map(
              (p: { id: string; label: string }) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ),
            )}
          </select>
        </label>
      )}
      {(record as any).incidents?.map(
        (incident: { id: string; type: string }) => (
          <p key={incident.id} role="status">
            Incidente: {incident.type}. Selecione um responsável elegível e
            reatribua a atividade para resolver.
          </p>
        ),
      )}

      {/* Activities */}
      {record.activities?.map((a) => (
        <div key={a.id}>
          {a.phase} — {a.state}
          {a.allowedActions.map((action) => (
            <button
              disabled={p2Disabled}
              key={action}
              onClick={() => {
                if (
                  action === "returnForCorrection" ||
                  action === "requestInformation"
                ) {
                  setP2ActionPanel({
                    activityId: a.id,
                    action,
                    text: "",
                  });
                } else if (isCommandAction(action)) {
                  void run(action, a.id);
                }
              }}
            >
              {(
                {
                  claim: "Assumir",
                  complete: "Concluir atividade",
                  release: "Liberar",
                  reassign: "Reatribuir",
                  returnForCorrection: "Devolver para correção",
                  requestInformation: "Solicitar informação",
                } as Record<string, string>
              )[action] ?? action}
            </button>
          ))}
          {/* P02 inline action panel for this activity */}
          {p2ActionPanel?.activityId === a.id && (
            <div>
              <label>
                {p2ActionPanel.action === "returnForCorrection"
                  ? "Motivo da devolução"
                  : "Pergunta para o solicitante"}
                <textarea
                  disabled={busy}
                  value={p2ActionPanel.text}
                  onChange={(e) =>
                    setP2ActionPanel({ ...p2ActionPanel, text: e.target.value })
                  }
                />
              </label>
              <button
                disabled={busy || p2ActionPanel.text.trim().length < 3}
                onClick={() => {
                  if (p2ActionPanel.action === "returnForCorrection")
                    void handleReturnForCorrection(a.id, p2ActionPanel.text);
                  else void handleRequestInformation(a.id, p2ActionPanel.text);
                }}
              >
                Confirmar
              </button>
              <button
                disabled={busy}
                onClick={() => setP2ActionPanel(null)}
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      ))}

      {["close", "cancel"]
        .filter((action) => record.allowedActions?.includes(action))
        .map((action) => (
          <button
            disabled={p2Disabled}
            key={action}
            onClick={() => void run(action)}
          >
            {action === "close" ? "Encerrar" : "Cancelar"}
          </button>
        ))}

      {/* === P02: Correction editor === */}
      {record.allowedActions?.includes("saveCorrection") && (
        <section aria-label="Correção solicitada">
          <h2>Correção solicitada</h2>
          <p>Corrija os campos indicados e reenvie a requisição.</p>
          {hasSections ? (
            <SectionedDynamicForm
              sections={sections}
              values={correctionFields}
              onChange={(key, value) =>
                setCorrectionFields((prev) => ({ ...prev, [key]: value }))
              }
            />
          ) : (
            <DynamicForm
              fields={flatFields}
              values={correctionFields}
              onChange={(key, value) =>
                setCorrectionFields((prev) => ({ ...prev, [key]: value }))
              }
            />
          )}
          <button disabled={p2Disabled} onClick={() => void handleSaveCorrection()}>
            Salvar correção
          </button>
          {record.allowedActions?.includes("resubmit") && (
            <button disabled={p2Disabled} onClick={() => void handleResubmit()}>
              Reenviar
            </button>
          )}
        </section>
      )}

      {/* === P02: Information response === */}
      {record.allowedActions?.includes("respondInformation") && (
        <section aria-label="Informação solicitada">
          <h2>Informação solicitada</h2>
          {record.activities?.map((a) =>
            (a as any).question ? (
              <blockquote key={a.id}>{(a as any).question}</blockquote>
            ) : null,
          )}
          <label>
            Resposta
            <textarea
              disabled={p2Disabled}
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
            />
          </label>
          <button
            disabled={p2Disabled || !answerText.trim()}
            onClick={() => void handleRespondInformation()}
          >
            Responder
          </button>
        </section>
      )}

      <h2>Anexos</h2>
      {uploads.current.length > 0 && (
        <button
          disabled={busy || autosave.state === "conflict"}
          onClick={() => void upload()}
        >
          Repetir upload
        </button>
      )}
      {record.attachments?.map((a) => (
        <div key={a.id}>
          {a.filename} · v{a.version}
          <button
            onClick={() =>
              void bpmApi
                .download(record.id, a.id)
                .then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = a.filename;
                  link.click();
                  URL.revokeObjectURL(url);
                })
                .catch(() => setError("Falha no download"))
            }
          >
            Baixar
          </button>
          {editable && (a as any).fieldKey && (
            <label>
              Substituir {a.filename}
              <input
                type="file"
                disabled={busy}
                onChange={(e) =>
                  e.target.files &&
                  void upload((a as any).fieldKey, e.target.files, a.id)
                }
              />
            </label>
          )}
        </div>
      ))}
      <h2>Comentários</h2>
      {comments.map((item) => (
        <p key={item.id}>{item.body}</p>
      ))}
      <label>
        Comentário
        <textarea
          disabled={
            busy ||
            transitionConflict ||
            !!transition.current ||
            !!commentAttempt.current
          }
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      <button
        disabled={
          busy ||
          transitionConflict ||
          !!transition.current ||
          (!comment.trim() && !commentAttempt.current)
        }
        onClick={() => void addComment()}
      >
        Comentar
      </button>
      {record.sla && record.sla.length > 0 && (
        <div>
          <h2>SLA</h2>
          <SlaBar sla={record.sla} />
          <Link to="/requests/bpm/sla" style={{ fontSize: 13 }}>Dashboard SLA</Link>
        </div>
      )}
      <h2>Timeline</h2>
      {timeline.map((e) => (
        <p key={e.id} style={{ fontSize: 13 }}>
          <span style={{ color: "var(--text-muted)" }}>
            {new Date(e.occurredAt).toLocaleString("pt-BR")}
          </span>
          {" · "}
          {e.type.replace("activity.", "").replace("request.", "").replace(/_/g, " ")}
        </p>
      ))}
      <Link to="/requests/bpm">Voltar</Link>
    </section>
  );
}
