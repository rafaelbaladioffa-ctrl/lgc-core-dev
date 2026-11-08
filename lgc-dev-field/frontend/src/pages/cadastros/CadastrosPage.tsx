import { useEffect, useMemo, useState } from "react";
import { regionsApi, registryApi } from "../../api/resources";
import EntityCrudPanel from "../../components/cadastros/EntityCrudPanel";
import { useAuth } from "../../context/AuthContext";
import { usePageText } from "../../i18n";
import { hasPerm } from "../../utils/permissions";
import CatalogGrid, { type RecentRecord } from "./CatalogGrid";
import { ENTITIES, type ReferenceData } from "./registryConfig";

const TEXT = {
  "pt-BR": {
    title: "Cadastros Gerais",
    noPermission: "Seu usuário não tem permissão de visualização em nenhum cadastro. Peça a um administrador para conceder acesso no grupo de permissões.",
  },
  "en-US": {
    title: "General Records",
    noPermission: "Your user does not have view permission on any record. Ask an administrator to grant access in the permissions group.",
  },
  "es-ES": {
    title: "Registros Generales",
    noPermission: "Tu usuario no tiene permiso de visualización en ningún registro. Pide a un administrador que otorgue acceso en el grupo de permisos.",
  },
};

export default function CadastrosPage() {
  const { user } = useAuth();
  const p = usePageText(TEXT);
  const visibleEntities = useMemo(() => ENTITIES.filter((e) => hasPerm(user, e.perms.view)), [user]);

  const [view, setView] = useState<"catalog" | "entity">("catalog");
  const [activeKey, setActiveKey] = useState(visibleEntities[0]?.key ?? "");
  const [quickCreateSignal, setQuickCreateSignal] = useState<{ key: string; nonce: number } | null>(null);
  const [refs, setRefs] = useState<ReferenceData>({
    companies: [], jobTitles: [], sites: [], clients: [], projectTypes: [], collaborators: [], regions: [],
    cableFamilies: [], masterDataSites: [], activities: [], taskTemplates: [], cableSpecs: [], networks: [], workstreams: [], paths: [],
  });
  const [refsLoaded, setRefsLoaded] = useState(false);

  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [recentRecords, setRecentRecords] = useState<RecentRecord[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const entity = useMemo(
    () => visibleEntities.find((e) => e.key === activeKey) ?? visibleEntities[0],
    [activeKey, visibleEntities]
  );

  useEffect(() => {
    // Promise.allSettled: falta de permissão de visualização em um desses
    // models (ex: sem core.view_collaborator) não deve impedir os campos
    // de outras abas para as quais o usuário tem permissão de carregar.
    Promise.allSettled([
      registryApi.companies.list({ page_size: "200" } as never),
      registryApi.jobTitles.list({ page_size: "200" } as never),
      registryApi.sites.list({ page_size: "500" } as never),
      registryApi.clients.list({ page_size: "500" } as never),
      registryApi.projectTypes.list({ page_size: "200" } as never),
      registryApi.collaborators.list({ page_size: "500" } as never),
      regionsApi.list({ page_size: "100" }),
    ])
      .then(([companies, jobTitles, sites, clients, projectTypes, collaborators, regions]) => {
        setRefs({
          companies: companies.status === "fulfilled" ? companies.value.results : [],
          jobTitles: jobTitles.status === "fulfilled" ? jobTitles.value.results : [],
          sites: sites.status === "fulfilled" ? sites.value.results : [],
          clients: clients.status === "fulfilled" ? clients.value.results : [],
          projectTypes: projectTypes.status === "fulfilled" ? projectTypes.value.results : [],
          collaborators: collaborators.status === "fulfilled" ? collaborators.value.results : [],
          regions: regions.status === "fulfilled" ? regions.value.results : [],
          cableFamilies: [],
          masterDataSites: [],
          activities: [],
          taskTemplates: [],
          cableSpecs: [],
          networks: [],
          workstreams: [],
          paths: [],
        });
      })
      .finally(() => setRefsLoaded(true));
  }, []);

  useEffect(() => {
    // Catálogo: contagem por entidade + registros recentes (mais atualizados
    // primeiro, entre todas as entidades visíveis).
    let cancelled = false;
    setRecentLoading(true);
    Promise.allSettled(
      visibleEntities.map((e) => e.api.list({ page_size: "5", ordering: "-updated_at" } as never))
    ).then((results) => {
      if (cancelled) return;
      const nextCounts: Record<string, number | null> = {};
      const merged: RecentRecord[] = [];
      results.forEach((result, index) => {
        const e = visibleEntities[index];
        if (result.status !== "fulfilled") {
          nextCounts[e.key] = null;
          return;
        }
        nextCounts[e.key] = result.value.count;
        result.value.results.forEach((row) => {
          const r = row as Record<string, unknown>;
          merged.push({
            entityKey: e.key,
            entityLabel: e.label,
            icon: e.icon,
            name: e.rowLabel(r as never),
            code: (r.code as string) || "",
            isActive: r.is_active !== false,
            updatedAt: (r.updated_at as string) || null,
          });
        });
      });
      merged.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      setCounts(nextCounts);
      setRecentRecords(merged.slice(0, 8));
      setRecentLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCatalog() {
    setView("catalog");
  }

  function openEntity(key: string) {
    setActiveKey(key);
    setView("entity");
  }

  function quickCreate(key: string) {
    const target = visibleEntities.find((e) => e.key === key);
    if (!target || !hasPerm(user, target.perms.add)) return;
    setActiveKey(key);
    setView("entity");
    setQuickCreateSignal({ key, nonce: Date.now() });
  }

  if (!entity) {
    return (
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", marginBottom: 16 }}>{p.title}</div>
        <div className="empty-state">
          {p.noPermission}
        </div>
      </div>
    );
  }

  if (view === "catalog") {
    return (
      <CatalogGrid
        entities={visibleEntities}
        counts={counts}
        recentRecords={recentLoading ? [] : recentRecords}
        onSelect={openEntity}
        onQuickCreate={quickCreate}
      />
    );
  }

  return (
    <EntityCrudPanel
      key={entity.key}
      entity={entity}
      refs={refs}
      refsLoaded={refsLoaded}
      onBack={openCatalog}
      autoOpenCreateNonce={quickCreateSignal?.key === entity.key ? quickCreateSignal.nonce : undefined}
    />
  );
}
