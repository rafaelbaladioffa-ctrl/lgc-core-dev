// Checkpoint-5 current methods; isolated synthetic persistence. No DB/API writes.
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
  const filename = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: false }, fileName: filename }).outputText;
  const exports = {};
  const context = { exports, module: { exports }, Date, Intl, Buffer, require(name) {
    if (name === '@nestjs/common') return nest;
    if (name === 'node:crypto') return crypto;
    if (name.includes('attachment-security')) return { MAX_REQUEST_TOTAL_BYTES: 100 * 1024 * 1024 };
    throw new Error(`Unexpected import: ${name}`);
  } };
  vm.runInNewContext(code, context, { filename }); return context.module.exports;
}
const { RequestRuntimeService } = load('backend/src/request-runtime/request-runtime.service.ts');
const { RequestProcessesService } = load('backend/src/request-processes/request-processes.service.ts');
const config = { get: () => 'true' };
const author = { userId: 'user-A', collaboratorId: 'collaborator-A', permissions: ['request:create', 'request:read', 'request:comment'], roles: [] };
const manager = { userId: 'user-G', collaboratorId: 'collaborator-G', permissions: ['request:update', 'request:assign', 'request:read'], roles: [] };
function current(user) { return { status: 'active', collaboratorId: user.collaboratorId, userRoles: [{ role: { rolePermissions: user.permissions.map((p) => { const [resource, action] = p.split(':'); return { permission: { resource, action } }; }) } }] }; }
function definition() {
  const value = new RequestProcessesService({}, config).definition({ code: 'TEST', name: 'Test', description: 'Synthetic' }, 'queue-Q', 'queue-Q');
  value.form = [{ key: 'private_value', label: 'Private synthetic', type: 'text' }, { key: 'public_value', label: 'Public synthetic', type: 'text' }];
  value.formAccess = { private_value: 'hidden', public_value: 'write' }; return value;
}
const findings = [];
async function check(id, action) { try { findings.push({ id, result: await action() }); } catch (e) { findings.push({ id, error: e.message }); } }
async function saveFixture(fields) {
  const d = definition(); let stored = { private_value: 'synthetic protected value', public_value: 'old public value' };
  const row = { id: 'request-R', status: 'rascunho', requesterId: author.collaboratorId, title: 'Synthetic title', description: 'Description', categoryVersion: { bpmDefinition: d }, formData: stored };
  const service = new RequestRuntimeService({ user: { findUnique: async () => current(author) }, request: { updateMany: async (q) => { stored = q.data.formData; return { count: 1 }; }, findUniqueOrThrow: async () => ({ ...row, formData: stored }) } }, config);
  service.requestAccess = async () => row;
  const response = await service.saveDraft('request-R', { expectedVersion: 0, title: 'New synthetic title', ...(fields === undefined ? {} : { fields }) }, author);
  return { storedFields: stored, responseFields: response.formData };
}
async function cancelFixture(actor) {
  const tx = { request: { updateMany: async () => ({ count: 1 }) }, activityInstance: { updateMany: async () => ({ count: 1 }) }, activityAssignment: { updateMany: async () => ({ count: 1 }) }, executionToken: { updateMany: async () => ({ count: 1 }) }, processInstance: { updateMany: async () => ({ count: 1 }) }, requestSlaClock: { findMany: async () => [] } };
  const service = new RequestRuntimeService({ user: { findUnique: async () => current(actor) }, $transaction: async (fn) => fn(tx) }, config);
  service.requestAccess = async () => ({ id: 'request-R', status: 'em_atendimento', requesterId: author.collaboratorId, beneficiaryId: author.collaboratorId, currentCycle: 1, queue: { bpmMembers: [{ collaboratorId: actor.collaboratorId, role: 'manager', active: true }] }, bpmInstances: [{ id: 'instance-I', activities: [{ id: 'activity-X', phase: 'execution' }] }] });
  service.event = async () => ({ id: 'event-E' });
  return service.cancel('request-R', { expectedVersion: 0, commandKey: 'new-key', commandId: 'new-command', reason: 'Synthetic cancellation' }, actor);
}
async function main() {
  await check('E01-title-save-preserves-and-masks', () => saveFixture(undefined));
  await check('E02-public-field-save-drops-protected-value', () => saveFixture({ public_value: 'new public value' }));
  await check('E03-manager-with-management-permission-can-cancel', () => cancelFixture(manager));
  await check('E04-manager-without-management-permission-also-cancels', () => cancelFixture({ ...manager, permissions: ['request:create', 'request:read'] }));
  await check('E05-breach-recorded-at-stop-instead-of-deadline', async () => {
    let saved;
    const service = new RequestRuntimeService({}, config);
    await service.stopClocks({ requestSlaClock: { findMany: async () => [{ id: 'clock-C', checkpointAt: new Date('2026-11-02T11:00:00Z'), elapsedSeconds: 0, budgetSeconds: 3600, targetAt: new Date('2026-11-02T12:00:00Z'), calendarSnapshot: { holidays: [] }, breachedAt: null }], update: async (q) => { saved = q.data; return {}; } } }, 'request-R', new Date('2026-11-02T13:00:00Z'), 'resolution');
    return { elapsedSeconds: saved.elapsedSeconds, actualBreachedAt: saved.breachedAt.toISOString(), expectedBreachedAt: '2026-11-02T12:00:00.000Z' };
  });
  await check('E06-screens-unchanged-from-checkpoint-4', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(root, 'docs/requisicoes-bpm/evidencias/P01/revisao-sol-rodada-4/reviewed-files.json'), 'utf8'));
    const relative = 'frontend/src/features/requisicoes-bpm/BpmPages.tsx';
    const previous = baseline.find((item) => item.path === relative).sha256;
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex').toUpperCase();
    return { unchanged: previous === actual };
  });
  await check('E07-document-mask-now-matches-global-mask', () => {
    const d = definition(); const service = new RequestRuntimeService({}, config);
    return { projectedFields: service.projectFields(d, { private_value: ['file-F'] }), documentVisible: service.attachmentVisible({ categoryVersion: { bpmDefinition: d }, bpmInstances: [{ activities: [{ nodeId: 'triage', state: 'claimed' }] }] }, 'private_value') };
  });
  console.log(JSON.stringify({ note: 'Checkpoint-5 actual-method observations; no PostgreSQL/HTTP/browser execution.', findings }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
