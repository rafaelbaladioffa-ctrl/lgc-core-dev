import { useState } from "react";
import { projectOccurrencesApi } from "../../api/resources";
import type { CollaboratorFull, ProjectOccurrence } from "../../api/types";
import { useI18n, usePageText } from "../../i18n";
import DynamicForm, { type FieldConfig, type FormValues } from "../ui/DynamicForm";
import Modal from "../ui/Modal";

type ApiErrors = Record<string, string[]>;

const TEXT = {
  "pt-BR": {
    editar: (title: string) => `Editar Ocorrência — ${title}`,
    novo: "Nova Ocorrência",
    titulo: "Título",
    descricao: "Descrição",
    responsavel: "Responsável",
    criticidade: "Criticidade",
    statusLabel: "Status",
    dataOcorrencia: "Data da Ocorrência",
    severidades: { low: "Baixa", medium: "Média", high: "Alta", critical: "Crítica" },
    statuses: { open: "Aberta", in_progress: "Em Andamento", resolved: "Resolvida", canceled: "Cancelada" },
  },
  "en-US": {
    editar: (title: string) => `Edit Occurrence — ${title}`,
    novo: "New Occurrence",
    titulo: "Title",
    descricao: "Description",
    responsavel: "Responsible",
    criticidade: "Severity",
    statusLabel: "Status",
    dataOcorrencia: "Occurrence Date",
    severidades: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
    statuses: { open: "Open", in_progress: "In Progress", resolved: "Resolved", canceled: "Canceled" },
  },
  "es-ES": {
    editar: (title: string) => `Editar Ocurrencia — ${title}`,
    novo: "Nueva Ocurrencia",
    titulo: "Título",
    descricao: "Descripción",
    responsavel: "Responsable",
    criticidade: "Criticidad",
    statusLabel: "Estado",
    dataOcorrencia: "Fecha de Ocurrencia",
    severidades: { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" },
    statuses: { open: "Abierta", in_progress: "En Progreso", resolved: "Resuelta", canceled: "Cancelada" },
  },
};

export default function ProjectOccurrenceFormModal({
  projectId,
  occurrence,
  collaborators,
  onClose,
  onSaved,
}: {
  projectId: number;
  occurrence: ProjectOccurrence | null;
  collaborators: CollaboratorFull[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const p = usePageText(TEXT);

  const severityOptions = [
    { value: "low", label: p.severidades.low },
    { value: "medium", label: p.severidades.medium },
    { value: "high", label: p.severidades.high },
    { value: "critical", label: p.severidades.critical },
  ];

  const statusOptions = [
    { value: "open", label: p.statuses.open },
    { value: "in_progress", label: p.statuses.in_progress },
    { value: "resolved", label: p.statuses.resolved },
    { value: "canceled", label: p.statuses.canceled },
  ];

  const fields: FieldConfig[] = [
    { name: "title", label: p.titulo, type: "text", required: true, span: 2 },
    { name: "description", label: p.descricao, type: "textarea", span: 2 },
    { name: "responsible", label: p.responsavel, type: "select", options: collaborators.map((c) => ({ value: c.id, label: c.name })) },
    { name: "severity", label: p.criticidade, type: "select", required: true, options: severityOptions },
    { name: "status", label: p.statusLabel, type: "select", required: true, options: statusOptions },
    { name: "occurred_at", label: p.dataOcorrencia, type: "date", required: true },
  ];

  const [values, setValues] = useState<FormValues>(
    occurrence
      ? { ...occurrence }
      : {
          title: "",
          description: "",
          responsible: "",
          severity: "medium",
          status: "open",
          occurred_at: new Date().toISOString().slice(0, 10),
        }
  );
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      const payload = { ...values, responsible: (values.responsible as number | "" | null) || null } as Partial<ProjectOccurrence>;
      if (occurrence) {
        await projectOccurrencesApi.update(occurrence.id, payload);
      } else {
        await projectOccurrencesApi.create({ ...payload, project: projectId });
      }
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) setErrors(axiosErr.response.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={occurrence ? p.editar(occurrence.title) : p.novo} onClose={onClose} width={560}>
      <DynamicForm fields={fields} values={values} errors={errors} onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))} />
      {errors.non_field_errors && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{errors.non_field_errors.join(" ")}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
        <button className="btn btn-outline" onClick={onClose}>
          {t.common.cancelar}
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? t.common.salvando : t.common.salvar}
        </button>
      </div>
    </Modal>
  );
}
