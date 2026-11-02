import { randomUUID } from 'node:crypto';

const base = 'http://127.0.0.1:3000/api/v1';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(`${options.method ?? 'GET'} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

const tokens = await request('/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
  }),
});
const auth = { authorization: `Bearer ${tokens.accessToken}` };
const get = (path) => request(path, { headers: auth });
const command = async (method, path, input) => {
  const commandKey = randomUUID();
  return request(path, {
    method,
    headers: {
      ...auth,
      'content-type': 'application/json',
      'Idempotency-Key': commandKey,
    },
    body: JSON.stringify({
      ...input,
      commandKey,
      commandId: randomUUID(),
    }),
  });
};

let category = (await get('/bpm/processes')).find(
  (candidate) => candidate.code === 'P01-PILOTO',
);
if (!category) throw new Error('P01-PILOTO not found');
let current = category.versions.find(
  (version) => version.id === category.publishedBpmVersionId,
);
if (!current) throw new Error('Published P01 version not found');

const alreadyReady = current.bpmDefinition?.form?.some(
  (field) => field.type === 'attachment',
);
if (!alreadyReady) {
  const cloned = await command('POST', `/bpm/processes/${category.id}/versions`, {
    expectedVersion: category.configRevision,
    cloneVersionId: current.version,
  });
  const definition = structuredClone(cloned.bpmDefinition);
  definition.form = [
    {
      key: 'observacao_adicional',
      label: 'Observação adicional',
      type: 'textarea',
      maxLength: 1000,
      required: false,
    },
    {
      key: 'quantidade',
      label: 'Quantidade',
      type: 'integer',
      required: false,
    },
    {
      key: 'urgente',
      label: 'É urgente?',
      type: 'boolean',
      required: false,
    },
    {
      key: 'anexos',
      label: 'Anexos',
      type: 'attachment',
      required: false,
    },
  ];
  const patched = await command('PATCH', `/bpm/versions/${cloned.id}`, {
    expectedVersion: cloned.bpmRevision,
    definition,
  });
  const validation = await command(
    'POST',
    `/bpm/versions/${cloned.id}/validate`,
    { expectedVersion: patched.bpmRevision },
  );
  if (!validation.valid || !validation.validatedHash)
    throw new Error(`P01 v2 validation failed: ${JSON.stringify(validation)}`);
  await command('POST', `/bpm/versions/${cloned.id}/publish`, {
    expectedVersion: patched.bpmRevision,
    validatedHash: validation.validatedHash,
  });
}

const [catalog, queues] = await Promise.all([
  get('/bpm/catalog'),
  get('/bpm/queues'),
]);
const published = catalog.find((candidate) => candidate.code === 'P01-PILOTO');
const queue = queues.find((candidate) => candidate.name === 'P01 - Atendimento piloto');
console.log(
  JSON.stringify({
    code: published?.code,
    version: published?.versions?.[0]?.version,
    fields: published?.versions?.[0]?.bpmDefinition?.form?.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type,
    })),
    operators: queue?.bpmMembers?.map((member) => ({
      name: member.collaborator?.fullName,
      role: member.role,
    })),
  }),
);
