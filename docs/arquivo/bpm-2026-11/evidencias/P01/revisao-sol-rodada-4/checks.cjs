// Isolated read-only observations of checkpoint 4, not a DB/API acceptance suite.
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
const { RequestRuntimeService } = load('backend/src/request-runtime/request-runtime.service.ts');
const { RequestProcessesService } = load('backend/src/request-processes/request-processes.service.ts');
const config = { get: () => 'true' };
const author = { userId: 'user-A', collaboratorId: 'collaborator-A', permissions: ['request:create', 'request:read', 'request:comment'], roles: [] };
const manager = { userId: 'user-G', collaboratorId: 'collaborator-G', permissions: ['request:update', 'request:assign', 'request:read'], roles: [] };
function current(user) { return { status: 'active', collaboratorId: user.collaboratorId, userRoles: [{ role: { rolePermissions: user.permissions.map((p) => { const [resource, action] = p.split(':'); return { permission: { resource, action } }; }) } }] }; }
const findings = [];
async function check(id, action) { try { findings.push({ id, result: await action() }); } catch (e) { findings.push({ id, error: e.message }); } }
async function main() {
  await check('D01-generated-definition-now-valid', () => {
    const service = new RequestProcessesService({}, config);
    const definition = service.definition({ code: 'TEST', name: 'Test', description: 'Synthetic' }, 'queue-Q', 'queue-Q');
    return { policy: definition.policy, validation: service.validateDefinition(definition) };
  });
  await check('D02-current-directory-separates-identities', async () => {
    const actor = { ...manager, permissions: ['request_queue:manage'] };
    const service = new RequestProcessesService({ user: { findUnique: async () => current(actor), findMany: async () => [{ id: 'user-P', collaborator: { id: 'collaborator-P', fullName: 'Synthetic Person', sectorId: 'sector-S' } }] } }, config);
    return await service.listCollaborators(actor);
  });
  await check('D03-save-draft-bypasses-field-projection', async () => {
    const processService = new RequestProcessesService({}, config);
    const definition = processService.definition({ code: 'TEST', name: 'Test', description: 'Synthetic' }, 'queue-Q', 'queue-Q');
    definition.form = [{ key: 'private_value', label: 'Private synthetic value', type: 'text' }];
    definition.formAccess = { private_value: 'hidden' };
    const row = { id: 'request-R', status: 'rascunho', requesterId: author.collaboratorId, categoryVersion: { bpmDefinition: definition }, formData: { private_value: 'synthetic-secret' }, title: 'Original synthetic title', description: 'Description' };
    let write;
    const service = new RequestRuntimeService({ user: { findUnique: async () => current(author) }, request: { updateMany: async (q) => { write = q.data; return { count: 1 }; }, findUniqueOrThrow: async () => ({ ...row, ...write }) } }, config);
    service.requestAccess = async () => row;
    const readProjection = service.projectFields(definition, row.formData);
    const saved = await service.saveDraft('request-R', { expectedVersion: 0, title: 'New synthetic title' }, author);
    return { detailFieldProjection: readProjection, saveDraftResponseFields: saved.formData };
  });
  await check('D04-manager-cancel-requires-requester-permission', async () => {
    const service = new RequestRuntimeService({ user: { findUnique: async () => current(manager) } }, config);
    try { await service.cancel('request-R', { expectedVersion: 0, commandKey: 'new-key', commandId: 'new-command', reason: 'Synthetic manager cancellation' }, manager); return { allowed: true }; }
    catch (e) { return { allowed: false, permissions: manager.permissions, error: e.message }; }
  });
  await check('D05-document-mask-disagrees-with-field-mask', () => {
    const processService = new RequestProcessesService({}, config);
    const definition = processService.definition({ code: 'TEST', name: 'Test', description: 'Synthetic' }, 'queue-Q', 'queue-Q');
    definition.formAccess = { private_file: 'hidden' };
    const service = new RequestRuntimeService({}, config);
    return { projectedFields: service.projectFields(definition, { private_file: ['file-F'] }), documentVisible: service.attachmentVisible({ categoryVersion: { bpmDefinition: definition }, bpmInstances: [{ activities: [{ nodeId: 'triage', state: 'claimed' }] }] }, 'private_file') };
  });
  console.log(JSON.stringify({ note: 'Checkpoint-4 current-method observations; synthetic persistence, no PostgreSQL/HTTP.', findings }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
