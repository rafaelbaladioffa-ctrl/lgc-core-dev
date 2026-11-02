// Read-only review reproductions. No database, migrations, server or source writes.
// These checks prove isolated code behavior; they do not replace P01 integration tests.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../../..');
const ts = require(path.join(root, 'backend/node_modules/typescript'));
const findings = [];
const nest = { Injectable: () => (target) => target };
for (const name of ['BadRequestException', 'ConflictException', 'ForbiddenException', 'NotFoundException']) {
  nest[name] = class extends Error {
    constructor(payload) { super(typeof payload === 'string' ? payload : JSON.stringify(payload)); this.payload = payload; }
  };
}
function load(relative, suffix = '') {
  const file = path.join(root, relative);
  const source = fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source + suffix, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: false },
    fileName: file,
  }).outputText;
  const exports = {};
  const context = { exports, module: { exports }, Buffer, Date, console,
    require(name) {
      if (name === '@nestjs/common') return nest;
      if (name === 'node:crypto') return crypto;
      if (name.includes('attachment-security')) return { MAX_REQUEST_TOTAL_BYTES: 100 * 1024 * 1024 };
      throw new Error(`Unexpected import in isolated check: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context, { filename: file });
  return context.module.exports;
}
async function capture(id, check) {
  try { findings.push({ id, result: await check() }); }
  catch (error) { findings.push({ id, error: error.message }); }
}
async function main() {
  const runtime = load('backend/src/request-runtime/request-runtime.service.ts', '\nexports.reviewAddBusinessMinutes = addBusinessMinutes;');
  const processes = load('backend/src/request-processes/request-processes.service.ts');
  const enabled = { get: () => 'true' };
  const service = new runtime.RequestRuntimeService({}, enabled);
  const actor = { userId: 'user-author', collaboratorId: 'author', permissions: ['request:read', 'request:create'], roles: [] };
  await capture('S01-submit-common-fields', async () => {
    try { await service.validateFields({ form: [] }, { title: 'Solicitacao de teste', description: 'Descricao valida' }, true); return { accepted: true }; }
    catch (error) { return { accepted: false, error: error.message }; }
  });
  await capture('S02-malformed-graph', () => {
    const model = new processes.RequestProcessesService({}, enabled);
    return model.validateDefinition({ format: 'axis-bpm/1',
      nodes: ['start', 'triage', 'execute', 'end'].map((id) => ({ id, type: 'unsupported' })),
      edges: Array.from({ length: 3 }, () => ({ from: 'triage', to: 'triage' })), form: [] });
  });
  await capture('S03-internal-note-visible-to-author', async () => {
    const isolated = new runtime.RequestRuntimeService({}, enabled);
    isolated.requestAccess = async () => ({ id: 'request', requesterId: 'author', code: 'REQ-TEST',
      status: 'em_atendimento', lockVersion: 1, currentCycle: 1, title: 'Test', description: 'Test',
      formData: {}, categoryVersion: { category: {}, version: 1 }, queue: { bpmMembers: [] },
      bpmInstances: [], bpmAttachments: [], bpmComments: [{ visibility: 'interno', body: 'Private team note' }] });
    const dto = await isolated.detail('request', actor);
    return { returnedInternalNotes: dto.comments.filter((c) => c.visibility === 'interno').length };
  });
  await capture('S04-submit-replay-precondition', async () => {
    const isolated = new runtime.RequestRuntimeService({}, enabled);
    isolated.requestAccess = async () => ({ requesterId: 'author', status: 'enviada' });
    let receiptReached = false;
    isolated.receipt = async () => { receiptReached = true; return { id: 'existing-receipt' }; };
    try { await isolated.submit('request', { expectedVersion: 0, commandKey: 'same-key', commandId: 'same-command' }, actor); return { receiptReached }; }
    catch (error) { return { receiptReached, error: error.message }; }
  });
  await capture('S05-sla-holiday', () => {
    const actual = runtime.reviewAddBusinessMinutes(new Date('2026-11-06T20:30:00.000Z'), 120).toISOString();
    return { fixtureHoliday: '2026-11-09', actual, expectedWithPublishedHoliday: '2026-11-10T12:30:00.000Z' };
  });
  await capture('S06-field-validation', async () => {
    const samples = [
      { field: { key: 'date', type: 'date' }, value: '2026-02-30' },
      { field: { key: 'amount', type: 'decimal' }, value: '1234567890123456.12345' },
      { field: { key: 'text', type: 'text', required: true }, value: '   ' },
      { field: { key: 'proof', type: 'attachment', required: true }, value: ['not-an-owned-attachment'] },
    ];
    const results = [];
    for (const sample of samples) {
      try { await service.validateFields({ form: [sample.field] }, { [sample.field.key]: sample.value }, true); results.push({ field: sample.field.key, accepted: true }); }
      catch (error) { results.push({ field: sample.field.key, accepted: false, error: error.message }); }
    }
    return results;
  });
  await capture('S07-global-modeler-can-patch-without-process-grant', async () => {
    let updated = false;
    const model = new processes.RequestProcessesService({ categoryVersion: {
      findUnique: async () => ({ id: 'foreign-version', bpmStatus: 'draft', bpmRevision: 0 }),
      update: async () => { updated = true; return {}; },
    } }, enabled);
    await model.patchVersion('foreign-version', { expectedVersion: 0, definition: { format: 'axis-bpm/1',
      nodes: ['start', 'triage', 'execute', 'end'].map((id) => ({ id })), edges: [{}, {}, {}], form: [] } },
    { ...actor, permissions: ['request_process:model'] });
    return { updatedWithoutAnyGrantLookup: updated };
  });
  await capture('S08-receipt-ignores-route-and-target', async () => {
    const body = { expectedVersion: 0, commandKey: 'same-key', commandId: 'same-command' };
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const existing = { id: 'receipt', routeScope: 'submit', requestId: 'request-A', requestHash };
    const result = await service.receipt({ requestCommandReceipt: { findUnique: async () => existing } }, actor.userId, body.commandKey, 'claim', body);
    return { requestedRoute: 'claim', returnedRoute: result.routeScope, returnedRequest: result.requestId };
  });
  await capture('S09-beneficiary-can-read-private-draft', async () => {
    const isolated = new runtime.RequestRuntimeService({ request: { findUnique: async () => ({
      executionMode: 'bpm_v1', status: 'rascunho', requesterId: 'different-author', beneficiaryId: actor.collaboratorId,
      queue: null, categoryVersion: { categoryId: 'category' },
    }) }, processConfigGrant: { findFirst: async () => null } }, enabled);
    return { granted: !!(await isolated.requestAccess('private-draft', actor)) };
  });
  console.log(JSON.stringify({ note: 'Isolated read-only checks; no DB or HTTP integration executed.', findings }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
