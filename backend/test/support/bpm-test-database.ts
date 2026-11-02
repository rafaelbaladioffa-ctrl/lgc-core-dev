/** Guardrail for BPM integration tests: never point them at a shared Axis database. */
export function requireBpmTestDatabaseUrl() {
  const value = process.env.BPM_TEST_DATABASE_URL;
  if (!value) throw new Error('BPM_TEST_DATABASE_URL is required');
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:')
    throw new Error('BPM tests require a PostgreSQL URL');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname))
    throw new Error('BPM tests only allow a local PostgreSQL host');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database.endsWith('_bpm_test'))
    throw new Error(
      'BPM tests require a dedicated database ending in _bpm_test',
    );
  if (/axis_logistica|(^|_)axis($|_)/i.test(database))
    throw new Error('Refusing to use a shared Axis database');
  return value;
}
