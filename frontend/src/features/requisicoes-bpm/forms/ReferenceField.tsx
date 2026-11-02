import { useEffect, useState } from "react";
import type { BpmField } from "../DynamicForm";
import { costCentersApi, type CostCenter } from "../../../api/costCenters";
import { projectsApi, type Project } from "../../../api/projects";
import { clientsApi, type Client } from "../../../api/clients";
import { collaboratorsApi, type CollaboratorSafe } from "../../../api/collaborators";
import { sectorsApi, type Sector } from "../../../api/sectors";
import { LogisticsItemAutocomplete } from "./LogisticsItemAutocomplete";

interface Props {
  field: BpmField;
  value: unknown;
  disabled?: boolean;
  error?: string;
  onChange: (key: string, value: unknown) => void;
}

export function ReferenceField({ field, value, disabled, onChange }: Props) {
  const sourceKey = field.source?.key ?? "";

  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorSafe[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (sourceKey !== "cost_centers") return;
    let active = true;
    setLoading(true);
    void costCentersApi
      .list()
      .then((items) => { if (active) setCostCenters(items); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sourceKey]);

  useEffect(() => {
    if (sourceKey !== "projects") return;
    let active = true;
    setLoading(true);
    void projectsApi
      .list()
      .then((items) => { if (active) setProjects(items); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sourceKey]);

  useEffect(() => {
    if (sourceKey !== "clients") return;
    let active = true;
    setLoading(true);
    void clientsApi
      .list()
      .then((items) => { if (active) setClients(items); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sourceKey]);

  useEffect(() => {
    if (sourceKey !== "collaborators") return;
    let active = true;
    setLoading(true);
    void collaboratorsApi
      .list()
      .then((items) => {
        if (active) setCollaborators(items.filter((c) => c.status === "ativo"));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sourceKey]);

  useEffect(() => {
    if (sourceKey !== "sectors") return;
    let active = true;
    setLoading(true);
    void sectorsApi
      .list()
      .then((items) => { if (active) setSectors(items); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sourceKey]);

  if (sourceKey === "cost_centers") {
    return (
      <select
        disabled={disabled || loading}
        value={String(value ?? "")}
        onChange={(e) => onChange(field.key, e.target.value || null)}
      >
        <option value="">{loading ? "Carregando centros de custo…" : "Selecione o centro de custo"}</option>
        {costCenters.map((cc) => (
          <option key={cc.id} value={cc.id}>{cc.code} — {cc.name}</option>
        ))}
      </select>
    );
  }

  if (sourceKey === "projects") {
    return (
      <select
        disabled={disabled || loading}
        value={String(value ?? "")}
        onChange={(e) => onChange(field.key, e.target.value || null)}
      >
        <option value="">{loading ? "Carregando projetos…" : "Selecione o projeto"}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.code}</option>
        ))}
      </select>
    );
  }

  if (sourceKey === "clients") {
    return (
      <select
        disabled={disabled || loading}
        value={String(value ?? "")}
        onChange={(e) => onChange(field.key, e.target.value || null)}
      >
        <option value="">{loading ? "Carregando clientes…" : "Selecione o cliente"}</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.code} — {c.legalName}</option>
        ))}
      </select>
    );
  }

  if (sourceKey === "collaborators") {
    return (
      <select
        disabled={disabled || loading}
        value={String(value ?? "")}
        onChange={(e) => onChange(field.key, e.target.value || null)}
      >
        <option value="">{loading ? "Carregando colaboradores…" : "Selecione o colaborador"}</option>
        {collaborators.map((c) => (
          <option key={c.id} value={c.id}>{c.matricula} — {c.fullName}</option>
        ))}
      </select>
    );
  }

  if (sourceKey === "sectors") {
    return (
      <select
        disabled={disabled || loading}
        value={String(value ?? "")}
        onChange={(e) => onChange(field.key, e.target.value || null)}
      >
        <option value="">{loading ? "Carregando setores…" : "Selecione o setor"}</option>
        {sectors.map((s) => (
          <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
        ))}
      </select>
    );
  }

  if (sourceKey === "logistics.catalog") {
    return (
      <LogisticsItemAutocomplete
        field={field}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  return (
    <input
      type="text"
      placeholder={`ID do ${field.refLabel ?? "registro"}`}
      disabled={disabled}
      value={String(value ?? "")}
      onChange={(e) => onChange(field.key, e.target.value || null)}
    />
  );
}
