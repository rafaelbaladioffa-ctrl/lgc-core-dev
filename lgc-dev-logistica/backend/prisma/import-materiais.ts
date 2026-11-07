/**
 * Carga do catálogo de materiais da LGC a partir de `prisma/materiais-lgc.csv`.
 *
 * Aplica as mesmas regras do MaterialsService.create (7.1/7.2) e grava a versão 1 de
 * cada material, como a API faria. O código vem pronto no CSV — na API isso exigiria a
 * permissão `material:set_code`, porque itens com grade usam o sequencial para o tamanho
 * (EPI-BOT-0040 = numeração 40; UNI-POL-0004 = tamanho G).
 *
 * Por segurança só roda contra banco cujo nome termina em `_test`. Para rodar em outro
 * ambiente é preciso IMPORT_ALLOW_NON_TEST=true e, aí, backup antes.
 *
 *   node --env-file=.env.test node_modules/tsx/dist/cli.mjs prisma/import-materiais.ts
 *   ... --dry-run   valida tudo e não escreve nada
 */
import { readFileSync } from 'node:fs';
import { PrismaClient, Prisma, Criticality, ExitMethod, MaterialType } from '@prisma/client';

const prisma = new PrismaClient();
const CSV = new URL('./materiais-lgc.csv', import.meta.url);
const DRY_RUN = process.argv.includes('--dry-run');

const bool = (v: string) => v.trim().toLowerCase() === 'sim';
/** "1.234,56" -> 1234.56; vazio ou zero vira null (item sem cotação não entra no catálogo de compra). */
const money = (v: string): number | null => {
  const n = Number(v.trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const txt = (v: string) => (v.trim() === '' ? undefined : v.trim());
/** Valor de enum do schema; erra cedo e com o nome da coluna se o CSV trouxer um valor que não existe. */
function enumDe<T extends Record<string, string>>(alvo: T, valor: string, coluna: string, codigo: string): T[keyof T] {
  const v = valor.trim();
  if (!Object.values(alvo).includes(v)) throw new Error(`${codigo}: "${v}" não é um valor válido para ${coluna}. Aceitos: ${Object.values(alvo).join(', ')}.`);
  return v as T[keyof T];
}

/**
 * Compara o que está no banco com o que o CSV traz. Trata os dois descasamentos de tipo que
 * aparecem aqui: custo volta como Prisma.Decimal e não como number, e campo de texto em branco
 * vira `undefined` no CSV mas é `null` na coluna.
 */
function mesmoValor(noBanco: unknown, doCsv: unknown): boolean {
  const vazio = (v: unknown) => v === null || v === undefined;
  if (vazio(noBanco) && vazio(doCsv)) return true;
  if (vazio(noBanco) || vazio(doCsv)) return false;
  if (noBanco instanceof Prisma.Decimal) return noBanco.equals(new Prisma.Decimal(doCsv as number));
  return noBanco === doCsv;
}

interface Row { [k: string]: string }

function parseCsv(raw: string): Row[] {
  const lines = raw.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  const cols = lines[0].split(';');
  return lines.slice(1).map((line, i) => {
    const cells = line.split(';');
    if (cells.length !== cols.length) throw new Error(`Linha ${i + 2}: esperava ${cols.length} colunas e veio ${cells.length}. Campo com ";" no meio?`);
    return Object.fromEntries(cols.map((c, j) => [c, cells[j]])) as Row;
  });
}

/** Mesmas regras do MaterialsService.validateRules. */
function validar(m: { code: string; lotControlled: boolean; expiryControlled: boolean; minShelfLifeDays: number | null; serialControlled: boolean; exitMethod: string; requiresAuthorization: boolean; authorizationBy?: string }) {
  const e: string[] = [];
  if (m.expiryControlled && !m.lotControlled) e.push('controle de validade exige controle por lote');
  if (m.minShelfLifeDays != null && !m.expiryControlled) e.push('vida útil mínima só se aplica com controle de validade');
  if (m.serialControlled && m.exitMethod !== 'SERIE_ESPECIFICA') e.push('item com número de série deve sair por SERIE_ESPECIFICA');
  if (m.exitMethod === 'FEFO' && !m.expiryControlled) e.push('FEFO exige controle de validade');
  if (m.requiresAuthorization && !m.authorizationBy) e.push('exige autorização mas não diz quem autoriza');
  if (!/^[A-Z0-9]+(-[A-Z0-9]+)+$/.test(m.code) || m.code.length > 40) e.push(`código inválido (${m.code})`);
  return e;
}

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const banco = url.pathname.slice(1);
  if (!banco.endsWith('_test') && process.env.IMPORT_ALLOW_NON_TEST !== 'true') {
    throw new Error(`Recusando rodar contra "${banco}": este script só roda em banco terminado em _test. Use IMPORT_ALLOW_NON_TEST=true se for mesmo a intenção, com backup feito.`);
  }
  console.log(`Banco: ${banco} em ${url.hostname}:${url.port}${DRY_RUN ? '  (dry-run, nada será escrito)' : ''}`);

  const rows = parseCsv(readFileSync(CSV, 'utf8'));
  const uoms = new Map((await prisma.unitOfMeasure.findMany({ where: { active: true } })).map((u) => [u.code, u.id]));

  const materiais = rows.map((r) => {
    const stockUomId = uoms.get(r.unidade.trim());
    if (!stockUomId) throw new Error(`${r.codigo_sugerido}: unidade "${r.unidade}" não existe ou está inativa no cadastro de unidades.`);
    const custo = money(r.valor_unitario);
    return {
      code: r.codigo_sugerido.trim(),
      shortDescription: r.descricao_curta.trim(),
      technicalDescription: txt(r.descricao_tecnica),
      category: r.categoria.trim(),
      subcategory: txt(r.subcategoria),
      type: enumDe(MaterialType, r.tipo, 'tipo', r.codigo_sugerido),
      stockUomId,
      manufacturer: txt(r.fabricante),
      brand: txt(r.marca),
      model: txt(r.modelo),
      lotControlled: bool(r.lote),
      expiryControlled: bool(r.validade),
      minShelfLifeDays: null,
      serialControlled: bool(r.serie),
      assetTagged: bool(r.patrimonio),
      requiresCa: bool(r.exige_ca),
      requiresCalibration: bool(r.calibracao),
      // Um material por tamanho: a grade deixou de ser interna ao material.
      hasSizeGrid: false,
      returnable: bool(r.retornavel),
      disposable: bool(r.descartavel),
      exitMethod: enumDe(ExitMethod, r.metodo_saida, 'metodo_saida', r.codigo_sugerido),
      criticality: enumDe(Criticality, r.criticidade, 'criticidade', r.codigo_sugerido),
      requiresAuthorization: bool(r.exige_autorizacao),
      authorizationBy: txt(r.autorizado_por),
      averageCost: custo,
      lastCost: custo,
      createdBy: 'import-materiais',
    };
  });

  const erros = materiais.flatMap((m) => validar(m).map((e) => `${m.code}: ${e}`));
  const repetidos = materiais.map((m) => m.code).filter((c, i, a) => a.indexOf(c) !== i);
  if (repetidos.length) erros.push(`códigos repetidos no CSV: ${[...new Set(repetidos)].join(', ')}`);
  if (erros.length) {
    console.error(`\n${erros.length} problema(s):`);
    for (const e of erros) console.error(`  - ${e}`);
    throw new Error('Nada foi gravado.');
  }
  console.log(`${materiais.length} material(is) validado(s) contra as regras 7.1/7.2.`);
  if (DRY_RUN) return;

  let criados = 0;
  let atualizados = 0;
  let inalterados = 0;
  for (const dados of materiais) {
    await prisma.$transaction(async (tx) => {
      const existente = await tx.material.findUnique({ where: { code: dados.code } });
      if (existente) {
        const { createdBy: _ignora, ...campos } = dados;
        // Reexecutar a carga não pode encher o histórico de versões idênticas.
        const mudou = Object.entries(campos).some(([k, novo]) => !mesmoValor((existente as Record<string, unknown>)[k], novo));
        if (!mudou) {
          inalterados += 1;
          return;
        }
        // Mesmo passo a passo do MaterialsService.update: versão nova, currentVersion e updatedBy juntos.
        const proxima = existente.currentVersion + 1;
        const material = await tx.material.update({ where: { id: existente.id }, data: { ...campos, currentVersion: proxima, updatedBy: 'import-materiais' } });
        await tx.materialVersion.create({ data: { materialId: material.id, version: proxima, snapshot: JSON.parse(JSON.stringify(material)) as Prisma.InputJsonValue, changedBy: 'import-materiais', changeReason: 'Carga do catálogo da LGC' } });
        atualizados += 1;
      } else {
        const material = await tx.material.create({ data: dados });
        await tx.materialVersion.create({ data: { materialId: material.id, version: 1, snapshot: JSON.parse(JSON.stringify(material)) as Prisma.InputJsonValue, changedBy: 'import-materiais', changeReason: 'Criação' } });
        criados += 1;
      }
    });
  }
  console.log(`Criados: ${criados}. Atualizados: ${atualizados}. Sem mudança: ${inalterados}.`);

  const porFamilia = await prisma.material.groupBy({ by: ['type'], _count: true, where: { createdBy: 'import-materiais' } });
  for (const g of porFamilia) console.log(`  ${g.type}: ${g._count}`);
  const semPreco = await prisma.material.count({ where: { createdBy: 'import-materiais', lastCost: null } });
  if (semPreco) console.log(`Atenção: ${semPreco} item(ns) sem custo cadastrado não aparecem no catálogo de compra do Axis.`);
}

main()
  .catch((e: unknown) => { console.error((e as Error).message); process.exitCode = 1; })
  .finally(() => void prisma.$disconnect());
