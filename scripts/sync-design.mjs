#!/usr/bin/env node
// Propaga a identidade visual do Core para os satélites (Logística, Financeiro e Field).
// Uso: node scripts/sync-design.mjs [--check]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checar = process.argv.includes('--check');
const origem = join(raiz, 'frontend');
const satelites = ['lgc-dev-logistica/frontend', 'lgc-dev-financeiro/frontend', 'lgc-dev-field/frontend'];
const estilos = ['axis-tokens.css', 'axis-shell.css'];
const icones = ['favicon-192.png', 'favicon-512.png', 'apple-touch-icon.png'];

// Arquivos de texto (CSS, SVG) são comparados em LF: com core.autocrlf o Git pode gravá-los com CRLF no Windows.
const lf = (buf) => Buffer.from(buf.toString('utf8').replaceAll('\r\n', '\n'), 'utf8');

// Lista de { destino, conteudo (Buffer) } esperada.
const esperados = [];
for (const sat of satelites) {
  const base = join(raiz, sat);
  for (const arq of estilos) {
    // Normaliza para LF: com core.autocrlf o Git pode reescrever as cópias com CRLF no Windows.
    const texto = readFileSync(join(origem, 'src/styles', arq), 'utf8').replaceAll('\r\n', '\n');
    const cabecalho = `/* GERADO por scripts/sync-design.mjs a partir de frontend/src/styles/${arq} — não edite aqui. */\n`;
    esperados.push({ destino: join(base, 'src/styles', arq), conteudo: Buffer.from(cabecalho + texto, 'utf8') });
  }
  const marca = join(origem, 'public/brand-industrial');
  for (const arq of readdirSync(marca).filter((f) => f.endsWith('.svg'))) {
    esperados.push({ destino: join(base, 'public/brand-industrial', arq), conteudo: lf(readFileSync(join(marca, arq))) });
  }
  for (const arq of icones) {
    const fonte = join(origem, 'public', arq);
    if (!existsSync(fonte)) throw new Error(`Arquivo de origem ausente: ${fonte}`);
    esperados.push({ destino: join(base, 'public', arq), conteudo: readFileSync(fonte) });
  }
}

const rel = (p) => p.slice(raiz.length + 1).replaceAll(String.fromCharCode(92), '/');
const divergentes = [];
for (const { destino, conteudo } of esperados) {
  const lido = existsSync(destino) ? readFileSync(destino) : null;
  const atual = lido && /\.(css|svg)$/.test(destino) ? lf(lido) : lido;
  if (atual && atual.equals(conteudo)) continue;
  divergentes.push(`${atual ? 'divergente' : 'ausente'}: ${rel(destino)}`);
  if (!checar) {
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, conteudo);
  }
}

if (checar) {
  if (divergentes.length) {
    console.error('Cópias do design fora de sincronia (rode: node scripts/sync-design.mjs):');
    for (const d of divergentes) console.error(`  ${d}`);
    process.exit(1);
  }
  console.log('Design sincronizado.');
} else if (divergentes.length) {
  console.log('Atualizados:');
  for (const d of divergentes) console.log(`  ${d}`);
} else {
  console.log('Nada a atualizar.');
}
