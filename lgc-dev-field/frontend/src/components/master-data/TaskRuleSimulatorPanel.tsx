import SearchSelect from "../ui/SearchSelect";
import { useState } from "react";
import { taskRuleSimulatorApi } from "../../api/resources";
import type {
  TaskTemplateRuleMatch,
  TaskTemplateRuleSimulateRequest,
  TaskTemplateRuleSimulateResult,
} from "../../api/types";
import { usePageText } from "../../i18n";
import type { ReferenceData } from "../../pages/cadastros/registryConfig";

const MEDIUM_SUGGESTIONS = ["FIBER", "COPPER", "MIXED"];

const TEXT = {
  "pt-BR": {
    titulo: "Simulador de Regras",
    subtitulo: "Testa o motor de regras (Família de Cabo / Especificação / Rede / Workstream / Meio / Pré-terminado → Regra de Template → Template → Etapas) sem criar nada — nenhum projeto, item de escopo ou tarefa é alterado.",
    naoConsiderar: "Não considerar",
    sim: "Sim",
    nao: "Não",
    limpar: "Limpar",
    simular: "Simular",
    simulando: "Simulando...",
    erroCriterio: "Informe ao menos um critério para simular.",
    erroGenerico: "Não foi possível simular. Tente novamente.",
    nenhumaRegra: "Nenhuma regra compatível encontrada.",
    camposDerivados: "Campos Derivados",
    derivadoDe: (field: string, value: string, source: string) => `${field} = ${value} (derivado de ${source})`,
    regraSelecionada: "Regra Selecionada",
    templateSelecionado: "Template Selecionado",
    codigo: "Código",
    nome: "Nome",
    prioridade: "Prioridade",
    especificidade: "Especificidade",
    categoria: "Categoria",
    meio: "Meio",
    etapasGeradas: (n: number) => `Etapas que Seriam Geradas (${n})`,
    ordem: "Ordem",
    atividade: "Atividade",
    nomeEfetivo: "Nome Efetivo",
    obrigatoria: "Obrigatória",
    repetivel: "Repetível",
    origemQtd: "Origem da Quantidade",
    unidade: "Unidade",
    explicacaoMatch: (code: string) => `Explicação do Match — ${code}`,
    criterio: "Critério",
    resultado: "Resultado",
    detalhe: "Detalhe",
    matchesSecundarios: (n: number) => `Matches Secundários (${n})`,
    descMatchesSecundarios: "Outras regras ativas também compatíveis com os critérios informados, em ordem de classificação — útil para auditoria.",
    prioridadeLabel: (p: number) => `prioridade ${p}`,
    especificidadeLabel: (s: number) => `especificidade ${s}`,
  },
  "en-US": {
    titulo: "Rule Simulator",
    subtitulo: "Tests the rule engine (Cable Family / Spec / Network / Workstream / Medium / Preterminated → Template Rule → Template → Steps) without creating anything — no project, scope item or task is modified.",
    naoConsiderar: "Do not consider",
    sim: "Yes",
    nao: "No",
    limpar: "Clear",
    simular: "Simulate",
    simulando: "Simulating...",
    erroCriterio: "Please provide at least one criterion to simulate.",
    erroGenerico: "Could not simulate. Please try again.",
    nenhumaRegra: "No matching rule found.",
    camposDerivados: "Derived Fields",
    derivadoDe: (field: string, value: string, source: string) => `${field} = ${value} (derived from ${source})`,
    regraSelecionada: "Selected Rule",
    templateSelecionado: "Selected Template",
    codigo: "Code",
    nome: "Name",
    prioridade: "Priority",
    especificidade: "Specificity",
    categoria: "Category",
    meio: "Medium",
    etapasGeradas: (n: number) => `Steps That Would Be Generated (${n})`,
    ordem: "Order",
    atividade: "Activity",
    nomeEfetivo: "Effective Name",
    obrigatoria: "Required",
    repetivel: "Repeatable",
    origemQtd: "Quantity Source",
    unidade: "Unit",
    explicacaoMatch: (code: string) => `Match Explanation — ${code}`,
    criterio: "Criterion",
    resultado: "Result",
    detalhe: "Detail",
    matchesSecundarios: (n: number) => `Secondary Matches (${n})`,
    descMatchesSecundarios: "Other active rules also matching the provided criteria, in ranking order — useful for auditing.",
    prioridadeLabel: (p: number) => `priority ${p}`,
    especificidadeLabel: (s: number) => `specificity ${s}`,
  },
  "es-ES": {
    titulo: "Simulador de Reglas",
    subtitulo: "Prueba el motor de reglas (Familia de Cable / Especificación / Red / Workstream / Medio / Preterminado → Regla de Template → Template → Pasos) sin crear nada — ningún proyecto, ítem de alcance o tarea es modificado.",
    naoConsiderar: "No considerar",
    sim: "Sí",
    nao: "No",
    limpar: "Limpiar",
    simular: "Simular",
    simulando: "Simulando...",
    erroCriterio: "Ingrese al menos un criterio para simular.",
    erroGenerico: "No se pudo simular. Inténtalo de nuevo.",
    nenhumaRegra: "No se encontró ninguna regla compatible.",
    camposDerivados: "Campos Derivados",
    derivadoDe: (field: string, value: string, source: string) => `${field} = ${value} (derivado de ${source})`,
    regraSelecionada: "Regla Seleccionada",
    templateSelecionado: "Template Seleccionado",
    codigo: "Código",
    nome: "Nombre",
    prioridade: "Prioridad",
    especificidade: "Especificidad",
    categoria: "Categoría",
    meio: "Medio",
    etapasGeradas: (n: number) => `Pasos que se Generarían (${n})`,
    ordem: "Orden",
    atividade: "Actividad",
    nomeEfetivo: "Nombre Efectivo",
    obrigatoria: "Obligatoria",
    repetivel: "Repetible",
    origemQtd: "Origen de Cantidad",
    unidade: "Unidad",
    explicacaoMatch: (code: string) => `Explicación del Match — ${code}`,
    criterio: "Criterio",
    resultado: "Resultado",
    detalhe: "Detalle",
    matchesSecundarios: (n: number) => `Matches Secundarios (${n})`,
    descMatchesSecundarios: "Otras reglas activas también compatibles con los criterios ingresados, en orden de clasificación — útil para auditoría.",
    prioridadeLabel: (p: number) => `prioridad ${p}`,
    especificidadeLabel: (s: number) => `especificidad ${s}`,
  },
};

export default function TaskRuleSimulatorPanel({ refs }: { refs: ReferenceData }) {
  const p = usePageText(TEXT);

  const [cableFamily, setCableFamily] = useState<number | "">("");
  const [cableSpec, setCableSpec] = useState<number | "">("");
  const [network, setNetwork] = useState<number | "">("");
  const [workstream, setWorkstream] = useState<number | "">("");
  const [medium, setMedium] = useState("");
  const [preterminated, setPreterminated] = useState<"" | "true" | "false">("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TaskTemplateRuleSimulateResult | null>(null);

  const hasAnyCriterion =
    cableFamily !== "" || cableSpec !== "" || network !== "" || workstream !== "" || Boolean(medium) || preterminated !== "";

  function handleClear() {
    setCableFamily("");
    setCableSpec("");
    setNetwork("");
    setWorkstream("");
    setMedium("");
    setPreterminated("");
    setResult(null);
    setError(null);
  }

  async function handleSimulate() {
    setError(null);
    if (!hasAnyCriterion) {
      setError(p.erroCriterio);
      setResult(null);
      return;
    }
    setLoading(true);
    const payload: TaskTemplateRuleSimulateRequest = {
      cable_family: cableFamily === "" ? null : cableFamily,
      cable_spec: cableSpec === "" ? null : cableSpec,
      network: network === "" ? null : network,
      workstream: workstream === "" ? null : workstream,
      medium,
      preterminated: preterminated === "" ? null : preterminated === "true",
    };
    try {
      const data = await taskRuleSimulatorApi.simulate(payload);
      setResult(data);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string; non_field_errors?: string[] } };
      };
      const detail =
        axiosErr.response?.data?.detail ||
        axiosErr.response?.data?.non_field_errors?.join(" ") ||
        p.erroGenerico;
      setError(detail);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="card">
        <div className="toolbar">
          <div>
            <div className="toolbar-title">{p.titulo}</div>
            <div className="toolbar-subtitle">{p.subtitulo}</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px", marginTop: 16 }}>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Cable Family</span>
            <SearchSelect
              options={refs.cableFamilies.map((f) => ({ value: f.id, label: f.code, sublabel: f.name }))}
              value={cableFamily}
              onChange={(v) => { const val = v === "" ? "" : Number(v); setCableFamily(val); }}
              placeholder={p.naoConsiderar}
            />
          </div>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Cable Spec</span>
            <SearchSelect
              options={refs.cableSpecs.map((s) => ({ value: s.id, label: s.code, sublabel: s.part_number || s.name }))}
              value={cableSpec}
              onChange={(v) => { const val = v === "" ? "" : Number(v); setCableSpec(val); }}
              placeholder={p.naoConsiderar}
            />
          </div>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Network</span>
            <SearchSelect
              options={refs.networks.map((n) => ({ value: n.id, label: n.code, sublabel: n.name }))}
              value={network}
              onChange={(v) => { const val = v === "" ? "" : Number(v); setNetwork(val); }}
              placeholder={p.naoConsiderar}
            />
          </div>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Workstream</span>
            <SearchSelect
              options={refs.workstreams.map((w) => ({ value: w.id, label: w.code, sublabel: w.name }))}
              value={workstream}
              onChange={(v) => { const val = v === "" ? "" : Number(v); setWorkstream(val); }}
              placeholder={p.naoConsiderar}
            />
          </div>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Medium</span>
            <SearchSelect
              options={MEDIUM_SUGGESTIONS.map((m) => ({ value: m, label: m }))}
              value={medium}
              onChange={(v) => { const val = String(v); setMedium(val); }}
              placeholder={p.naoConsiderar}
            />
          </div>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Preterminated</span>
            <SearchSelect
              options={[{ value: "true", label: p.sim }, { value: "false", label: p.nao }]}
              value={preterminated}
              onChange={(v) => { const val = String(v); setPreterminated(val as "" | "true" | "false"); }}
              placeholder={p.naoConsiderar}
            />
          </div>
        </div>

        {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-outline" onClick={handleClear}>{p.limpar}</button>
          <button className="btn btn-primary" onClick={handleSimulate} disabled={loading}>
            {loading ? p.simulando : p.simular}
          </button>
        </div>
      </div>

      {result && <SimulationResult result={result} p={p} />}
    </div>
  );
}

type P = typeof TEXT["pt-BR"];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
      {children}
    </div>
  );
}

function MatchChecksTable({ checks, p }: { checks: TaskTemplateRuleMatch["checks"]; p: P }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{p.criterio}</th>
            <th>{p.resultado}</th>
            <th>{p.detalhe}</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.criterion}>
              <td>{c.criterion}</td>
              <td style={{ fontWeight: 700, color: c.result === "MATCH" ? "var(--green)" : c.result === "MISMATCH" ? "var(--red)" : "var(--text-muted)" }}>
                {c.result}
              </td>
              <td>{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimulationResult({ result, p }: { result: TaskTemplateRuleSimulateResult; p: P }) {
  const secondaryMatches = result.matches.slice(1);
  const derivedEntries = Object.entries(result.derived_fields);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      {!result.selected_rule || !result.selected_template ? (
        <div className="empty-state">{p.nenhumaRegra}</div>
      ) : (
        <>
          {derivedEntries.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>{p.camposDerivados}</SectionLabel>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text)" }}>
                {derivedEntries.map(([field, info]) => (
                  <li key={field}>{p.derivadoDe(field, info.value, info.source)}</li>
                ))}
              </ul>
            </div>
          )}

          {result.warnings.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {result.warnings.map((w, i) => (
                <p key={i} style={{ color: "var(--amber)", fontSize: 13, margin: "0 0 4px" }}>⚠ {w}</p>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div>
              <SectionLabel>{p.regraSelecionada}</SectionLabel>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    <tr><td>{p.codigo}</td><td>{result.selected_rule.code}</td></tr>
                    <tr><td>{p.nome}</td><td>{result.selected_rule.name}</td></tr>
                    <tr><td>{p.prioridade}</td><td>{result.selected_rule.priority}</td></tr>
                    <tr><td>{p.especificidade}</td><td>{result.selected_rule.specificity_score}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <SectionLabel>{p.templateSelecionado}</SectionLabel>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    <tr><td>{p.codigo}</td><td>{result.selected_template.code}</td></tr>
                    <tr><td>{p.nome}</td><td>{result.selected_template.name}</td></tr>
                    <tr><td>{p.categoria}</td><td>{result.selected_template.category}</td></tr>
                    <tr><td>{p.meio}</td><td>{result.selected_template.medium || "—"}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <SectionLabel>{p.etapasGeradas(result.steps.length)}</SectionLabel>
          <div className="table-wrap" style={{ marginBottom: 20 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{p.ordem}</th>
                  <th>Activity Code</th>
                  <th>{p.atividade}</th>
                  <th>{p.nomeEfetivo}</th>
                  <th>{p.obrigatoria}</th>
                  <th>{p.repetivel}</th>
                  <th>{p.origemQtd}</th>
                  <th>{p.unidade}</th>
                </tr>
              </thead>
              <tbody>
                {result.steps.map((s) => (
                  <tr key={s.step_order}>
                    <td>{s.step_order}</td>
                    <td>{s.activity_code}</td>
                    <td>{s.activity_name}</td>
                    <td>{s.effective_name}</td>
                    <td>{s.required ? p.sim : p.nao}</td>
                    <td>{s.repeatable ? p.sim : p.nao}</td>
                    <td>{s.quantity_source || "—"}</td>
                    <td>{s.unit_override || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: secondaryMatches.length > 0 ? 20 : 0 }}>
            <SectionLabel>{p.explicacaoMatch(result.selected_rule.code)}</SectionLabel>
            <MatchChecksTable checks={result.matches[0].checks} p={p} />
          </div>

          {secondaryMatches.length > 0 && (
            <div>
              <SectionLabel>{p.matchesSecundarios(secondaryMatches.length)}</SectionLabel>
              <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: -4, marginBottom: 10 }}>
                {p.descMatchesSecundarios}
              </p>
              {secondaryMatches.map((m) => (
                <div key={m.rule.code} style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                    {m.rule.code} — {m.rule.name} ({p.prioridadeLabel(m.rule.priority)}, {p.especificidadeLabel(m.rule.specificity_score)}) → {m.rule.task_template_code}
                  </p>
                  <MatchChecksTable checks={m.checks} p={p} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
