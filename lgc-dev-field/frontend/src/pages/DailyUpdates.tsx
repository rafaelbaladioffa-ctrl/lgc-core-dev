import { SearchMultiSelect } from "../components/ui/SearchSelect";
import ProjectCombobox from "../components/ui/ProjectCombobox";
import { useEffect, useState } from "react";
import { collaboratorsApi, dailyUpdatesApi, projectsApi } from "../api/resources";
import type { Collaborator, DailyUpdate, Project } from "../api/types";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import DateRangeCalendar, { type DateRange } from "../components/ui/DateRangeCalendar";
import DateInput from "../components/ui/DateInput";
import { downloadAuthenticatedFile } from "../utils/downloadFile";
import { useI18n, usePageText } from "../i18n";
import EmailLanguageSelect, { defaultEmailLanguage, type EmailLanguage } from "../components/ui/EmailLanguageSelect";
import { PERMS, hasPerm } from "../utils/permissions";

const TEXT = {
  "pt-BR": {
    eyebrow: "Área Operacional", title: "Atualizações Diárias",
    subtitle: "Registre e envie o consolidado diário de alocação da equipe.",
    newUpdate: "Nova Atualização", cancel: "Cancelar",
    period: "Período",
    found: (n: number) => `${n} atualização(ões) encontrada(s)`,
    consolidatedPdfLabel: "Gerar PDF Consolidado do dia",
    generateConsolidated: "Gerar PDF Consolidado", generating: "Gerando...",
    loading: "Carregando...",
    selectPeriod: "Selecione um período acima para ver as Atualizações Diárias.",
    projectLabel: (n: number) => `Projeto ${n}`,
    selectProject: "Selecione...",
    dateFrom: "Data inicial", dateTo: "Data final",
    days: (n: number) => `${n} dias`,
    project: "Projeto",
    technicians: "Técnicos", addProject: "Adicionar Projeto",
    saving: "Salvando...", save: "Salvar",
    noUpdate: "Nenhuma atualização registrada.",
    pdf: "PDF", sendEmail: "Enviar e-mail",
    deleteUpdate: "Excluir",
    confirmDelete: (date: string) => `Excluir a Atualização Diária de ${date}? Essa ação não pode ser desfeita.`,
    deleted: "Atualização excluída.",
    errDelete: "Não foi possível excluir a atualização.",
    errNoRows: "Adicione ao menos um projeto com técnico(s) selecionado(s).",
    errInvalidPeriod: "Um ou mais projetos têm período inválido (data inicial > data final).",
    errSave: "Não foi possível salvar a atualização.",
    errPdf: "Não foi possível gerar o PDF consolidado. Verifique se existem Atualizações Diárias para a data selecionada.",
  },
  "en-US": {
    eyebrow: "Operations", title: "Daily Updates",
    subtitle: "Record and send the daily team allocation summary.",
    newUpdate: "New Update", cancel: "Cancel",
    period: "Period",
    found: (n: number) => `${n} update(s) found`,
    consolidatedPdfLabel: "Generate Consolidated PDF for date",
    generateConsolidated: "Generate Consolidated PDF", generating: "Generating...",
    loading: "Loading...",
    selectPeriod: "Select a period above to see Daily Updates.",
    projectLabel: (n: number) => `Project ${n}`,
    selectProject: "Select...",
    dateFrom: "Start date", dateTo: "End date",
    days: (n: number) => `${n} days`,
    project: "Project",
    technicians: "Technicians", addProject: "Add Project",
    saving: "Saving...", save: "Save",
    noUpdate: "No updates recorded.",
    pdf: "PDF", sendEmail: "Send email",
    deleteUpdate: "Delete",
    confirmDelete: (date: string) => `Delete the Daily Update of ${date}? This cannot be undone.`,
    deleted: "Update deleted.",
    errDelete: "Could not delete the update.",
    errNoRows: "Add at least one project with technician(s) selected.",
    errInvalidPeriod: "One or more projects have an invalid period (start date > end date).",
    errSave: "Could not save the update.",
    errPdf: "Could not generate the consolidated PDF. Check if Daily Updates exist for the selected date.",
  },
  "es-ES": {
    eyebrow: "Operaciones", title: "Actualizaciones Diarias",
    subtitle: "Registra y envía el consolidado diario de asignación del equipo.",
    newUpdate: "Nueva Actualización", cancel: "Cancelar",
    period: "Período",
    found: (n: number) => `${n} actualización(es) encontrada(s)`,
    consolidatedPdfLabel: "Generar PDF Consolidado del día",
    generateConsolidated: "Generar PDF Consolidado", generating: "Generando...",
    loading: "Cargando...",
    selectPeriod: "Selecciona un período arriba para ver las Actualizaciones Diarias.",
    projectLabel: (n: number) => `Proyecto ${n}`,
    selectProject: "Seleccionar...",
    dateFrom: "Fecha inicial", dateTo: "Fecha final",
    days: (n: number) => `${n} días`,
    project: "Proyecto",
    technicians: "Técnicos", addProject: "Agregar Proyecto",
    saving: "Guardando...", save: "Guardar",
    noUpdate: "Sin actualizaciones registradas.",
    pdf: "PDF", sendEmail: "Enviar correo",
    deleteUpdate: "Eliminar",
    confirmDelete: (date: string) => `¿Eliminar la Actualización Diaria del ${date}? Esta acción no se puede deshacer.`,
    deleted: "Actualización eliminada.",
    errDelete: "No fue posible eliminar la actualización.",
    errNoRows: "Agrega al menos un proyecto con técnico(s) seleccionado(s).",
    errInvalidPeriod: "Uno o más proyectos tienen período inválido (fecha inicial > fecha final).",
    errSave: "No fue posible guardar la actualización.",
    errPdf: "No fue posible generar el PDF consolidado. Verifica si existen Actualizaciones Diarias para la fecha seleccionada.",
  },
};

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface AllocationRow {
  projectId: number | "";
  collaboratorIds: number[];
  dateFrom: string;
  dateTo: string;
}

function emptyRow(): AllocationRow {
  const today = new Date().toISOString().slice(0, 10);
  return { projectId: "", collaboratorIds: [], dateFrom: today, dateTo: today };
}

export default function DailyUpdates() {
  const { user } = useAuth();
  const p = usePageText(TEXT);
  const { locale } = useI18n();
  const [emailLang, setEmailLang] = useState<EmailLanguage>(defaultEmailLanguage(locale));
  const canCreate = hasPerm(user, PERMS.addDailyUpdate);
  const canSend = hasPerm(user, PERMS.changeDailyUpdate);
  const canDelete = hasPerm(user, PERMS.deleteDailyUpdate);
  const [updates, setUpdates] = useState<DailyUpdate[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [allocationRows, setAllocationRows] = useState<AllocationRow[]>([emptyRow()]);
  const [feedback, setFeedback] = useState("");
  const [createError, setCreateError] = useState("");
  const [savingCreate, setSavingCreate] = useState(false);
  const [consolidatedDate, setConsolidatedDate] = useState(tomorrowIso);
  const [downloadingId, setDownloadingId] = useState<number | "consolidated" | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);

  function reload(currentRange: DateRange | null) {
    if (!currentRange) {
      setUpdates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    dailyUpdatesApi
      .list({ date_from: currentRange.start, date_to: currentRange.end })
      .then((data) => setUpdates(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    projectsApi.list({ status: "in_progress" }).then((data) => setProjects(data.results));
    collaboratorsApi.list().then((data) => setCollaborators(data.results));
  }, []);

  function addAllocationRow() {
    setAllocationRows((prev) => [...prev, emptyRow()]);
  }

  function removeAllocationRow(index: number) {
    setAllocationRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateAllocationRow(index: number, patch: Partial<AllocationRow>) {
    setAllocationRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function getDatesInRange(from: string, to: string): string[] {
    const dates: string[] = [];
    const current = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    while (current <= end) {
      dates.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  async function handleCreate() {
    const validRows = allocationRows.filter((row) => row.projectId && row.collaboratorIds.length > 0);
    if (validRows.length === 0) {
      setCreateError(p.errNoRows);
      return;
    }
    const invalidPeriod = validRows.find((row) => !row.dateFrom || !row.dateTo || row.dateFrom > row.dateTo);
    if (invalidPeriod) {
      setCreateError(p.errInvalidPeriod);
      return;
    }
    setSavingCreate(true);
    setCreateError("");
    try {
      // Uma única atualização por data, concentrando todos os projetos
      // selecionados naquele dia. Se o mesmo projeto aparece em mais de uma
      // linha para a mesma data, os técnicos são unidos (há restrição de
      // um projeto por atualização).
      const byDate = new Map<string, Map<number, Set<number>>>();
      for (const row of validRows) {
        for (const d of getDatesInRange(row.dateFrom, row.dateTo)) {
          const projectsOfDay = byDate.get(d) ?? new Map<number, Set<number>>();
          const projectId = Number(row.projectId);
          const techs = projectsOfDay.get(projectId) ?? new Set<number>();
          row.collaboratorIds.forEach((id) => techs.add(id));
          projectsOfDay.set(projectId, techs);
          byDate.set(d, projectsOfDay);
        }
      }
      const allRequests = Array.from(byDate.entries()).map(([d, projectsOfDay]) =>
        dailyUpdatesApi.create({
          allocation_date: d,
          allocations: Array.from(projectsOfDay.entries()).map(([project, techs]) => ({
            project,
            collaborator_ids: Array.from(techs),
          })),
        } as never)
      );
      await Promise.all(allRequests);
      setCreating(false);
      setAllocationRows([emptyRow()]);
      reload(range);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: Record<string, unknown> } };
      const data = axiosErr.response?.data;
      setCreateError(data ? JSON.stringify(data) : p.errSave);
    } finally {
      setSavingCreate(false);
    }
  }

  async function handleSendEmail(id: number) {
    const result = await dailyUpdatesApi.sendEmail(id, emailLang);
    setFeedback(`${result.sent.length} e-mail(s) enviado(s).${result.skipped.length ? ` Sem e-mail: ${result.skipped.join(", ")}` : ""}`);
  }

  async function handleDelete(id: number, date: string) {
    const label = new Date(date + "T00:00:00").toLocaleDateString(locale);
    if (!window.confirm(p.confirmDelete(label))) return;
    try {
      await dailyUpdatesApi.remove(id);
      setUpdates((prev) => prev.filter((u) => u.id !== id));
      setFeedback(p.deleted);
    } catch {
      alert(p.errDelete);
    }
  }

  async function handleDownloadPdf(id: number, date: string) {
    setDownloadingId(id);
    try {
      await downloadAuthenticatedFile(dailyUpdatesApi.pdfPath(id), `atualizacao-diaria-${date}.pdf`);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDownloadConsolidated() {
    if (!consolidatedDate) return;
    setDownloadingId("consolidated");
    try {
      await downloadAuthenticatedFile(dailyUpdatesApi.consolidatedPdfPath(consolidatedDate), `atualizacao-diaria-${consolidatedDate}.pdf`);
    } catch {
      alert(p.errPdf);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={p.subtitle}
        actions={
          canCreate ? (
            <button
              className="btn btn-primary"
              onClick={() => {
                setCreating((v) => !v);
                setAllocationRows([emptyRow()]);
                setCreateError("");
              }}
            >
              <Icon name={creating ? "close" : "add"} style={{ fontSize: 18 }} />
              {creating ? p.cancel : p.newUpdate}
            </button>
          ) : undefined
        }
      />

      <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="field-label">{p.period}</span>
          <DateRangeCalendar value={range} onChange={setRange} maxDays={7} />
          {range && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {p.found(updates.length)}
            </span>
          )}
        </div>

        {canSend && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginLeft: "auto", flexWrap: "wrap" }}>
            <div className="field-group">
              <span className="field-label">{p.consolidatedPdfLabel}</span>
              <DateInput value={consolidatedDate} onChange={setConsolidatedDate} />
            </div>
            <button className="btn btn-outline" onClick={handleDownloadConsolidated} disabled={downloadingId === "consolidated"}>
              <Icon name="picture_as_pdf" style={{ fontSize: 16 }} />
              {downloadingId === "consolidated" ? p.generating : p.generateConsolidated}
            </button>
          </div>
        )}
      </div>

      {feedback && (
        <div className="card" style={{ padding: 12, marginBottom: 16, color: "var(--green)", fontSize: 13, fontWeight: 600 }}>
          {feedback}
        </div>
      )}

      {creating && canCreate && (
        <div className="form-card">
          {allocationRows.map((row, index) => (
            <div
              key={index}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 14,
                marginBottom: 12,
                position: "relative",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
                  {p.projectLabel(index + 1)}
                </span>
                {allocationRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeAllocationRow(index)}
                    className="btn btn-outline btn-sm"
                    style={{ color: "var(--red)" }}
                  >
                    <Icon name="delete" style={{ fontSize: 14 }} />
                  </button>
                )}
              </div>

              <label className="form-label">{p.project}</label>
              <ProjectCombobox
                projects={projects}
                value={row.projectId}
                onChange={(id) => updateAllocationRow(index, { projectId: id })}
                showAllToggle={false}
              />

              <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
                <div className="field-group" style={{ flex: 1, minWidth: 140 }}>
                  <label className="form-label">{p.dateFrom}</label>
                  <DateInput
                    value={row.dateFrom}
                    onChange={(val) => {
                      updateAllocationRow(index, { dateFrom: val, dateTo: val > row.dateTo ? val : row.dateTo });
                    }}
                  />
                </div>
                <div className="field-group" style={{ flex: 1, minWidth: 140 }}>
                  <label className="form-label">{p.dateTo}</label>
                  <DateInput
                    value={row.dateTo}
                    min={row.dateFrom}
                    onChange={(val) => updateAllocationRow(index, { dateTo: val })}
                  />
                </div>
              </div>
              {row.dateFrom !== row.dateTo && row.dateFrom <= row.dateTo && (
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 4px" }}>
                  <Icon name="info" style={{ fontSize: 13, verticalAlign: "middle", marginRight: 4 }} />
                  {p.days(getDatesInRange(row.dateFrom, row.dateTo).length)}
                </p>
              )}

              <label className="form-label" style={{ marginTop: 10 }}>{p.technicians}</label>
              <SearchMultiSelect
                options={collaborators.map((c) => ({ value: c.id, label: c.name }))}
                value={row.collaboratorIds}
                onChange={(next) => updateAllocationRow(index, { collaboratorIds: next.map(Number) })}
              />
            </div>
          ))}

          <button type="button" onClick={addAllocationRow} className="btn btn-outline btn-sm" style={{ marginBottom: 14 }}>
            <Icon name="add" style={{ fontSize: 15 }} />
            {p.addProject}
          </button>

          {createError && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{createError}</p>}

          <div>
            <button className="btn btn-primary" onClick={handleCreate} disabled={savingCreate}>
              {savingCreate ? p.saving : p.save}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>{p.loading}</p>
      ) : !range ? (
        <div className="empty-state">
          <Icon name="calendar_month" style={{ fontSize: 28, color: "var(--text-faint)" }} />
          <p style={{ marginTop: 8 }}>{p.selectPeriod}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {updates.map((update) => (
            <div key={update.id} className="card" style={{ padding: 16 }}>
              <div className="section-header-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <strong style={{ color: "var(--text)" }}>
                  {new Date(update.allocation_date + "T00:00:00").toLocaleDateString(locale)}
                </strong>
                {(canSend || canDelete) && (
                  <div className="section-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {canDelete && (
                      <button
                        onClick={() => handleDelete(update.id, update.allocation_date)}
                        className="btn btn-outline btn-sm"
                        style={{ color: "var(--red)", borderColor: "var(--red)" }}
                      >
                        <Icon name="delete" style={{ fontSize: 15 }} />
                        {p.deleteUpdate}
                      </button>
                    )}
                    {canSend && (
                      <>
                        <button
                          onClick={() => handleDownloadPdf(update.id, update.allocation_date)}
                          disabled={downloadingId === update.id}
                          className="btn btn-secondary btn-sm"
                        >
                          {downloadingId === update.id ? p.generating : p.pdf}
                        </button>
                        <EmailLanguageSelect value={emailLang} onChange={setEmailLang} />
                        <button onClick={() => handleSendEmail(update.id)} className="btn btn-primary btn-sm">
                          {p.sendEmail}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "var(--text-muted)", marginTop: 10, fontFamily: "inherit" }}>
                {update.description}
              </pre>
            </div>
          ))}
          {updates.length === 0 && <div className="empty-state">{p.noUpdate}</div>}
        </div>
      )}
    </div>
  );
}
