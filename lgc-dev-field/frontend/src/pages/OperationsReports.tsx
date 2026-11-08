import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { operationsApi, sitesApi, type Site } from "../api/resources";
import type {
  OperationsReports,
  ReportsActivityProductivity,
  ReportsLogType,
  ReportsTechnician,
  ReportsUnproductiveReason,
  UtilizationBand,
} from "../api/types";
import BlockTimesCard from "../components/reports/BlockTimesCard";
import DateRangeCalendar, { type DateRange } from "../components/ui/DateRangeCalendar";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import Pagination from "../components/ui/Pagination";
import { useI18n, usePageText } from "../i18n";
import { downloadCsv, type CsvCell } from "../utils/csv";
import { presenceLabel } from "../utils/timeline";
import {
  addDaysIso,
  brazilDaysAgoIso,
  brazilTodayIso,
  daysInclusive,
  formatBrazilClock,
  formatIsoDate,
} from "../utils/date";

// ---------------------------------------------------------------------------
// Constantes de regra de negócio (docs/features/relatorios-v2.md)
// ---------------------------------------------------------------------------

/** Data em que o cálculo v2 entrou em produção (banner "Cálculo corrigido"). */
const CALC_FIX_DATE = "2026-10-03";
/** O banner some sozinho este número de dias após CALC_FIX_DATE. */
const CALC_FIX_BANNER_DAYS = 14;
const CALC_FIX_STORAGE_KEY = "rpt-calc-fix-dismissed";

/** Faixas de utilização (RN-08) — fonte única para KPI, tabela e exceções. */
const UTIL_BANDS = { lowBelow: 50, attentionBelow: 70, suspectAbove: 100 } as const;
const TRACKING_TARGET_PCT = 90; // RN-24
const DEFAULT_TODAY_TARGET_HOURS = 6; // RN-13 (o backend manda productive_target_hours)
const DEFAULT_IDLE_LIMIT_HOURS = 0.5; // RN-26 (o backend manda internal_idle_limit_hours)
const MAX_PERIOD_DAYS = 180;
const PERIOD_PRESETS = [7, 30, 90] as const;
const TECH_PAGE_SIZE = 50;

function bandFor(pct: number | null, band: UtilizationBand | null | undefined): UtilizationBand | null {
  if (band) return band;
  if (pct == null) return null;
  if (pct > UTIL_BANDS.suspectAbove) return "suspect";
  if (pct >= UTIL_BANDS.attentionBelow) return "normal";
  if (pct >= UTIL_BANDS.lowBelow) return "attention";
  return "low";
}

const LOG_TYPES: ReportsLogType[] = ["complete", "dispatch", "start", "pause", "available", "checkin", "status"];
const LOG_ICONS: Record<ReportsLogType, string> = {
  complete: "task_alt",
  dispatch: "send",
  start: "play_arrow",
  pause: "pause",
  available: "hourglass_empty",
  checkin: "login",
  status: "sync_alt",
};

const AVATAR_COLORS = [
  { bg: "var(--blue-soft)", color: "var(--blue)" },
  { bg: "var(--purple-soft)", color: "var(--purple)" },
  { bg: "var(--amber-soft)", color: "var(--amber)" },
  { bg: "var(--green-soft)", color: "var(--green)" },
  { bg: "var(--teal-soft)", color: "var(--teal)" },
  { bg: "var(--red-soft)", color: "var(--red)" },
];

function avatarColor(id: number) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "4h 12min" — usado no bloco Hoje (valores de um dia). */
function formatDuration(value: number) {
  const totalMin = Math.round(value * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  return m > 0 ? `${h}h ${String(m).padStart(2, "0")}min` : `${h}h`;
}

/** Casas decimais da referência de estimativa (layout §3.2). */
// Faixas do coeficiente de variação do HH por unidade: até 15% regular, até 30% moderado, acima irregular.
function cvColor(cv: number | null): string | undefined {
  if (cv == null) return undefined;
  if (cv <= 15) return "var(--green)";
  if (cv <= 30) return "var(--amber)";
  return "var(--red)";
}

// Horas decimais → "1h23min" (≥ 1h), "52min" / "5min20s" (< 1h) ou "45s" (< 1min).
// Ex.: 1,38 h → 1h23min; 0,0321 h → 1min56s. Segundos só aparecem abaixo de 10 min.
function fmtDur(hours: number): string {
  const totalSec = Math.round(Math.abs(hours) * 3600);
  if (totalSec === 0) return "0min";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}min`;
  if (m >= 10) return `${m}min`;
  if (m > 0) return sec ? `${m}min${String(sec).padStart(2, "0")}s` : `${m}min`;
  return `${sec}s`;
}

const UNIT_KEYS: Record<string, "cabo" | "porta" | "link" | "metro" | "unidade"> = {
  CABLE: "cabo",
  CABLES: "cabo",
  CABO: "cabo",
  CABOS: "cabo",
  PORT: "porta",
  PORTS: "porta",
  PORTA: "porta",
  PORTAS: "porta",
  LINK: "link",
  LINKS: "link",
  M: "metro",
  MT: "metro",
  METER: "metro",
  METERS: "metro",
  METRO: "metro",
  METROS: "metro",
  UN: "unidade",
  UND: "unidade",
  UNIT: "unidade",
  UNITS: "unidade",
  UNIDADE: "unidade",
};

// ---------------------------------------------------------------------------
// Textos (pt-BR / en-US / es-ES)
// ---------------------------------------------------------------------------

const TEXT = {
  "pt-BR": {
    eyebrow: "Central de Operações",
    title: "Relatórios e Indicadores",
    subtitle: "Utilização, homem-hora e base de estimativa por atividade",
    todosSites: "Todos os sites",
    filtroSite: "Filtrar por site",
    relatorioGerencial: "Relatório gerencial",
    irParaPeriodo: "Ir para Período",
    // Banner
    bannerCorrecao: (d: string) =>
      `Cálculo corrigido em ${d}. A utilização agora desconta pausas, o HH soma as horas de cada técnico e o tempo por atividade usa o catálogo mestre.`,
    verOQueMudou: "Ver o que mudou",
    mudouPausas: "Pausas não contam mais como horas trabalhadas.",
    mudouHH: "HH é a soma das horas reais de cada técnico, não duração × equipe.",
    mudouFimExpediente: "Dia sem Fim de Expediente é cortado em check-in + 9 h e marcado como incompleto.",
    mudouCatalogo: "Tempo por atividade agrupa por atividade do catálogo × família de cabo.",
    fechar: "Fechar",
    // Seções
    secPeriodo: "Período",
    escopoPeriodo: "Afeta todos os blocos desta seção.",
    preset: (n: number) => `${n} dias`,
    secHoje: (d: string) => `Hoje · ${d}`,
    escopoHoje: "Não muda com o filtro de período.",
    atualizar: "Atualizar",
    atualizando: "Atualizando…",
    carregandoRelatorio: "Carregando relatório…",
    // Estados
    erroCarregar: "Não foi possível carregar o relatório.",
    erroAtualizar: "Não foi possível atualizar. Exibindo o resultado anterior.",
    tentarNovamente: "Tentar novamente",
    erroPeriodo: "Período inválido.",
    exibindoAnterior: "Exibindo o resultado anterior.",
    semDadosPeriodo: "Sem dados no período",
    semCheckinPeriodo: "Sem check-in no período",
    nenhumaConcluida: "Nenhuma tarefa concluída no período",
    nenhumaRastreada: "Nenhuma tarefa com apontamento real no período",
    nenhumCheckinHoje: "Nenhum técnico com check-in hoje",
    nenhumaAtividadeNoPeriodo: "Nenhuma atividade no período selecionado.",
    ampliar90: "Ampliar para 90 dias",
    // Exceções
    requerAtencao: "Requer atenção",
    semExcecoes: "Nenhuma exceção no período.",
    semExcecoesAvaliar: "Sem dados para avaliar exceções neste período.",
    excUtilBaixa: "Utilização baixa (< 50%)",
    excSuspeito: "Dado suspeito (> 100%)",
    excOcioso: (limit: string) => `Ocioso interno acima de ${limit}/dia`,
    excIncompletos: (n: number, d: number) => `${n} técnicos com dias incompletos (${d})`,
    excRastreamento: (pct: string, n: number) => `Rastreamento ${pct} · ${n} técnicos < 90%`,
    // KPIs do período
    kpiUtilizacao: "Utilização",
    hintUtilizacao: (exec: string, jornada: string) => `${exec} em execução ÷ ${jornada} de jornada`,
    kpiHH: "Homem-hora (HH) consumido",
    hintHH: (n: number) => `${n} tarefas rastreadas`,
    kpiExterno: "Bloqueio externo (cliente/site)",
    kpiInterno: "Ocioso interno",
    pctJornada: (pct: string) => `${pct} da jornada`,
    acimaLimite: (n: number, limit: string) => `${n} técnico(s) acima de ${limit}/dia`,
    limiteOcioso: (limit: string) => `Limite: ${limit} por técnico por dia`,
    kpiRastreamento: "Taxa de rastreamento",
    hintRastreamento: (a: number, b: number) => `${a} de ${b} com apontamento real`,
    abaixoMeta90: "Abaixo da meta de 90%",
    kpiConcluidas: "Concluídas no período",
    hintSemApontamento: (n: number) => `${n} sem apontamento (fora do HH)`,
    hintTodasRastreadas: "Todas com apontamento real",
    // KPIs de hoje
    kpiCheckin: "Técnicos com check-in",
    kpiProdMedio: "Produtivo médio por técnico",
    deMeta: (h: string, meta: string) => `${h} de ${meta}`,
    pctMeta: (pct: number) => `${pct}% da meta`,
    kpiExternoHoje: "Bloqueio externo hoje",
    kpiInternoHoje: "Ocioso interno hoje",
    // Faixas e categorias
    faixaBaixa: "Baixa",
    faixaAtencao: "Atenção",
    faixaNormal: "Normal",
    dadoSuspeito: "Dado suspeito",
    semJornada: "Sem jornada",
    catExterno: "Bloqueio externo (cliente/site)",
    catInterno: "Ocioso interno",
    descExterno: "Evidência para o cliente",
    descInterno: "Falha de despacho/planejamento",
    intervalosNeutros: "Almoço, café, reunião, deslocamento e pausas pessoais não entram.",
    segExecucao: "Execução",
    segIntervalos: "Intervalos",
    ordemOcioso: "Mais ocioso primeiro",
    ociosoAcimaLimite: "Ocioso acima do limite",
    mediaDia: (avg: string, limit: string) => `Média de ${avg} por dia — limite ${limit}`,
    ociosoHojeLimite: (h: string, limit: string) => `${h} hoje — limite ${limit}`,
    // Cards
    cardTecnicos: "Técnicos no período",
    nTecnicos: (n: number) => `${n} técnicos`,
    cardImprodutivo: "Improdutivo por motivo",
    cardProducao: "Produção por técnico",
    hintProducao: "Simulação para remuneração variável (não gera pagamento). Quantidade planejada das tarefas fechadas e concluídas por completo, dividida entre os técnicos proporcional às horas de cada um. Taxa por hora = soma da quantidade ÷ soma das horas apontadas pelo técnico nessa atividade. Tarefas iniciadas juntas ou concluídas em lote distorcem as horas apontadas.",
    prodMetrosLancados: "Metros lançados",
    prodLabels: "Labels coladas",
    prodMetrosUtp: "Metros de UTP cortados",
    prodConectoresRj: "Conectores RJ crimpados",
    prodPatching: "Patching (conexões)",
    prodLinks: "Links certificados",
    csvProducao: "producao-por-tecnico",
    exportarDados: "Exportar dados",
    csvDados: "dados-execucoes",
    dadosCols: ["Técnico", "Data", "Projeto", "Tarefa", "Código da atividade", "Atividade", "Família", "Unidade", "Quantidade da tarefa", "Horas do técnico (h)", "Horas da tarefa (HH)", "Quantidade creditada", "Taxa por hora", "Situação", "Motivo do descarte"],
    dadosIncluida: "Incluída",
    dadosDescartada: "Descartada",
    exImplausivel: "Valor absurdo (descartado)",
    semProducao: "Sem produção física no período.",
    cardQualidade: "Qualidade do apontamento",
    hintQualidade: "Mostra por que o HH de um técnico pode estar errado. Em lote = tarefa apontada com menos de 1 min. Valor absurdo = taxa por hora acima do limite da atividade. Sobreposição = tempo de tarefas feitas ao mesmo tempo, que o HH conta uma vez só. HH ÷ execução bem acima de 1 indica apontamento longo demais ou sobreposto.",
    qConcluidas: "Concluídas",
    qSemApont: "Sem apontamento",
    qLote: "Em lote",
    qAbsurdo: "Valor absurdo",
    qSobreposicao: "Sobreposição",
    qHHExec: "HH ÷ execução",
    qSuspeito: "Suspeito",
    qSemDados: "Sem tarefas concluídas no período.",
    csvQualidade: "qualidade-apontamento",
    cardStatusHoras: "Horas por status",
    totalLabel: "Total",
    hintStatusHoras: "Tempo em cada status de presença, por técnico, no período. Produtivo = execução e apoio; improdutivo = disponível sem tarefa e bloqueio externo; neutro = intervalos do técnico, que não entram na conta.",
    catProdutivo: "Produtivo",
    catImprodutivoStatus: "Improdutivo",
    catNeutro: "Neutro",
    csvStatusHoras: "horas-por-status",
    cardAtividades: "Produtividade por atividade",
    cardDiaTecnico: "Dia por técnico",
    cardLog: "Log do dia",
    nEventos: (n: number) => `${n} eventos`,
    exportarCsv: "Exportar CSV",
    // Filtros da tabela de técnicos
    filtroTodos: "Todos",
    filtroBaixa: "Baixa",
    filtroSuspeito: "Suspeito",
    filtroOcioso: "Ocioso > limite",
    filtroIncompletos: "Incompletos",
    filtroRastreamento: "< 90%",
    filtroAtivo: (a: number, b: number, f: string) => `${a} de ${b} técnicos · filtro: ${f}`,
    limparFiltro: "Limpar filtro",
    nenhumTecnicoFiltro: "Nenhum técnico nesta condição.",
    // Tabela de técnicos
    thTecnico: "Técnico",
    thUtilizacao: "Utilização",
    thHorasExec: "Horas em execução",
    thJornada: "Jornada",
    thHH: "HH",
    thExterno: "Bloqueio externo",
    thInterno: "Ocioso interno",
    thConcluidas: "Concluídas",
    thRastreamento: "Rastreamento",
    thDiasIncompletos: "Dias incompletos",
    semApontAbrev: (n: number) => `${n} s/a`,
    semApontTip: (n: number) => `${n} sem apontamento real — fora do HH`,
    total: (n: number) => `Total (${n})`,
    ordemExcecoes: "Exceções primeiro",
    tipUtilizacao: "Horas em execução ÷ jornada (8 h por dia com check-in). Acima de 100% indica apontamento a revisar.",
    tipHorasExec: "Tempo em Em Execução, contado uma vez mesmo com tarefas paralelas. Já desconta pausas.",
    tipJornada: "8 h por dia com check-in.",
    tipHH: "Homem-hora: soma das horas reais deste técnico nas tarefas concluídas. Base de faturamento.",
    tipExterno: "Sem Acesso ao Site + Aguardando Liberações.",
    tipInterno: "Disponível sem tarefa. Limite: 30 min por técnico por dia.",
    tipRastreamento: "Concluídas com apontamento real ÷ concluídas. Meta: 90%.",
    tipIncompletos: "Dias sem Fim de Expediente. O tempo foi cortado em check-in + 9 h.",
    tipConcluidasTotal: "Tarefas distintas concluídas no período (uma tarefa com vários técnicos conta uma vez).",
    // Tabela de atividades
    thAtividade: "Atividade",
    thFamiliaCabo: "Família de cabo",
    thUnidade: "Un.",
    thExecucoesUsadas: "Execuções (usadas / total)",
    thGrupoReferencia: "Referência de estimativa",
    thGrupoExecucao: "Por execução (mediana)",
    thHHUnidade: "HH por unidade",
    thHHMetro: "HH por metro",
    thVariacao: "Variação (σ)",
    tipVariacao:
      "Desvio padrão do HH por unidade entre as execuções (amostral, n−1). CV = desvio ÷ média: até 15% é regular, de 15% a 30% é moderado, acima de 30% é irregular — a mediana sozinha esconde isso.",
    mediaCV: (mean: string, cv: string) => `média ${mean} · CV ${cv}`,
    csvMedia: "média",
    csvDesvio: "desvio padrão",
    csvCV: "CV (%)",
    thHHMediano: "HH",
    thDuracao: "Duração",
    thEquipe: "Equipe média",
    tipDuracao: "Tempo de relógio do início ao fim, sem pausas. Não usar para faturar.",
    tipHHUnidade:
      "Mediana de HH ÷ quantidade em cada execução. Metade das execuções ficou entre P25 e P75; quanto mais larga a faixa, menos previsível a atividade.",
    tipHHMediano: "Homem-hora mediano por execução (soma das horas de cada técnico).",
    faixaP25P75: (a: string, b: string) => `P25–P75 ${a}–${b}`,
    semComprimento: "Item sem comprimento cadastrado",
    exTitulo: "Execuções desta combinação",
    exUsadas: "Usadas na referência",
    exExcluidas: "Excluídas",
    exSemApontamento: "Sem apontamento real",
    exParcialBloqueada: "Parcial ou bloqueada",
    exSemQuantidade: "Sem quantidade",
    quantidadeTotal: "Quantidade total",
    dadosInsuficientes: (n: number) => `Dados insuficientes (n=${n})`,
    amostraPequenaTip: "Amostra pequena — informativo, não usar para orçar.",
    soAmostraSuficiente: "Só amostra suficiente (n ≥ 5)",
    buscarAtividade: "Buscar atividade ou cabo…",
    nCombinacoes: (n: number, s: number) => `${n} combinações · ${s} com amostra suficiente`,
    rodapeExclusoes: (a: number, b: number, c: number) =>
      `Exclusões nas linhas: ${a} sem apontamento real · ${b} parciais ou bloqueadas · ${c} sem quantidade`,
    rodapeSemCatalogo: (n: number) =>
      `Fora da tabela: ${n} tarefas concluídas sem vínculo ao catálogo mestre (tarefas manuais).`,
    nenhumaSuficiente:
      "Nenhuma combinação atingiu 5 execuções válidas no período. Amplie o período ou gere tarefas pelo catálogo mestre.",
    nenhumaAtividadeBusca: (q: string) => `Nenhuma atividade encontrada para "${q}".`,
    limparBusca: "Limpar busca",
    // Improdutivo
    semImprodutivo: "Nenhum tempo improdutivo registrado no período.",
    nenhumNaCategoria: "Nenhum tempo nesta categoria no período.",
    // Log
    logTodos: "Todos",
    nenhumEvento: "Nenhum evento registrado hoje.",
    nenhumEventoTipo: "Nenhum evento deste tipo registrado hoje.",
    logLabel: {
      complete: "Concluiu",
      dispatch: "Despacho",
      start: "Início",
      pause: "Pausa",
      available: "Disponível",
      checkin: "Check-in",
      status: "Status",
    } as Record<ReportsLogType, string>,
    // Unidades e status
    hhUnit: "HH",
    unitLabel: { cabo: "cabo", porta: "porta", link: "link", metro: "m", unidade: "un." },
    statusLabel: {
      site_blocked: "Sem Acesso ao Site",
      awaiting_release: "Aguardando Liberações",
      available: "Disponível sem tarefa",
    } as Record<string, string>,
    // CSV
    csvTecnicos: "tecnicos",
    csvAtividades: "produtividade-atividades",
    csvImprodutivo: "improdutivo-motivos",
    csvSites: "Sites",
    csvFaixa: "Faixa",
    csvUtilPct: "Utilização (%)",
    csvHorasExec: "Horas em execução (h)",
    csvJornada: "Jornada (h)",
    csvExterno: "Bloqueio externo (h)",
    csvInterno: "Ocioso interno (h)",
    csvInternoDia: "Ocioso interno médio por dia (h)",
    csvAcimaLimite: "Ocioso acima do limite",
    csvSemApont: "Sem apontamento",
    csvRastrPct: "Rastreamento (%)",
    csvCodigo: "Código",
    csvCodigoFamilia: "Código da família",
    csvUnidade: "Unidade",
    csvExecUsadas: "Execuções usadas",
    csvExecTotal: "Execuções total",
    colAmostraSuficiente: "Amostra suficiente",
    csvMediana: "mediana",
    csvMetrosTotais: "Metros totais",
    csvDuracao: "Duração mediana (h)",
    csvCategoria: "Categoria",
    csvMotivo: "Motivo",
    csvHoras: "Horas",
    csvPctJornada: "% da jornada",
    sim: "Sim",
    nao: "Não",
  },
  "en-US": {
    eyebrow: "Operations Center",
    title: "Reports & Indicators",
    subtitle: "Utilization, man-hours and activity estimating baseline",
    todosSites: "All sites",
    filtroSite: "Filter by site",
    relatorioGerencial: "Management report",
    irParaPeriodo: "Go to Period",
    bannerCorrecao: (d: string) =>
      `Calculation corrected on ${d}. Utilization now excludes pauses, MH sums each technician's hours and activity time uses the master catalog.`,
    verOQueMudou: "See what changed",
    mudouPausas: "Pauses no longer count as worked hours.",
    mudouHH: "MH is the sum of each technician's actual hours, not duration × crew.",
    mudouFimExpediente: "Days without End of Shift are capped at check-in + 9 h and flagged as incomplete.",
    mudouCatalogo: "Activity time is grouped by catalog activity × cable family.",
    fechar: "Close",
    secPeriodo: "Period",
    escopoPeriodo: "Applies to every block in this section.",
    preset: (n: number) => `${n} days`,
    secHoje: (d: string) => `Today · ${d}`,
    escopoHoje: "Not affected by the period filter.",
    atualizar: "Refresh",
    atualizando: "Updating…",
    carregandoRelatorio: "Loading report…",
    erroCarregar: "Could not load the report.",
    erroAtualizar: "Could not refresh. Showing the previous result.",
    tentarNovamente: "Try again",
    erroPeriodo: "Invalid period.",
    exibindoAnterior: "Showing the previous result.",
    semDadosPeriodo: "No data in the period",
    semCheckinPeriodo: "No check-in in the period",
    nenhumaConcluida: "No tasks completed in the period",
    nenhumaRastreada: "No task with actual time logged in the period",
    nenhumCheckinHoje: "No technician checked in today",
    nenhumaAtividadeNoPeriodo: "No activity in the selected period.",
    ampliar90: "Widen to 90 days",
    requerAtencao: "Needs attention",
    semExcecoes: "No exceptions in the period.",
    semExcecoesAvaliar: "No data to evaluate exceptions in this period.",
    excUtilBaixa: "Low utilization (< 50%)",
    excSuspeito: "Suspicious data (> 100%)",
    excOcioso: (limit: string) => `Internal idle above ${limit}/day`,
    excIncompletos: (n: number, d: number) => `${n} technicians with incomplete days (${d})`,
    excRastreamento: (pct: string, n: number) => `Tracking ${pct} · ${n} technicians < 90%`,
    kpiUtilizacao: "Utilization",
    hintUtilizacao: (exec: string, jornada: string) => `${exec} in progress ÷ ${jornada} shift`,
    kpiHH: "Man-hours (MH) consumed",
    hintHH: (n: number) => `${n} tracked tasks`,
    kpiExterno: "External block (client/site)",
    kpiInterno: "Internal idle",
    pctJornada: (pct: string) => `${pct} of shift hours`,
    acimaLimite: (n: number, limit: string) => `${n} technician(s) above ${limit}/day`,
    limiteOcioso: (limit: string) => `Limit: ${limit} per technician per day`,
    kpiRastreamento: "Tracking rate",
    hintRastreamento: (a: number, b: number) => `${a} of ${b} with actual time logged`,
    abaixoMeta90: "Below the 90% target",
    kpiConcluidas: "Completed in the period",
    hintSemApontamento: (n: number) => `${n} without time logged (excluded from MH)`,
    hintTodasRastreadas: "All with actual time logged",
    kpiCheckin: "Technicians checked in",
    kpiProdMedio: "Avg productive time per technician",
    deMeta: (h: string, meta: string) => `${h} of ${meta}`,
    pctMeta: (pct: number) => `${pct}% of target`,
    kpiExternoHoje: "External block today",
    kpiInternoHoje: "Internal idle today",
    faixaBaixa: "Low",
    faixaAtencao: "Attention",
    faixaNormal: "Normal",
    dadoSuspeito: "Suspicious data",
    semJornada: "No shift",
    catExterno: "External block (client/site)",
    catInterno: "Internal idle",
    descExterno: "Evidence for the client",
    descInterno: "Dispatch/planning gap",
    intervalosNeutros: "Lunch, meals, meetings, travel and personal breaks are not counted.",
    segExecucao: "In progress",
    segIntervalos: "Breaks",
    ordemOcioso: "Most idle first",
    ociosoAcimaLimite: "Idle above limit",
    mediaDia: (avg: string, limit: string) => `Average of ${avg} per day — limit ${limit}`,
    ociosoHojeLimite: (h: string, limit: string) => `${h} today — limit ${limit}`,
    cardTecnicos: "Technicians in the period",
    nTecnicos: (n: number) => `${n} technicians`,
    cardImprodutivo: "Non-productive time by reason",
    cardProducao: "Production by technician",
    hintProducao: "Simulation for variable pay (no payout). Planned quantity of closed, fully completed tasks, split among technicians in proportion to each one's hours. Hourly rate = sum of quantity ÷ sum of the hours the technician logged on that activity. Tasks started together or closed in a batch distort the logged hours.",
    prodMetrosLancados: "Meters pulled",
    prodLabels: "Labels applied",
    prodMetrosUtp: "UTP meters cut",
    prodConectoresRj: "RJ connectors crimped",
    prodPatching: "Patching (connections)",
    prodLinks: "Links certified",
    csvProducao: "production-by-technician",
    exportarDados: "Export data",
    csvDados: "execution-data",
    dadosCols: ["Technician", "Date", "Project", "Task", "Activity code", "Activity", "Family", "Unit", "Task quantity", "Technician hours (h)", "Task hours (MH)", "Credited quantity", "Rate per hour", "Status", "Discard reason"],
    dadosIncluida: "Included",
    dadosDescartada: "Discarded",
    exImplausivel: "Absurd value (discarded)",
    semProducao: "No physical output in the period.",
    cardQualidade: "Time-logging quality",
    hintQualidade: "Shows why a technician's MH may be wrong. Batch = task logged with under 1 min. Absurd value = hourly rate above the activity limit. Overlap = time of tasks done at the same time, which MH counts only once. MH ÷ in-progress well above 1 points to logging that is too long or overlapping.",
    qConcluidas: "Completed",
    qSemApont: "No time logged",
    qLote: "Batch",
    qAbsurdo: "Absurd value",
    qSobreposicao: "Overlap",
    qHHExec: "MH ÷ in progress",
    qSuspeito: "Suspect",
    qSemDados: "No completed tasks in the period.",
    csvQualidade: "logging-quality",
    cardStatusHoras: "Hours by status",
    totalLabel: "Total",
    hintStatusHoras: "Time in each presence status, per technician, in the period. Productive = execution and support; non-productive = available without a task and external blocks; neutral = the technician's breaks, which are not counted.",
    catProdutivo: "Productive",
    catImprodutivoStatus: "Non-productive",
    catNeutro: "Neutral",
    csvStatusHoras: "hours-by-status",
    cardAtividades: "Productivity by activity",
    cardDiaTecnico: "Day by technician",
    cardLog: "Today's log",
    nEventos: (n: number) => `${n} events`,
    exportarCsv: "Export CSV",
    filtroTodos: "All",
    filtroBaixa: "Low",
    filtroSuspeito: "Suspicious",
    filtroOcioso: "Idle > limit",
    filtroIncompletos: "Incomplete",
    filtroRastreamento: "< 90%",
    filtroAtivo: (a: number, b: number, f: string) => `${a} of ${b} technicians · filter: ${f}`,
    limparFiltro: "Clear filter",
    nenhumTecnicoFiltro: "No technician matches this condition.",
    thTecnico: "Technician",
    thUtilizacao: "Utilization",
    thHorasExec: "Hours in progress",
    thJornada: "Shift",
    thHH: "MH",
    thExterno: "External block",
    thInterno: "Internal idle",
    thConcluidas: "Completed",
    thRastreamento: "Tracking",
    thDiasIncompletos: "Incomplete days",
    semApontAbrev: (n: number) => `${n} untracked`,
    semApontTip: (n: number) => `${n} without actual time — excluded from MH`,
    total: (n: number) => `Total (${n})`,
    ordemExcecoes: "Exceptions first",
    tipUtilizacao: "Hours in progress ÷ shift (8 h per checked-in day). Above 100% means time logs need review.",
    tipHorasExec: "Time in In Progress status, counted once even with parallel tasks. Pauses excluded.",
    tipJornada: "8 h per checked-in day.",
    tipHH: "Man-hours: sum of this technician's actual hours on completed tasks. Billing basis.",
    tipExterno: "No Site Access + Awaiting Clearance.",
    tipInterno: "Available without a task. Limit: 30 min per technician per day.",
    tipRastreamento: "Completed with actual time ÷ completed. Target: 90%.",
    tipIncompletos: "Days without End of Shift. Time was capped at check-in + 9 h.",
    tipConcluidasTotal: "Distinct tasks completed in the period (a task with several technicians counts once).",
    thAtividade: "Activity",
    thFamiliaCabo: "Cable family",
    thUnidade: "Unit",
    thExecucoesUsadas: "Runs (used / total)",
    thGrupoReferencia: "Estimating baseline",
    thGrupoExecucao: "Per run (median)",
    thHHUnidade: "MH per unit",
    thHHMetro: "MH per meter",
    thVariacao: "Variation (σ)",
    tipVariacao:
      "Standard deviation of MH per unit across executions (sample, n−1). CV = deviation ÷ mean: up to 15% is steady, 15–30% moderate, above 30% erratic — the median alone hides this.",
    mediaCV: (mean: string, cv: string) => `mean ${mean} · CV ${cv}`,
    csvMedia: "mean",
    csvDesvio: "standard deviation",
    csvCV: "CV (%)",
    thHHMediano: "MH",
    thDuracao: "Duration",
    thEquipe: "Avg crew",
    tipDuracao: "Clock time from start to finish, excluding pauses. Not for billing.",
    tipHHUnidade:
      "Median of MH ÷ quantity per run. Half of the runs fall between P25 and P75; the wider the range, the less predictable the activity.",
    tipHHMediano: "Median man-hours per run (sum of each technician's hours).",
    faixaP25P75: (a: string, b: string) => `P25–P75 ${a}–${b}`,
    semComprimento: "Item has no length registered",
    exTitulo: "Runs for this combination",
    exUsadas: "Used in baseline",
    exExcluidas: "Excluded",
    exSemApontamento: "No actual time logged",
    exParcialBloqueada: "Partial or blocked",
    exSemQuantidade: "No quantity",
    quantidadeTotal: "Total quantity",
    dadosInsuficientes: (n: number) => `Insufficient data (n=${n})`,
    amostraPequenaTip: "Small sample — informational only, do not use for quoting.",
    soAmostraSuficiente: "Sufficient sample only (n ≥ 5)",
    buscarAtividade: "Search activity or cable…",
    nCombinacoes: (n: number, s: number) => `${n} combinations · ${s} with sufficient sample`,
    rodapeExclusoes: (a: number, b: number, c: number) =>
      `Excluded within rows: ${a} without actual time · ${b} partial or blocked · ${c} without quantity`,
    rodapeSemCatalogo: (n: number) =>
      `Not in table: ${n} completed tasks not linked to the master catalog (manual tasks).`,
    nenhumaSuficiente:
      "No combination reached 5 valid runs in the period. Widen the period or generate tasks from the master catalog.",
    nenhumaAtividadeBusca: (q: string) => `No activity found for "${q}".`,
    limparBusca: "Clear search",
    semImprodutivo: "No non-productive time recorded in the period.",
    nenhumNaCategoria: "No time in this category in the period.",
    logTodos: "All",
    nenhumEvento: "No events recorded today.",
    nenhumEventoTipo: "No events of this type recorded today.",
    logLabel: {
      complete: "Completed",
      dispatch: "Dispatch",
      start: "Started",
      pause: "Paused",
      available: "Available",
      checkin: "Check-in",
      status: "Status",
    } as Record<ReportsLogType, string>,
    hhUnit: "MH",
    unitLabel: { cabo: "cable", porta: "port", link: "link", metro: "m", unidade: "unit" },
    statusLabel: {
      site_blocked: "No Site Access",
      awaiting_release: "Awaiting Clearance",
      available: "Available without a task",
    } as Record<string, string>,
    csvTecnicos: "technicians",
    csvAtividades: "activity-productivity",
    csvImprodutivo: "non-productive-by-reason",
    csvSites: "Sites",
    csvFaixa: "Band",
    csvUtilPct: "Utilization (%)",
    csvHorasExec: "Hours in progress (h)",
    csvJornada: "Shift (h)",
    csvExterno: "External block (h)",
    csvInterno: "Internal idle (h)",
    csvInternoDia: "Avg internal idle per day (h)",
    csvAcimaLimite: "Idle above limit",
    csvSemApont: "Untracked",
    csvRastrPct: "Tracking (%)",
    csvCodigo: "Code",
    csvCodigoFamilia: "Family code",
    csvUnidade: "Unit",
    csvExecUsadas: "Runs used",
    csvExecTotal: "Runs total",
    colAmostraSuficiente: "Sufficient sample",
    csvMediana: "median",
    csvMetrosTotais: "Total meters",
    csvDuracao: "Median duration (h)",
    csvCategoria: "Category",
    csvMotivo: "Reason",
    csvHoras: "Hours",
    csvPctJornada: "% of shift",
    sim: "Yes",
    nao: "No",
  },
  "es-ES": {
    eyebrow: "Centro de Operaciones",
    title: "Informes e Indicadores",
    subtitle: "Utilización, horas-hombre y base de estimación por actividad",
    todosSites: "Todos los sitios",
    filtroSite: "Filtrar por sitio",
    relatorioGerencial: "Informe gerencial",
    irParaPeriodo: "Ir a Período",
    bannerCorrecao: (d: string) =>
      `Cálculo corregido el ${d}. La utilización ahora descuenta pausas, las HH suman las horas de cada técnico y el tiempo por actividad usa el catálogo maestro.`,
    verOQueMudou: "Ver qué cambió",
    mudouPausas: "Las pausas ya no cuentan como horas trabajadas.",
    mudouHH: "HH es la suma de las horas reales de cada técnico, no duración × equipo.",
    mudouFimExpediente: "Los días sin Fin de jornada se cortan en check-in + 9 h y se marcan como incompletos.",
    mudouCatalogo: "El tiempo por actividad se agrupa por actividad del catálogo × familia de cable.",
    fechar: "Cerrar",
    secPeriodo: "Período",
    escopoPeriodo: "Afecta a todos los bloques de esta sección.",
    preset: (n: number) => `${n} días`,
    secHoje: (d: string) => `Hoy · ${d}`,
    escopoHoje: "No cambia con el filtro de período.",
    atualizar: "Actualizar",
    atualizando: "Actualizando…",
    carregandoRelatorio: "Cargando informe…",
    erroCarregar: "No fue posible cargar el informe.",
    erroAtualizar: "No fue posible actualizar. Mostrando el resultado anterior.",
    tentarNovamente: "Reintentar",
    erroPeriodo: "Período inválido.",
    exibindoAnterior: "Mostrando el resultado anterior.",
    semDadosPeriodo: "Sin datos en el período",
    semCheckinPeriodo: "Sin check-in en el período",
    nenhumaConcluida: "Ninguna tarea completada en el período",
    nenhumaRastreada: "Ninguna tarea con tiempo real registrado en el período",
    nenhumCheckinHoje: "Ningún técnico con check-in hoy",
    nenhumaAtividadeNoPeriodo: "Ninguna actividad en el período seleccionado.",
    ampliar90: "Ampliar a 90 días",
    requerAtencao: "Requiere atención",
    semExcecoes: "Ninguna excepción en el período.",
    semExcecoesAvaliar: "Sin datos para evaluar excepciones en este período.",
    excUtilBaixa: "Utilización baja (< 50%)",
    excSuspeito: "Dato sospechoso (> 100%)",
    excOcioso: (limit: string) => `Inactividad interna por encima de ${limit}/día`,
    excIncompletos: (n: number, d: number) => `${n} técnicos con días incompletos (${d})`,
    excRastreamento: (pct: string, n: number) => `Seguimiento ${pct} · ${n} técnicos < 90%`,
    kpiUtilizacao: "Utilización",
    hintUtilizacao: (exec: string, jornada: string) => `${exec} en ejecución ÷ ${jornada} de jornada`,
    kpiHH: "Horas-hombre (HH) consumidas",
    hintHH: (n: number) => `${n} tareas con seguimiento`,
    kpiExterno: "Bloqueo externo (cliente/sitio)",
    kpiInterno: "Inactividad interna",
    pctJornada: (pct: string) => `${pct} de la jornada`,
    acimaLimite: (n: number, limit: string) => `${n} técnico(s) por encima de ${limit}/día`,
    limiteOcioso: (limit: string) => `Límite: ${limit} por técnico por día`,
    kpiRastreamento: "Tasa de seguimiento",
    hintRastreamento: (a: number, b: number) => `${a} de ${b} con tiempo real registrado`,
    abaixoMeta90: "Por debajo de la meta del 90%",
    kpiConcluidas: "Completadas en el período",
    hintSemApontamento: (n: number) => `${n} sin registro de tiempo (fuera de HH)`,
    hintTodasRastreadas: "Todas con tiempo real registrado",
    kpiCheckin: "Técnicos con check-in",
    kpiProdMedio: "Productivo medio por técnico",
    deMeta: (h: string, meta: string) => `${h} de ${meta}`,
    pctMeta: (pct: number) => `${pct}% de la meta`,
    kpiExternoHoje: "Bloqueo externo hoy",
    kpiInternoHoje: "Inactividad interna hoy",
    faixaBaixa: "Baja",
    faixaAtencao: "Atención",
    faixaNormal: "Normal",
    dadoSuspeito: "Dato sospechoso",
    semJornada: "Sin jornada",
    catExterno: "Bloqueo externo (cliente/sitio)",
    catInterno: "Inactividad interna",
    descExterno: "Evidencia para el cliente",
    descInterno: "Falla de despacho/planificación",
    intervalosNeutros: "El almuerzo, las comidas, las reuniones, los desplazamientos y las pausas personales no se cuentan.",
    segExecucao: "En ejecución",
    segIntervalos: "Pausas",
    ordemOcioso: "Más inactivo primero",
    ociosoAcimaLimite: "Inactividad por encima del límite",
    mediaDia: (avg: string, limit: string) => `Media de ${avg} por día — límite ${limit}`,
    ociosoHojeLimite: (h: string, limit: string) => `${h} hoy — límite ${limit}`,
    cardTecnicos: "Técnicos en el período",
    nTecnicos: (n: number) => `${n} técnicos`,
    cardImprodutivo: "Tiempo improductivo por motivo",
    cardProducao: "Producción por técnico",
    hintProducao: "Simulación para remuneración variable (no genera pago). Cantidad planificada de las tareas cerradas y completadas por completo, dividida entre los técnicos en proporción a las horas de cada uno. Tasa por hora = suma de la cantidad ÷ suma de las horas registradas por el técnico en esa actividad. Las tareas iniciadas juntas o cerradas en lote distorsionan las horas registradas.",
    prodMetrosLancados: "Metros tendidos",
    prodLabels: "Etiquetas aplicadas",
    prodMetrosUtp: "Metros de UTP cortados",
    prodConectoresRj: "Conectores RJ crimpados",
    prodPatching: "Patching (conexiones)",
    prodLinks: "Enlaces certificados",
    csvProducao: "produccion-por-tecnico",
    exportarDados: "Exportar datos",
    csvDados: "datos-ejecuciones",
    dadosCols: ["Técnico", "Fecha", "Proyecto", "Tarea", "Código de la actividad", "Actividad", "Familia", "Unidad", "Cantidad de la tarea", "Horas del técnico (h)", "Horas de la tarea (HH)", "Cantidad acreditada", "Tasa por hora", "Situación", "Motivo del descarte"],
    dadosIncluida: "Incluida",
    dadosDescartada: "Descartada",
    exImplausivel: "Valor absurdo (descartado)",
    semProducao: "Sin producción física en el período.",
    cardQualidade: "Calidad del registro",
    hintQualidade: "Muestra por qué el HH de un técnico puede estar errado. En lote = tarea registrada con menos de 1 min. Valor absurdo = tasa por hora sobre el límite de la actividad. Superposición = tiempo de tareas hechas a la vez, que el HH cuenta una sola vez. HH ÷ ejecución muy por encima de 1 indica registro demasiado largo o superpuesto.",
    qConcluidas: "Concluidas",
    qSemApont: "Sin registro",
    qLote: "En lote",
    qAbsurdo: "Valor absurdo",
    qSobreposicao: "Superposición",
    qHHExec: "HH ÷ ejecución",
    qSuspeito: "Sospechoso",
    qSemDados: "Sin tareas concluidas en el período.",
    csvQualidade: "calidad-registro",
    cardStatusHoras: "Horas por estado",
    totalLabel: "Total",
    hintStatusHoras: "Tiempo en cada estado de presencia, por técnico, en el período. Productivo = ejecución y apoyo; improductivo = disponible sin tarea y bloqueo externo; neutro = pausas del técnico, que no se cuentan.",
    catProdutivo: "Productivo",
    catImprodutivoStatus: "Improductivo",
    catNeutro: "Neutro",
    csvStatusHoras: "horas-por-estado",
    cardAtividades: "Productividad por actividad",
    cardDiaTecnico: "Día por técnico",
    cardLog: "Registro del día",
    nEventos: (n: number) => `${n} eventos`,
    exportarCsv: "Exportar CSV",
    filtroTodos: "Todos",
    filtroBaixa: "Baja",
    filtroSuspeito: "Sospechoso",
    filtroOcioso: "Inactivo > límite",
    filtroIncompletos: "Incompletos",
    filtroRastreamento: "< 90%",
    filtroAtivo: (a: number, b: number, f: string) => `${a} de ${b} técnicos · filtro: ${f}`,
    limparFiltro: "Quitar filtro",
    nenhumTecnicoFiltro: "Ningún técnico en esta condición.",
    thTecnico: "Técnico",
    thUtilizacao: "Utilización",
    thHorasExec: "Horas en ejecución",
    thJornada: "Jornada",
    thHH: "HH",
    thExterno: "Bloqueo externo",
    thInterno: "Inactividad interna",
    thConcluidas: "Completadas",
    thRastreamento: "Seguimiento",
    thDiasIncompletos: "Días incompletos",
    semApontAbrev: (n: number) => `${n} s/r`,
    semApontTip: (n: number) => `${n} sin tiempo real — fuera de HH`,
    total: (n: number) => `Total (${n})`,
    ordemExcecoes: "Excepciones primero",
    tipUtilizacao: "Horas en ejecución ÷ jornada (8 h por día con check-in). Más de 100% indica registros a revisar.",
    tipHorasExec: "Tiempo en estado En ejecución, contado una vez aun con tareas paralelas. Sin pausas.",
    tipJornada: "8 h por día con check-in.",
    tipHH: "Horas-hombre: suma de las horas reales de este técnico en tareas completadas. Base de facturación.",
    tipExterno: "Sin acceso al sitio + Esperando autorizaciones.",
    tipInterno: "Disponible sin tarea. Límite: 30 min por técnico por día.",
    tipRastreamento: "Completadas con tiempo real ÷ completadas. Meta: 90%.",
    tipIncompletos: "Días sin Fin de jornada. El tiempo se cortó en check-in + 9 h.",
    tipConcluidasTotal: "Tareas distintas completadas en el período (una tarea con varios técnicos cuenta una vez).",
    thAtividade: "Actividad",
    thFamiliaCabo: "Familia de cable",
    thUnidade: "Ud.",
    thExecucoesUsadas: "Ejecuciones (usadas / total)",
    thGrupoReferencia: "Referencia de estimación",
    thGrupoExecucao: "Por ejecución (mediana)",
    thHHUnidade: "HH por unidad",
    thHHMetro: "HH por metro",
    thVariacao: "Variación (σ)",
    tipVariacao:
      "Desviación estándar del HH por unidad entre las ejecuciones (muestral, n−1). CV = desviación ÷ media: hasta 15% es regular, de 15% a 30% moderado, más de 30% irregular — la mediana sola lo oculta.",
    mediaCV: (mean: string, cv: string) => `media ${mean} · CV ${cv}`,
    csvMedia: "media",
    csvDesvio: "desviación estándar",
    csvCV: "CV (%)",
    thHHMediano: "HH",
    thDuracao: "Duración",
    thEquipe: "Equipo medio",
    tipDuracao: "Tiempo de reloj del inicio al fin, sin pausas. No usar para facturar.",
    tipHHUnidade:
      "Mediana de HH ÷ cantidad por ejecución. La mitad de las ejecuciones está entre P25 y P75; cuanto más ancho el rango, menos previsible la actividad.",
    tipHHMediano: "Horas-hombre medianas por ejecución (suma de las horas de cada técnico).",
    faixaP25P75: (a: string, b: string) => `P25–P75 ${a}–${b}`,
    semComprimento: "Ítem sin longitud registrada",
    exTitulo: "Ejecuciones de esta combinación",
    exUsadas: "Usadas en la referencia",
    exExcluidas: "Excluidas",
    exSemApontamento: "Sin tiempo real registrado",
    exParcialBloqueada: "Parcial o bloqueada",
    exSemQuantidade: "Sin cantidad",
    quantidadeTotal: "Cantidad total",
    dadosInsuficientes: (n: number) => `Datos insuficientes (n=${n})`,
    amostraPequenaTip: "Muestra pequeña — solo informativo, no usar para presupuestar.",
    soAmostraSuficiente: "Solo muestra suficiente (n ≥ 5)",
    buscarAtividade: "Buscar actividad o cable…",
    nCombinacoes: (n: number, s: number) => `${n} combinaciones · ${s} con muestra suficiente`,
    rodapeExclusoes: (a: number, b: number, c: number) =>
      `Excluidas en las filas: ${a} sin tiempo real · ${b} parciales o bloqueadas · ${c} sin cantidad`,
    rodapeSemCatalogo: (n: number) =>
      `Fuera de la tabla: ${n} tareas completadas sin vínculo al catálogo maestro (tareas manuales).`,
    nenhumaSuficiente:
      "Ninguna combinación alcanzó 5 ejecuciones válidas en el período. Amplíe el período o genere tareas desde el catálogo maestro.",
    nenhumaAtividadeBusca: (q: string) => `Ninguna actividad encontrada para "${q}".`,
    limparBusca: "Borrar búsqueda",
    semImprodutivo: "Ningún tiempo improductivo registrado en el período.",
    nenhumNaCategoria: "Ningún tiempo en esta categoría en el período.",
    logTodos: "Todos",
    nenhumEvento: "Ningún evento registrado hoy.",
    nenhumEventoTipo: "Ningún evento de este tipo registrado hoy.",
    logLabel: {
      complete: "Completó",
      dispatch: "Despacho",
      start: "Inicio",
      pause: "Pausa",
      available: "Disponible",
      checkin: "Check-in",
      status: "Estado",
    } as Record<ReportsLogType, string>,
    hhUnit: "HH",
    unitLabel: { cabo: "cable", porta: "puerto", link: "enlace", metro: "m", unidade: "ud." },
    statusLabel: {
      site_blocked: "Sin acceso al sitio",
      awaiting_release: "Esperando autorizaciones",
      available: "Disponible sin tarea",
    } as Record<string, string>,
    csvTecnicos: "tecnicos",
    csvAtividades: "productividad-actividades",
    csvImprodutivo: "improductivo-motivos",
    csvSites: "Sitios",
    csvFaixa: "Franja",
    csvUtilPct: "Utilización (%)",
    csvHorasExec: "Horas en ejecución (h)",
    csvJornada: "Jornada (h)",
    csvExterno: "Bloqueo externo (h)",
    csvInterno: "Inactividad interna (h)",
    csvInternoDia: "Inactividad interna media por día (h)",
    csvAcimaLimite: "Inactividad por encima del límite",
    csvSemApont: "Sin registro",
    csvRastrPct: "Seguimiento (%)",
    csvCodigo: "Código",
    csvCodigoFamilia: "Código de familia",
    csvUnidade: "Unidad",
    csvExecUsadas: "Ejecuciones usadas",
    csvExecTotal: "Ejecuciones total",
    colAmostraSuficiente: "Muestra suficiente",
    csvMediana: "mediana",
    csvMetrosTotais: "Metros totales",
    csvDuracao: "Duración mediana (h)",
    csvCategoria: "Categoría",
    csvMotivo: "Motivo",
    csvHoras: "Horas",
    csvPctJornada: "% de la jornada",
    sim: "Sí",
    nao: "No",
  },
};


// ---------------------------------------------------------------------------
// Tooltip acessível (hover, foco e toque). Renderizado em portal com
// position: fixed para não ser cortado por containers com overflow.
// ---------------------------------------------------------------------------

function Tip({ content, label, children }: { content: ReactNode; label?: string; children?: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  function show() {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const above = r.top > 180;
    const half = 150;
    const left = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    setPos({ left, top: above ? r.top - 8 : r.bottom + 8, above });
  }

  useEffect(() => {
    if (!pos) return;
    const hide = () => setPos(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={children ? "rpt-tip-trigger rpt-tip-trigger--inline" : "rpt-tip-trigger"}
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onFocus={show}
        onBlur={() => setPos(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) setPos(null);
          else show();
        }}
      >
        {children ?? <Icon name="info" style={{ fontSize: 14 }} />}
      </button>
      {pos &&
        createPortal(
          <div
            className="rpt-tip-body"
            role="tooltip"
            style={{ left: pos.left, top: pos.top, transform: pos.above ? "translate(-50%, -100%)" : "translate(-50%, 0)" }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Ordenação
// ---------------------------------------------------------------------------

type SortDir = "asc" | "desc";
type SortState<K extends string> = { key: K; dir: SortDir } | null;

function nextSort<K extends string>(current: SortState<K>, key: K, firstDir: SortDir): SortState<K> {
  if (!current || current.key !== key) return { key, dir: firstDir };
  if (current.dir === firstDir) return { key, dir: firstDir === "asc" ? "desc" : "asc" };
  return null; // terceiro clique volta à ordem padrão
}

/** Compara números deixando null/undefined sempre no fim. */
function cmpNullable(a: number | null | undefined, b: number | null | undefined, dir: SortDir) {
  const an = a == null;
  const bn = b == null;
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return dir === "asc" ? a - b : b - a;
}

function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  firstDir = "desc",
  tip,
  align = "right",
  className,
  defaultLabel,
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (s: SortState<K>) => void;
  firstDir?: SortDir;
  tip?: string;
  align?: "left" | "right";
  className?: string;
  defaultLabel?: string;
}) {
  const active = sort != null && sort.key === sortKey;
  const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th aria-sort={ariaSort} className={[align === "right" ? "rpt-num" : "", className || ""].join(" ").trim()}>
      <span className="rpt-th-inner">
        <button type="button" className="rpt-th-sort" onClick={() => onSort(nextSort(sort, sortKey, firstDir))}>
          {label}
          {active ? (
            <Icon name={sort!.dir === "asc" ? "arrow_upward" : "arrow_downward"} style={{ fontSize: 13 }} />
          ) : defaultLabel ? (
            <span className="rpt-th-default" title={defaultLabel}>
              <Icon name="swap_vert" style={{ fontSize: 13 }} />
            </span>
          ) : null}
        </button>
        {tip && <Tip content={tip} label={tip} />}
      </span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

type TechFilter = "all" | "low" | "suspect" | "idle" | "incomplete" | "tracking";
type TechSortKey =
  | "name"
  | "utilization"
  | "productive_hours"
  | "journey_hours"
  | "man_hours"
  | "external_block_hours"
  | "internal_idle_hours"
  | "completed_count"
  | "tracking_rate_pct"
  | "incomplete_days";
type ActSortKey =
  | "activity"
  | "family"
  | "executions_used"
  | "hh_per_unit"
  | "hh_per_meter"
  | "hh_cv"
  | "median_man_hours"
  | "median_duration_hours"
  | "avg_crew_size";
type RefreshScope = "all" | "period" | "today";

const BAND_RANK: Record<string, number> = { low: 0, suspect: 1, attention: 2, normal: 3, none: 4 };

function techMatches(t: ReportsTechnician, f: TechFilter): boolean {
  const band = bandFor(t.utilization_pct, t.utilization_band);
  switch (f) {
    case "low":
      return band === "low";
    case "suspect":
      return band === "suspect";
    case "idle":
      return t.idle_limit_exceeded;
    case "incomplete":
      return t.incomplete_days > 0;
    case "tracking":
      return t.tracking_rate_pct != null && t.tracking_rate_pct < TRACKING_TARGET_PCT;
    default:
      return true;
  }
}

function readBannerDismissed(): boolean {
  try {
    return localStorage.getItem(CALC_FIX_STORAGE_KEY) === CALC_FIX_DATE;
  } catch {
    return false;
  }
}

function errorDetail(err: unknown): { status?: number; detail?: string } {
  const e = err as { response?: { status?: number; data?: { detail?: unknown } } };
  const detail = e?.response?.data?.detail;
  return { status: e?.response?.status, detail: typeof detail === "string" ? detail : undefined };
}

export default function OperationsReportsPage() {
  const p = usePageText(TEXT);
  const { locale } = useI18n();

  const [sites, setSites] = useState<Site[]>([]);
  // "all" ou um ou mais ids separados por vírgula ("12,15")
  const [siteId, setSiteId] = useState<string>("all");
  const [range, setRange] = useState<DateRange>(() => ({ start: brazilDaysAgoIso(29), end: brazilTodayIso() }));
  const [data, setData] = useState<OperationsReports | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshScope, setRefreshScope] = useState<RefreshScope>("all");
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState<{ detail?: string } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(readBannerDismissed);

  const [techFilter, setTechFilter] = useState<TechFilter>("all");
  const [techSort, setTechSort] = useState<SortState<TechSortKey>>(null);
  const [techPage, setTechPage] = useState(1);

  const [actSearch, setActSearch] = useState("");
  const [actOnlySufficient, setActOnlySufficient] = useState(false);
  const [actSort, setActSort] = useState<SortState<ActSortKey>>(null);
  const [actPage, setActPage] = useState(1);
  const [actPageSize, setActPageSize] = useState(10);

  const [logFilter, setLogFilter] = useState<ReportsLogType | "all">("all");

  const techTableRef = useRef<HTMLDivElement>(null);
  const periodRef = useRef<HTMLElement>(null);

  useEffect(() => {
    sitesApi
      .list()
      .then((res) => setSites(res.results))
      .catch(() => setSites([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    operationsApi
      .reports(siteId, range.start, range.end)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoadError(null);
        setRangeError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const { status, detail } = errorDetail(err);
        if (status === 400) {
          setRangeError(detail ?? "");
        } else {
          setLoadError({ detail });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, range.start, range.end, reloadKey]);

  useEffect(() => {
    setTechPage(1);
    setActPage(1);
  }, [siteId, range.start, range.end]);

  useEffect(() => {
    setActPage(1);
  }, [actSearch, actOnlySufficient, actSort]);

  useEffect(() => {
    setTechPage(1);
  }, [techFilter, techSort]);

  // --- Formatação --------------------------------------------------------
  const nf = useMemo(() => {
    const cache = new Map<number, Intl.NumberFormat>();
    return (v: number, digits: number) => {
      let f = cache.get(digits);
      if (!f) {
        f = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
        cache.set(digits, f);
      }
      return f.format(v);
    };
  }, [locale]);
  const fmtH = (v: number) => `${nf(v, 1)} h`;
  const fmtHH = (v: number) => `${nf(v, 1)} ${p.hhUnit}`;
  const fmtPct = (v: number) => `${nf(v, 1)}%`;

  const todayIso = brazilTodayIso();
  const todayLabel = formatIsoDate(todayIso, locale, { weekday: "short", day: "2-digit", month: "2-digit" });
  const fixDateLabel = formatIsoDate(CALC_FIX_DATE, locale, { day: "2-digit", month: "2-digit" });
  const bannerVisible = !bannerDismissed && todayIso <= addDaysIso(CALC_FIX_DATE, CALC_FIX_BANNER_DAYS);

  function unitLabel(unit: string): string {
    const key = UNIT_KEYS[unit.trim().toUpperCase()];
    return key ? p.unitLabel[key] : unit.trim();
  }

  function statusLabel(r: ReportsUnproductiveReason) {
    return p.statusLabel[r.status] ?? r.status_display;
  }

  // --- Ações -------------------------------------------------------------
  function changeSite(value: string) {
    setRefreshScope("all");
    setSiteId(value);
  }

  function changeRange(next: DateRange | null) {
    setRefreshScope("period");
    setRangeError(null);
    if (!next) {
      setRange({ start: brazilDaysAgoIso(29), end: brazilTodayIso() });
      return;
    }
    setRange(next);
  }

  function applyPreset(days: number) {
    changeRange({ start: brazilDaysAgoIso(days - 1), end: brazilTodayIso() });
  }

  function retry() {
    setRefreshScope("all");
    setReloadKey((k) => k + 1);
  }

  function refreshToday() {
    setRefreshScope("today");
    setReloadKey((k) => k + 1);
  }

  function dismissBanner() {
    setBannerDismissed(true);
    try {
      localStorage.setItem(CALC_FIX_STORAGE_KEY, CALC_FIX_DATE);
    } catch {
      /* armazenamento indisponível: o banner só some nesta visita */
    }
  }

  function selectTechFilter(f: TechFilter, scroll = false) {
    setTechFilter(f);
    if (scroll) techTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // --- Dados derivados ---------------------------------------------------
  const stats = data?.stats;
  const today = data?.today;
  const technicians = data?.technicians ?? [];
  const activityRows = data?.activity_productivity ?? [];
  const reasons = data?.unproductive_by_reason ?? [];
  const logEntries = data?.log_entries ?? [];
  const todayTechs = data?.today_technicians ?? [];

  const periodEmpty = !!data && technicians.length === 0 && data.stats.period_completed_count === 0;
  const journeyTotal = stats?.journey_hours_total ?? 0;
  const idleLimitHours = stats?.internal_idle_limit_hours ?? DEFAULT_IDLE_LIMIT_HOURS;
  const idleLimitLabel = formatDuration(idleLimitHours);
  const todayIdleLimitHours = today?.internal_idle_limit_hours ?? DEFAULT_IDLE_LIMIT_HOURS;
  const todayTarget = today?.productive_target_hours ?? DEFAULT_TODAY_TARGET_HOURS;

  const filterCounts = useMemo(() => {
    const counts: Record<TechFilter, number> = { all: technicians.length, low: 0, suspect: 0, idle: 0, incomplete: 0, tracking: 0 };
    for (const t of technicians) {
      (["low", "suspect", "idle", "incomplete", "tracking"] as TechFilter[]).forEach((f) => {
        if (techMatches(t, f)) counts[f] += 1;
      });
    }
    return counts;
  }, [technicians]);

  const sortedTechs = useMemo(() => {
    const rows = technicians.filter((t) => techMatches(t, techFilter));
    if (!techSort) {
      return rows.sort((a, b) => {
        const ba = bandFor(a.utilization_pct, a.utilization_band) ?? "none";
        const bb = bandFor(b.utilization_pct, b.utilization_band) ?? "none";
        if (BAND_RANK[ba] !== BAND_RANK[bb]) return BAND_RANK[ba] - BAND_RANK[bb];
        if (ba === "none") return a.name.localeCompare(b.name);
        const diff = ba === "suspect" ? (b.utilization_pct ?? 0) - (a.utilization_pct ?? 0) : (a.utilization_pct ?? 0) - (b.utilization_pct ?? 0);
        return diff || a.name.localeCompare(b.name);
      });
    }
    const { key, dir } = techSort;
    return rows.sort((a, b) => {
      if (key === "name") return dir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      if (key === "utilization") return cmpNullable(a.utilization_pct, b.utilization_pct, dir);
      return cmpNullable(a[key], b[key], dir);
    });
  }, [technicians, techFilter, techSort]);

  const techPaged = sortedTechs.length > TECH_PAGE_SIZE;
  const techSlice = techPaged ? sortedTechs.slice((techPage - 1) * TECH_PAGE_SIZE, techPage * TECH_PAGE_SIZE) : sortedTechs;

  const actFiltered = useMemo(() => {
    const q = actSearch.trim().toLowerCase();
    let rows = activityRows.filter((a) => !actOnlySufficient || a.sufficient_sample);
    if (q) {
      rows = rows.filter((a) =>
        [a.activity_name, a.activity_code, a.cable_family_name, a.cable_family_code]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    rows = [...rows];
    if (!actSort) {
      return rows.sort(
        (a, b) =>
          Number(b.sufficient_sample) - Number(a.sufficient_sample) ||
          b.executions_used - a.executions_used ||
          a.activity_name.localeCompare(b.activity_name)
      );
    }
    const { key, dir } = actSort;
    const text = (a: string | null, b: string | null) => {
      const r = (a ?? "").localeCompare(b ?? "");
      return dir === "asc" ? r : -r;
    };
    return rows.sort((a, b) => {
      switch (key) {
        case "activity":
          return text(a.activity_name, b.activity_name);
        case "family":
          return text(a.cable_family_name, b.cable_family_name);
        case "hh_per_unit": {
          // Unidades diferentes não são comparáveis: agrupa por unidade antes do valor.
          if (a.hh_per_unit && b.hh_per_unit) {
            const u = a.unit.localeCompare(b.unit);
            if (u !== 0) return u;
          }
          return cmpNullable(a.hh_per_unit?.median, b.hh_per_unit?.median, dir);
        }
        case "hh_per_meter":
          return cmpNullable(a.hh_per_meter?.median, b.hh_per_meter?.median, dir);
        case "hh_cv":
          return cmpNullable(a.hh_per_unit?.cv_pct, b.hh_per_unit?.cv_pct, dir);
        default:
          return cmpNullable(a[key], b[key], dir);
      }
    });
  }, [activityRows, actSearch, actOnlySufficient, actSort]);

  const actSlice = actFiltered.slice((actPage - 1) * actPageSize, actPage * actPageSize);
  const actSufficientCount = activityRows.filter((a) => a.sufficient_sample).length;
  const actExcludedTotals = activityRows.reduce(
    (acc, a) => ({
      untracked: acc.untracked + a.excluded.untracked,
      partial: acc.partial + a.excluded.partial_or_blocked,
      noQty: acc.noQty + a.excluded.no_quantity,
    }),
    { untracked: 0, partial: 0, noQty: 0 }
  );

  const todaySorted = useMemo(
    () => [...todayTechs].sort((a, b) => b.internal_idle_hours - a.internal_idle_hours || a.name.localeCompare(b.name)),
    [todayTechs]
  );

  const logCounts = useMemo(() => {
    const c = {} as Record<ReportsLogType, number>;
    LOG_TYPES.forEach((t) => (c[t] = 0));
    logEntries.forEach((e) => {
      if (e.type in c) c[e.type] += 1;
      else c.status += 1;
    });
    return c;
  }, [logEntries]);
  const normalizeLogType = (t: string): ReportsLogType => (LOG_TYPES.includes(t as ReportsLogType) ? (t as ReportsLogType) : "status");
  const filteredLog = logFilter === "all" ? logEntries : logEntries.filter((e) => normalizeLogType(e.type) === logFilter);

  // --- Exportação CSV ----------------------------------------------------
  const csvSuffix = `${range.start}_${range.end}`;
  const bandText = (band: UtilizationBand | null) =>
    band === "low" ? p.faixaBaixa : band === "attention" ? p.faixaAtencao : band === "normal" ? p.faixaNormal : band === "suspect" ? p.dadoSuspeito : "";

  function exportTechnicians() {
    const header: CsvCell[] = [
      p.thTecnico,
      p.csvSites,
      p.csvUtilPct,
      p.csvFaixa,
      p.csvHorasExec,
      p.csvJornada,
      p.thHH,
      p.csvExterno,
      p.csvInterno,
      p.csvInternoDia,
      p.csvAcimaLimite,
      p.thConcluidas,
      p.csvSemApont,
      p.csvRastrPct,
      p.thDiasIncompletos,
    ];
    const rows: CsvCell[][] = sortedTechsAll().map((t) => [
      t.name,
      t.site_name,
      t.utilization_pct,
      bandText(bandFor(t.utilization_pct, t.utilization_band)),
      fmtDur(t.productive_hours),
      fmtDur(t.journey_hours),
      fmtDur(t.man_hours),
      t.journey_hours > 0 ? fmtDur(t.external_block_hours) : null,
      t.journey_hours > 0 ? fmtDur(t.internal_idle_hours) : null,
      t.internal_idle_avg_per_day == null ? null : fmtDur(t.internal_idle_avg_per_day),
      t.idle_limit_exceeded ? p.sim : p.nao,
      t.completed_count,
      t.untracked_count,
      t.tracking_rate_pct,
      t.incomplete_days,
    ]);
    downloadCsv(`${p.csvTecnicos}_${csvSuffix}.csv`, [header, ...rows], locale);
  }

  /** CSV leva todos os técnicos (ignora o filtro rápido), na ordem atual. */
  function sortedTechsAll(): ReportsTechnician[] {
    if (techFilter === "all") return sortedTechs;
    const ids = new Set(sortedTechs.map((t) => t.id));
    return [...sortedTechs, ...technicians.filter((t) => !ids.has(t.id))];
  }

  function exportActivities() {
    const hu = p.thHHUnidade;
    const hm = p.thHHMetro;
    const header: CsvCell[] = [
      p.thAtividade,
      p.csvCodigo,
      p.thFamiliaCabo,
      p.csvCodigoFamilia,
      p.csvUnidade,
      p.csvExecUsadas,
      p.csvExecTotal,
      p.exSemApontamento,
      p.exParcialBloqueada,
      p.exSemQuantidade,
      p.colAmostraSuficiente,
      `${hu} (${p.csvMediana})`,
      `${hu} (P25)`,
      `${hu} (P75)`,
      `${hu} (${p.csvMedia})`,
      `${hu} (${p.csvDesvio})`,
      `${hu} (${p.csvCV})`,
      `${hm} (${p.csvMediana})`,
      `${hm} (P25)`,
      `${hm} (P75)`,
      p.csvMetrosTotais,
      p.quantidadeTotal,
      `${p.thHHMediano} (${p.csvMediana})`,
      p.csvDuracao,
      p.thEquipe,
    ];
    // Todas as linhas, sem busca/filtro/paginação (critério 15), na ordem padrão.
    const all = [...activityRows].sort(
      (a, b) => Number(b.sufficient_sample) - Number(a.sufficient_sample) || b.executions_used - a.executions_used
    );
    const rows: CsvCell[][] = all.map((a) => {
      const ok = a.sufficient_sample;
      return [
        a.activity_name,
        a.activity_code,
        a.cable_family_name ?? "",
        a.cable_family_code ?? "",
        a.unit,
        a.executions_used,
        a.executions_total,
        a.excluded.untracked,
        a.excluded.partial_or_blocked,
        a.excluded.no_quantity,
        ok ? p.sim : p.nao,
        ok && a.hh_per_unit?.median != null ? fmtDur(a.hh_per_unit?.median) : null,
        ok && a.hh_per_unit?.p25 != null ? fmtDur(a.hh_per_unit?.p25) : null,
        ok && a.hh_per_unit?.p75 != null ? fmtDur(a.hh_per_unit?.p75) : null,
        ok && a.hh_per_unit?.mean != null ? fmtDur(a.hh_per_unit?.mean) : null,
        ok && a.hh_per_unit?.std_dev != null ? fmtDur(a.hh_per_unit?.std_dev) : null,
        ok ? a.hh_per_unit?.cv_pct : null,
        ok && a.hh_per_meter?.median != null ? fmtDur(a.hh_per_meter?.median) : null,
        ok && a.hh_per_meter?.p25 != null ? fmtDur(a.hh_per_meter?.p25) : null,
        ok && a.hh_per_meter?.p75 != null ? fmtDur(a.hh_per_meter?.p75) : null,
        ok ? a.hh_per_meter?.total_meters : null,
        a.total_quantity,
        a.median_man_hours == null ? null : fmtDur(a.median_man_hours),
        a.median_duration_hours == null ? null : fmtDur(a.median_duration_hours),
        a.avg_crew_size,
      ];
    });
    downloadCsv(`${p.csvAtividades}_${csvSuffix}.csv`, [header, ...rows], locale);
  }

  function exportUnproductive() {
    const header: CsvCell[] = [p.csvCategoria, p.csvMotivo, p.csvHoras, p.csvPctJornada];
    const rows: CsvCell[][] = reasons.map((r) => [
      r.category === "external" ? p.catExterno : p.catInterno,
      statusLabel(r),
      r.hours,
      journeyTotal > 0 ? Math.round((r.hours / journeyTotal) * 1000) / 10 : null,
    ]);
    downloadCsv(`${p.csvImprodutivo}_${csvSuffix}.csv`, [header, ...rows], locale);
  }

  // --- Estados de carregamento -------------------------------------------
  const firstLoad = loading && !data;
  const refreshing = loading && !!data;
  const periodDim = refreshing && refreshScope !== "today";
  const todayDim = refreshing && refreshScope !== "period";
  const fatalError = !data && !loading && !!loadError;
  const rangeDays = daysInclusive(range.start, range.end);
  const activePreset = range.end === todayIso ? PERIOD_PRESETS.find((d) => d === rangeDays) : undefined;

  // --- Renderizadores ----------------------------------------------------
  const empty = (title?: string) => (
    <span className="rpt-empty-val" title={title}>
      —
    </span>
  );

  function renderUtilization(pct: number | null, band: UtilizationBand | null | undefined, compact = false) {
    if (pct == null) return <span className="rpt-no-journey">{p.semJornada}</span>;
    const b = bandFor(pct, band) ?? "normal";
    return (
      <div className="rpt-util-cell">
        <div className="rpt-util-bar">
          <div className={`rpt-util-fill rpt-util-fill--${b}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </div>
        <span className="rpt-util-pct">{pct}%</span>
        {!compact && b === "low" && (
          <span className="rpt-band rpt-band--low">
            <Icon name="error" style={{ fontSize: 12 }} />
            {p.faixaBaixa}
          </span>
        )}
        {!compact && b === "attention" && <span className="rpt-band rpt-band--attention">{p.faixaAtencao}</span>}
        {!compact && b === "suspect" && (
          <span className="rpt-band rpt-band--suspect">
            <Icon name="warning" style={{ fontSize: 12 }} />
            {p.dadoSuspeito}
          </span>
        )}
      </div>
    );
  }

  function Kpi({
    label,
    value,
    valueClass,
    hint,
    bar,
    marker,
    icon,
  }: {
    label: string;
    value: ReactNode;
    valueClass?: string;
    hint?: ReactNode;
    bar?: { pct: number; className: string };
    marker?: "external" | "internal";
    icon?: string;
  }) {
    return (
      <div className="rpt-kpi-card">
        <div className="rpt-kpi-top">
          <span className="rpt-kpi-label">
            {marker && <span className={`rpt-cat rpt-cat--${marker}`} aria-hidden="true" />}
            {label}
          </span>
        </div>
        <div className={`rpt-kpi-value${valueClass ? ` ${valueClass}` : ""}`}>
          {icon && <Icon name={icon} style={{ fontSize: 20 }} />}
          {value}
        </div>
        {bar && (
          <div className="rpt-kpi-bar">
            <div className={`rpt-kpi-bar-fill ${bar.className}`} style={{ width: `${Math.min(100, Math.max(0, bar.pct))}%` }} />
          </div>
        )}
        {hint && <div className="rpt-kpi-hint">{hint}</div>}
      </div>
    );
  }

  const skeletonKpis = (n: number, cls: string) => (
    <div className={`stat-grid rpt-kpi-grid ${cls}`}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rpt-skeleton rpt-skeleton-kpi" />
      ))}
    </div>
  );

  const skeletonCard = (
    <div className="ops-pool-card rpt-card">
      <div className="ops-card-head">
        <div className="rpt-skeleton" style={{ width: 180, height: 14 }} />
      </div>
      <div style={{ padding: 12 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rpt-skeleton rpt-skeleton-row" />
        ))}
      </div>
    </div>
  );

  // ---------------------------------------------------------------------
  // Seção HOJE
  // ---------------------------------------------------------------------
  function renderTodaySection() {
    const n = today?.technicians_checked_in ?? 0;
    const avg = today?.productive_hours_avg_per_tech ?? null;
    const overLimit = today?.technicians_over_idle_limit ?? 0;
    return (
      <section className={`rpt-section${todayDim ? " rpt-is-refreshing" : ""}`} aria-busy={firstLoad || todayDim}>
        <div className="rpt-section-head">
          <div className="rpt-section-heading">
            <h2 className="rpt-section-title">
              <Icon name="today" style={{ fontSize: 18 }} />
              {p.secHoje(todayLabel)}
            </h2>
            <span className="rpt-section-scope">{p.escopoHoje}</span>
            {todayDim && (
              <span className="rpt-refreshing">
                <Icon name="progress_activity" style={{ fontSize: 14 }} />
                {p.atualizando}
              </span>
            )}
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={refreshToday} disabled={loading}>
            <Icon name="refresh" style={{ fontSize: 16 }} />
            {p.atualizar}
          </button>
        </div>

        {firstLoad ? (
          <>
            {skeletonKpis(4, "rpt-kpi-grid--today")}
            {skeletonCard}
          </>
        ) : (
          <>
            <div className="stat-grid rpt-kpi-grid rpt-kpi-grid--today">
              <Kpi label={p.kpiCheckin} value={n} hint={n === 0 ? p.nenhumCheckinHoje : undefined} />
              <Kpi
                label={p.kpiProdMedio}
                value={avg == null ? empty(p.nenhumCheckinHoje) : p.deMeta(formatDuration(avg), formatDuration(todayTarget))}
                valueClass={avg == null ? "rpt-kpi-value--empty" : "rpt-kpi-value--sm"}
                bar={avg == null ? undefined : { pct: (avg / todayTarget) * 100, className: "rpt-fill--active" }}
                hint={avg == null ? p.nenhumCheckinHoje : p.pctMeta(Math.round((avg / todayTarget) * 100))}
              />
              <Kpi
                label={p.kpiExternoHoje}
                marker="external"
                value={n === 0 ? empty(p.nenhumCheckinHoje) : formatDuration(today?.external_block_hours ?? 0)}
                valueClass={n === 0 ? "rpt-kpi-value--empty" : undefined}
                hint={n === 0 ? p.nenhumCheckinHoje : undefined}
              />
              <Kpi
                label={p.kpiInternoHoje}
                marker="internal"
                value={n === 0 ? empty(p.nenhumCheckinHoje) : formatDuration(today?.internal_idle_hours ?? 0)}
                valueClass={n === 0 ? "rpt-kpi-value--empty" : undefined}
                hint={
                  n === 0 ? (
                    p.nenhumCheckinHoje
                  ) : overLimit > 0 ? (
                    <span className="rpt-hint-alert">
                      <Icon name="warning" style={{ fontSize: 13 }} />
                      {p.acimaLimite(overLimit, formatDuration(todayIdleLimitHours))}
                    </span>
                  ) : (
                    p.limiteOcioso(formatDuration(todayIdleLimitHours))
                  )
                }
              />
            </div>

            <div className="rpt-today-grid">
              <div className="ops-pool-card rpt-card">
                <div className="ops-card-head">
                  <div>
                    <div className="ops-card-title">{p.cardDiaTecnico}</div>
                    <div className="ops-card-hint">{p.ordemOcioso}</div>
                  </div>
                </div>
                <div className="rpt-legend">
                  <span><span className="rpt-cat rpt-cat--active" />{p.segExecucao}</span>
                  <span><span className="rpt-cat rpt-cat--external" />{p.catExterno}</span>
                  <span><span className="rpt-cat rpt-cat--internal" />{p.catInterno}</span>
                  <span><span className="rpt-cat rpt-cat--break" />{p.segIntervalos}</span>
                </div>
                <div className="rpt-today-list">
                  {todaySorted.map((t) => {
                    const sum = t.active_hours + t.external_block_hours + t.internal_idle_hours + t.break_hours;
                    const base = Math.max(t.journey_hours, sum, 0.01);
                    const seg = (h: number) => `${(h / base) * 100}%`;
                    const ac = avatarColor(t.id);
                    return (
                      <div key={t.id} className="rpt-today-row">
                        <div className="rpt-today-header">
                          <div className="rpt-today-avatar" style={{ background: ac.bg, color: ac.color }}>
                            {initials(t.name)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div className="rpt-today-name">{t.name}</div>
                            {t.site_name && t.site_name !== "—" && (
                              <div className="rpt-today-sub">{t.site_name.split(",").map((s) => s.trim()).join(" · ")}</div>
                            )}
                          </div>
                          <div className="rpt-today-right">
                            {t.idle_limit_exceeded && (
                              <Tip
                                content={p.ociosoHojeLimite(formatDuration(t.internal_idle_hours), formatDuration(todayIdleLimitHours))}
                                label={p.ociosoAcimaLimite}
                              >
                                <span className="rpt-band rpt-band--low">
                                  <Icon name="warning" style={{ fontSize: 12 }} />
                                  {p.ociosoAcimaLimite}
                                </span>
                              </Tip>
                            )}
                            <span className="rpt-today-target">
                              {formatDuration(t.active_hours)}/{formatDuration(todayTarget)}
                            </span>
                          </div>
                        </div>
                        <div className="rpt-today-bar" role="img" aria-label={`${p.segExecucao} ${formatDuration(t.active_hours)}, ${p.catExterno} ${formatDuration(t.external_block_hours)}, ${p.catInterno} ${formatDuration(t.internal_idle_hours)}, ${p.segIntervalos} ${formatDuration(t.break_hours)}`}>
                          <div className="rpt-seg rpt-cat--active" style={{ width: seg(t.active_hours) }} title={`${p.segExecucao}: ${formatDuration(t.active_hours)}`} />
                          <div className="rpt-seg rpt-cat--external" style={{ width: seg(t.external_block_hours) }} title={`${p.catExterno}: ${formatDuration(t.external_block_hours)}`} />
                          <div className="rpt-seg rpt-cat--internal" style={{ width: seg(t.internal_idle_hours) }} title={`${p.catInterno}: ${formatDuration(t.internal_idle_hours)}`} />
                          <div className="rpt-seg rpt-cat--break" style={{ width: seg(t.break_hours) }} title={`${p.segIntervalos}: ${formatDuration(t.break_hours)}`} />
                        </div>
                        <div className="rpt-today-metrics">
                          <span className="rpt-today-metric">{p.segExecucao} <span className="rpt-today-metric-val">{formatDuration(t.active_hours)}</span></span>
                          <span className="rpt-today-metric">{p.thExterno} <span className="rpt-today-metric-val">{formatDuration(t.external_block_hours)}</span></span>
                          <span className="rpt-today-metric">{p.thInterno} <span className="rpt-today-metric-val">{formatDuration(t.internal_idle_hours)}</span></span>
                          <span className="rpt-today-metric">{p.segIntervalos} <span className="rpt-today-metric-val">{formatDuration(t.break_hours)}</span></span>
                        </div>
                      </div>
                    );
                  })}
                  {todaySorted.length === 0 && (
                    <div className="table-empty rpt-empty-block">
                      <Icon name="event_busy" style={{ fontSize: 22 }} />
                      <div>{p.nenhumCheckinHoje}</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="ops-pool-card rpt-card">
                <div className="ops-card-head">
                  <div className="ops-card-title">{p.cardLog}</div>
                  <div className="ops-card-hint">{p.nEventos(logEntries.length)}</div>
                </div>
                <div className="log-filter-row">
                  {(["all", ...LOG_TYPES] as (ReportsLogType | "all")[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`log-filter-chip${logFilter === f ? " active" : ""}`}
                      aria-pressed={logFilter === f}
                      onClick={() => setLogFilter(f)}
                    >
                      {f === "all" ? p.logTodos : p.logLabel[f]}
                      {f !== "all" && <span className="log-filter-count">{logCounts[f]}</span>}
                    </button>
                  ))}
                </div>
                <div className="log-feed rpt-log-feed">
                  {filteredLog.map((e, idx) => {
                    const type = normalizeLogType(e.type);
                    return (
                      <div key={`${e.at}-${idx}`} className="log-item">
                        <span className={`log-dot rpt-logdot-${type}`} />
                        <div className="log-time">{formatBrazilClock(e.at, locale)}</div>
                        <div className="log-text">
                          <strong>{e.name}</strong> {e.text}{" "}
                          <span className={`log-tag rpt-logtag-${type}`}>
                            <Icon name={LOG_ICONS[type]} style={{ fontSize: 11 }} />
                            {p.logLabel[type]}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {filteredLog.length === 0 && (
                    <div className="table-empty rpt-empty-block">{logFilter !== "all" ? p.nenhumEventoTipo : p.nenhumEvento}</div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    );
  }

  // ---------------------------------------------------------------------
  // Seção PERÍODO
  // ---------------------------------------------------------------------
  function renderExceptions() {
    if (!stats) return null;
    if (periodEmpty) {
      return (
        <div className="rpt-exceptions">
          <span className="rpt-exceptions-title">{p.requerAtencao}</span>
          <span className="rpt-exceptions-ok">{p.semExcecoesAvaliar}</span>
        </div>
      );
    }
    const items: { key: TechFilter; cls: string; icon: string; count: number; label: string }[] = [];
    if (filterCounts.low > 0) items.push({ key: "low", cls: "rpt-exception--low", icon: "error", count: filterCounts.low, label: p.excUtilBaixa });
    if (filterCounts.suspect > 0) items.push({ key: "suspect", cls: "rpt-exception--suspect", icon: "warning", count: filterCounts.suspect, label: p.excSuspeito });
    if (filterCounts.idle > 0) items.push({ key: "idle", cls: "rpt-exception--low", icon: "hourglass_empty", count: filterCounts.idle, label: p.excOcioso(idleLimitLabel) });
    if (filterCounts.incomplete > 0)
      items.push({ key: "incomplete", cls: "rpt-exception--attention", icon: "event_busy", count: filterCounts.incomplete, label: p.excIncompletos(filterCounts.incomplete, stats.incomplete_days).replace(/^\d+\s/, "") });
    const trackingLow = stats.tracking_rate_pct != null && stats.tracking_rate_pct < TRACKING_TARGET_PCT;
    if (trackingLow || filterCounts.tracking > 0)
      items.push({
        key: "tracking",
        cls: "rpt-exception--attention",
        icon: "warning",
        count: -1,
        label: p.excRastreamento(stats.tracking_rate_pct == null ? "—" : `${stats.tracking_rate_pct}%`, filterCounts.tracking),
      });
    return (
      <div className="rpt-exceptions">
        <span className="rpt-exceptions-title">{p.requerAtencao}</span>
        {items.length === 0 ? (
          <span className="rpt-exceptions-ok">
            <Icon name="check_circle" style={{ fontSize: 15 }} />
            {p.semExcecoes}
          </span>
        ) : (
          items.map((it) => (
            <button
              key={it.key}
              type="button"
              className={`rpt-exception ${it.cls}${techFilter === it.key ? " active" : ""}`}
              onClick={() => selectTechFilter(it.key, true)}
              disabled={it.key === "tracking" && filterCounts.tracking === 0}
            >
              <Icon name={it.icon} style={{ fontSize: 15 }} />
              {it.count >= 0 && <span className="rpt-exception-count">{it.count}</span>}
              {it.label}
            </button>
          ))
        )}
      </div>
    );
  }

  function renderPeriodKpis() {
    if (!stats) return null;
    const noData = periodEmpty;
    const utilBand = bandFor(stats.utilization_pct, stats.utilization_band);
    const utilClass =
      stats.utilization_pct == null || noData
        ? "rpt-kpi-value--empty"
        : utilBand === "low"
          ? "rpt-kpi-value--low"
          : utilBand === "attention"
            ? "rpt-kpi-value--attention"
            : utilBand === "suspect"
              ? "rpt-kpi-value--suspect"
              : undefined;
    const pctOfJourney = (h: number) => p.pctJornada(fmtPct((h / journeyTotal) * 100));
    const trackingLow = stats.tracking_rate_pct != null && stats.tracking_rate_pct < TRACKING_TARGET_PCT;
    const untracked = stats.period_completed_count - stats.tracked_completed_count;
    return (
      <div className="stat-grid rpt-kpi-grid">
        <Kpi
          label={p.kpiUtilizacao}
          value={stats.utilization_pct == null || noData ? empty() : `${stats.utilization_pct}%`}
          valueClass={utilClass}
          icon={!noData && utilBand === "suspect" ? "warning" : !noData && utilBand === "low" ? "error" : undefined}
          bar={stats.utilization_pct == null || noData ? undefined : { pct: stats.utilization_pct, className: `rpt-util-fill--${utilBand ?? "normal"}` }}
          hint={
            noData
              ? p.semDadosPeriodo
              : stats.utilization_pct == null
                ? p.semCheckinPeriodo
                : utilBand === "suspect"
                  ? `${p.dadoSuspeito} · ${p.hintUtilizacao(fmtH(stats.productive_hours_total), fmtH(journeyTotal))}`
                  : p.hintUtilizacao(fmtH(stats.productive_hours_total), fmtH(journeyTotal))
          }
        />
        <Kpi
          label={p.kpiHH}
          value={noData || stats.tracked_completed_count === 0 ? empty() : fmtHH(stats.man_hours_total)}
          valueClass={noData || stats.tracked_completed_count === 0 ? "rpt-kpi-value--empty" : undefined}
          hint={noData ? p.semDadosPeriodo : stats.tracked_completed_count === 0 ? p.nenhumaRastreada : p.hintHH(stats.tracked_completed_count)}
        />
        <Kpi
          label={p.kpiExterno}
          marker="external"
          value={noData || journeyTotal === 0 ? empty() : fmtH(stats.external_block_hours)}
          valueClass={noData || journeyTotal === 0 ? "rpt-kpi-value--empty" : undefined}
          hint={noData ? p.semDadosPeriodo : journeyTotal === 0 ? p.semCheckinPeriodo : pctOfJourney(stats.external_block_hours)}
        />
        <Kpi
          label={p.kpiInterno}
          marker="internal"
          value={noData || journeyTotal === 0 ? empty() : fmtH(stats.internal_idle_hours)}
          valueClass={noData || journeyTotal === 0 ? "rpt-kpi-value--empty" : undefined}
          hint={
            noData ? (
              p.semDadosPeriodo
            ) : journeyTotal === 0 ? (
              p.semCheckinPeriodo
            ) : (
              <>
                {pctOfJourney(stats.internal_idle_hours)}
                <br />
                {stats.technicians_over_idle_limit > 0 ? (
                  <button type="button" className="rpt-link rpt-hint-alert" onClick={() => selectTechFilter("idle", true)}>
                    <Icon name="warning" style={{ fontSize: 13 }} />
                    {p.acimaLimite(stats.technicians_over_idle_limit, idleLimitLabel)}
                  </button>
                ) : (
                  p.limiteOcioso(idleLimitLabel)
                )}
              </>
            )
          }
        />
        <Kpi
          label={p.kpiRastreamento}
          value={noData || stats.tracking_rate_pct == null ? empty() : `${stats.tracking_rate_pct}%`}
          valueClass={noData || stats.tracking_rate_pct == null ? "rpt-kpi-value--empty" : trackingLow ? "rpt-kpi-value--attention" : undefined}
          icon={!noData && trackingLow ? "warning" : undefined}
          hint={
            noData
              ? p.semDadosPeriodo
              : stats.tracking_rate_pct == null
                ? p.nenhumaConcluida
                : trackingLow
                  ? `${p.abaixoMeta90} · ${p.hintRastreamento(stats.tracked_completed_count, stats.period_completed_count)}`
                  : p.hintRastreamento(stats.tracked_completed_count, stats.period_completed_count)
          }
        />
        <Kpi
          label={p.kpiConcluidas}
          value={noData ? empty() : stats.period_completed_count}
          valueClass={noData ? "rpt-kpi-value--empty" : undefined}
          hint={noData ? p.semDadosPeriodo : untracked > 0 ? p.hintSemApontamento(untracked) : stats.period_completed_count > 0 ? p.hintTodasRastreadas : undefined}
        />
      </div>
    );
  }

  const filterLabels: Record<TechFilter, string> = {
    all: p.filtroTodos,
    low: p.filtroBaixa,
    suspect: p.filtroSuspeito,
    idle: p.filtroOcioso,
    incomplete: p.filtroIncompletos,
    tracking: p.filtroRastreamento,
  };

  const ampliarButton =
    rangeDays < 90 ? (
      <button type="button" className="btn btn-outline btn-sm" onClick={() => applyPreset(90)}>
        {p.ampliar90}
      </button>
    ) : null;

  function renderTechTable() {
    if (!stats) return null;
    const sh = (label: string, key: TechSortKey, tip?: string, firstDir: SortDir = "desc", align: "left" | "right" = "right", extra?: string) => (
      <SortHeader<TechSortKey>
        label={label}
        sortKey={key}
        sort={techSort}
        onSort={setTechSort}
        tip={tip}
        firstDir={firstDir}
        align={align}
        className={extra}
        defaultLabel={key === "utilization" && !techSort ? p.ordemExcecoes : undefined}
      />
    );
    const untrackedTotal = stats.period_completed_count - stats.tracked_completed_count;
    return (
      <div className="ops-pool-card rpt-card" ref={techTableRef} style={{ scrollMarginTop: 16 }}>
        <div className="ops-card-head rpt-card-head-wrap">
          <div>
            <div className="ops-card-title">{p.cardTecnicos}</div>
            <div className="ops-card-hint">
              {techFilter === "all" ? (
                p.nTecnicos(technicians.length)
              ) : (
                <>
                  {p.filtroAtivo(sortedTechs.length, technicians.length, filterLabels[techFilter])}{" "}
                  <button type="button" className="rpt-link" onClick={() => setTechFilter("all")}>
                    {p.limparFiltro}
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="rpt-card-tools">
            <div className="rpt-chips" role="group" aria-label={p.cardTecnicos}>
              {(["all", "low", "suspect", "idle", "incomplete", "tracking"] as TechFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`log-filter-chip${techFilter === f ? " active" : ""}`}
                  aria-pressed={techFilter === f}
                  disabled={f !== "all" && filterCounts[f] === 0}
                  onClick={() => setTechFilter(f)}
                >
                  {filterLabels[f]}
                  {f !== "all" && <span className="log-filter-count">{filterCounts[f]}</span>}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={exportTechnicians} disabled={technicians.length === 0}>
              <Icon name="download" style={{ fontSize: 16 }} />
              {p.exportarCsv}
            </button>
          </div>
        </div>
        <div className="table-wrap rpt-scroll">
          <table className="table rpt-table-dense">
            <thead>
              <tr>
                {sh(p.thTecnico, "name", undefined, "asc", "left", "rpt-sticky-col")}
                {sh(p.thUtilizacao, "utilization", p.tipUtilizacao, "asc", "left")}
                {sh(p.thHorasExec, "productive_hours", p.tipHorasExec)}
                {sh(p.thJornada, "journey_hours", p.tipJornada)}
                {sh(p.thHH, "man_hours", p.tipHH)}
                {sh(p.thExterno, "external_block_hours", p.tipExterno)}
                {sh(p.thInterno, "internal_idle_hours", p.tipInterno)}
                {sh(p.thConcluidas, "completed_count")}
                {sh(p.thRastreamento, "tracking_rate_pct", p.tipRastreamento)}
                {sh(p.thDiasIncompletos, "incomplete_days", p.tipIncompletos)}
              </tr>
            </thead>
            <tbody>
              {techSlice.map((t) => {
                const ac = avatarColor(t.id);
                const hasJourney = t.journey_hours > 0;
                const sitesLine = t.site_name && t.site_name !== "—" ? t.site_name.split(",").map((s) => s.trim()).filter(Boolean).join(" · ") : "";
                const trackingLow = t.tracking_rate_pct != null && t.tracking_rate_pct < TRACKING_TARGET_PCT;
                return (
                  <tr key={t.id}>
                    <td className="rpt-sticky-col">
                      <div className="rpt-tech-cell">
                        <div className="rpt-avatar" style={{ background: ac.bg, color: ac.color }}>
                          {initials(t.name)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div className="rpt-tech-name">{t.name}</div>
                          {sitesLine && <div className="rpt-num-sub">{sitesLine}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{renderUtilization(t.utilization_pct, t.utilization_band)}</td>
                    <td className="rpt-num">{fmtDur(t.productive_hours)}</td>
                    <td className="rpt-num">{hasJourney ? fmtDur(t.journey_hours) : empty(p.semCheckinPeriodo)}</td>
                    <td className="rpt-num">{fmtDur(t.man_hours)}</td>
                    <td className="rpt-num">
                      {hasJourney ? (
                        <span className="rpt-val-marker">
                          <span className="rpt-cat rpt-cat--external" aria-hidden="true" />
                          {fmtDur(t.external_block_hours)}
                        </span>
                      ) : (
                        empty(p.semCheckinPeriodo)
                      )}
                    </td>
                    <td className="rpt-num">
                      {!hasJourney ? (
                        empty(p.semCheckinPeriodo)
                      ) : t.idle_limit_exceeded ? (
                        <Tip
                          content={p.mediaDia(formatDuration(t.internal_idle_avg_per_day ?? 0), idleLimitLabel)}
                          label={p.ociosoAcimaLimite}
                        >
                          <span className="rpt-band rpt-band--low">
                            <Icon name="warning" style={{ fontSize: 12 }} />
                            {fmtDur(t.internal_idle_hours)}
                          </span>
                        </Tip>
                      ) : (
                        <span className="rpt-val-marker">
                          <span className="rpt-cat rpt-cat--internal" aria-hidden="true" />
                          {fmtDur(t.internal_idle_hours)}
                        </span>
                      )}
                    </td>
                    <td className="rpt-num">
                      {t.completed_count}
                      {t.untracked_count > 0 && (
                        <>
                          {" · "}
                          <Tip content={p.semApontTip(t.untracked_count)} label={p.semApontTip(t.untracked_count)}>
                            <span className="rpt-muted">{p.semApontAbrev(t.untracked_count)}</span>
                          </Tip>
                        </>
                      )}
                    </td>
                    <td className="rpt-num">
                      {t.tracking_rate_pct == null ? (
                        empty(p.nenhumaConcluida)
                      ) : (
                        <span className="rpt-warn-inline">
                          {trackingLow && <Icon name="warning" style={{ fontSize: 14 }} />}
                          {t.tracking_rate_pct}%
                        </span>
                      )}
                    </td>
                    <td className="rpt-num">
                      {t.incomplete_days > 0 ? (
                        <span className="rpt-warn-inline">
                          <Icon name="event_busy" style={{ fontSize: 14 }} />
                          {t.incomplete_days}
                        </span>
                      ) : (
                        <span className="rpt-zero">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {technicians.length > 0 && (
              <tfoot>
                <tr className="rpt-total-row">
                  <td className="rpt-sticky-col">{p.total(technicians.length)}</td>
                  <td>{renderUtilization(stats.utilization_pct, stats.utilization_band, true)}</td>
                  <td className="rpt-num">{fmtDur(stats.productive_hours_total)}</td>
                  <td className="rpt-num">{journeyTotal > 0 ? fmtDur(journeyTotal) : empty()}</td>
                  <td className="rpt-num">{fmtDur(stats.man_hours_total)}</td>
                  <td className="rpt-num">{journeyTotal > 0 ? fmtDur(stats.external_block_hours) : empty()}</td>
                  <td className="rpt-num">{journeyTotal > 0 ? fmtDur(stats.internal_idle_hours) : empty()}</td>
                  <td className="rpt-num" title={p.tipConcluidasTotal}>
                    {stats.period_completed_count}
                    {untrackedTotal > 0 && <span className="rpt-muted"> · {p.semApontAbrev(untrackedTotal)}</span>}
                  </td>
                  <td className="rpt-num">{stats.tracking_rate_pct == null ? empty() : `${stats.tracking_rate_pct}%`}</td>
                  <td className="rpt-num">{stats.incomplete_days}</td>
                </tr>
              </tfoot>
            )}
          </table>
          {technicians.length === 0 && (
            <div className="table-empty rpt-empty-block">
              <Icon name="event_note" style={{ fontSize: 22 }} />
              <div>{p.nenhumaAtividadeNoPeriodo}</div>
              {ampliarButton}
            </div>
          )}
          {technicians.length > 0 && sortedTechs.length === 0 && (
            <div className="table-empty rpt-empty-block">
              <div>{p.nenhumTecnicoFiltro}</div>
              <button type="button" className="rpt-link" onClick={() => setTechFilter("all")}>
                {p.limparFiltro}
              </button>
            </div>
          )}
        </div>
        {techPaged && (
          <Pagination page={techPage} pageSize={TECH_PAGE_SIZE} total={sortedTechs.length} onPageChange={setTechPage} onPageSizeChange={() => undefined} />
        )}
      </div>
    );
  }

  function exportStatusHours() {
    const cats = data?.status_categories ?? [];
    const catText = (c: string) => (c === "productive" ? p.catProdutivo : c === "unproductive" ? p.catImprodutivoStatus : p.catNeutro);
    const header: CsvCell[] = [
      p.thTecnico,
      ...cats.map((c) => `${presenceLabel(c.status, locale)} (${catText(c.category)})`),
    ];
    const rows: CsvCell[][] = sortedTechsAll().map((t) => [t.name, ...cats.map((c) => fmtDur(t.status_hours?.[c.status] ?? 0))]);
    rows.push([
      p.totalLabel,
      ...cats.map((c) => fmtDur(technicians.reduce((sum, t) => sum + (t.status_hours?.[c.status] ?? 0), 0))),
    ]);
    downloadCsv(`${p.csvStatusHoras}_${csvSuffix}.csv`, [header, ...rows], locale);
  }

  function renderStatusHours() {
    if (!stats) return null;
    const cats = data?.status_categories ?? [];
    const catText = (c: string) => (c === "productive" ? p.catProdutivo : c === "unproductive" ? p.catImprodutivoStatus : p.catNeutro);
    const catColor = (c: string) => (c === "productive" ? "var(--green)" : c === "unproductive" ? "var(--red)" : "var(--text-muted)");
    const groups = (["productive", "unproductive", "neutral"] as const)
      .map((cat) => ({ cat, items: cats.filter((c) => c.category === cat) }))
      .filter((g) => g.items.length > 0);
    const rowsTechs = sortedTechsAll();
    const hoursOf = (t: ReportsTechnician, status: string) => t.status_hours?.[status] ?? 0;
    const cell = (hours: number) => (hours > 0 ? fmtDur(hours) : <span className="rpt-cell-muted">—</span>);
    return (
      <div className="ops-pool-card rpt-card">
        <div className="ops-card-head rpt-card-head-wrap">
          <div>
            <div className="ops-card-title">{p.cardStatusHoras}</div>
            <div className="ops-card-hint">{p.hintStatusHoras}</div>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={exportStatusHours} disabled={rowsTechs.length === 0}>
            <Icon name="download" style={{ fontSize: 16 }} />
            {p.exportarCsv}
          </button>
        </div>
        {rowsTechs.length === 0 ? (
          <div className="table-empty rpt-empty-block">{p.semImprodutivo}</div>
        ) : (
          <div className="table-wrap rpt-scroll">
            <table className="table rpt-table-dense">
              <thead>
                <tr className="rpt-th-group">
                  <th className="rpt-sticky-col" />
                  {groups.map((g) => (
                    <th key={g.cat} colSpan={g.items.length} style={{ color: catColor(g.cat), textAlign: "center" }}>
                      <span className={`rpt-cat rpt-cat--${g.cat === "productive" ? "internal" : g.cat === "unproductive" ? "external" : "neutral"}`} aria-hidden="true" style={{ background: catColor(g.cat) }} />
                      {" "}
                      {catText(g.cat)}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="rpt-sticky-col">{p.thTecnico}</th>
                  {groups.flatMap((g) =>
                    g.items.map((c) => (
                      <th key={c.status} className="rpt-num" style={{ borderTop: `2px solid ${catColor(g.cat)}` }}>
                        {presenceLabel(c.status, locale)}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {rowsTechs.map((t) => (
                  <tr key={t.id}>
                    <td className="rpt-sticky-col">
                      <div className="rpt-strong">{t.name}</div>
                    </td>
                    {groups.flatMap((g) =>
                      g.items.map((c) => (
                        <td key={c.status} className="rpt-num">
                          {cell(hoursOf(t, c.status))}
                        </td>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="rpt-sticky-col rpt-strong">{p.totalLabel}</td>
                  {groups.flatMap((g) =>
                    g.items.map((c) => (
                      <td key={c.status} className="rpt-num rpt-strong" style={{ color: catColor(g.cat) }}>
                        {fmtDur(rowsTechs.reduce((sum, t) => sum + hoursOf(t, c.status), 0))}
                      </td>
                    ))
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  }

  function exportExecutionData() {
    const [thTec, thData, thProj, thTarefa, thCod, thAtiv, thFam, thUn, thQtd, thHTec, thHTarefa, thCred, thTaxa, thSit, thMotivo] = p.dadosCols;
    const header: CsvCell[] = [thTec, thData, thProj, thTarefa, thCod, thAtiv, thFam, thUn, thQtd, thHTec, thHTarefa, thCred, thTaxa, thSit, thMotivo];
    const rows: CsvCell[][] = (data?.execution_rows ?? []).map((r) => [
      r.technician,
      r.date,
      r.project,
      r.task,
      r.activity_code,
      r.activity,
      r.cable_family,
      r.unit,
      r.task_quantity,
      r.technician_hours,
      r.task_hours,
      r.credited_quantity,
      r.rate_per_hour,
      r.included ? p.dadosIncluida : p.dadosDescartada,
      r.discard_reason,
    ]);
    downloadCsv(`${p.csvDados}_${csvSuffix}.csv`, [header, ...rows], locale);
  }

  function exportProduction() {
    const cols = productionColumns();
    const header: CsvCell[] = [p.thTecnico, ...cols.flatMap((c) => [c.label, `${c.label} (${c.rate})`])];
    const rows: CsvCell[][] = sortedTechsAll().map((t) => [
      t.name,
      ...cols.flatMap((c) => {
        const v = c.value(t);
        const h = t.production?.[c.code]?.hours ?? 0;
        return [v > 0 ? Math.round(v * 100) / 100 : 0, v > 0 && h > 0 ? Math.round((v / h) * 100) / 100 : null];
      }),
    ]);
    downloadCsv(`${p.csvProducao}_${csvSuffix}.csv`, [header, ...rows], locale);
  }

  function productionColumns() {
    const sumHours = (code: string) => technicians.reduce((s, t) => s + (t.production?.[code]?.hours ?? 0), 0);
    const defs = [
      { code: "CAB-RUN", label: p.prodMetrosLancados, unit: "m", pick: (x: { meters: number }) => x.meters },
      { code: "CAB-LABEL", label: p.prodLabels, unit: "un", pick: (x: { labels: number }) => x.labels },
      { code: "CAB-CUT", label: p.prodMetrosUtp, unit: "m", pick: (x: { meters_utp: number }) => x.meters_utp },
      { code: "CAB-CRIMP", label: p.prodConectoresRj, unit: "un", pick: (x: { quantity: number }) => x.quantity },
      { code: "CAB-PATCH", label: p.prodPatching, unit: "un", pick: (x: { quantity: number }) => x.quantity },
      { code: "CERTIFY", label: p.prodLinks, unit: "un", pick: (x: { quantity: number }) => x.quantity },
    ];
    return defs.map((d) => ({
      code: d.code,
      label: d.label,
      unit: d.unit,
      rate: `${d.unit}/h`,
      value: (t: ReportsTechnician) => {
        const row = t.production?.[d.code];
        return row ? d.pick(row as never) : 0;
      },
      total: () => technicians.reduce((s, t) => s + (t.production?.[d.code] ? d.pick(t.production[d.code] as never) : 0), 0),
      totalHours: () => sumHours(d.code),
    }));
  }

  function qualityRows() {
    return sortedTechsAll().filter((t) => (t.quality?.assignments ?? 0) > 0);
  }

  function exportQuality() {
    const header: CsvCell[] = [p.thTecnico, p.qConcluidas, p.qSemApont, p.qLote, p.qAbsurdo, p.qSobreposicao, p.qHHExec, p.qSuspeito];
    const rows: CsvCell[][] = qualityRows().map((t) => [
      t.name,
      t.quality?.assignments ?? 0,
      t.quality?.no_hours ?? 0,
      t.quality?.batch ?? 0,
      t.quality?.absurd ?? 0,
      t.overlap_hours ?? 0,
      t.quality?.hh_to_execution ?? null,
      t.quality?.suspect_pct ?? null,
    ]);
    downloadCsv(`${p.csvQualidade}_${csvSuffix}.csv`, [header, ...rows], locale);
  }

  function renderQuality() {
    if (!stats) return null;
    const rows = qualityRows();
    return (
      <div className="ops-pool-card rpt-card">
        <div className="ops-card-head rpt-card-head-wrap">
          <div>
            <div className="ops-card-title">{p.cardQualidade}</div>
            <div className="ops-card-hint">{p.hintQualidade}</div>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={exportQuality} disabled={rows.length === 0}>
            <Icon name="download" style={{ fontSize: 16 }} />
            {p.exportarCsv}
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="table-empty rpt-empty-block">{p.qSemDados}</div>
        ) : (
          <div className="table-wrap rpt-scroll">
            <table className="table rpt-table-dense">
              <thead>
                <tr>
                  <th className="rpt-sticky-col">{p.thTecnico}</th>
                  <th className="rpt-num">{p.qConcluidas}</th>
                  <th className="rpt-num">{p.qSemApont}</th>
                  <th className="rpt-num">{p.qLote}</th>
                  <th className="rpt-num">{p.qAbsurdo}</th>
                  <th className="rpt-num">{p.qSobreposicao}</th>
                  <th className="rpt-num">{p.qHHExec}</th>
                  <th className="rpt-num">{p.qSuspeito}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const q = t.quality!;
                  const ratioHigh = q.hh_to_execution !== null && q.hh_to_execution > 1.5;
                  const suspect = q.suspect_pct ?? 0;
                  const suspectColor = suspect >= 30 ? "var(--red)" : suspect >= 10 ? "var(--amber)" : "var(--green)";
                  const dash = <span className="rpt-cell-muted">—</span>;
                  return (
                    <tr key={t.id}>
                      <td className="rpt-sticky-col">
                        <div className="rpt-strong">{t.name}</div>
                      </td>
                      <td className="rpt-num">{q.assignments}</td>
                      <td className="rpt-num">{q.no_hours > 0 ? q.no_hours : dash}</td>
                      <td className="rpt-num">{q.batch > 0 ? q.batch : dash}</td>
                      <td className="rpt-num">{q.absurd > 0 ? q.absurd : dash}</td>
                      <td className="rpt-num">{(t.overlap_hours ?? 0) > 0 ? formatDuration(t.overlap_hours ?? 0) : dash}</td>
                      <td className="rpt-num" style={ratioHigh ? { color: "var(--red)", fontWeight: 600 } : undefined}>
                        {q.hh_to_execution !== null ? `${nf(q.hh_to_execution, 1)}×` : dash}
                      </td>
                      <td className="rpt-num" style={{ color: suspectColor, fontWeight: 600 }}>
                        {q.suspect_pct !== null ? `${nf(q.suspect_pct, 0)}%` : dash}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function renderProduction() {
    if (!stats) return null;
    const cols = productionColumns();
    const rowsTechs = sortedTechsAll();
    const anyProduction = cols.some((c) => c.total() > 0);
    return (
      <div className="ops-pool-card rpt-card">
        <div className="ops-card-head rpt-card-head-wrap">
          <div>
            <div className="ops-card-title">{p.cardProducao}</div>
            <div className="ops-card-hint">{p.hintProducao}</div>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={exportExecutionData} disabled={!(data?.execution_rows?.length)}>
            <Icon name="dataset" style={{ fontSize: 16 }} />
            {p.exportarDados}
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={exportProduction} disabled={!anyProduction}>
            <Icon name="download" style={{ fontSize: 16 }} />
            {p.exportarCsv}
          </button>
        </div>
        {rowsTechs.length === 0 || !anyProduction ? (
          <div className="table-empty rpt-empty-block">{p.semProducao}</div>
        ) : (
          <div className="table-wrap rpt-scroll">
            <table className="table rpt-table-dense">
              <thead>
                <tr>
                  <th className="rpt-sticky-col">{p.thTecnico}</th>
                  {cols.map((c) => (
                    <th key={c.code} className="rpt-num">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsTechs.map((t) => (
                  <tr key={t.id}>
                    <td className="rpt-sticky-col">
                      <div className="rpt-strong">{t.name}</div>
                    </td>
                    {cols.map((c) => {
                      const v = c.value(t);
                      const h = t.production?.[c.code]?.hours ?? 0;
                      return (
                        <td key={c.code} className="rpt-num">
                          {v > 0 ? (
                            <>
                              <div className="rpt-strong">{nf(v, v % 1 === 0 ? 0 : 1)} {c.unit}</div>
                              {h > 0 && <div className="rpt-num-sub">{nf(v / h, 1)} {c.rate}</div>}
                            </>
                          ) : (
                            <span className="rpt-cell-muted">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="rpt-sticky-col rpt-strong">{p.totalLabel}</td>
                  {cols.map((c) => {
                    const v = c.total();
                    const h = c.totalHours();
                    return (
                      <td key={c.code} className="rpt-num">
                        {v > 0 ? (
                          <>
                            <div className="rpt-strong">{nf(v, v % 1 === 0 ? 0 : 1)} {c.unit}</div>
                            {h > 0 && <div className="rpt-num-sub">{nf(v / h, 1)} {c.rate}</div>}
                          </>
                        ) : (
                          <span className="rpt-cell-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  }

  function renderUnproductive() {
    if (!stats) return null;
    const external = reasons.filter((r) => r.category === "external");
    const internal = reasons.filter((r) => r.category !== "external");
    const max = Math.max(0.0001, ...reasons.map((r) => r.hours));
    const noJourney = journeyTotal === 0;
    const showEmpty = periodEmpty || (noJourney && reasons.length === 0);
    const group = (cat: "external" | "internal", rows: ReportsUnproductiveReason[], total: number) => (
      <div className="rpt-reason-group">
        <div className="rpt-reason-group-head">
          <span className="rpt-reason-group-title">
            <span className={`rpt-cat rpt-cat--${cat}`} aria-hidden="true" />
            {cat === "external" ? p.catExterno : p.catInterno}
          </span>
          <span className="rpt-reason-group-total">
            {fmtH(total)}
            {!noJourney && ` · ${fmtPct((total / journeyTotal) * 100)}`}
          </span>
        </div>
        <div className="rpt-reason-group-desc">{cat === "external" ? p.descExterno : p.descInterno}</div>
        <div className="reason-bars rpt-reason-bars">
          {rows.map((r) => (
            <div key={r.status} className="reason-bar-row">
              <div className="reason-bar-label">{statusLabel(r)}</div>
              <div className="reason-bar-track">
                <div className={`reason-bar-fill rpt-cat--${cat}`} style={{ width: `${(r.hours / max) * 100}%` }} />
              </div>
              <div className="reason-bar-value">{fmtH(r.hours)}</div>
            </div>
          ))}
          {rows.length === 0 && <div className="rpt-reason-none">{p.nenhumNaCategoria}</div>}
        </div>
      </div>
    );
    return (
      <div className="ops-pool-card rpt-card">
        <div className="ops-card-head rpt-card-head-wrap">
          <div>
            <div className="ops-card-title">{p.cardImprodutivo}</div>
            <div className="ops-card-hint">{p.intervalosNeutros}</div>
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={exportUnproductive} disabled={reasons.length === 0}>
            <Icon name="download" style={{ fontSize: 16 }} />
            {p.exportarCsv}
          </button>
        </div>
        {showEmpty ? (
          <div className="table-empty rpt-empty-block">{p.semImprodutivo}</div>
        ) : (
          <div className="rpt-reason-groups">
            {group("external", external, stats.external_block_hours)}
            {group("internal", internal, stats.internal_idle_hours)}
          </div>
        )}
      </div>
    );
  }

  function renderActivityRow(a: ReportsActivityProductivity, idx: number) {
    const excludedTotal = a.excluded.untracked + a.excluded.partial_or_blocked + a.excluded.no_quantity + (a.excluded.implausible ?? 0);
    const u = a.unit ? unitLabel(a.unit) : "";
    const perUnit = u ? `/${u}` : "";
    const exclusionTip = (
      <div className="rpt-tip-table">
        <div className="rpt-tip-title">{p.exTitulo}</div>
        <div><span>{p.exUsadas}</span><strong>{a.executions_used}</strong></div>
        <div><span>{p.exExcluidas}</span><strong>{excludedTotal}</strong></div>
        {a.excluded.untracked > 0 && <div className="rpt-tip-indent"><span>{p.exSemApontamento}</span><strong>{a.excluded.untracked}</strong></div>}
        {a.excluded.partial_or_blocked > 0 && <div className="rpt-tip-indent"><span>{p.exParcialBloqueada}</span><strong>{a.excluded.partial_or_blocked}</strong></div>}
        {a.excluded.no_quantity > 0 && <div className="rpt-tip-indent"><span>{p.exSemQuantidade}</span><strong>{a.excluded.no_quantity}</strong></div>}
        {(a.excluded.implausible ?? 0) > 0 && <div className="rpt-tip-indent"><span>{p.exImplausivel}</span><strong>{a.excluded.implausible}</strong></div>}
        {a.total_quantity > 0 && (
          <div><span>{p.quantidadeTotal}</span><strong>{nf(a.total_quantity, a.total_quantity % 1 === 0 ? 0 : 1)} {u}</strong></div>
        )}
      </div>
    );
    const muted = !a.sufficient_sample;
    const info = (value: string | null) =>
      value == null ? (
        empty()
      ) : muted ? (
        <span className="rpt-cell-muted" title={p.amostraPequenaTip}>
          {value}*
        </span>
      ) : (
        value
      );
    const unitDist = a.hh_per_unit;
    const meterDist = a.hh_per_meter;
    return (
      <tr key={`${a.activity_code}-${a.cable_family_code ?? "none"}-${idx}`}>
        <td className="rpt-sticky-col">
          <div className="rpt-strong">{a.activity_name}</div>
          <div className="rpt-num-sub rpt-mono">{a.activity_code}</div>
        </td>
        <td>
          {a.cable_family_name || a.cable_family_code ? (
            <>
              <div>{a.cable_family_name ?? a.cable_family_code}</div>
              {a.cable_family_name && a.cable_family_code && <div className="rpt-num-sub rpt-mono">{a.cable_family_code}</div>}
            </>
          ) : (
            empty()
          )}
        </td>
        <td>{u || empty()}</td>
        <td className="rpt-num">
          <span className="rpt-val-marker">
            {a.executions_used} / {a.executions_total}
            {(excludedTotal > 0 || a.total_quantity > 0) && <Tip content={exclusionTip} label={p.exTitulo} />}
          </span>
        </td>
        {a.sufficient_sample ? (
          <>
            <td className="rpt-num">
              {unitDist ? (
                <>
                  <div className="rpt-strong">
                    {fmtDur(unitDist.median)}{perUnit}
                  </div>
                  <div className="rpt-num-sub">
                    {p.faixaP25P75(fmtDur(unitDist.p25), fmtDur(unitDist.p75))}
                  </div>
                </>
              ) : (
                empty()
              )}
            </td>
            <td className="rpt-num">
              {meterDist ? (
                <>
                  <div className="rpt-strong">
                    {fmtDur(meterDist.median)}/m
                  </div>
                  <div className="rpt-num-sub">
                    {p.faixaP25P75(fmtDur(meterDist.p25), fmtDur(meterDist.p75))}
                    {" · "}
                    {nf(meterDist.total_meters, 0)} m
                  </div>
                </>
              ) : (
                empty(p.semComprimento)
              )}
            </td>
            <td className="rpt-num">
              {unitDist ? (
                <>
                  <div className="rpt-strong" style={{ color: cvColor(unitDist.cv_pct) }}>
                    ± {fmtDur(unitDist.std_dev)}{perUnit}
                  </div>
                  <div className="rpt-num-sub">
                    {p.mediaCV(fmtDur(unitDist.mean), unitDist.cv_pct == null ? "—" : `${nf(unitDist.cv_pct, 0)}%`)}
                  </div>
                </>
              ) : (
                empty()
              )}
            </td>
          </>
        ) : (
          <td colSpan={3} className="rpt-num">
            <span className="rpt-insufficient">
              <Icon name="info" style={{ fontSize: 14 }} />
              {p.dadosInsuficientes(a.executions_used)}
            </span>
          </td>
        )}
        <td className="rpt-num">{info(a.median_man_hours == null ? null : fmtDur(a.median_man_hours))}</td>
        <td className="rpt-num">{info(a.median_duration_hours == null ? null : fmtDur(a.median_duration_hours))}</td>
        <td className="rpt-num">{info(a.avg_crew_size == null ? null : nf(a.avg_crew_size, 1))}</td>
      </tr>
    );
  }

  function renderActivities() {
    if (!stats) return null;
    const sh = (label: string, key: ActSortKey, tip?: string, firstDir: SortDir = "desc", align: "left" | "right" = "right", extra?: string) => (
      <SortHeader<ActSortKey> label={label} sortKey={key} sort={actSort} onSort={setActSort} tip={tip} firstDir={firstDir} align={align} className={extra} />
    );
    const q = actSearch.trim();
    return (
      <div className="ops-pool-card rpt-card">
        <div className="ops-card-head rpt-card-head-wrap">
          <div>
            <div className="ops-card-title">{p.cardAtividades}</div>
            <div className="ops-card-hint">{p.nCombinacoes(activityRows.length, actSufficientCount)}</div>
          </div>
          <div className="rpt-card-tools">
            <label className="rpt-search">
              <Icon name="search" style={{ fontSize: 16 }} />
              <input
                type="search"
                value={actSearch}
                placeholder={p.buscarAtividade}
                aria-label={p.buscarAtividade}
                onChange={(e) => setActSearch(e.target.value)}
              />
            </label>
            <label className="rpt-check">
              <input type="checkbox" checked={actOnlySufficient} onChange={(e) => setActOnlySufficient(e.target.checked)} />
              {p.soAmostraSuficiente}
            </label>
            <button type="button" className="btn btn-outline btn-sm" onClick={exportExecutionData} disabled={!(data?.execution_rows?.length)}>
              <Icon name="dataset" style={{ fontSize: 16 }} />
              {p.exportarDados}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={exportActivities} disabled={activityRows.length === 0}>
              <Icon name="download" style={{ fontSize: 16 }} />
              {p.exportarCsv}
            </button>
          </div>
        </div>
        {activityRows.length > 0 && actSufficientCount === 0 && (
          <div className="rpt-notice rpt-notice--info rpt-notice--inset">
            <Icon name="info" style={{ fontSize: 16 }} />
            <span>{p.nenhumaSuficiente}</span>
          </div>
        )}
        <div className="table-wrap rpt-scroll">
          <table className="table rpt-table-dense">
            <thead>
              <tr className="rpt-th-group">
                <th className="rpt-sticky-col" />
                <th colSpan={3} />
                <th colSpan={3}>{p.thGrupoReferencia}</th>
                <th colSpan={3}>{p.thGrupoExecucao}</th>
              </tr>
              <tr>
                {sh(p.thAtividade, "activity", undefined, "asc", "left", "rpt-sticky-col")}
                {sh(p.thFamiliaCabo, "family", undefined, "asc", "left")}
                <th>{p.thUnidade}</th>
                {sh(p.thExecucoesUsadas, "executions_used")}
                {sh(p.thHHUnidade, "hh_per_unit", p.tipHHUnidade, "asc")}
                {sh(p.thHHMetro, "hh_per_meter", undefined, "asc")}
                {sh(p.thVariacao, "hh_cv", p.tipVariacao, "asc")}
                {sh(p.thHHMediano, "median_man_hours", p.tipHHMediano)}
                {sh(p.thDuracao, "median_duration_hours", p.tipDuracao)}
                {sh(p.thEquipe, "avg_crew_size")}
              </tr>
            </thead>
            <tbody>{actSlice.map(renderActivityRow)}</tbody>
          </table>
          {activityRows.length === 0 && (
            <div className="table-empty rpt-empty-block">
              <Icon name="event_note" style={{ fontSize: 22 }} />
              <div>{p.nenhumaAtividadeNoPeriodo}</div>
              {ampliarButton}
            </div>
          )}
          {activityRows.length > 0 && actFiltered.length === 0 && (
            <div className="table-empty rpt-empty-block">
              <div>{q ? p.nenhumaAtividadeBusca(q) : p.nenhumaSuficiente}</div>
              {q && (
                <button type="button" className="rpt-link" onClick={() => setActSearch("")}>
                  {p.limparBusca}
                </button>
              )}
            </div>
          )}
        </div>
        {(activityRows.length > 0 || (data?.activity_excluded_no_catalog ?? 0) > 0) && (
          <div className="rpt-table-foot">
            {activityRows.length > 0 && (
              <div>{p.rodapeExclusoes(actExcludedTotals.untracked, actExcludedTotals.partial, actExcludedTotals.noQty)}</div>
            )}
            {(data?.activity_excluded_no_catalog ?? 0) > 0 && <div>{p.rodapeSemCatalogo(data!.activity_excluded_no_catalog)}</div>}
          </div>
        )}
        {actFiltered.length > 0 && (
          <Pagination
            page={actPage}
            pageSize={actPageSize}
            total={actFiltered.length}
            onPageChange={setActPage}
            onPageSizeChange={(size) => {
              setActPageSize(size);
              setActPage(1);
            }}
          />
        )}
      </div>
    );
  }

  function renderPeriodSection() {
    return (
      <section
        id="rpt-periodo"
        ref={periodRef}
        className={`rpt-section${periodDim ? " rpt-is-refreshing" : ""}`}
        aria-busy={firstLoad || periodDim}
      >
        <div className="rpt-section-head">
          <div className="rpt-section-heading">
            <h2 className="rpt-section-title">
              <Icon name="date_range" style={{ fontSize: 18 }} />
              {p.secPeriodo}
            </h2>
            <span className="rpt-section-scope">{p.escopoPeriodo}</span>
            {periodDim && (
              <span className="rpt-refreshing">
                <Icon name="progress_activity" style={{ fontSize: 14 }} />
                {p.atualizando}
              </span>
            )}
          </div>
          <div className="rpt-period-bar">
            <DateRangeCalendar value={range} onChange={changeRange} maxDays={MAX_PERIOD_DAYS} emitPartial={false} />
            <div className="rpt-presets" role="group" aria-label={p.secPeriodo}>
              {PERIOD_PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`rpt-preset${activePreset === d ? " active" : ""}`}
                  aria-pressed={activePreset === d}
                  onClick={() => applyPreset(d)}
                >
                  {p.preset(d)}
                </button>
              ))}
            </div>
          </div>
        </div>
        {rangeError != null && (
          <div className="rpt-notice rpt-notice--error" role="alert">
            <Icon name="error" style={{ fontSize: 16 }} />
            <span>
              {rangeError || p.erroPeriodo}
              {data ? ` ${p.exibindoAnterior}` : ""}
            </span>
          </div>
        )}
        {loadError && data && !loading && (
          <div className="rpt-notice rpt-notice--error" role="alert">
            <Icon name="error" style={{ fontSize: 16 }} />
            <span>{p.erroAtualizar}</span>
            <div className="rpt-notice-actions">
              <button type="button" className="btn btn-outline btn-sm" onClick={retry}>
                {p.tentarNovamente}
              </button>
            </div>
          </div>
        )}

        {firstLoad ? (
          <>
            <div className="rpt-skeleton rpt-skeleton-bar" />
            {skeletonKpis(6, "")}
            {skeletonCard}
          </>
        ) : (
          <>
            {renderExceptions()}
            {renderPeriodKpis()}
            {renderTechTable()}
            {renderStatusHours()}
            {renderProduction()}
            {renderQuality()}
            <BlockTimesCard siteId={siteId} start={range.start} end={range.end} />
            {renderUnproductive()}
            {renderActivities()}
          </>
        )}
      </section>
    );
  }

  return (
    <div className="rpt-page">
      <PageHeader
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={p.subtitle}
        actions={
          <div className="ops-toolbar rpt-header-tools">
            <MultiSelectFilter
              label={locale === "es-ES" ? "Sitio" : "Site"}
              options={sites.map((s) => ({ value: String(s.id), label: s.name }))}
              selected={siteId === "all" ? [] : String(siteId).split(",")}
              onChange={(next) => changeSite(next.length ? next.join(",") : "all")}
              allLabel={p.todosSites}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => periodRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <Icon name="arrow_downward" style={{ fontSize: 16 }} />
              {p.irParaPeriodo}
            </button>
            <Link to="/relatorios-indicadores/gerencial" className="btn btn-primary btn-sm">
              <Icon name="insights" style={{ fontSize: 16 }} />
              {p.relatorioGerencial}
            </Link>
          </div>
        }
      />

      {firstLoad && <span className="rpt-sr-only" role="status">{p.carregandoRelatorio}</span>}

      {bannerVisible && (
        <div className="rpt-notice rpt-notice--info">
          <Icon name="info" style={{ fontSize: 16 }} />
          <div className="rpt-notice-body">
            <span>{p.bannerCorrecao(fixDateLabel)}</span>
            <details className="rpt-notice-details">
              <summary>{p.verOQueMudou}</summary>
              <ul>
                <li>{p.mudouPausas}</li>
                <li>{p.mudouHH}</li>
                <li>{p.mudouFimExpediente}</li>
                <li>{p.mudouCatalogo}</li>
              </ul>
            </details>
          </div>
          <button type="button" className="rpt-notice-close" onClick={dismissBanner} aria-label={p.fechar} title={p.fechar}>
            <Icon name="close" style={{ fontSize: 16 }} />
          </button>
        </div>
      )}

      {fatalError ? (
        <div className="rpt-notice rpt-notice--error rpt-notice--block" role="alert">
          <Icon name="error" style={{ fontSize: 18 }} />
          <div className="rpt-notice-body">
            <strong>{p.erroCarregar}</strong>
            {loadError?.detail && <span>{loadError.detail}</span>}
          </div>
          <div className="rpt-notice-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={retry}>
              <Icon name="refresh" style={{ fontSize: 16 }} />
              {p.tentarNovamente}
            </button>
          </div>
        </div>
      ) : (
        <>
          {renderTodaySection()}
          {renderPeriodSection()}
        </>
      )}
    </div>
  );
}

