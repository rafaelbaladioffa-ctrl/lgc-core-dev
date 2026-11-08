const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const qrcodeImage = require("qrcode");
const pino = require("pino");
const axios = require("axios");
const http = require("http");
const crypto = require("crypto");
const puppeteer = require("puppeteer-core");

const API_URL = process.env.BOT_API_URL || "http://field-backend:8000/api";
const API_SECRET = process.env.BOT_API_SECRET || "";
const AUTH_DIR = process.env.AUTH_DIR || "/app/auth_info";
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

const logger = pino({ level: "warn" });

// Opções do menu principal. A lista foi pensada para crescer conforme novas
// funções do bot forem adicionadas.
const MENU_OPTIONS = [
  { number: "1", key: "alocacao", label: "Alocação (projeto e site de hoje)" },
  { number: "2", key: "atualizacao_projetos", label: "Atualização de projetos" },
  { number: "3", key: "minhas_tarefas", label: "Minhas tarefas" },
  { number: "4", key: "status_tecnicos", label: "Status dos técnicos" },
];

// Texto do menu conforme o modelo "Menu /bot" configurado na web: saudação,
// opções habilitadas (renumeradas) e rodapé.
function buildMenu(template) {
  const useTemplate = template && template.is_active !== false;
  const options = MENU_OPTIONS.filter((o) => templateEnabled(template, o.key)).map((o, i) => ({ ...o, number: String(i + 1) }));
  const intro = (useTemplate && template.intro_text) || "Olá! Eu sou o bot do Axis Field. O que você deseja?";
  const footer = (useTemplate && template.footer_text) || "Digite o número da opção.";
  const text = options.length
    ? `${intro}\n\n${options.map((o) => `${o.number}️⃣ ${o.label}`).join("\n")}\n\n${footer}`
    : "Nenhuma opção do bot está disponível no momento.";
  return { options, text };
}

// Estado de conversa por número (em memória — reinicia com o processo, o que
// é aceitável já que o fluxo é curto e o usuário sempre pode digitar /bot
// de novo para recomeçar).
const sessions = new Map();

function normalize(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function extractText(msg) {
  const m = msg.message;
  return m?.conversation || m?.extendedTextMessage?.text || m?.imageMessage?.caption || m?.videoMessage?.caption || "";
}

const NAME_PARTICLES = new Set(["da", "de", "do", "das", "dos", "e"]);

// "RAFAEL BALADI" -> "Rafael Baladi"; partículas (da, de, do...) ficam em minúsculo.
function formatPersonName(name) {
  if (!name || typeof name !== "string") return name;
  return name
    .trim()
    .split(/\s+/)
    .map((w, i) => (i > 0 && NAME_PARTICLES.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function formatDate(iso) {
  const [y, mo, d] = iso.split("-");
  return `${d}/${mo}/${y}`;
}

async function botGet(path, params) {
  const { data } = await axios.get(`${API_URL}${path}`, {
    params,
    headers: { "X-Bot-Secret": API_SECRET },
    timeout: 10000,
  });
  return data;
}

async function fetchMessageTemplate(messageType) {
  try {
    return await botGet("/bot/message-template/", { message_type: messageType });
  } catch (err) {
    console.error(`Template ${messageType}: usando padrão por falha ao consultar configuração:`, err.message);
    return null;
  }
}

function templateEnabled(template, field) {
  if (!template || template.is_active === false) return true;
  return template.enabled_fields?.[field] !== false;
}

function renderTemplatedLines(template, fallbackTitle, rows) {
  if (!template || template.is_active === false) return null;
  const lines = [];
  const title = template.title || fallbackTitle;
  if (title) lines.push(`*${title}*`);
  if (template.intro_text) lines.push("", template.intro_text);
  const body = rows.filter(([key]) => templateEnabled(template, key)).map(([, line]) => line).filter(Boolean);
  if (body.length) lines.push("", ...body);
  if (template.footer_text) lines.push("", template.footer_text);
  return lines.join("\n").trim();
}

async function fetchAllocationByName(name) {
  const data = await botGet("/bot/allocation/", { name });

  if (data.found === "ambiguous") {
    const options = data.matches.map((n) => `• ${n}`).join("\n");
    return `Encontrei mais de um técnico com esse nome:\n\n${options}\n\nDigite /bot para tentar de novo, com o nome completo.`;
  }
  if (!data.found) {
    return "Não encontrei ninguém com esse nome cadastrado como técnico ativo. Confira a digitação (nome completo) ou fale com seu gestor.";
  }
  if (!data.allocations.length) {
    return `Olá, ${data.collaborator_name}! Você ainda não tem uma alocação registrada para hoje (${formatDate(data.date)}).`;
  }
  const lines = data.allocations.map(
    (a) => `• ${a.project}${a.code ? ` (${a.code})` : ""} — Site: ${a.site || "não informado"}`
  );
  return `Olá, ${data.collaborator_name}! Sua alocação de hoje (${formatDate(data.date)}):\n\n${lines.join("\n")}`;
}

async function fetchMyTasksByName(name) {
  const data = await botGet("/bot/my-tasks/", { name });

  if (data.found === "ambiguous") {
    const options = data.matches.map((n) => `• ${n}`).join("\n");
    return `Encontrei mais de um técnico com esse nome:\n\n${options}\n\nDigite /bot para tentar de novo, com o nome completo.`;
  }
  if (!data.found) {
    return "Não encontrei ninguém com esse nome cadastrado como técnico ativo. Confira a digitação (nome completo) ou fale com seu gestor.";
  }
  if (!data.tasks.length) {
    return `Olá, ${data.collaborator_name}! Você não tem tarefas pendentes no momento. 🎉`;
  }

  const byProject = new Map();
  for (const t of data.tasks) {
    const key = `${t.code ? `${t.code} - ` : ""}${t.project}`;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(t);
  }

  const blocks = [...byProject.entries()].map(
    ([project, tasks]) => `*${project}*\n` + tasks.map((t) => `• ${t.task} (${t.status})`).join("\n")
  );

  return `Olá, ${data.collaborator_name}! Suas tarefas pendentes:\n\n${blocks.join("\n\n")}`;
}

async function fetchTechStatus(siteId, siteLabel) {
  const data = await botGet("/bot/tech-status/", siteId ? { site_id: siteId } : undefined);
  if (!data.technicians.length) {
    return `Nenhum técnico ativo vinculado a ${siteLabel}.`;
  }

  const line = (t) => `• *${t.name}* — ${t.status}${t.current_task ? ` (${t.current_task})` : ""}`;

  if (siteId) {
    return `👷 Status dos técnicos — ${siteLabel}:\n\n${data.technicians.map(line).join("\n")}`;
  }

  const bySite = new Map();
  for (const t of data.technicians) {
    if (!bySite.has(t.site_name)) bySite.set(t.site_name, []);
    bySite.get(t.site_name).push(t);
  }
  const blocks = [...bySite.entries()].map(([site, techs]) => `*${site}*\n` + techs.map(line).join("\n"));
  return `👷 Status dos técnicos — todos os sites:\n\n${blocks.join("\n\n")}`;
}

function formatProjectUpdate(p) {
  const lines = [
    `📋 *${p.name}*`,
    `PO: ${p.po || "não informado"}`,
    `Responsável Cliente: ${p.responsible_client || "não informado"}`,
    `Início previsto: ${p.planned_start ? formatDate(p.planned_start) : "não informado"}`,
    `Término previsto: ${p.planned_end ? formatDate(p.planned_end) : "não informado"}`,
    `Progresso do projeto: ${p.completion_percent}%`,
  ];

  if (p.today_update) {
    const u = p.today_update;
    lines.push("", "*Atualização de hoje:*");
    if (u.activities_text) lines.push(`Atividades: ${u.activities_text}`);
    if (u.certification_done) lines.push("🏆 Certificação finalizada");
    if (u.project_finished) lines.push("🏁 Projeto finalizado");
    if (u.summary) lines.push(`Obs: ${u.summary}`);
    if (u.collaborators.length) lines.push(`Colaboradores: ${u.collaborators.join(", ")}`);
  } else {
    lines.push("", "Nenhuma atualização registrada hoje para este projeto.");
  }

  return lines.join("\n");
}

// Destinatário pode ser uma pessoa (telefone) ou um grupo do WhatsApp
// (group_jid, terminado em "@g.us" — ver BotSubscriber no backend).
function recipientToJid(recipient) {
  if (recipient && recipient.group_jid) return recipient.group_jid;
  return phoneToJid(recipient && recipient.phone);
}

function phoneToJid(rawPhone) {
  const digits = (rawPhone || "").replace(/\D/g, "");
  if (digits.length >= 12) return `${digits}@s.whatsapp.net`;
  if (digits.length === 10 || digits.length === 11) return `55${digits}@s.whatsapp.net`; // sem código de país
  return null; // número curto/inválido demais para confiar
}

// Resolve o JID real do número via WhatsApp (evita "Aguardando mensagem" causado
// por números de 8 dígitos sem o "9" obrigatório ou outros problemas de formato).
// Retorna null se o número não estiver no WhatsApp ou a consulta falhar.
async function resolvePhoneJid(sock, rawPhone) {
  const candidateJid = phoneToJid(rawPhone);
  if (!candidateJid) return null;
  try {
    const [result] = await sock.onWhatsApp(candidateJid.replace("@s.whatsapp.net", ""));
    return result?.exists ? result.jid : null;
  } catch {
    return candidateJid; // fallback: tenta com o JID construído localmente
  }
}

// now.toLocaleDateString/toLocaleTimeString("pt-BR", ...) formata só o
// IDIOMA — o fuso usado continua sendo o do sistema operacional do
// container, que aqui não é America/Sao_Paulo (por padrão os containers
// rodam em UTC). Sem isso, uma mensagem enviada às 18h (horário de
// Brasília) saía com "21:00" escrito na legenda. Corrige subtraindo 3h
// fixas (mesmo raciocínio já usado no agendamento via hourUTC — Brasil não
// tem mais horário de verão desde 2019) e formatando o resultado como UTC,
// que não depende de dado de fuso-horário (tzdata) instalado na imagem.
function formatBrazilDateTime(date) {
  const brazilTime = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const dateLabel = brazilTime.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  const timeLabel = brazilTime.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${dateLabel} ${timeLabel}`;
}

function formatBroadcastMessage(t, date) {
  const lines = t.allocations.map(
    (a) => `• ${a.project}${a.code ? ` (${a.code})` : ""} — Site: ${a.site || "não informado"}`
  );
  return `Olá, ${t.collaborator_name}! Aqui está sua alocação para ${formatDate(date)}:\n\n${lines.join("\n")}`;
}

function formatAllocationMessage(t, date, template) {
  const useTemplate = template && template.is_active !== false;
  const displayName = formatPersonName(t.collaborator_name);
  const fallbackIntro = `Olá, ${displayName}! Aqui está sua alocação para ${formatDate(date)}:`;
  const intro =
    useTemplate && template.intro_text
      ? template.intro_text.split("{nome}").join(displayName).split("{data}").join(formatDate(date))
      : fallbackIntro;
  const lines = t.allocations.map((a) => {
    const name = templateEnabled(template, "project_code") && a.code ? `${a.project} (${a.code})` : a.project;
    return templateEnabled(template, "site") ? `• ${name} — Site: ${a.site || "não informado"}` : `• ${name}`;
  });
  const footer = useTemplate && template.footer_text ? `\n\n${template.footer_text}` : "";
  return `${intro}\n\n${lines.join("\n")}${footer}`;
}

// Resumo único da alocação para enviar a um grupo: um bloco por projeto (ordenado por
// site e nome), com os técnicos alocados listados embaixo.
function groupAllocationByProject(technicians) {
  const groups = new Map();
  for (const t of technicians) {
    for (const a of t.allocations) {
      const key = `${a.code || ""}|${a.project}|${a.site || ""}`;
      if (!groups.has(key)) groups.set(key, { project: a.project, code: a.code, site: a.site, technicians: [] });
      groups.get(key).technicians.push(formatPersonName(t.collaborator_name));
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, technicians: [...new Set(g.technicians)].sort((x, y) => x.localeCompare(y, "pt-BR")) }))
    .sort((x, y) => (x.site || "").localeCompare(y.site || "", "pt-BR") || x.project.localeCompare(y.project, "pt-BR"));
}

function formatAllocationGroupBlock(g, template) {
  const title = templateEnabled(template, "project_code") && g.code ? `${g.project} (${g.code})` : g.project;
  const count = `${g.technicians.length} técnico(s)`;
  const lines = [`*${title}*`];
  lines.push(templateEnabled(template, "site") ? `Site: ${g.site || "não informado"} · ${count}` : count);
  lines.push(...g.technicians.map((name) => `• ${name}`));
  return lines.join("\n");
}

function buildAllocationSummaryMessages(technicians, date, template) {
  const groups = groupAllocationByProject(technicians);
  // O texto de introdução do modelo é da mensagem individual ("Olá, {nome}!"); o resumo não usa.
  const summaryTemplate = template ? { ...template, intro_text: "" } : template;
  return buildConsolidatedDailyProjectReport(groups, date, summaryTemplate, {
    fallbackTitle: "Alocação Técnica",
    blockFn: formatAllocationGroupBlock,
    extraHeader: [`Técnicos: ${new Set(technicians.map((t) => t.collaborator_name)).size}`],
  });
}

async function sendAllocationSummary(sock, data, recipients) {
  const template = await fetchMessageTemplate("allocation");
  console.log(`Alocação (resumo): ${data.technicians.length} técnico(s) para ${recipients.length} destinatário(s).`);
  let sent = 0;
  for (const text of buildAllocationSummaryMessages(data.technicians, data.date, template)) {
    sent += await sendToRecipients(sock, recipients, text, "Alocação (resumo)");
  }
  return sent;
}

// Alocação individual: cada técnico recebe a própria mensagem. Com
// overrideTo (teste), manda no máximo 3 mensagens, todas para esse destino.
async function sendAllocationData(sock, data, overrideTo) {
  const technicians = overrideTo ? data.technicians.slice(0, 3) : data.technicians;
  if (!technicians.length) {
    console.log(`Envio de alocação: nenhuma alocação para ${data.date}, nada a enviar.`);
    return 0;
  }
  const template = await fetchMessageTemplate("allocation");
  console.log(`Envio de alocação: enviando de ${data.date} para ${technicians.length} técnico(s).`);
  let sent = 0;
  for (const t of technicians) {
    const jid = overrideTo ? recipientToJid(overrideToRecipient(overrideTo)) : await resolvePhoneJid(sock, t.phone);
    if (!jid) {
      console.error(`Envio de alocação: telefone inválido ou não encontrado no WhatsApp para ${t.collaborator_name} (${t.phone}), pulando.`);
      continue;
    }
    try {
      // Assinar presença antes de enviar ajuda o WhatsApp a re-estabelecer
      // a sessão E2E quando o contato ficou inativo por alguns dias,
      // reduzindo o "Aguardando mensagem" no aparelho do técnico.
      await sock.presenceSubscribe(jid).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
      await sock.sendMessage(jid, { text: formatAllocationMessage(t, data.date, template) });
      sent += 1;
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (err) {
      console.error(`Envio de alocação: erro ao enviar para ${t.collaborator_name}:`, err.message);
    }
  }
  return sent;
}

async function runAllocationBroadcast(sock) {
  const data = await botGet("/bot/daily-broadcast/");
  await sendAllocationData(sock, data);
}

// Manda o mesmo texto consolidado (todos os projetos do dia) para cada
// destinatário cadastrado no BotSubscriber — usado pelos envios das 10h e
// das 17h, que são resumos gerenciais, não mensagens individuais por técnico.
async function sendToRecipients(sock, recipients, text, label) {
  if (!recipients.length) {
    console.log(`${label}: nenhum destinatário cadastrado (BotSubscriber), nada a enviar.`);
    return 0;
  }
  let sent = 0;
  for (const r of recipients) {
    const jid = recipientToJid(r);
    if (!jid) {
      console.error(`${label}: telefone inválido para ${r.name} (${r.phone}), pulando.`);
      continue;
    }
    try {
      await sock.sendMessage(jid, { text });
      sent += 1;
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (err) {
      console.error(`${label}: erro ao enviar para ${r.name}:`, err.message);
    }
  }
  return sent;
}

async function sendDailyTasksData(sock, data, recipients) {
  const template = await fetchMessageTemplate("daily_tasks");
  const blocks = data.projects.map((p) => {
    const titleParts = [];
    if (templateEnabled(template, "project_code") && p.code) titleParts.push(p.code);
    if (templateEnabled(template, "project_name")) titleParts.push(p.project);
    const lines = titleParts.length ? [`*${titleParts.join(" - ")}*`] : [];
    if (templateEnabled(template, "site")) lines.push(`Site: ${p.site || "não informado"}`);
    if (templateEnabled(template, "collaborators")) lines.push(`Técnicos: ${p.collaborators.join(", ") || "não informado"}`);
    if (templateEnabled(template, "pending_tasks")) {
      lines.push(p.tasks.length ? `Tarefas:\n${p.tasks.map((t) => `• ${t}`).join("\n")}` : "Sem tarefas pendentes cadastradas.");
    }
    return lines.join("\n");
  }).filter(Boolean);
  const text =
    renderTemplatedLines(template, `Tarefas alocadas para hoje (${formatDate(data.date)})`, [["projects", blocks.join("\n\n")]]) ||
    `Tarefas alocadas para hoje (${formatDate(data.date)}):\n\n${blocks.join("\n\n")}`;
  console.log(`Tarefas do dia: enviando ${data.projects.length} projeto(s) para ${recipients.length} destinatário(s).`);
  return sendToRecipients(sock, recipients, text, "Tarefas do dia");
}

async function runDailyTasksBroadcast(sock) {
  const data = await botGet("/bot/broadcasts/daily-tasks/");
  if (!data.projects.length) {
    console.log(`Tarefas do dia (10h): nenhum projeto alocado em ${data.date}, nada a enviar.`);
    return;
  }
  await sendDailyTasksData(sock, data, data.recipients);
}

function formatProjectDailyUpdate(p, date, workdayStart, workdayEnd, template) {
  const templated = renderTemplatedLines(template, "Atualização Diária de Projeto", [
    ["project_name", `Nome do Projeto: ${p.project}`],
    ["po", `PO: ${p.po || "Não informada"}`],
    ["responsible_client", `Responsável AWS: ${formatPersonName(p.responsible_client) || "Não informado"}`],
    ["responsible_cstr", `Responsável CSTR: ${formatPersonName(p.responsible_cstr) || "Não informado"}`],
    ["collaborators", `Colaboradores: ${p.collaborators.length ? p.collaborators.map(formatPersonName).join(", ") : "Não informados"}`],
    ["date", `Data: ${formatDate(date)}`],
    ["work_hours", `Hora de início: ${workdayStart}\nHora de término: ${workdayEnd}`],
    ["completion_percent", `Percentual de Conclusão: ${p.completion_percent}%`],
    ["activities_text", `Atividades Executadas:\n${p.activities_text || "Nenhuma atividade concluída registrada nesta data."}`],
    ["certification_done", `Certificação Finalizada: ${p.certification_done ? "Sim" : "Não"}`],
    ["project_finished", `Projeto finalizado: ${p.project_finished ? "Sim" : "Não"}`],
    ["summary", `Observações:\n${p.summary || "Nenhuma observação."}`],
  ]);
  if (templated) return templated;
  const lines = [
    "📋 Atualização Diária de Projeto",
    "",
    `Nome do Projeto: ${p.project}`,
    `PO: ${p.po || "Não informada"}`,
    `Responsável AWS: ${formatPersonName(p.responsible_client) || "Não informado"}`,
    `Responsável CSTR: ${formatPersonName(p.responsible_cstr) || "Não informado"}`,
    "",
    `👷 Colaboradores: ${p.collaborators.length ? p.collaborators.map(formatPersonName).join(", ") : "Não informados"}`,
    "",
    `📅 Data: ${formatDate(date)}`,
    `Hora de início: ${workdayStart}`,
    `Hora de término: ${workdayEnd}`,
    "",
    `📊 Percentual de Conclusão: ${p.completion_percent}%`,
    "",
    "🛠️ Atividades Executadas:",
    p.activities_text || "Nenhuma atividade concluída registrada nesta data.",
    "",
    `✅ Certificação Finalizada: ${p.certification_done ? "Sim" : "Não"}`,
    `🏁 Projeto finalizado: ${p.project_finished ? "Sim" : "Não"}`,
    "",
    "⚠️ Observações:",
    p.summary || "Nenhuma observação.",
  ];
  return lines.join("\n");
}

function formatDailyProjectReport(p, date, template) {
  // Sem retrato anterior (primeiro envio do projeto) não há delta honesto a
  // mostrar — melhor omitir o número do que inventar um "+0%".
  const deltaLine =
    p.daily_delta === null || p.daily_delta === undefined
      ? "* Avanço no dia: primeiro registro"
      : `* Avanço no dia: ${p.daily_delta >= 0 ? "+" : ""}${p.daily_delta}%`;

  // Riscos/Bloqueios vêm das Ocorrências em aberto do projeto.
  const risksBlock =
    p.occurrences && p.occurrences.length
      ? p.occurrences.map((o) => `* ${o}`).join("\n")
      : "Nenhum bloqueio relevante identificado no período";

  const templated = renderTemplatedLines(template, "ATUALIZAÇÃO DIÁRIA DE PROJETO", [
    ["project_name", `Projeto: ${p.project}`],
    ["po", `PO: ${p.po || "Não informado"}`],
    ["site", `Site: ${p.site || "Não informado"}`],
    ["responsible_cstr", `Responsável CSTR: ${formatPersonName(p.responsible_cstr) || "Não informado"}`],
    ["responsible_client", `Responsável A100: ${formatPersonName(p.responsible_client) || ""}`],
    ["completion_percent", `* Avanço atual: ${p.completion_percent}%`],
    ["daily_delta", deltaLine],
    ["status", "* Status: Em andamento"],
    ["planned_end", `* Previsão de término: ${p.planned_end ? formatDate(p.planned_end) : "Não informada"}`],
    ["certification", `* Certificação: ${p.certification_label}`],
    ["project_finished", `* Projeto finalizado: ${p.project_finished ? "Sim" : "Não"}`],
    ["occurrences", `Riscos / Bloqueios\n${risksBlock}`],
  ]);
  if (templated) return templated;

  const lines = [
    "*ATUALIZAÇÃO DIÁRIA DE PROJETO*",
    `Data: ${formatDate(date)}`,
    "",
    `Projeto: ${p.project}`,
    `PO: ${p.po || "Não informado"}`,
    `Site: ${p.site || "Não informado"}`,
    `Responsável CSTR: ${formatPersonName(p.responsible_cstr) || "Não informado"}`,
    `Responsável A100: ${formatPersonName(p.responsible_client) || ""}`,
    "",
    "📊 STATUS DO PROJETO",
    `* Avanço atual: ${p.completion_percent}%`,
    deltaLine,
    "* Status: Em andamento",
    `* Previsão de término: ${p.planned_end ? formatDate(p.planned_end) : "Não informada"}`,
    `* Certificação: ${p.certification_label}`,
    `* Projeto finalizado: ${p.project_finished ? "Sim" : "Não"}`,
    "",
    "⚠️ Riscos / Bloqueios",
    risksBlock,
  ];
  return lines.join("\n");
}

// Bloco de UM projeto dentro da mensagem consolidada (sem título/rodapé do modelo,
// que aparecem uma única vez no cabeçalho/rodapé da mensagem).
function formatDailyProjectReportBlock(p, template) {
  const deltaLine =
    p.daily_delta === null || p.daily_delta === undefined
      ? "* Avanço no dia: primeiro registro"
      : `* Avanço no dia: ${p.daily_delta >= 0 ? "+" : ""}${p.daily_delta}%`;
  const risksBlock =
    p.occurrences && p.occurrences.length
      ? p.occurrences.map((o) => `* ${o}`).join("\n")
      : "Nenhum bloqueio relevante identificado no período";
  const rows = [
    ["project_name", `*Projeto: ${p.project}*`],
    ["po", `PO: ${p.po || "Não informado"}`],
    ["site", `Site: ${p.site || "Não informado"}`],
    ["responsible_cstr", `Responsável CSTR: ${formatPersonName(p.responsible_cstr) || "Não informado"}`],
    ["responsible_client", `Responsável A100: ${formatPersonName(p.responsible_client) || ""}`],
    ["completion_percent", `* Avanço atual: ${p.completion_percent}%`],
    ["daily_delta", deltaLine],
    ["status", "* Status: Em andamento"],
    ["planned_end", `* Previsão de término: ${p.planned_end ? formatDate(p.planned_end) : "Não informada"}`],
    ["certification", `* Certificação: ${p.certification_label}`],
    ["project_finished", `* Projeto finalizado: ${p.project_finished ? "Sim" : "Não"}`],
    ["occurrences", `Riscos / Bloqueios\n${risksBlock}`],
  ];
  return rows.filter(([key]) => templateEnabled(template, key)).map(([, line]) => line).filter(Boolean).join("\n");
}

const PROJECT_REPORT_SEPARATOR = "\n\n━━━━━━━━━━━━━━━━\n\n";
const PROJECT_REPORT_MAX_CHARS = 12000; // acima disso divide em partes (legibilidade/limite do WhatsApp)

// Monta a(s) mensagem(ns) consolidada(s): cabeçalho uma vez, um bloco por projeto, rodapé uma vez.
function buildConsolidatedDailyProjectReport(projects, date, template, opts = {}) {
  const active = template && template.is_active !== false ? template : null;
  const title = (active && active.title) || opts.fallbackTitle || "ATUALIZAÇÃO DIÁRIA DE PROJETO";
  const blockFn = opts.blockFn || formatDailyProjectReportBlock;
  const extraHeader = opts.extraHeader || [];
  const intro = active && active.intro_text ? active.intro_text : "";
  const footer = active && active.footer_text ? active.footer_text : "";
  const blocks = projects.map((p) => blockFn(p, template));

  // Agrupa os blocos em partes que respeitam o limite de tamanho.
  const parts = [];
  let current = [];
  let size = 0;
  for (const block of blocks) {
    if (current.length && size + block.length > PROJECT_REPORT_MAX_CHARS) {
      parts.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += block.length + PROJECT_REPORT_SEPARATOR.length;
  }
  if (current.length) parts.push(current);

  return parts.map((partBlocks, index) => {
    const partLabel = parts.length > 1 ? ` (parte ${index + 1}/${parts.length})` : "";
    const head = [`*${title}*`, `Data: ${formatDate(date)} · ${projects.length} projeto(s)${partLabel}`];
    head.push(...extraHeader);
    if (intro) head.push("", intro);
    let text = `${head.join("\n")}\n\n${partBlocks.join(PROJECT_REPORT_SEPARATOR)}`;
    if (footer && index === parts.length - 1) text += `\n\n${footer}`;
    return text.trim();
  });
}

// Bloco de UM projeto na "Atualização de projetos" consolidada. Data e horário de
// trabalho aparecem uma vez no cabeçalho da mensagem.
function formatProjectUpdateBlock(p, template) {
  const rows = [
    ["project_name", `*Nome do Projeto: ${p.project}*`],
    ["po", `PO: ${p.po || "Não informada"}`],
    ["responsible_client", `Responsável AWS: ${formatPersonName(p.responsible_client) || "Não informado"}`],
    ["responsible_cstr", `Responsável CSTR: ${formatPersonName(p.responsible_cstr) || "Não informado"}`],
    ["collaborators", `Colaboradores: ${p.collaborators.length ? p.collaborators.map(formatPersonName).join(", ") : "Não informados"}`],
    ["completion_percent", `Percentual de Conclusão: ${p.completion_percent}%`],
    ["activities_text", `Atividades Executadas:\n${p.activities_text || "Nenhuma atividade concluída registrada nesta data."}`],
    ["certification_done", `Certificação Finalizada: ${p.certification_done ? "Sim" : "Não"}`],
    ["project_finished", `Projeto finalizado: ${p.project_finished ? "Sim" : "Não"}`],
    ["summary", `Observações:\n${p.summary || "Nenhuma observação."}`],
  ];
  return rows.filter(([key]) => templateEnabled(template, key)).map(([, line]) => line).filter(Boolean).join("\n");
}

// Envia o relatório diário de projeto como UMA mensagem por destinatário (ou poucas, se enorme).
async function sendConsolidatedDailyProjectReport(sock, recipients, data, template, label) {
  const messages = buildConsolidatedDailyProjectReport(data.projects, data.date, template);
  let sent = 0;
  for (const r of recipients) {
    const jid = recipientToJid(r);
    if (!jid) {
      console.error(`${label}: destino inválido para ${r.name} (${r.phone || ""}), pulando.`);
      continue;
    }
    for (const text of messages) {
      try {
        await sock.sendMessage(jid, { text });
        sent += 1;
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch (err) {
        console.error(`${label}: erro ao enviar para ${r.name}:`, err.message);
      }
    }
  }
  return sent;
}

async function runDailyProjectReportBroadcast(sock, overridePhone) {
  const data = await botGet("/bot/broadcasts/daily-project-report/");
  if (!data.projects.length) {
    console.log(`Atualização diária de projeto (15h): nenhum projeto ativo, nada a enviar.`);
    return;
  }
  const recipients = overridePhone ? [{ name: "Teste", phone: overridePhone }] : data.recipients;
  const template = await fetchMessageTemplate("daily_project_report");
  console.log(`Atualização diária de projeto (15h): enviando ${data.projects.length} projeto(s) para ${recipients.length} destinatário(s).`);
  await sendConsolidatedDailyProjectReport(sock, recipients, data, template, "Atualização diária de projeto (15h)");
}

async function captureDailyProjectReportPrint(date, projectLimit, ruleId) {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-extensions", "--no-zygote"],
  });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "X-Bot-Secret": API_SECRET });
    // Largura vertical para a prévia do WhatsApp manter letras legíveis no celular.
    // A captura full-page usa a largura do documento. Um viewport estreito
    // evita que o JPEG inclua uma faixa vazia à direita da arte compacta.
    await page.setViewport({ width: 780, height: 1200, deviceScaleFactor: 1 });
    const limitQuery = (projectLimit ? `&limit=${encodeURIComponent(projectLimit)}` : "") + (ruleId ? `&rule=${encodeURIComponent(ruleId)}` : "");
    await page.goto(`${API_URL}/bot/daily-project-report-print/?date=${encodeURIComponent(date)}${limitQuery}`, { waitUntil: "networkidle0", timeout: 30000 });
    const shot = await page.screenshot({ type: "jpeg", quality: 88, fullPage: true });
    return Buffer.isBuffer(shot) ? shot : Buffer.from(shot);
  } finally {
    await browser.close();
  }
}

// Disparo manual para aprovar apenas a arte no WhatsApp, sem reenviar os
// relatórios de texto. O agendamento das 15h continua inalterado.
async function runDailyProjectReportImageBroadcast(sock, overridePhone, projectLimit) {
  const data = await botGet("/bot/broadcasts/daily-project-report/");
  if (!data.projects.length) {
    console.log("Imagem do relatório das 15h: nenhum projeto ativo, nada a enviar.");
    return;
  }
  const recipients = overridePhone ? [{ name: "Teste", phone: overridePhone }] : data.recipients;
  const image = await captureDailyProjectReportPrint(data.date, projectLimit);
  for (const r of recipients) {
    const jid = recipientToJid(r);
    if (!jid) continue;
    try {
      await sock.sendMessage(jid, {
        image,
        caption: `Status de Projetos AZ4 - ${formatDate(data.date)}`,
        mimetype: "image/jpeg",
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (err) {
      console.error(`Imagem do relatório das 15h: erro ao enviar para ${r.name}:`, err.message);
    }
  }
}

async function sendProjectUpdatesData(sock, data, recipients) {
  console.log(`Atualização de projetos: enviando ${data.projects.length} projeto(s) para ${recipients.length} destinatário(s).`);
  const template = await fetchMessageTemplate("project_updates");
  const extraHeader = templateEnabled(template, "work_hours")
    ? [`Hora de início: ${data.workday_start}`, `Hora de término: ${data.workday_end}`]
    : [];
  const messages = buildConsolidatedDailyProjectReport(data.projects, data.date, template, {
    fallbackTitle: "ATUALIZAÇÃO DIÁRIA DE PROJETO",
    blockFn: formatProjectUpdateBlock,
    extraHeader,
  });
  let sent = 0;
  for (const r of recipients) {
    const jid = recipientToJid(r);
    if (!jid) {
      console.error(`Atualização de projetos: telefone inválido para ${r.name} (${r.phone}), pulando.`);
      continue;
    }
    for (const text of messages) {
      try {
        await sock.sendMessage(jid, { text });
        sent += 1;
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch (err) {
        console.error(`Atualização de projetos: erro ao enviar para ${r.name}:`, err.message);
      }
    }
  }
  return sent;
}

async function runProjectUpdatesBroadcast(sock) {
  const data = await botGet("/bot/broadcasts/project-updates/");
  if (!data.projects.length) {
    console.log(`Atualização de projetos (17h): nenhum projeto alocado em ${data.date}, nada a enviar.`);
    return;
  }
  await sendProjectUpdatesData(sock, data, data.recipients);
}

async function captureOperationsPrint(site = "all") {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--no-zygote",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "X-Bot-Secret": API_SECRET });
    await page.setViewport({ width: 1260, height: 900, deviceScaleFactor: 2 });
    await page.goto(`${API_URL}/bot/operations-print/?site=${encodeURIComponent(site)}`, { waitUntil: "networkidle0", timeout: 30000 });
    const shot = await page.screenshot({ type: "png", fullPage: true });
    return Buffer.isBuffer(shot) ? shot : Buffer.from(shot);
  } finally {
    await browser.close();
  }
}

// Print da Operação do Dia. `sites` (opcional): lista de {id, name}; manda um
// print por site. Sem sites, um único print com todos.
async function sendOperationsPrint(sock, recipients, sites) {
  const label = "Operação do Dia (print)";
  const template = await fetchMessageTemplate("operations_print");
  const targets = sites && sites.length ? sites : [{ id: "all", name: "" }];
  let sent = 0;
  for (const site of targets) {
    console.log(`${label}: capturando imagem da Central de Operações${site.name ? ` (${site.name})` : ""}...`);
    const image = await captureOperationsPrint(site.id);
    let caption =
      renderTemplatedLines(template, "Operação do Dia", [["caption_datetime", formatBrazilDateTime(new Date())]]) ||
      `📸 Operação do Dia — ${formatBrazilDateTime(new Date())}`;
    if (site.name) caption += `\n${site.name}`;
    console.log(`${label}: enviando para ${recipients.length} destinatário(s).`);
    for (const r of recipients) {
      const jid = recipientToJid(r);
      if (!jid) {
        console.error(`${label}: telefone inválido para ${r.name} (${r.phone}), pulando.`);
        continue;
      }
      try {
        await sock.sendMessage(jid, { image, caption, mimetype: "image/png" });
        sent += 1;
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch (err) {
        console.error(`${label}: erro ao enviar para ${r.name}:`, err.message);
      }
    }
  }
  return sent;
}

async function runOperationsPrintBroadcast(sock, overridePhone) {
  const recipients = overridePhone
    ? [{ name: "Teste", phone: overridePhone }]
    : (await botGet("/bot/broadcasts/operations-print-recipients/")).recipients;
  if (!recipients.length) {
    console.log("Operação do Dia (print): nenhum destinatário cadastrado, nada a enviar.");
    return;
  }
  await sendOperationsPrint(sock, recipients);
}

// Destino do envio de teste: grupo (JID @g.us) ou telefone.
function overrideToRecipient(to) {
  return String(to).endsWith("@g.us")
    ? { name: "Teste", group_jid: String(to) }
    : { name: "Teste", phone: String(to) };
}

// Executa uma regra de envio configurada na web (BotBroadcastRule). Com
// overrideTo, manda só para esse destino (teste). Retorna uma mensagem
// resumindo o resultado, usada na resposta do envio de teste.
async function runBroadcastRule(sock, ruleId, overrideTo) {
  const label = `Regra de envio #${ruleId}`;
  const data = await botGet(`/bot/broadcasts/rule/${ruleId}/`);
  const rule = data.rule;
  const type = rule.message_type || "daily_project_report";
  const done = (msg) => {
    console.log(`${label}: ${msg}`);
    return msg;
  };

  const hasData = type === "allocation" ? data.technicians.length > 0 : type === "operations_print" ? true : data.projects.length > 0;
  if (!hasData) {
    return done(`Nenhum dado atende aos filtros da regra "${rule.name}" — nada enviado.`);
  }
  // Alocação: com destinatários escolhidos (ex.: um grupo) vai UM resumo para
  // eles; sem destinatários, cada técnico recebe a própria mensagem.
  const allocationToGroup = type === "allocation" && Array.isArray(data.recipients) && data.recipients.length > 0;
  const recipients = type === "allocation" && !allocationToGroup ? [] : overrideTo ? [overrideToRecipient(overrideTo)] : data.recipients;
  if ((type !== "allocation" || allocationToGroup) && !recipients.length) {
    return done(`Regra "${rule.name}" sem destinatários — nada enviado.`);
  }
  if (type === "allocation" && !allocationToGroup && overrideTo) {
    data.technicians = data.technicians.slice(0, 3);
  }

  let sent = 0;
  if (type === "allocation" && allocationToGroup) {
    sent = await sendAllocationSummary(sock, data, recipients);
  } else if (type === "allocation") {
    sent = await sendAllocationData(sock, data, overrideTo);
  } else if (type === "daily_tasks") {
    sent = await sendDailyTasksData(sock, data, recipients);
  } else if (type === "project_updates") {
    sent = await sendProjectUpdatesData(sock, data, recipients);
  } else if (type === "operations_print") {
    sent = await sendOperationsPrint(sock, recipients, data.sites);
  } else if (rule.content_type === "image") {
    const image = await captureDailyProjectReportPrint(data.date, undefined, rule.id);
    const caption = rule.image_caption || `Status de Projetos AZ4 - ${formatDate(data.date)}`;
    for (const r of recipients) {
      const jid = recipientToJid(r);
      if (!jid) continue;
      try {
        await sock.sendMessage(jid, { image, caption, mimetype: "image/jpeg" });
        sent += 1;
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch (err) {
        console.error(`${label}: erro ao enviar imagem para ${r.name}:`, err.message);
      }
    }
  } else {
    const template = await fetchMessageTemplate("daily_project_report");
    sent = await sendConsolidatedDailyProjectReport(sock, recipients, data, template, label);
  }
  return done(`Regra "${rule.name}": ${sent} mensagem(ns) enviada(s).`);
}

// Agendador das regras: a cada minuto consulta as regras ativas e dispara as
// que batem com o horário de Brasília (UTC-3 fixo) e o dia da semana.
const lastRuleRunKey = {};
async function checkBroadcastRules(sock) {
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const hhmm = `${String(brt.getUTCHours()).padStart(2, "0")}:${String(brt.getUTCMinutes()).padStart(2, "0")}`;
  const weekday = (brt.getUTCDay() + 6) % 7; // 0 = segunda, como no Django
  const dateKey = brt.toISOString().slice(0, 10);
  const rules = await botGet("/bot/broadcasts/rules/");
  for (const rule of rules) {
    if (rule.send_time !== hhmm) continue;
    if (rule.weekdays.length && !rule.weekdays.includes(weekday)) continue;
    if (lastRuleRunKey[rule.id] === dateKey) continue;
    lastRuleRunKey[rule.id] = dateKey;
    runBroadcastRule(sock, rule.id).catch((err) => console.error(`Erro na regra de envio ${rule.id}:`, err.message));
  }
}

let currentSock = null;
// Separado de currentSock: só vira true 45s após a conexão abrir, tempo
// suficiente para as "init queries" do Baileys (chaves E2E, sync de estado)
// completarem. Broadcasts e triggers manuais só disparam quando true.
let botReady = false;
// Último QR Code emitido pelo WhatsApp e quando. Servido em /qr — o QR roda
// a cada ~20s, então o log nunca chega a tempo para alguém escanear.
let lastQr = null;
let lastQrAt = 0;

// Horários dos envios automáticos, em America/Sao_Paulo (convertidos para UTC
// fixo -3h — o Brasil não tem mais horário de verão desde 2019, então não
// precisa do pacote tzdata, nem sempre presente em imagens slim).
const SCHEDULED_BROADCASTS = [
  { key: "daily-tasks", hourUTC: 13, minuteUTC: 0, run: runDailyTasksBroadcast }, // 10h
  // Os dois abaixo agora são regras configuráveis pela web (BotBroadcastRule); ficam só como disparo manual.
  { key: "daily-project-report", hourUTC: 18, minuteUTC: 0, run: runDailyProjectReportBroadcast, scheduled: false },
  { key: "daily-project-report-image", hourUTC: 18, minuteUTC: 1, run: runDailyProjectReportImageBroadcast, scheduled: false },
  { key: "allocation", hourUTC: 21, minuteUTC: 0, run: runAllocationBroadcast }, // 18h
  { key: "project-updates", hourUTC: 20, minuteUTC: 0, run: runProjectUpdatesBroadcast }, // 17h
  // Print da Operação do Dia — 6x ao dia (8h, 10h, 12h, 14h, 16h, 18h). Cada
  // horário precisa de uma key própria: são disparos independentes no mesmo
  // dia, não um único envio diário como os de cima.
  { key: "operations-print-08", hourUTC: 11, minuteUTC: 0, run: runOperationsPrintBroadcast },
  { key: "operations-print-10", hourUTC: 13, minuteUTC: 0, run: runOperationsPrintBroadcast },
  { key: "operations-print-12", hourUTC: 15, minuteUTC: 0, run: runOperationsPrintBroadcast },
  { key: "operations-print-14", hourUTC: 17, minuteUTC: 0, run: runOperationsPrintBroadcast },
  { key: "operations-print-16", hourUTC: 19, minuteUTC: 0, run: runOperationsPrintBroadcast },
  { key: "operations-print-18", hourUTC: 21, minuteUTC: 0, run: runOperationsPrintBroadcast },
];
const lastRunDateKey = {};

// Uso interno: publicado só em 127.0.0.1 no compose.yaml. Toda rota exige
// BOT_API_SECRET (header X-Bot-Token ou ?token=); sem segredo configurado,
// recusa tudo.
function isAuthorized(req, url) {
  if (!API_SECRET) return false;
  const provided = Buffer.from(String(req.headers["x-bot-token"] || url.searchParams.get("token") || ""));
  const expected = Buffer.from(API_SECRET);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (!isAuthorized(req, url)) {
      res.writeHead(401).end("Não autorizado.\n");
      return;
    }
    const tokenQuery = `token=${encodeURIComponent(url.searchParams.get("token") || "")}`;

    // Rotas do QR Code vêm ANTES da checagem de conexão de propósito: o QR só
    // existe enquanto o bot NÃO está conectado — é exatamente quando se precisa
    // dele.
    if (url.pathname === "/qr" || url.pathname === "/qr.png") {
      if (currentSock) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Bot já está conectado ao WhatsApp.</h2>");
        return;
      }
      if (!lastQr) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end('<meta http-equiv="refresh" content="3"><h2>Aguardando o WhatsApp gerar o QR Code…</h2>');
        return;
      }
      if (url.pathname === "/qr.png") {
        qrcodeImage
          .toBuffer(lastQr, { width: 400, margin: 2 })
          .then((buf) => {
            res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
            res.end(buf);
          })
          .catch((err) => res.writeHead(500).end(`Erro ao gerar QR: ${err.message}\n`));
        return;
      }
      const age = Math.round((Date.now() - lastQrAt) / 1000);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        '<meta http-equiv="refresh" content="5">' +
          '<body style="font-family:sans-serif;text-align:center;padding:24px">' +
          "<h2>Escaneie no WhatsApp: Aparelhos conectados &gt; Conectar um aparelho</h2>" +
          `<img src="/qr.png?${tokenQuery}&t=${Date.now()}" width="400" height="400">` +
          `<p>QR gerado há ${age}s — a página se atualiza sozinha a cada 5s.</p></body>`
      );
      return;
    }

    if (!currentSock || !botReady) {
      res.writeHead(503).end("Bot ainda está inicializando — aguarde alguns instantes.\n");
      return;
    }

    // Lista os grupos em que o bot é membro, com o JID de cada um — é assim
    // que se descobre o valor pra preencher em BotSubscriber.group_jid (o
    // WhatsApp não mostra esse identificador na interface).
    if (url.pathname === "/groups") {
      currentSock
        .groupFetchAllParticipating()
        .then((groups) => {
          const list = Object.values(groups).map((g) => ({ jid: g.id, nome: g.subject }));
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(list, null, 2));
        })
        .catch((err) => res.writeHead(500).end(`Erro ao listar grupos: ${err.message}\n`));
      return;
    }

    // Rota própria pro print da Operação do Dia — aceita ?to=<telefone> pra
    // mandar só pra um número específico (teste), em vez da lista completa
    // de destinatários cadastrados.
    if (url.pathname === "/trigger-operations-print") {
      const overridePhone = url.searchParams.get("to") || undefined;
      runOperationsPrintBroadcast(currentSock, overridePhone)
        .then(() => res.writeHead(200).end("Envio disparado — confira os logs do bot.\n"))
        .catch((err) => res.writeHead(500).end(`Erro: ${err.message}\n`));
      return;
    }

    if (url.pathname === "/trigger-daily-project-report-image") {
      const overridePhone = url.searchParams.get("to") || undefined;
      const requestedLimit = Number.parseInt(url.searchParams.get("limit"), 10);
      const projectLimit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : undefined;
      runDailyProjectReportImageBroadcast(currentSock, overridePhone, projectLimit)
        .then(() => res.writeHead(200).end("Imagem JPEG disparada — confira os logs do bot.\n"))
        .catch((err) => res.writeHead(500).end(`Erro: ${err.message}\n`));
      return;
    }

    // Envio de uma regra configurada na web; com ?to= manda só para esse
    // destino (botão "Enviar teste" da tela Bot WhatsApp).
    // Envia o menu /bot (como configurado) para um número, para conferir o texto.
    if (url.pathname === "/trigger-bot-menu") {
      const to = url.searchParams.get("to");
      const jid = to ? recipientToJid(overrideToRecipient(to)) : null;
      if (!jid) {
        res.writeHead(400).end("Parâmetro to inválido.\n");
        return;
      }
      fetchMessageTemplate("interactive_menu")
        .then((template) => currentSock.sendMessage(jid, { text: buildMenu(template).text }))
        .then(() => {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, message: "Menu enviado." }));
        })
        .catch((err) => res.writeHead(500).end(`Erro: ${err.message}\n`));
      return;
    }

    if (url.pathname === "/trigger-rule") {
      const ruleId = Number.parseInt(url.searchParams.get("rule"), 10);
      const to = url.searchParams.get("to") || undefined;
      if (!Number.isInteger(ruleId)) {
        res.writeHead(400).end("Parâmetro rule inválido.\n");
        return;
      }
      runBroadcastRule(currentSock, ruleId, to)
        .then((message) => {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, message }));
        })
        .catch((err) => res.writeHead(500).end(`Erro: ${err.message}\n`));
      return;
    }

    const broadcast = SCHEDULED_BROADCASTS.find((b) => url.pathname === `/trigger-${b.key}`);
    if (!broadcast) {
      res.writeHead(404).end();
      return;
    }
    const overridePhone = url.searchParams.get("to") || undefined;
    broadcast
      .run(currentSock, overridePhone)
      .then(() => res.writeHead(200).end("Envio disparado — confira os logs do bot.\n"))
      .catch((err) => res.writeHead(500).end(`Erro: ${err.message}\n`));
  })
  .listen(3001, "0.0.0.0");

setInterval(() => {
  if (!currentSock || !botReady) return;
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  for (const b of SCHEDULED_BROADCASTS) {
    if (b.scheduled !== true) continue; // agendamento agora é feito só pelas regras (web)
    if (now.getUTCHours() === b.hourUTC && now.getUTCMinutes() === b.minuteUTC && lastRunDateKey[b.key] !== dateKey) {
      lastRunDateKey[b.key] = dateKey;
      b.run(currentSock).catch((err) => console.error(`Erro no envio automático (${b.key}):`, err.message));
    }
  }
  checkBroadcastRules(currentSock).catch((err) => console.error("Erro ao verificar regras de envio:", err.message));
}, 60000);

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Usando versão do WhatsApp Web: ${version.join(".")} (mais recente: ${isLatest})`);

  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    version,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      // Guardado em memória para o endpoint /qr — o QR expira em ~20s, então
      // ler do log nunca funciona a tempo; pela URL sempre se vê o atual.
      lastQr = qr;
      lastQrAt = Date.now();
      console.log("Escaneie o QR Code abaixo com o WhatsApp (Aparelhos conectados > Conectar um aparelho):");
      console.log("Ou abra http://127.0.0.1:3001/qr?token=<BOT_API_SECRET> no navegador da máquina.");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "close") {
      currentSock = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("Conexão com o WhatsApp fechada.", shouldReconnect ? "Reconectando..." : "Sessão deslogada — apague o volume de auth e escaneie o QR de novo.");
      if (shouldReconnect) start();
    } else if (connection === "open") {
      currentSock = sock;
      botReady = false;
      console.log("Bot conectado ao WhatsApp. Aguardando 45s para inicialização das chaves E2E...");
      setTimeout(() => {
        botReady = true;
        console.log("Bot pronto para enviar mensagens.");
      }, 45000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith("@g.us")) continue;

      const rawText = extractText(msg).trim();
      const text = normalize(rawText);
      if (!text) continue;

      try {
        if (text === "/bot" || text === "bot") {
          const menu = buildMenu(await fetchMessageTemplate("interactive_menu"));
          sessions.set(jid, { state: "menu", options: menu.options });
          await sock.sendMessage(jid, { text: menu.text });
          continue;
        }

        const session = sessions.get(jid);
        if (!session) continue; // ignora mensagens fora do fluxo, sem /bot não reagimos

        if (session.state === "menu") {
          const menuOptions = session.options || MENU_OPTIONS;
          const option = menuOptions.find((o) => o.number === text || normalize(o.key) === text || text.includes(o.key));
          if (!option) {
            await sock.sendMessage(jid, { text: "Opção inválida. " + buildMenu(await fetchMessageTemplate("interactive_menu")).text });
            continue;
          }

          if (option.key === "alocacao" || option.key === "minhas_tarefas") {
            sessions.set(jid, { state: "awaiting_name", purpose: option.key });
            await sock.sendMessage(jid, { text: "Qual é o seu nome completo (como está cadastrado no sistema)?" });
            continue;
          }

          if (option.key === "atualizacao_projetos") {
            const sites = await botGet("/bot/sites/");
            if (!sites.length) {
              sessions.delete(jid);
              await sock.sendMessage(jid, { text: "Não encontrei nenhum site com projeto ativo no momento." });
              continue;
            }
            sessions.set(jid, { state: "select_site", sites });
            const list = sites.map((s, i) => `${i + 1}️⃣ ${s.name}`).join("\n");
            await sock.sendMessage(jid, { text: `Qual site?\n\n${list}\n\nDigite o número.` });
            continue;
          }

          if (option.key === "status_tecnicos") {
            const sites = await botGet("/bot/tech-status/sites/");
            if (!sites.length) {
              sessions.delete(jid);
              await sock.sendMessage(jid, { text: "Não encontrei nenhum site com técnico ativo vinculado no momento." });
              continue;
            }
            sessions.set(jid, { state: "select_status_site", sites });
            const list = sites.map((s, i) => `${i + 1}️⃣ ${s.name}`).join("\n");
            await sock.sendMessage(jid, {
              text: `De qual site você quer ver o status dos técnicos?\n\n0️⃣ Todos os sites\n${list}\n\nDigite o número.`,
            });
            continue;
          }
        }

        if (session.state === "select_status_site") {
          sessions.delete(jid);
          if (text === "0" || text.includes("todos")) {
            const reply = await fetchTechStatus(null, "todos os sites");
            await sock.sendMessage(jid, { text: reply });
            continue;
          }
          const index = parseInt(text, 10) - 1;
          const site = session.sites[index];
          if (!site) {
            await sock.sendMessage(jid, { text: "Número inválido. Digite /bot para recomeçar." });
            continue;
          }
          const reply = await fetchTechStatus(site.id, site.name);
          await sock.sendMessage(jid, { text: reply });
          continue;
        }

        if (session.state === "select_site") {
          const index = parseInt(text, 10) - 1;
          const site = session.sites[index];
          if (!site) {
            await sock.sendMessage(jid, { text: "Número inválido. Digite o número de um dos sites da lista, ou /bot para recomeçar." });
            continue;
          }

          const projects = await botGet("/bot/projects/", { site_id: site.id });
          if (!projects.length) {
            sessions.delete(jid);
            await sock.sendMessage(jid, { text: `Não há projetos ativos em ${site.name} no momento.` });
            continue;
          }
          sessions.set(jid, { state: "select_project", site, projects });
          const list = projects.map((p, i) => `${i + 1}️⃣ ${p.code ? `${p.code} - ` : ""}${p.name}`).join("\n");
          await sock.sendMessage(jid, {
            text: `Projetos ativos em ${site.name}:\n\n${list}\n\n0️⃣ Todos os projetos ativos deste site\n\nDigite o número.`,
          });
          continue;
        }

        if (session.state === "select_project") {
          const { site, projects } = session;
          sessions.delete(jid);

          if (text === "0" || text.includes("todos")) {
            const updates = await botGet("/bot/project-update/", { site_id: site.id });
            for (const update of updates) {
              await sock.sendMessage(jid, { text: formatProjectUpdate(update) });
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
            continue;
          }

          const index = parseInt(text, 10) - 1;
          const project = projects[index];
          if (!project) {
            await sock.sendMessage(jid, { text: "Número inválido. Digite /bot para recomeçar." });
            continue;
          }
          const [update] = await botGet("/bot/project-update/", { project_id: project.id });
          await sock.sendMessage(jid, { text: formatProjectUpdate(update) });
          continue;
        }

        if (session.state === "awaiting_name") {
          const { purpose } = session;
          sessions.delete(jid);
          const reply =
            purpose === "minhas_tarefas" ? await fetchMyTasksByName(rawText) : await fetchAllocationByName(rawText);
          await sock.sendMessage(jid, { text: reply });
          continue;
        }
      } catch (err) {
        console.error(`Erro ao responder ${jid}:`, err.message);
        sessions.delete(jid);
        try {
          await sock.sendMessage(jid, { text: "Desculpe, deu um erro. Digite /bot para começar de novo." });
        } catch {
          // ignora falha ao enviar a mensagem de erro
        }
      }
    }
  });
}

start().catch((err) => {
  console.error("Falha ao iniciar o bot:", err);
  process.exit(1);
});
