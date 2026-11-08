import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { masterDataApi } from "../../api/resources";
import { usePageText } from "../../i18n";

const TEXT = {
  "pt-BR": {
    eyebrow: "Sistema",
    title: "Cadastros Mestres",
    subtitle: "Base padronizada de dados técnicos e operacionais — fundação para escopos, tarefas e automações futuras.",
    noPermission: "Seu usuário não tem permissão de visualização em nenhum Cadastro Mestre. Peça a um administrador para conceder acesso no grupo de permissões.",
    comingSoon: "Em breve",
    selectItem: "Selecione um cadastro na lista ao lado.",
    catLabels: { engenharia: "Engenharia", operacao: "Operação", infraestrutura: "Infraestrutura", planejamento: "Planejamento" },
    toolLabels: { "task-rule-simulator": "Simulador de Regras", "sow-import": "Importar SOW", "sow-wizard": "Fluxo Guiado", "cable-wizard": "Cadastro Guiado de Cabos", "project-plan": "Plano do Projeto" },
  },
  "en-US": {
    eyebrow: "System",
    title: "Master Records",
    subtitle: "Standardized base of technical and operational data — foundation for scopes, tasks and future automations.",
    noPermission: "Your user does not have view permission on any Master Record. Ask an administrator to grant access in the permissions group.",
    comingSoon: "Coming soon",
    selectItem: "Select a record from the list on the left.",
    catLabels: { engenharia: "Engineering", operacao: "Operations", infraestrutura: "Infrastructure", planejamento: "Planning" },
    toolLabels: { "task-rule-simulator": "Rule Simulator", "sow-import": "Import SOW", "sow-wizard": "Guided Flow", "cable-wizard": "Guided Cable Registration", "project-plan": "Project Plan" },
  },
  "es-ES": {
    eyebrow: "Sistema",
    title: "Datos Maestros",
    subtitle: "Base estandarizada de datos técnicos y operacionales — fundación para alcances, tareas y automatizaciones futuras.",
    noPermission: "Tu usuario no tiene permiso de visualización en ningún Dato Maestro. Pide a un administrador que otorgue acceso en el grupo de permisos.",
    comingSoon: "Próximamente",
    selectItem: "Selecciona un registro de la lista al lado.",
    catLabels: { engenharia: "Ingeniería", operacao: "Operación", infraestrutura: "Infraestructura", planejamento: "Planificación" },
    toolLabels: { "task-rule-simulator": "Simulador de Reglas", "sow-import": "Importar SOW", "sow-wizard": "Flujo Guiado", "cable-wizard": "Registro Guiado de Cables", "project-plan": "Plan del Proyecto" },
  },
};
import EntityCrudPanel from "../../components/cadastros/EntityCrudPanel";
import ProjectPlanPanel from "../../components/master-data/ProjectPlanPanel";
import SowImportPanel from "../../components/master-data/SowImportPanel";
import CableWizardPanel from "../../components/master-data/CableWizardPanel";
import SowWizardPanel from "../../components/master-data/SowWizardPanel";
import TaskRuleSimulatorPanel from "../../components/master-data/TaskRuleSimulatorPanel";
import Icon from "../../components/ui/Icon";
import PageHeader from "../../components/ui/PageHeader";
import { useAuth } from "../../context/AuthContext";
import { hasPerm } from "../../utils/permissions";
import { useI18n } from "../../i18n";
import type { ReferenceData } from "../cadastros/registryConfig";
import { entityLabels } from "../cadastros/registryConfig";
import { MASTER_DATA_CATEGORIES, type MasterDataNavItem, type ToolConfig } from "./masterDataConfig";

function isToolConfig(item: MasterDataNavItem): item is ToolConfig {
  return (item as ToolConfig).kind === "tool";
}

const EMPTY_REFS: ReferenceData = {
  companies: [],
  jobTitles: [],
  sites: [],
  clients: [],
  projectTypes: [],
  collaborators: [],
  regions: [],
  cableFamilies: [],
  masterDataSites: [],
  activities: [],
  taskTemplates: [],
  cableSpecs: [],
  networks: [],
  workstreams: [],
  paths: [],
};

export default function MasterDataPage() {
  const { user } = useAuth();
  const p = usePageText(TEXT);
  const { locale } = useI18n();
  // Links contextuais da tela Importar SOW ("Abrir Itens de Escopo desta
  // SOW" etc.) chegam aqui como ?focusEntity=scope-items&focusSearch=
  // SOW-IMPORT-000001 — nenhuma outra tela deste app usa querystring
  // hoje, mas é o jeito mais simples de atravessar a fronteira entre
  // "tool" (SowImportPanel) e "entity" (EntityCrudPanel) sem inventar
  // estado global só pra isso.
  const [searchParams] = useSearchParams();
  const focusEntity = searchParams.get("focusEntity");
  const focusSearch = searchParams.get("focusSearch");

  const [refs, setRefs] = useState<ReferenceData>(EMPTY_REFS);
  const [refsLoaded, setRefsLoaded] = useState(false);

  useEffect(() => {
    // Cadastros Mestres não tem tantos cadastros quanto Cadastros Gerais
    // ainda — Aliases/Especificações de Cabo precisam da lista de Famílias
    // (seletor/filtro), Localizações precisa da lista de Sites, Etapas de
    // Template precisa das listas de Templates e Atividades, Regras de
    // Templates precisa também de Especificações/Redes/Workstreams, e
    // Itens de Escopo (Planejamento) precisa de todas essas mais Rotas.
    // Promise.allSettled deixa fácil acrescentar mais entradas conforme
    // novos cadastros forem chegando.
    Promise.allSettled([
      masterDataApi.cableFamilies.list({ page_size: "500" } as never),
      masterDataApi.sites.list({ page_size: "500" } as never),
      masterDataApi.activities.list({ page_size: "500" } as never),
      masterDataApi.taskTemplates.list({ page_size: "500" } as never),
      masterDataApi.cableSpecs.list({ page_size: "500" } as never),
      masterDataApi.networks.list({ page_size: "500" } as never),
      masterDataApi.workstreams.list({ page_size: "500" } as never),
      masterDataApi.paths.list({ page_size: "500" } as never),
    ])
      .then(([cableFamilies, masterDataSites, activities, taskTemplates, cableSpecs, networks, workstreams, paths]) => {
        setRefs({
          ...EMPTY_REFS,
          cableFamilies: cableFamilies.status === "fulfilled" ? cableFamilies.value.results : [],
          masterDataSites: masterDataSites.status === "fulfilled" ? masterDataSites.value.results : [],
          activities: activities.status === "fulfilled" ? activities.value.results : [],
          taskTemplates: taskTemplates.status === "fulfilled" ? taskTemplates.value.results : [],
          cableSpecs: cableSpecs.status === "fulfilled" ? cableSpecs.value.results : [],
          networks: networks.status === "fulfilled" ? networks.value.results : [],
          workstreams: workstreams.status === "fulfilled" ? workstreams.value.results : [],
          paths: paths.status === "fulfilled" ? paths.value.results : [],
        });
      })
      .finally(() => setRefsLoaded(true));
  }, []);

  const categories = useMemo(
    () =>
      MASTER_DATA_CATEGORIES.map((cat) => ({
        ...cat,
        entities: cat.entities.filter((e) => hasPerm(user, e.perms.view)),
      })),
    [user]
  );

  const [activeKey, setActiveKey] = useState<string | null>(focusEntity || "sow-wizard");

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = localStorage.getItem(`erp_masterdata_collapsed_${user.id}`);
      setCollapsedGroups(saved ? JSON.parse(saved) : {});
    } catch { setCollapsedGroups({}); }
  }, [user?.id]);

  function toggleGroup(catKey: string) {
    if (!user?.id) return;
    setCollapsedGroups((prev) => {
      const next = { ...prev, [catKey]: !prev[catKey] };
      try { localStorage.setItem(`erp_masterdata_collapsed_${user.id}`, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  useEffect(() => {
    if (focusEntity) setActiveKey(focusEntity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEntity, focusSearch]);

  const activeEntity = useMemo(() => {
    for (const cat of categories) {
      const found = cat.entities.find((e) => e.key === activeKey);
      if (found) return found;
    }
    return null;
  }, [categories, activeKey]);

  const hasAnyEntity = categories.some((c) => c.entities.length > 0);

  return (
    <div>
      <PageHeader
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={p.subtitle}
      />

      {!hasAnyEntity && (
        <div className="empty-state">
          {p.noPermission}
        </div>
      )}

      {hasAnyEntity && (
        <div className="master-data-layout" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div className="master-data-nav card" style={{ width: 220, flexShrink: 0, padding: "8px 0" }}>
            {categories.map((cat) => {
              const open = !collapsedGroups[cat.key];
              return (
                <div key={cat.key} style={{ marginBottom: 2 }}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(cat.key)}
                    aria-expanded={open}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      width: "100%",
                      padding: "8px 12px 4px",
                      fontSize: 10,
                      fontWeight: 800,
                      color: "var(--text)",
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      background: "transparent",
                      border: 0,
                      cursor: "pointer",
                    }}
                  >
                    <span>{p.catLabels[cat.key as keyof typeof p.catLabels] ?? cat.label}</span>
                    <Icon name={open ? "expand_less" : "expand_more"} style={{ fontSize: 16 }} />
                  </button>
                  {open && cat.entities.length === 0 && (
                    <div style={{ padding: "2px 12px 6px", fontSize: 12, color: "var(--text-faint)" }}>{p.comingSoon}</div>
                  )}
                  {open && cat.entities.map((entity) => {
                    const isActive = activeKey === entity.key;
                    return (
                      <button
                        key={entity.key}
                        onClick={() => setActiveKey(entity.key)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          width: "100%",
                          padding: "7px 12px",
                          border: 0,
                          borderLeft: isActive ? "2.5px solid var(--orange)" : "2.5px solid transparent",
                          borderRadius: 0,
                          cursor: "pointer",
                          fontSize: 13.5,
                          fontWeight: isActive ? 500 : 400,
                          color: isActive ? "var(--orange)" : "var(--text-muted)",
                          background: isActive ? "var(--orange-soft)" : "transparent",
                          textAlign: "left",
                        }}
                      >
                        <Icon name={entity.icon} style={{ fontSize: 16, color: isActive ? "var(--orange)" : "var(--text-faint)" }} />
                        {isToolConfig(entity)
                          ? (p.toolLabels[entity.key as keyof typeof p.toolLabels] ?? entity.label)
                          : entityLabels(entity, locale).label}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {activeEntity ? (
              isToolConfig(activeEntity) ? (
                activeEntity.key === "sow-wizard" ? (
                  <SowWizardPanel key={activeEntity.key} refs={refs} />
                ) : activeEntity.key === "cable-wizard" ? (
                  <CableWizardPanel key={activeEntity.key} />
                ) : activeEntity.key === "sow-import" ? (
                  <SowImportPanel key={activeEntity.key} refs={refs} />
                ) : activeEntity.key === "project-plan" ? (
                  <ProjectPlanPanel key={activeEntity.key} />
                ) : (
                  <TaskRuleSimulatorPanel key={activeEntity.key} refs={refs} />
                )
              ) : (
                <EntityCrudPanel
                  key={activeEntity.key}
                  entity={activeEntity}
                  refs={refs}
                  refsLoaded={refsLoaded}
                  initialSearch={activeEntity.key === focusEntity ? focusSearch ?? undefined : undefined}
                />
              )
            ) : (
              <div className="empty-state">{p.selectItem}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
