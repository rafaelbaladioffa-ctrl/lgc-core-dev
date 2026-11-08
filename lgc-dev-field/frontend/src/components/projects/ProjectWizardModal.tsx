import SearchSelect from "../ui/SearchSelect";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { projectsApi, registryApi } from "../../api/resources";
import type { Category, ClientFull, Company, ConsultimerProjectType, Project, ProjectType, ResponsibleFull, SiteFull } from "../../api/types";
import { useI18n, usePageText } from "../../i18n";
import DateInput from "../ui/DateInput";
import Icon from "../ui/Icon";
import Modal from "../ui/Modal";

const TEXT = {
  "pt-BR": {
    tituloModal: "Novo Projeto",
    steps: ["Identificação", "Classificação", "Planejamento"],
    statuses: {
      planning: "Planejamento",
      not_started: "Não Iniciado",
      in_progress: "Ativo",
      paused: "Pausado",
    },
    selecione: "— selecione —",
    projetoRegistrado: "Projeto registrado",
    proximosPassos: "Próximos passos",
    irParaProjeto: "Ir para o projeto",
    importarSow: "Importar SOW",
    instrucaoSow: "Importe a SOW para cadastrar atividades e tarefas automaticamente",
    fecharSemImportar: "Fechar sem importar",
    descPasso1: "Preencha as informações essenciais para identificar o projeto.",
    descPasso2: "Classifique o projeto para facilitar filtros e relatórios.",
    descPasso3: "Defina responsáveis, cronograma e observações. Todos os campos são opcionais — você pode preencher depois.",
    nomeProjeto: "Nome do Projeto",
    placeholderNome: "Ex: GRU65 — Fase 2 — Cabeamento Óptico",
    po: "PO",
    placeholderPo: "Número da PO",
    empresa: "Empresa",
    cliente: "Cliente",
    site: "Site",
    tipoProjeto: "Tipo de Projeto",
    categoria: "Categoria",
    statusInicial: "Status inicial",
    qtdLinks: "Quantidade de Links",
    ativarRP: "Ativar Rack Position",
    descRP: "Habilita controle de DH, Links e UTP por posição de rack.",
    responsavelCstr: "Responsável CSTR",
    responsavelCliente: "Responsável Cliente",
    inicioPrevisto: "Início Previsto",
    terminoPrevisto: "Término Previsto",
    descricao: "Descrição",
    observacoes: "Observações",
    voltar: "Voltar",
    continuar: "Continuar",
    criando: "Criando...",
    criarProjeto: "Criar Projeto",
    erroNome: "Nome é obrigatório.",
    erroEmpresa: "Empresa é obrigatória.",
  },
  "en-US": {
    tituloModal: "New Project",
    steps: ["Identification", "Classification", "Planning"],
    statuses: {
      planning: "Planning",
      not_started: "Not Started",
      in_progress: "Active",
      paused: "Paused",
    },
    selecione: "— select —",
    projetoRegistrado: "Project registered",
    proximosPassos: "Next steps",
    irParaProjeto: "Go to project",
    importarSow: "Import SOW",
    instrucaoSow: "Import the SOW to register activities and tasks automatically",
    fecharSemImportar: "Close without importing",
    descPasso1: "Fill in the essential information to identify the project.",
    descPasso2: "Classify the project to make filtering and reporting easier.",
    descPasso3: "Set assignees, schedule and notes. All fields are optional — you can fill them in later.",
    nomeProjeto: "Project Name",
    placeholderNome: "Ex: GRU65 — Phase 2 — Optical Cabling",
    po: "PO",
    placeholderPo: "PO Number",
    empresa: "Company",
    cliente: "Client",
    site: "Site",
    tipoProjeto: "Project Type",
    categoria: "Category",
    statusInicial: "Initial Status",
    qtdLinks: "Link Count",
    ativarRP: "Enable Rack Position",
    descRP: "Enables DH, Links and UTP control per rack position.",
    responsavelCstr: "CSTR Responsible",
    responsavelCliente: "Client Responsible",
    inicioPrevisto: "Planned Start",
    terminoPrevisto: "Planned End",
    descricao: "Description",
    observacoes: "Notes",
    voltar: "Back",
    continuar: "Continue",
    criando: "Creating...",
    criarProjeto: "Create Project",
    erroNome: "Name is required.",
    erroEmpresa: "Company is required.",
  },
  "es-ES": {
    tituloModal: "Nuevo Proyecto",
    steps: ["Identificación", "Clasificación", "Planificación"],
    statuses: {
      planning: "Planificación",
      not_started: "No Iniciado",
      in_progress: "Activo",
      paused: "Pausado",
    },
    selecione: "— seleccione —",
    projetoRegistrado: "Proyecto registrado",
    proximosPassos: "Próximos pasos",
    irParaProjeto: "Ir al proyecto",
    importarSow: "Importar SOW",
    instrucaoSow: "Importe el SOW para registrar actividades y tareas automáticamente",
    fecharSemImportar: "Cerrar sin importar",
    descPasso1: "Complete la información esencial para identificar el proyecto.",
    descPasso2: "Clasifique el proyecto para facilitar filtros e informes.",
    descPasso3: "Defina responsables, cronograma y observaciones. Todos los campos son opcionales — puede completarlos después.",
    nomeProjeto: "Nombre del Proyecto",
    placeholderNome: "Ej: GRU65 — Fase 2 — Cableado Óptico",
    po: "PO",
    placeholderPo: "Número de PO",
    empresa: "Empresa",
    cliente: "Cliente",
    site: "Site",
    tipoProjeto: "Tipo de Proyecto",
    categoria: "Categoría",
    statusInicial: "Estado inicial",
    qtdLinks: "Cantidad de Links",
    ativarRP: "Activar Rack Position",
    descRP: "Habilita control de DH, Links y UTP por posición de rack.",
    responsavelCstr: "Responsable CSTR",
    responsavelCliente: "Responsable Cliente",
    inicioPrevisto: "Inicio Previsto",
    terminoPrevisto: "Fin Previsto",
    descricao: "Descripción",
    observacoes: "Observaciones",
    voltar: "Volver",
    continuar: "Continuar",
    criando: "Creando...",
    criarProjeto: "Crear Proyecto",
    erroNome: "El nombre es obligatorio.",
    erroEmpresa: "La empresa es obligatoria.",
  },
};

// ---------------------------------------------------------------------------
// Barra de progresso
// ---------------------------------------------------------------------------

function StepBar({ current, steps }: { current: number; steps: string[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 0 }}>
      {steps.map((label, i) => {
        const n = i + 1;
        return (
          <Fragment key={n}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
              <div
                style={{
                  width: 32, height: 32, borderRadius: "50%", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700,
                  background: n < current ? "var(--green)" : n === current ? "var(--orange)" : "var(--surface-2, #eee)",
                  color: n <= current ? "#fff" : "var(--text-faint)",
                  transition: "background 0.2s",
                }}
              >
                {n < current ? <Icon name="check" style={{ fontSize: 16 }} /> : n}
              </div>
              <div
                style={{
                  fontSize: 11, marginTop: 4, textAlign: "center", whiteSpace: "nowrap",
                  color: n === current ? "var(--orange)" : n < current ? "var(--green)" : "var(--text-faint)",
                  fontWeight: n === current ? 700 : 400,
                }}
              >
                {label}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 2, height: 2, marginBottom: 18, background: n < current ? "var(--green)" : "var(--border, #ddd)", transition: "background 0.2s" }} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

type FormValues = {
  name: string;
  po: string;
  company: number | "";
  client: number | "";
  site: number | "";
  project_type: number | "";
  consultimer_type: number | "";
  category: number | "";
  status: string;
  has_rack_positions: boolean;
  link_count: number | "";
  responsible_cstr: number | "";
  responsible_client: number | "";
  planned_start: string;
  planned_end: string;
  description: string;
  notes: string;
};

const INITIAL: FormValues = {
  name: "", po: "", company: "", client: "", site: "",
  project_type: "", consultimer_type: "", category: "", status: "planning",
  has_rack_positions: false, link_count: "",
  responsible_cstr: "", responsible_client: "",
  planned_start: "", planned_end: "", description: "", notes: "",
};

type ApiErrors = Record<string, string[]>;

// ---------------------------------------------------------------------------
// Componentes de campo reutilizáveis
// ---------------------------------------------------------------------------

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="field-group">
      <span className="field-label">{label}{required && <span style={{ color: "var(--red)", marginLeft: 2 }}>*</span>}</span>
      {children}
      {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
    </div>
  );
}

function SelectField({ label, required, error, value, onChange, options, placeholder }: {
  label: string; required?: boolean; error?: string;
  value: number | ""; onChange: (v: number | "") => void;
  options: { value: number; label: string }[]; placeholder: string;
}) {
  return (
    <Field label={label} required={required} error={error}>
      <SearchSelect
        options={options}
        value={value}
        onChange={(v) => onChange(v === "" ? "" : Number(v))}
        placeholder={placeholder}
        clearable={!required}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Wizard principal
// ---------------------------------------------------------------------------

export default function ProjectWizardModal({ onClose, onSaved }: { onClose: () => void; onSaved: (project: Project) => void }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const p = usePageText(TEXT);

  const statusOptions = Object.entries(p.statuses).map(([value, label]) => ({ value, label }));

  const [step, setStep] = useState(1);
  const [values, setValues] = useState<FormValues>(INITIAL);
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);
  const [savedProject, setSavedProject] = useState<Project | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [clients, setClients] = useState<ClientFull[]>([]);
  const [sites, setSites] = useState<SiteFull[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>([]);
  const [consultimerTypes, setConsultimerTypes] = useState<ConsultimerProjectType[]>([]);
  const [responsibles, setResponsibles] = useState<ResponsibleFull[]>([]);
  const [clientResponsibles, setClientResponsibles] = useState<ResponsibleFull[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

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
    ]).then(([c, cl, s, cat, pt, ct, resp, clResp]) => {
      if (c.status === "fulfilled") setCompanies(c.value.results);
      if (cl.status === "fulfilled") setClients(cl.value.results);
      if (s.status === "fulfilled") setSites(s.value.results);
      if (cat.status === "fulfilled") setCategories(cat.value.results);
      if (pt.status === "fulfilled") setProjectTypes(pt.value.results);
      if (ct.status === "fulfilled") setConsultimerTypes(ct.value.results.filter((t) => t.is_active));
      if (resp.status === "fulfilled") setResponsibles(resp.value.results);
      if (clResp.status === "fulfilled") setClientResponsibles(clResp.value.results);
    }).finally(() => setLoadingRefs(false));
  }, []);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "client") {
        const newClientId = value as number | "";
        const currentSite = sites.find((s) => s.id === prev.site);
        if (currentSite && currentSite.client !== newClientId) next.site = "";
        const currentResp = clientResponsibles.find((r) => r.id === prev.responsible_client);
        if (currentResp && currentResp.client !== newClientId) next.responsible_client = "";
      }
      return next;
    });
  }

  const filteredSites = useMemo(
    () => sites.filter((s) => !values.client || s.client === values.client),
    [sites, values.client]
  );

  const filteredClientResp = useMemo(
    () => clientResponsibles.filter((r) => !values.client || r.client === values.client),
    [clientResponsibles, values.client]
  );

  function validateStep1() {
    const e: ApiErrors = {};
    if (!values.name.trim()) e.name = [p.erroNome];
    if (!values.company) e.company = [p.erroEmpresa];
    return e;
  }

  function goNext() {
    if (step === 1) {
      const e = validateStep1();
      if (Object.keys(e).length) { setErrors(e); return; }
    }
    setErrors({});
    setStep((s) => s + 1);
  }

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      const payload = {
        ...values,
        company: values.company || null,
        client: values.client || null,
        site: values.site || null,
        project_type: values.project_type || null,
        consultimer_type: values.consultimer_type || null,
        category: values.category || null,
        responsible_cstr: values.responsible_cstr || null,
        responsible_client: values.responsible_client || null,
        link_count: values.link_count === "" ? 0 : values.link_count,
        planned_start: values.planned_start || null,
        planned_end: values.planned_end || null,
      };
      const created = await projectsApi.create(payload as never) as Project;
      setSavedProject(created);
      onSaved(created);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) {
        setErrors(axiosErr.response.data);
      }
    } finally {
      setSaving(false);
    }
  }

  const errFirst = (field: string) => errors[field]?.[0];

  // ---------------------------------------------------------------------------
  // Tela de sucesso
  // ---------------------------------------------------------------------------

  if (savedProject) {
    return (
      <Modal title={p.tituloModal} onClose={onClose} width={480}>
        <div style={{ padding: "4px 0 8px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--orange)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>
            {p.projetoRegistrado}
          </div>
          <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.02em", color: "var(--text)" }}>
            {savedProject.code}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3, marginBottom: 20 }}>
            {savedProject.name}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, color: "var(--text-faint)", fontSize: 11 }}>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            {p.proximosPassos}
            <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          </div>

          <button
            className="btn btn-outline"
            style={{ width: "100%", justifyContent: "center", marginBottom: 8 }}
            onClick={() => navigate(`/projetos/${savedProject.id}`)}
          >
            <Icon name="open_in_new" style={{ fontSize: 15, marginRight: 6 }} />
            {p.irParaProjeto}
          </button>
          <button
            className="btn btn-primary"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={() => {
              onClose();
              const sowTitle = savedProject.po || savedProject.name;
              navigate(`/cadastros-mestres?focusEntity=sow-wizard&sowTitle=${encodeURIComponent(sowTitle)}`);
            }}
          >
            <Icon name="upload_file" style={{ fontSize: 15, marginRight: 6 }} />
            {p.importarSow}
          </button>
          <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
            {p.instrucaoSow}
          </div>
          <button className="btn btn-ghost" style={{ width: "100%", marginTop: 6, justifyContent: "center", fontSize: 12 }} onClick={onClose}>
            {p.fecharSemImportar}
          </button>
        </div>
      </Modal>
    );
  }

  // ---------------------------------------------------------------------------
  // Wizard
  // ---------------------------------------------------------------------------

  return (
    <Modal title={p.tituloModal} onClose={onClose} width={680}>
      <StepBar current={step} steps={p.steps} />

      {loadingRefs && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>{t.common.carregando}</p>}

      {!loadingRefs && (
        <>
          {/* PASSO 1 */}
          {step === 1 && (
            <div>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>{p.descPasso1}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Field label={p.nomeProjeto} required error={errFirst("name")}>
                    <input className="input" value={values.name} onChange={(e) => set("name", e.target.value)} placeholder={p.placeholderNome} />
                  </Field>
                </div>
                <Field label={p.po} error={errFirst("po")}>
                  <input className="input" value={values.po} onChange={(e) => set("po", e.target.value)} placeholder={p.placeholderPo} />
                </Field>
                <SelectField label={p.empresa} required error={errFirst("company")}
                  value={values.company} onChange={(v) => set("company", v)}
                  options={companies.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name }))}
                  placeholder={p.selecione}
                />
                <SelectField label={p.cliente} error={errFirst("client")}
                  value={values.client} onChange={(v) => set("client", v)}
                  options={clients.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name }))}
                  placeholder={p.selecione}
                />
                <SelectField label={p.site} error={errFirst("site")}
                  value={values.site} onChange={(v) => set("site", v)}
                  options={filteredSites.map((s) => ({ value: s.id, label: s.code || s.name }))}
                  placeholder={p.selecione}
                />
              </div>
            </div>
          )}

          {/* PASSO 2 */}
          {step === 2 && (
            <div>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>{p.descPasso2}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <SelectField label="Tipo Consultimer" error={errFirst("consultimer_type")}
                  value={values.consultimer_type} onChange={(v) => set("consultimer_type", v)}
                  options={consultimerTypes.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))}
                  placeholder={p.selecione}
                />
                <SelectField label={p.tipoProjeto} error={errFirst("project_type")}
                  value={values.project_type} onChange={(v) => set("project_type", v)}
                  options={projectTypes.map((pt) => ({ value: pt.id, label: pt.name }))}
                  placeholder={p.selecione}
                />
                <SelectField label={p.categoria} error={errFirst("category")}
                  value={values.category} onChange={(v) => set("category", v)}
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder={p.selecione}
                />
                <Field label={p.statusInicial} error={errFirst("status")}>
                  <SearchSelect
                    options={statusOptions}
                    value={values.status}
                    onChange={(v) => set("status", String(v))}
                    clearable={false}
                  />
                </Field>
                <Field label={p.qtdLinks} error={errFirst("link_count")}>
                  <input className="input" type="number" min={0} value={values.link_count} onChange={(e) => set("link_count", e.target.value ? Number(e.target.value) : "")} />
                </Field>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={values.has_rack_positions} onChange={(e) => set("has_rack_positions", e.target.checked)} />
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.ativarRP}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.descRP}</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* PASSO 3 */}
          {step === 3 && (
            <div>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>{p.descPasso3}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <SelectField label={p.responsavelCstr} error={errFirst("responsible_cstr")}
                  value={values.responsible_cstr} onChange={(v) => set("responsible_cstr", v)}
                  options={responsibles.map((r) => ({ value: r.id, label: r.name }))}
                  placeholder={p.selecione}
                />
                <SelectField label={p.responsavelCliente} error={errFirst("responsible_client")}
                  value={values.responsible_client} onChange={(v) => set("responsible_client", v)}
                  options={filteredClientResp.map((r) => ({ value: r.id, label: r.name }))}
                  placeholder={p.selecione}
                />
                <Field label={p.inicioPrevisto} error={errFirst("planned_start")}>
                  <DateInput value={values.planned_start} onChange={(v) => set("planned_start", v)} />
                </Field>
                <Field label={p.terminoPrevisto} error={errFirst("planned_end")}>
                  <DateInput value={values.planned_end} onChange={(v) => set("planned_end", v)} />
                </Field>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Field label={p.descricao} error={errFirst("description")}>
                    <textarea className="input" rows={3} value={values.description} onChange={(e) => set("description", e.target.value)} />
                  </Field>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Field label={p.observacoes} error={errFirst("notes")}>
                    <textarea className="input" rows={2} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
                  </Field>
                </div>
              </div>
              {errors.non_field_errors && (
                <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{errors.non_field_errors.join(" ")}</p>
              )}
            </div>
          )}

          {/* BARRA DE AÇÃO */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            {step > 1 ? (
              <button className="btn btn-outline btn-sm" onClick={() => { setErrors({}); setStep((s) => s - 1); }}>
                <Icon name="arrow_back" style={{ fontSize: 15, marginRight: 6 }} />{p.voltar}
              </button>
            ) : (
              <button className="btn btn-outline btn-sm" onClick={onClose}>{t.common.cancelar}</button>
            )}
            {step < 3 ? (
              <button className="btn btn-primary btn-sm" onClick={goNext}>
                {p.continuar} <Icon name="arrow_forward" style={{ fontSize: 15, marginLeft: 6 }} />
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? p.criando : <><Icon name="check" style={{ fontSize: 15, marginRight: 6 }} />{p.criarProjeto}</>}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
