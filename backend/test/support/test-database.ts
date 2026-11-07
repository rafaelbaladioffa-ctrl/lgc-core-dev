/** Guarda dos testes de integração (e2e): nunca apontar para um banco compartilhado do Axis.
 * Exige `TEST_DATABASE_URL` com PostgreSQL local e nome de banco terminado em `_test`
 * (ex.: postgresql://axis:axis@localhost:5432/axis_test). */
export function requireTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL é obrigatória para os testes de integração');
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:')
    throw new Error('Os testes de integração exigem uma URL PostgreSQL');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname))
    throw new Error('Os testes de integração só aceitam PostgreSQL local');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database.endsWith('_test'))
    throw new Error('Os testes de integração exigem um banco dedicado com nome terminado em _test');
  if (/axis_logistica/i.test(database))
    throw new Error('Recusando usar o banco da Logística');
  return value;
}
