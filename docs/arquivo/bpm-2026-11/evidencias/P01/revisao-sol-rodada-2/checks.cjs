// Read-only checks of the round-2 source, with explicit current fixtures.
// No database/network/application writes. Not an integration acceptance suite.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const ts = require(path.join(root, 'backend/node_modules/typescript'));
const nest = { Injectable: () => (target) => target };
for (const name of ['BadRequestException', 'ConflictException', 'ForbiddenException', 'NotFoundException'])
  nest[name] = class extends Error { constructor(payload) { super(typeof payload === 'string' ? payload : JSON.stringify(payload)); } };
function load(relative) {
  const file = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: false }, fileName: file,
  }).outputText;
  const exports = {};
  const context = { exports, module: { exports }, Buffer, Date, Intl,
    require(name) {
      if (name === '@nestjs/common') return nest;
      if (name === 'node:crypto') return crypto;
      if (name.includes('attachment-security')) return { MAX_REQUEST_TOTAL_BYTES: 100 * 1024 * 1024 };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(code, context, { filename: file });
  return context.module.exports;
}
const runtime = load('backend/src/request-runtime/request-runtime.service.ts');
const processes = load('backend/src/request-processes/request-processes.service.ts');
const config = { get: () => 'true' };
const actor = { userId: 'author-user', collaboratorId: 'author', permissions: ['request:create', 'request:read', 'request:comment'], roles: [] };
const active = (permissions) => ({ status: 'active', userRoles: [{ role: { rolePermissions: permissions.map((value) => { const [resource, action] = value.split(':'); return { permission: { resource, action } }; }) } }] });
const definition = () => ({ format: 'axis-bpm/1', capabilities: ['human_tasks'],
  nodes: [{ id: 'start', type: 'start' }, { id: 'triage', type: 'human', phase: 'triage', queueId: 'q' }, { id: 'execute', type: 'human', phase: 'execution', queueId: 'q' }, { id: 'end', type: 'end', terminalOutcome: 'completed' }],
  edges: [{ from: 'start', to: 'triage' }, { from: 'triage', to: 'execute' }, { from: 'execute', to: 'end' }], form: [] });
const findings = [];
async function check(id, action) { try { findings.push({ id, result: await action() }); } catch (error) { findings.push({ id, error: error.message }); } }
async function main() {
  await check('T01-submit-replay-and-current-auth', async () => {
    const dto = { expectedVersion: 0, commandKey: 'retry-key', commandId: 'original-command' };
    const requestId = 'r';
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({ routeScope: 'submit', requestId, body: { ...dto, requestId } })).digest('hex');
    let currentUserReads = 0;
    const service = new runtime.RequestRuntimeService({
      user: { findUnique: async () => { currentUserReads++; return { status: 'disabled', userRoles: [] }; } },
      queue: { findUnique: async () => ({ id: 'q', bpmMembers: [] }) },
      $transaction: async (fn) => fn({ requestCommandReceipt: { findUnique: async () => ({ id: 'receipt', requestId, requestHash, resultRef: { currentVersion: 1 } }) } }),
    }, config);
    service.requestAccess = async () => ({ requesterId: actor.collaboratorId, status: 'enviada', lockVersion: 4,
      title: 'Titulo de teste valido', description: 'Descricao valida', formData: {}, categoryVersion: { bpmDefinition: definition() } });
    const response = await service.submit(requestId, dto, actor);
    return { response, currentUserReads, currentResourceVersion: 4, note: 'Replay now reaches receipt, but no current-auth lookup and returned version is stale.' };
  });
  await check('T02-author-save-requires-executor-permission', async () => {
    const service = new runtime.RequestRuntimeService({ user: { findUnique: async () => active(actor.permissions) } }, config);
    try { await service.saveDraft('r', { expectedVersion: 0, title: 'Titulo' }, actor); return { allowed: true }; }
    catch (error) { return { allowed: false, currentPermissions: actor.permissions, error: error.message }; }
  });
  await check('T03-manager-reassign-requires-candidate', async () => {
    const manager = { ...actor, userId: 'manager-user', collaboratorId: 'manager', permissions: ['request:update', 'request:assign', 'request:read'] };
    let requestScopeReached = false;
    const service = new runtime.RequestRuntimeService({ user: { findUnique: async () => active(manager.permissions) },
      activityInstance: { findUnique: async () => ({ id: 'a', instance: { request: { executionMode: 'bpm_v1' }, requestId: 'r' }, candidates: [{ collaboratorId: 'executor' }] }) },
    }, config);
    service.requestAccess = async () => { requestScopeReached = true; return { queue: { bpmMembers: [{ collaboratorId: 'manager', role: 'manager', active: true }] } }; };
    try { await service.reassign('a', { expectedVersion: 0, assigneeId: 'executor', commandKey: 'k', commandId: 'c', reason: 'Redistribuir' }, manager); return { allowed: true }; }
    catch (error) { return { allowed: false, requestScopeReached, error: error.message }; }
  });
  await check('T04-receipt-does-not-bind-activity-id', async () => {
    const body = { expectedVersion: 0, commandKey: 'same-key', commandId: 'same-command', requestId: 'r' };
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({ routeScope: 'claim', requestId: 'r', body })).digest('hex');
    const service = new runtime.RequestRuntimeService({}, config);
    const result = await service.receipt({ requestCommandReceipt: { findUnique: async () => ({ id: 'receipt', requestHash, resultRef: { activityId: 'activity-A' } }) } }, actor.userId, body.commandKey, 'claim', body);
    return { replayForDifferentActivityCanUseSameBody: true, activityIdReturned: result.resultRef.activityId, note: 'Callers add Request.id to body, but not route activity id.' };
  });
  await check('T05-sla-seconds-cross-close', () => ({
    start: '2026-11-06T20:59:45.000Z', minutes: 1,
    actual: runtime.addBusinessMinutes(new Date('2026-11-06T20:59:45.000Z'), 1).toISOString(),
    expected: '2026-11-09T11:00:45.000Z',
  }));
  await check('T06-definition-unsupported-phase-capability-budget', () => {
    const value = definition(); value.nodes[1].phase = 'missing-triage'; value.capabilities = ['unsupported_approval']; value.sla = { firstResponseMinutes: -1, resolutionMinutes: 0 };
    return new processes.RequestProcessesService({}, config).validateDefinition(value);
  });
  await check('T07-numeric-and-text-limits', async () => {
    const service = new runtime.RequestRuntimeService({}, config);
    const cases = [
      { field: { key: 'amount', type: 'decimal' }, value: 0.123456789 },
      { field: { key: 'amount', type: 'decimal' }, value: '12345678901234567890.1234' },
      { field: { key: 'count', type: 'integer' }, value: 9007199254740992 },
      { field: { key: 'text', type: 'text', maxLength: 3 }, value: 'much longer' },
    ];
    const result = [];
    for (const item of cases) { try { await service.validateFields({ form: [item.field] }, { [item.field.key]: item.value }, true); result.push({ field: item.field, value: item.value, accepted: true }); } catch (error) { result.push({ field: item.field, value: item.value, accepted: false }); } }
    return result;
  });
  await check('T08-field-projection-and-note-fix', async () => {
    const service = new runtime.RequestRuntimeService({}, config);
    const def = definition(); def.nodes[2].formAccess = { private_field: 'hidden' };
    service.requestAccess = async () => ({ id: 'r', requesterId: 'other-author', code: 'REQ-TEST', status: 'em_atendimento', lockVersion: 1, currentCycle: 1,
      formData: { private_field: 'synthetic private value' }, categoryVersion: { category: {}, version: 1, bpmDefinition: def }, queue: { bpmMembers: [] },
      bpmInstances: [], bpmAttachments: [], bpmComments: [{ visibility: 'interno', body: 'synthetic team-only note' }] });
    const result = await service.detail('r', actor);
    return { fields: result.fields, internalNotesReturned: result.comments.length };
  });
  await check('T09-read-permission-not-revalidated-and-draft-list', async () => {
    let userReads = 0; let query;
    const service = new runtime.RequestRuntimeService({ user: { findUnique: async () => { userReads++; return { status: 'disabled' }; } }, request: { findMany: async (value) => { query = value; return []; } } }, config);
    await service.list(actor);
    return { userReads, beneficiaryBranch: query.where.OR.find((branch) => 'beneficiaryId' in branch), paginationTake: query.take ?? null };
  });
  await check('T10-confirmed-corrections', async () => {
    const service = new runtime.RequestRuntimeService({}, config);
    const formChecks = [];
    for (const item of [{ key: 'name', type: 'text', required: true, value: ' ' }, { key: 'when', type: 'date', value: '2026-02-30' }, { key: 'amount', type: 'decimal', value: '1.23456' }]) {
      const { value, ...field } = item;
      try { await service.validateFields({ form: [field] }, { [field.key]: value }, true); formChecks.push({ key: field.key, rejected: false }); } catch { formChecks.push({ key: field.key, rejected: true }); }
    }
    const badType = definition(); badType.nodes[1].type = 'unsupported';
    return { formChecks, unsupportedNodeRejected: !new processes.RequestProcessesService({}, config).validateDefinition(badType).valid,
      holidayTarget: runtime.addBusinessMinutes(new Date('2026-11-06T20:30:00.000Z'), 120, ['2026-11-09']).toISOString() };
  });
  console.log(JSON.stringify({ note: 'Round-2 actual methods, explicit fixtures; no PostgreSQL/HTTP integration.', findings }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
