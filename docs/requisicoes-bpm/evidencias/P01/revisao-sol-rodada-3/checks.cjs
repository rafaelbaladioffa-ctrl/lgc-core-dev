// Round-3 read-only review. Actual methods; synthetic persistence fixtures.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const ts = require(path.join(root, 'backend/node_modules/typescript'));
const nest = { Injectable: () => (target) => target };
for (const name of ['BadRequestException', 'ConflictException', 'ForbiddenException', 'NotFoundException'])
  nest[name] = class extends Error { constructor(value) { super(typeof value === 'string' ? value : JSON.stringify(value)); } };
function load(relative) {
  const file = path.join(root, relative);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: false }, fileName: file }).outputText;
  const exports = {};
  const context = { exports, module: { exports }, Date, Intl, Buffer, require(name) {
    if (name === '@nestjs/common') return nest;
    if (name === 'node:crypto') return crypto;
    if (name.includes('attachment-security')) return { MAX_REQUEST_TOTAL_BYTES: 100 * 1024 * 1024 };
    throw new Error(`Unexpected import: ${name}`);
  } };
  vm.runInNewContext(compiled, context, { filename: file });
  return context.module.exports;
}
const { RequestRuntimeService, addBusinessMinutes } = load('backend/src/request-runtime/request-runtime.service.ts');
const { RequestProcessesService } = load('backend/src/request-processes/request-processes.service.ts');
const config = { get: () => 'true' };
const author = { userId: 'user-A', collaboratorId: 'collaborator-A', permissions: ['request:create', 'request:read', 'request:comment'], roles: [] };
const manager = { userId: 'user-G', collaboratorId: 'collaborator-G', permissions: ['request:update', 'request:assign', 'request:read'], roles: [] };
function current(user) { return { status: 'active', collaboratorId: user.collaboratorId, userRoles: [{ role: { rolePermissions: user.permissions.map((p) => { const [resource, action] = p.split(':'); return { permission: { resource, action } }; }) } }] }; }
const definition = () => ({ format: 'axis-bpm/1', capabilities: ['human_tasks'],
  policy: { confidentiality: 'interna', requiresAcceptance: false, allowRepresentation: false, closure: { mode: 'manual' } },
  sla: { firstResponseMinutes: 10, resolutionMinutes: 20 },
  nodes: [{ id: 'start', type: 'start' }, { id: 'triage', type: 'human', phase: 'triage', queueId: 'queue-Q' }, { id: 'execute', type: 'human', phase: 'execution', queueId: 'queue-Q' }, { id: 'end', type: 'end', terminalOutcome: 'completed' }],
  edges: [{ from: 'start', to: 'triage' }, { from: 'triage', to: 'execute' }, { from: 'execute', to: 'end' }], form: [] });
function request() { return { id: 'request-R', requesterId: author.collaboratorId, beneficiaryId: author.collaboratorId, status: 'em_atendimento', currentCycle: 1,
  queue: { bpmMembers: [{ collaboratorId: manager.collaboratorId, role: 'manager', active: true }, { collaboratorId: author.collaboratorId, role: 'member', active: true }] } }; }
const findings = [];
async function check(id, action) { try { findings.push({ id, result: await action() }); } catch (e) { findings.push({ id, error: e.message }); } }
async function main() {
  await check('C01-default-generated-definition-fails-validator', () => {
    const service = new RequestProcessesService({}, config);
    const value = service.definition({ code: 'TEST', name: 'Test', description: 'Synthetic' }, 'queue-Q', 'queue-Q');
    return { generatedPolicy: value.policy, validation: service.validateDefinition(value) };
  });
  await check('C02-publisher-directory-identity', async () => {
    let query;
    const configActor = { ...manager, permissions: ['request_queue:manage'] };
    const service = new RequestProcessesService({ user: { findUnique: async () => current(configActor) }, collaborator: { findMany: async (q) => { query = q; return [{ id: 'collaborator-P', fullName: 'Synthetic Person', sectorId: 'sector-S' }]; } } }, config);
    const rows = await service.listCollaborators(configActor);
    return { directorySelect: query.select, returnedRow: rows[0], userIdAvailable: 'userId' in rows[0] || 'user' in rows[0], uiUsesCollaboratorIdForPublisher: fs.readFileSync(path.join(root, 'frontend/src/features/requisicoes-bpm/BpmPages.tsx'), 'utf8').includes('publisherUserIds: [...new Set([...form.publisherUserIds, v])]') };
  });
  await check('C03-reassign-replay-hash-mismatch', async () => {
    const dto = { expectedVersion: 0, commandKey: 'retry-key', commandId: 'original-command', assigneeId: author.collaboratorId, reason: 'Synthetic assignment' };
    const storedHash = crypto.createHash('sha256').update(JSON.stringify({ routeScope: 'reassign', requestId: 'request-R', body: { ...dto, requestId: 'request-R', activityId: 'activity-X' } })).digest('hex');
    const service = new RequestRuntimeService({ user: { findUnique: async () => current(manager) }, $transaction: async (fn) => fn({ requestCommandReceipt: { findUnique: async () => ({ id: 'receipt', requestId: 'request-R', requestHash: storedHash }) } }) }, config);
    service.activity = async () => ({ id: 'activity-X', instanceId: 'instance-I', state: 'claimed', instance: { requestId: 'request-R' } });
    service.requestAccess = async () => request();
    try { return await service.reassign('activity-X', dto, manager); } catch (e) { return { replayAccepted: false, error: e.message }; }
  });
  await check('C04-manager-can-assign-requester', async () => {
    let assigned;
    const tx = {
      requestCommandReceipt: { findUnique: async () => null, create: async () => ({}) },
      request: { updateMany: async () => ({ count: 1 }) },
      activityInstance: { update: async (q) => { assigned = q.data.assigneeId; return {}; } },
      activityCandidate: { findFirst: async () => null, create: async () => ({}) },
      activityAssignment: { updateMany: async () => ({ count: 1 }), create: async () => ({}) },
    };
    const service = new RequestRuntimeService({ user: { findUnique: async () => current(manager) }, $transaction: async (fn) => fn(tx) }, config);
    service.activity = async () => ({ id: 'activity-X', instanceId: 'instance-I', state: 'claimed', instance: { requestId: 'request-R' } });
    service.requestAccess = async () => request(); service.event = async () => ({ id: 'event-E' });
    await service.reassign('activity-X', { expectedVersion: 0, commandKey: 'new-key', commandId: 'new-command', assigneeId: author.collaboratorId, reason: 'Synthetic assignment' }, manager);
    return { assignedToRequester: assigned === author.collaboratorId };
  });
  await check('C05-sla-config-does-not-drive-clocks', async () => {
    let clocks;
    const def = definition();
    const tx = { requestCommandReceipt: { findUnique: async () => null, create: async () => ({ id: 'receipt' }) }, request: { updateMany: async () => ({ count: 1 }) },
      processInstance: { create: async () => ({ id: 'instance-I' }) }, executionToken: { create: async () => ({ id: 'token' }) }, activityInstance: { create: async () => ({ id: 'activity-X' }) }, requestSlaClock: { createMany: async (q) => { clocks = q.data; return { count: 2 }; } } };
    const service = new RequestRuntimeService({ user: { findUnique: async () => current(author) }, queue: { findUnique: async () => ({ id: 'queue-Q', bpmMembers: [{ role: 'member', collaboratorId: 'executor-T', collaborator: { status: 'ativo', user: { status: 'active' } } }] }) }, $transaction: async (fn) => fn(tx) }, config);
    service.requestAccess = async () => ({ ...request(), status: 'rascunho', title: 'Titulo de teste valido', description: 'Descricao', formData: {}, categoryVersionId: 'version-V', categoryVersion: { bpmDefinition: def, slaFirstResponseMinutes: 240, slaResolutionMinutes: 2880, bpmCalendarSnapshot: { holidays: [] } } });
    service.event = async () => ({ id: 'event-E' });
    await service.submit('request-R', { expectedVersion: 0, commandKey: 'new-key', commandId: 'new-command' }, author);
    return { configuredMinutes: [def.sla.firstResponseMinutes, def.sla.resolutionMinutes], actualClockMinutes: clocks.map((c) => c.budgetSeconds / 60) };
  });
  await check('C06-hidden-document-still-downloads', async () => {
    const triager = { userId: 'user-T', collaboratorId: 'collaborator-T', permissions: ['request:read', 'request:update'], roles: [] };
    const service = new RequestRuntimeService({ user: { findUnique: async () => current(triager) }, bpmRequestAttachment: { findFirst: async () => ({ id: 'file-F', requestId: 'request-R', fieldKey: 'private_file', filename: 'synthetic-private.pdf', content: Buffer.from('synthetic') }) } }, config);
    const def = definition(); def.nodes[1].formAccess = { private_file: 'hidden' };
    service.requestAccess = async () => ({ ...request(), status: 'em_triagem', queue: { bpmMembers: [{ collaboratorId: triager.collaboratorId, role: 'member', active: true }] }, bpmInstances: [{ activities: [{ nodeId: 'triage', state: 'claimed', assigneeId: triager.collaboratorId }] }], categoryVersion: { bpmDefinition: def } });
    const result = await service.download('request-R', 'file-F', triager);
    return { hiddenDocumentDownloaded: result.fieldKey === 'private_file' };
  });
  await check('C07-corrected-guards-and-calendar', async () => {
    const service = new RequestRuntimeService({ user: { findUnique: async () => ({ ...current(author), status: 'disabled' }) } }, config);
    let revokedReadDenied = false;
    try { await service.list(author); } catch (e) { revokedReadDenied = e.message === 'Permissão atual insuficiente'; }
    return { revokedReadDenied, endOfDayTarget: addBusinessMinutes(new Date('2026-11-06T20:59:45Z'), 1).toISOString() };
  });
  await check('C08-publishedAt-schema-migration-drift', () => {
    const schema = fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'), 'utf8');
    const migration = fs.readFileSync(path.join(root, 'backend/prisma/migrations/20261101000000_request_bpm_p01/migration.sql'), 'utf8');
    return { nullableInSchema: /publishedAt\s+DateTime\?/.test(schema), defaultNowInSchema: /publishedAt[^\r\n]*@default\(now\(\)\)/.test(schema), migrationChangesPublishedAt: /ALTER[^;]*published_at/is.test(migration) };
  });
  console.log(JSON.stringify({ note: 'Round-3 actual-method observations; no DB/HTTP integration.', findings }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
