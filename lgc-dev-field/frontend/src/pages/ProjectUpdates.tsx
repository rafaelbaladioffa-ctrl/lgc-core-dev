import { SearchMultiSelect } from "../components/ui/SearchSelect";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import { useEffect, useState } from "react";
import { collaboratorsApi, projectsApi, projectUpdatesApi, usersApi } from "../api/resources";
import type { Collaborator, Project, ProjectDailyUpdate, UserOption } from "../api/types";
import { useAuth } from "../context/AuthContext";
import DateRangeCalendar, { type DateRange } from "../components/ui/DateRangeCalendar";
import DateInput from "../components/ui/DateInput";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import { downloadAuthenticatedFile } from "../utils/downloadFile";
import { PERMS, hasPerm } from "../utils/permissions";
import { useI18n, usePageText } from "../i18n";
import ProjectCombobox from "../components/ui/ProjectCombobox";
import WeeklyUpdatePanel from "../components/projects/WeeklyUpdatePanel";
import EmailLanguageSelect, { defaultEmailLanguage, type EmailLanguage } from "../components/ui/EmailLanguageSelect";

const TEXT = {
  "pt-BR": {
    eyebrow: "Área Operacional",
    title: "Atualizações de Projeto",
    subtitle: "Gere, edite e envie o status consolidado de cada projeto.",
    cancel: "Cancelar",
    newUpdate: "Nova Atualização",
    weeklyUpdate: "Update Semanal",
    period: "Período",
    search: "Buscar",
    searchPlaceholder: "PO ou nome do projeto...",
    statusLabel: "Status",
    statusAll: "Todos",
    statusSent: "Enviado",
    statusPending: "Não enviado",
    formProject: "Projeto",
    formSelectProject: "Selecione...",
    formDate: "Data",
    formNotes: "Observações (opcional)",
    generating: "Gerando...",
    generateBtn: "Gerar Atualização",
    loading: "Carregando...",
    emptyState: "Selecione um período ou busque por PO/nome do projeto acima para ver as Atualizações de Projeto.",
    badgeSent: "Enviado",
    badgePending: "Não enviado",
    noResults: "Nenhuma atualização encontrada para o filtro.",
    errorDuplicate: "Já existe uma atualização para este projeto nesta data. Edite a atualização existente na lista abaixo.",
    errorGenerate: "Não foi possível gerar a atualização.",
    // editor
    technicians: "Técnicos",
    completionPercent: "Percentual de Conclusão",
    activitiesText: "Atividades Executadas",
    certificationDone: "Certificação Finalizada",
    projectFinished: "Projeto Finalizado",
    observations: "Observações",
    saving: "Salvando...",
    additionalRecipients: "Destinatários adicionais",
    recipientsInfo: "Além dos responsáveis do cliente vinculado ao projeto, você pode escolher usuários do sistema e/ou digitar e-mails avulsos.",
    systemUsers: "Usuários do sistema",
    extraEmails: "E-mails avulsos",
    extraEmailsPlaceholder: "Separe por vírgula ou uma linha por e-mail",
    copied: "Copiado!",
    copyText: "Copiar Texto",
    downloadingPdf: "Gerando...",
    downloadPdf: "Baixar PDF",
    sending: "Enviando...",
    sendEmail: "Enviar por E-mail",
    feedbackError: "Não foi possível enviar o e-mail.",
  },
  "en-US": {
    eyebrow: "Operations",
    title: "Project Updates",
    subtitle: "Generate, edit and send the consolidated status for each project.",
    cancel: "Cancel",
    newUpdate: "New Update",
    weeklyUpdate: "Weekly Update",
    period: "Period",
    search: "Search",
    searchPlaceholder: "PO or project name...",
    statusLabel: "Status",
    statusAll: "All",
    statusSent: "Sent",
    statusPending: "Not sent",
    formProject: "Project",
    formSelectProject: "Select...",
    formDate: "Date",
    formNotes: "Notes (optional)",
    generating: "Generating...",
    generateBtn: "Generate Update",
    loading: "Loading...",
    emptyState: "Select a period or search by PO/project name above to see Project Updates.",
    badgeSent: "Sent",
    badgePending: "Not sent",
    noResults: "No updates found for the filter.",
    errorDuplicate: "An update for this project on this date already exists. Edit the existing update in the list below.",
    errorGenerate: "Could not generate the update.",
    technicians: "Technicians",
    completionPercent: "Completion Percentage",
    activitiesText: "Activities Performed",
    certificationDone: "Certification Complete",
    projectFinished: "Project Finished",
    observations: "Notes",
    saving: "Saving...",
    additionalRecipients: "Additional recipients",
    recipientsInfo: "In addition to the client contacts linked to the project, you can choose system users and/or type individual e-mails.",
    systemUsers: "System users",
    extraEmails: "Individual e-mails",
    extraEmailsPlaceholder: "Separate by comma or one e-mail per line",
    copied: "Copied!",
    copyText: "Copy Text",
    downloadingPdf: "Generating...",
    downloadPdf: "Download PDF",
    sending: "Sending...",
    sendEmail: "Send by E-mail",
    feedbackError: "Could not send the e-mail.",
  },
  "es-ES": {
    eyebrow: "Área Operacional",
    title: "Actualizaciones de Proyecto",
    subtitle: "Genere, edite y envíe el estado consolidado de cada proyecto.",
    cancel: "Cancelar",
    newUpdate: "Nueva Actualización",
    weeklyUpdate: "Update Semanal",
    period: "Período",
    search: "Buscar",
    searchPlaceholder: "PO o nombre del proyecto...",
    statusLabel: "Estado",
    statusAll: "Todos",
    statusSent: "Enviado",
    statusPending: "No enviado",
    formProject: "Proyecto",
    formSelectProject: "Seleccione...",
    formDate: "Fecha",
    formNotes: "Observaciones (opcional)",
    generating: "Generando...",
    generateBtn: "Generar Actualización",
    loading: "Cargando...",
    emptyState: "Seleccione un período o busque por PO/nombre del proyecto arriba para ver las Actualizaciones de Proyecto.",
    badgeSent: "Enviado",
    badgePending: "No enviado",
    noResults: "No se encontraron actualizaciones para el filtro.",
    errorDuplicate: "Ya existe una actualización para este proyecto en esta fecha. Edite la actualización existente en la lista de abajo.",
    errorGenerate: "No se pudo generar la actualización.",
    technicians: "Técnicos",
    completionPercent: "Porcentaje de Finalización",
    activitiesText: "Actividades Ejecutadas",
    certificationDone: "Certificación Finalizada",
    projectFinished: "Proyecto Finalizado",
    observations: "Observaciones",
    saving: "Guardando...",
    additionalRecipients: "Destinatarios adicionales",
    recipientsInfo: "Además de los responsables del cliente vinculado al proyecto, puede elegir usuarios del sistema y/o escribir correos individuales.",
    systemUsers: "Usuarios del sistema",
    extraEmails: "Correos individuales",
    extraEmailsPlaceholder: "Separe por coma o un correo por línea",
    copied: "¡Copiado!",
    copyText: "Copiar Texto",
    downloadingPdf: "Generando...",
    downloadPdf: "Descargar PDF",
    sending: "Enviando...",
    sendEmail: "Enviar por Correo",
    feedbackError: "No se pudo enviar el correo.",
  },
};

type PU = typeof TEXT["pt-BR"];

export default function ProjectUpdates() {
  const { user } = useAuth();
  const p = usePageText(TEXT);
  const { locale } = useI18n();
  const canCreate = hasPerm(user, PERMS.addProjectUpdate);
  const canEdit = hasPerm(user, PERMS.changeProjectUpdate);
  const [updates, setUpdates] = useState<ProjectDailyUpdate[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const [selected, setSelected] = useState<ProjectDailyUpdate | null>(null);

  const [newProjectId, setNewProjectId] = useState<number | "">("");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newSummary, setNewSummary] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange | null>(null);

  function openUpdate(update: ProjectDailyUpdate) {
    setSelected(update);
    projectUpdatesApi.get(update.id).then((detail) => {
      setSelected((current) => (current?.id === detail.id ? detail : current));
      setUpdates((prev) => prev.map((item) => (item.id === detail.id ? detail : item)));
    });
  }

  function reload() {
    setLoading(true);
    projectUpdatesApi
      .list()
      .then((data) => setUpdates(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    projectsApi.list({ for_updates: "1" }).then((data) => setProjects(data.results));
    collaboratorsApi.list().then((data) => setCollaborators(data.results));
    usersApi.options().then(setUserOptions).catch(() => setUserOptions([]));
  }, []);

  async function handleGenerate() {
    if (!newProjectId) return;
    setGenerating(true);
    setGenerateError("");
    try {
      const created = await projectUpdatesApi.create({
        project: Number(newProjectId),
        date: newDate,
        summary: newSummary,
      });
      setCreating(false);
      setNewProjectId("");
      setNewSummary("");
      reload();
      setSelected(created);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: Record<string, string[]> } };
      const data = axiosErr.response?.data;
      const raw = data ? Object.values(data).flat().join(" ") : "";
      const message = raw.includes("devem criar um set único")
        ? p.errorDuplicate
        : raw || p.errorGenerate;
      setGenerateError(message);
    } finally {
      setGenerating(false);
    }
  }

  const poByProject: Record<number, string> = {};
  projects.forEach((proj) => {
    poByProject[proj.id] = proj.po || "";
  });

  const term = search.trim().toLowerCase();
  const hasFilter = term !== "" || range !== null;

  const filteredUpdates = hasFilter
    ? updates.filter((update) => {
        // enviado + pendente marcados juntos = sem filtro
        if (statusFilter.length === 1 && statusFilter[0] === "sent" && !update.is_sent) return false;
        if (statusFilter.length === 1 && statusFilter[0] === "pending" && update.is_sent) return false;
        if (range && (update.date < range.start || update.date > range.end)) return false;
        if (term) {
          const po = (poByProject[update.project] || "").toLowerCase();
          const matches =
            update.project_name.toLowerCase().includes(term) ||
            update.project_code.toLowerCase().includes(term) ||
            po.includes(term);
          if (!matches) return false;
        }
        return true;
      })
    : [];

  return (
    <div>
      <PageHeader
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={p.subtitle}
        actions={
          canCreate ? (
            <div style={{ display: "flex", gap: 8 }}>
              {canEdit && (
                <button className="btn btn-secondary" onClick={() => setWeeklyOpen((v) => !v)}>
                  <Icon name={weeklyOpen ? "close" : "date_range"} style={{ fontSize: 18 }} />
                  {weeklyOpen ? p.cancel : p.weeklyUpdate}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
                <Icon name={creating ? "close" : "add"} style={{ fontSize: 18 }} />
                {creating ? p.cancel : p.newUpdate}
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="field-label">{p.period}</span>
          <DateRangeCalendar value={range} onChange={setRange} maxDays={31} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="field-label">{p.search}</span>
          <input
            type="text"
            className="input"
            placeholder={p.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }}
          />
          {hasFilter && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {filteredUpdates.length} {filteredUpdates.length === 1 ? "atualização encontrada" : "atualizações encontradas"}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginLeft: "auto" }}>
          <MultiSelectFilter
            label={p.statusLabel}
            options={[
              { value: "sent", label: p.statusSent },
              { value: "pending", label: p.statusPending },
            ]}
            selected={statusFilter}
            onChange={setStatusFilter}
            allLabel={p.statusAll}
            allWhenFull
          />
        </div>
      </div>

      {weeklyOpen && canEdit && <WeeklyUpdatePanel projects={projects} userOptions={userOptions} />}

      {creating && canCreate && (
        <div className="form-card">
          <label className="form-label">{p.formProject}</label>
          <ProjectCombobox projects={projects} value={newProjectId} onChange={setNewProjectId} />

          <label className="form-label">{p.formDate}</label>
          <DateInput value={newDate} onChange={setNewDate} />

          <label className="form-label">{p.formNotes}</label>
          <textarea className="input" value={newSummary} onChange={(e) => setNewSummary(e.target.value)} style={{ height: 80 }} />

          {generateError && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{generateError}</p>}

          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating} style={{ marginTop: 14 }}>
            {generating ? p.generating : p.generateBtn}
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>{p.loading}</p>
      ) : !hasFilter ? (
        <div className="empty-state">
          <Icon name="calendar_month" style={{ fontSize: 28, color: "var(--text-faint)" }} />
          <p style={{ marginTop: 8 }}>{p.emptyState}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredUpdates.map((update) => {
            const expanded = selected?.id === update.id;
            return (
              <div key={update.id} className="card" style={{ padding: 16 }}>
                <div
                  onClick={() => (expanded ? setSelected(null) : openUpdate(update))}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", flexWrap: "wrap", gap: 8 }}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ color: "var(--text)" }}>{update.project_name}</strong>
                    <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                      {update.project_code} · {new Date(update.date + "T00:00:00").toLocaleDateString(locale)} · {update.completion_percent}%
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: update.is_sent ? "var(--green)" : "var(--amber)" }}>
                      {update.is_sent ? p.badgeSent : p.badgePending}
                    </span>
                    <Icon name={expanded ? "expand_less" : "expand_more"} style={{ fontSize: 20, color: "var(--text-faint)" }} />
                  </div>
                </div>

                {expanded && (
                  <ProjectUpdateEditor
                    update={update}
                    collaborators={collaborators}
                    userOptions={userOptions}
                    canEdit={canEdit}
                    p={p}
                    onChange={(u) => {
                      setSelected(u);
                      setUpdates((prev) => prev.map((item) => (item.id === u.id ? u : item)));
                    }}
                  />
                )}
              </div>
            );
          })}
          {filteredUpdates.length === 0 && <div className="empty-state">{p.noResults}</div>}
        </div>
      )}
    </div>
  );
}

function ProjectUpdateEditor({
  update,
  collaborators,
  userOptions,
  canEdit,
  p,
  onChange,
}: {
  update: ProjectDailyUpdate;
  collaborators: Collaborator[];
  userOptions: UserOption[];
  canEdit: boolean;
  p: PU;
  onChange: (u: ProjectDailyUpdate) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [copied, setCopied] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [extraUserIds, setExtraUserIds] = useState<number[]>([]);
  const [extraEmailsText, setExtraEmailsText] = useState("");
  const { locale: uiLocale } = useI18n();
  const [emailLang, setEmailLang] = useState<EmailLanguage>(defaultEmailLanguage(uiLocale));

  async function handleDownloadPdf() {
    setDownloadingPdf(true);
    try {
      await downloadAuthenticatedFile(projectUpdatesApi.pdfPath(update.id), `atualizacao-projeto-${update.project}-${update.date}.pdf`);
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function save(patch: Partial<ProjectDailyUpdate>) {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...patch };
      if (patch.collaborators) {
        payload.collaborator_ids = patch.collaborators.map((c) => c.id);
        delete payload.collaborators;
      }
      const updated = await projectUpdatesApi.update(update.id, payload);
      onChange(updated);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendEmail() {
    const emails = extraEmailsText
      .split(/[,;\n]/)
      .map((e) => e.trim())
      .filter(Boolean);
    setSendingEmail(true);
    setFeedback("");
    setFeedbackError("");
    try {
      const result = await projectUpdatesApi.sendEmail(update.id, { user_ids: extraUserIds, emails, language: emailLang });
      if (result.detail) {
        setFeedbackError(result.detail);
      } else {
        const skippedPart = result.skipped.length ? ` Sem e-mail: ${result.skipped.join(", ")}` : "";
        setFeedback(`${result.sent.length} e-mail(s) enviado(s).${skippedPart}`);
        const refreshed = await projectUpdatesApi.get(update.id);
        onChange(refreshed);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setFeedbackError(axiosErr.response?.data?.detail || p.feedbackError);
    } finally {
      setSendingEmail(false);
    }
  }

  function copyText() {
    if (!update.preview) return;
    navigator.clipboard.writeText(update.preview);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
      <label className="form-label">{p.technicians}</label>
      <SearchMultiSelect
        disabled={!canEdit}
        options={collaborators.map((c) => ({ value: c.id, label: c.name }))}
        value={update.collaborators.map((c) => c.id)}
        onChange={(next) => {
          const ids = next.map(Number);
          save({ collaborators: collaborators.filter((c) => ids.includes(c.id)) });
        }}
      />

      <label className="form-label">{p.completionPercent}</label>
      <input
        type="number"
        min={0}
        max={100}
        disabled={!canEdit}
        className="input"
        value={update.completion_percent}
        onChange={(e) => onChange({ ...update, completion_percent: Number(e.target.value) })}
        onBlur={(e) => save({ completion_percent: Number(e.target.value) })}
      />

      <label className="form-label">{p.activitiesText}</label>
      <textarea
        disabled={!canEdit}
        className="input"
        value={update.activities_text}
        onChange={(e) => onChange({ ...update, activities_text: e.target.value })}
        onBlur={(e) => save({ activities_text: e.target.value })}
        style={{ height: 90 }}
      />

      <div style={{ display: "flex", gap: 16, margin: "14px 0" }}>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={update.certification_done}
            onChange={(e) => save({ certification_done: e.target.checked })}
          />
          {p.certificationDone}
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={update.project_finished}
            onChange={(e) => save({ project_finished: e.target.checked })}
          />
          {p.projectFinished}
        </label>
      </div>

      <label className="form-label">{p.observations}</label>
      <textarea
        disabled={!canEdit}
        className="input"
        value={update.summary}
        onChange={(e) => onChange({ ...update, summary: e.target.value })}
        onBlur={(e) => save({ summary: e.target.value })}
        style={{ height: 70 }}
      />

      {saving && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.saving}</p>}

      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginTop: 16, fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 220, overflowY: "auto" }}>
        {update.preview}
      </div>

      {feedback && <p style={{ fontSize: 12, color: "var(--green)", marginTop: 8, fontWeight: 600 }}>{feedback}</p>}
      {feedbackError && <p style={{ fontSize: 12, color: "var(--red)", marginTop: 8, fontWeight: 600 }}>{feedbackError}</p>}

      {canEdit && (
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            onClick={() => setRecipientsOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)", fontSize: 12.5 }}
          >
            <Icon name={recipientsOpen ? "expand_less" : "expand_more"} style={{ fontSize: 16 }} />
            {p.additionalRecipients} {extraUserIds.length + extraEmailsText.split(/[,;\n]/).filter((e) => e.trim()).length > 0
              ? `(${extraUserIds.length + extraEmailsText.split(/[,;\n]/).filter((e) => e.trim()).length})`
              : ""}
          </button>

          {recipientsOpen && (
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginTop: 8 }}>
              <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>
                {p.recipientsInfo}
              </p>

              <label className="form-label">{p.systemUsers}</label>
              <SearchMultiSelect
                options={userOptions.map((u) => ({ value: u.id, label: u.name, sublabel: u.email }))}
                value={extraUserIds}
                onChange={(next) => setExtraUserIds(next.map(Number))}
              />

              <label className="form-label">{p.extraEmails}</label>
              <textarea
                className="input"
                placeholder={p.extraEmailsPlaceholder}
                value={extraEmailsText}
                onChange={(e) => setExtraEmailsText(e.target.value)}
                style={{ height: 60 }}
              />
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button onClick={copyText} className="btn btn-secondary">
          {copied ? p.copied : p.copyText}
        </button>
        {canEdit && (
          <>
            <button onClick={handleDownloadPdf} disabled={downloadingPdf} className="btn btn-secondary">
              {downloadingPdf ? p.downloadingPdf : p.downloadPdf}
            </button>
            <EmailLanguageSelect value={emailLang} onChange={setEmailLang} />
            <button onClick={handleSendEmail} disabled={sendingEmail} className="btn btn-primary">
              {sendingEmail ? p.sending : p.sendEmail}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
