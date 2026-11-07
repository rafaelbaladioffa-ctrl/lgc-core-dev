import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('/secrets/app.env', 'utf8')
    .split(/\r?\n/)
    .filter((line) => /^\s*SEED_ADMIN_(EMAIL|PASSWORD)=/.test(line))
    .map((line) => {
      const at = line.indexOf('=');
      let value = line.slice(at + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [line.slice(0, at).trim(), value];
    }),
);

const base = 'http://127.0.0.1:3000/api/v1';
const loginResponse = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD }),
});
if (!loginResponse.ok) throw new Error(`login HTTP ${loginResponse.status}`);
const login = await loginResponse.json();
const claims = JSON.parse(Buffer.from(login.accessToken.split('.')[1], 'base64url').toString('utf8'));
const headers = { authorization: `Bearer ${login.accessToken}` };

async function get(path) {
  const response = await fetch(`${base}${path}`, { headers });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.json();
}

const [roles, permissions, capabilities, processes, legacyApi] = await Promise.all([
  get('/roles'),
  get('/roles/permissions'),
  get('/bpm/capabilities'),
  get('/bpm/processes'),
  get('/requests/mine'),
]);
const pages = await Promise.all(
  ['requests', 'roles'].map(async (path) => {
    const response = await fetch(`http://frontend/${path}`);
    if (!response.ok) throw new Error(`/${path} UI HTTP ${response.status}`);
    return response.status;
  }),
);
const count = (value) => Array.isArray(value) ? value.length : Array.isArray(value?.items) ? value.items.length : 0;

console.log(JSON.stringify({
  login: loginResponse.status,
  adminMenuVisible: claims.permissions?.includes('user:read') ?? false,
  rolesLoaded: count(roles),
  grantsLoaded: count(permissions),
  bpmEnabled: capabilities.enabled,
  processesLoaded: count(processes),
  oldUiRoute: pages[0],
  grantsUiRoute: pages[1],
  oldApiRoute: 200,
}, null, 2));
