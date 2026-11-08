import { useEffect, useMemo, useState } from "react";
import { projectsApi, registryApi } from "../../api/resources";
import type {
  Category,
  ClientFull,
  Company,
  Project,
  ProjectType,
  ConsultimerProjectType,
  ResponsibleFull,
  SiteFull,
} from "../../api/types";
import { useI18n, usePageText } from "../../i18n";
import DynamicForm, { type FieldConfig, type FormValues } from "../ui/DynamicForm";
import Modal from "../ui/Modal";

type ApiErrors = Record<string, string[]>;

const TEXT = {
  "pt-BR": {
    editar: (code: string) => `Editar Projeto — ${code}`,
    novo: "Novo Projeto",
    nomeLabel: "Nome do Projeto",
    po: "PO",
    qtdLinks: "Quantidade de Links",
    rackPos: "Rack Position",
    rackPosTip: "Ativar controle de Rack Position (DH, Links, UTP)",
    empresa: "Empresa",
    statusLabel: "Status",
    cliente: "Cliente",
    site: "Site",
    tipoProjeto: "Tipo de Projeto",
    categoria: "Categoria",
    responsavelCstr: "Responsável CSTR",
    responsavelCliente: "Responsável Cliente",
    inicioPrevisto: "Início Previsto",
    terminoPrevisto: "Término Previsto",
    descricao: "Descrição",
    observacoes: "Observações",
    situacao: "Situação",
    instrucaoRP: "Depois de salvar, cadastre as Rack Positions (individualmente ou em massa, com DH/Links/UTP) e aloque as tarefas por Rack Position na tela de edição do projeto no Admin.",
    statuses: { planning: "Planejamento", not_started: "Não Iniciado", in_progress: "Ativo", paused: "Pausado", completed: "Concluído", canceled: "Cancelado" },
  },
  "en-US": {
    editar: (code: string) => `Edit Project — ${code}`,
    novo: "New Project",
    nomeLabel: "Project Name",
    po: "PO",
    qtdLinks: "Link Count",
    rackPos: "Rack Position",
    rackPosTip: "Enable Rack Position tracking (DH, Links, UTP)",
    empresa: "Company",
    statusLabel: "Status",
    cliente: "Client",
    site: "Site",
    tipoProjeto: "Project Type",
    categoria: "Category",
    responsavelCstr: "CSTR Responsible",
    responsavelCliente: "Client Responsible",
    inicioPrevisto: "Planned Start",
    terminoPrevisto: "Planned End",
    descricao: "Description",
    observacoes: "Notes",
    situacao: "Status",
    instrucaoRP: "After saving, register the Rack Positions (individually or in bulk, with DH/Links/UTP) and allocate tasks per Rack Position in the project edit screen.",
    statuses: { planning: "Planning", not_started: "Not Started", in_progress: "Active", paused: "Paused", completed: "Completed", canceled: "Canceled" },
  },
  "es-ES": {
    editar: (code: string) => `Editar Proyecto — ${code}`,
    novo: "Nuevo Proyecto",
    nomeLabel: "Nombre del Proyecto",
    po: "PO",
    qtdLinks: "Cantidad de Links",
    rackPos: "Rack Position",
    rackPosTip: "Activar control de Rack Position (DH, Links, UTP)",
    empresa: "Empresa",
    statusLabel: "Estado",
    cliente: "Cliente",
    site: "Site",
    tipoProjeto: "Tipo de Proyecto",
    categoria: "Categoría",
    responsavelCstr: "Responsable CSTR",
    responsavelCliente: "Responsable Cliente",
    inicioPrevisto: "Inicio Previsto",
    terminoPrevisto: "Fin Previsto",
    descricao: "Descripción",
    observacoes: "Observaciones",
    situacao: "Situación",
    instrucaoRP: "Tras guardar, registre los Rack Positions (individualmente o en masa, con DH/Links/UTP) y asigne las tareas por Rack Position.",
    statuses: { planning: "Planificación", not_started: "No Iniciado", in_progress: "Activo", paused: "Pausado", completed: "Completado", canceled: "Cancelado" },
  },
};

export default function ProjectFormModal({
  project,
  onClose,
  onSaved,
}: {
  project: Project | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const p = usePageText(TEXT);

  const statusOptions = Object.entries(p.statuses).map(([value, label]) => ({ value, label }));

  const [companies, setCompanies] = useState<Company[]>([]);
  const [clients, setClients] = useState<ClientFull[]>([]);
  const [sites, setSites] = useState<SiteFull[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>([]);
  const [consultimerTypes, setConsultimerTypes] = useState<ConsultimerProjectType[]>([]);
  const [responsibles, setResponsibles] = useState<ResponsibleFull[]>([]);
  const [clientResponsibles, setClientResponsibles] = useState<ResponsibleFull[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  const [values, setValues] = useState<FormValues>(
    project
      ? { ...project }
      : {
          company: null, name: "", po: "", link_count: 0, has_rack_positions: false, client: null, site: null, category: null,
          project_type: null, consultimer_type: null, responsible_cstr: null, responsible_client: null, status: "planning",
          planned_start: null, planned_end: null, description: "", notes: "", is_active: true,
        }
  );
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      registryApi.companies.list({ page_size: "200" } as never),
      registryApi.clients.list({ page_size: "500" } as never),
      registryApi.sites.list({ page_size: "500" } as never),
      registryApi.categories.list({ page_size: "200" } as never),
      registryApi.projectTypes.list({ page_size: "200" } as never),
      registryApi.consultimerProjectTypes.list({ page_size: "200" } as never),
      registryApi.responsibles.list({ page_size: "200", kind: "cstr" } as never),
      registryApi.responsibles.list({ page_size: "500", kind: "client" } as never),
    ])
      .then(([c, cl, s, cat, pt, ct, resp, clResp]) => {
        if (c.status === "fulfilled") setCompanies(c.value.results);
        if (cl.status === "fulfilled") setClients(cl.value.results);
        if (s.status === "fulfilled") setSites(s.value.results);
        if (cat.status === "fulfilled") setCategories(cat.value.results);
        if (pt.status === "fulfilled") setProjectTypes(pt.value.results);
        if (ct.status === "fulfilled") setConsultimerTypes(ct.value.results.filter((t) => t.is_active));
        if (resp.status === "fulfilled") setResponsibles(resp.value.results);
        if (clResp.status === "fulfilled") setClientResponsibles(clResp.value.results);
      })
      .finally(() => setLoadingRefs(false));
  }, []);

  const fields: FieldConfig[] = useMemo(() => {
    const selectedClientId = values.client as number | null;
    return [
      { name: "name", label: p.nomeLabel, type: "text", required: true, span: 2 },
      { name: "po", label: p.po, type: "text" },
      { name: "link_count", label: p.qtdLinks, type: "number" },
      { name: "has_rack_positions", label: p.rackPos, type: "checkbox", placeholder: p.rackPosTip, span: 2 },
      { name: "company", label: p.empresa, type: "select", required: true, options: companies.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name })) },
      { name: "status", label: p.statusLabel, type: "select", required: true, options: statusOptions },
      { name: "client", label: p.cliente, type: "select", options: clients.map((c) => ({ value: c.id, label: `${c.number_code ? c.number_code + " · " : ""}${c.trade_name || c.legal_name}` })) },
      {
        name: "site",
        label: p.site,
        type: "select",
        options: sites
          .filter((s) => !selectedClientId || s.client === selectedClientId)
          .map((s) => ({ value: s.id, label: s.code || s.name })),
      },
      { name: "consultimer_type", label: "Tipo Consultimer", type: "select", options: consultimerTypes.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` })) },
      { name: "project_type", label: p.tipoProjeto, type: "select", options: projectTypes.map((pt) => ({ value: pt.id, label: pt.name })) },
      { name: "category", label: p.categoria, type: "select", options: categories.map((cat) => ({ value: cat.id, label: cat.name })) },
      { name: "responsible_cstr", label: p.responsavelCstr, type: "select", options: responsibles.map((r) => ({ value: r.id, label: r.name })) },
      {
        name: "responsible_client",
        label: p.responsavelCliente,
        type: "select",
        options: clientResponsibles.filter((r) => !selectedClientId || r.client === selectedClientId).map((r) => ({ value: r.id, label: r.name })),
      },
      { name: "planned_start", label: p.inicioPrevisto, type: "date" },
      { name: "planned_end", label: p.terminoPrevisto, type: "date" },
      { name: "description", label: p.descricao, type: "textarea", span: 2 },
      { name: "notes", label: p.observacoes, type: "textarea", span: 2 },
      { name: "is_active", label: p.situacao, type: "checkbox", placeholder: t.common.ativo, span: 2 },
    ];
  }, [companies, clients, sites, categories, projectTypes, consultimerTypes, responsibles, clientResponsibles, values.client, p, t, statusOptions]);

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      if (project) {
        await projectsApi.update(project.id, values);
      } else {
        await projectsApi.create(values);
      }
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) {
        setErrors(axiosErr.response.data);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={project ? p.editar(project.code) : p.novo} onClose={onClose} width={720}>
      {loadingRefs ? (
        <p style={{ color: "var(--text-muted)" }}>{t.common.carregando}</p>
      ) : (
        <>
          <DynamicForm
            fields={fields}
            values={values}
            errors={errors}
            onChange={(name, value) =>
              setValues((prev) => {
                const next = { ...prev, [name]: value };
                if (name === "client") {
                  const newClientId = value as number | null;
                  const currentSite = sites.find((s) => s.id === prev.site);
                  if (currentSite && currentSite.client !== newClientId) {
                    next.site = null;
                  }
                  const currentResponsible = clientResponsibles.find((r) => r.id === prev.responsible_client);
                  if (currentResponsible && currentResponsible.client !== newClientId) {
                    next.responsible_client = null;
                  }
                }
                return next;
              })
            }
          />
          {values.has_rack_positions && (
            <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: -6, marginBottom: 12 }}>
              {p.instrucaoRP}
            </p>
          )}
          {errors.non_field_errors && (
            <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{errors.non_field_errors.join(" ")}</p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button className="btn btn-outline" onClick={onClose}>
              {t.common.cancelar}
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? t.common.salvando : t.common.salvar}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
