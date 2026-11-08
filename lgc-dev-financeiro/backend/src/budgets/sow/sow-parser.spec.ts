import { cleanLines, expandCount, normalizeType, parseSow } from './sow-parser.js';

/**
 * SOWs fictícias nos dois formatos encontrados nas SOWs reais (2026-11-08). Nenhum dado de cliente:
 * FBN, sites, hosts, e-mails e quantidades são inventados.
 */

const FOOTER = `Note: This SOW is Confidential Information (rodapé fictício de teste)
disclosed, in whole or in part (continuação fictícia do rodapé)`;

const HEADER = `Infrastructure Delivery
Cabling Scope of Work
SOW Type: Original
PROJECT OVERVIEW
Project Type: Scaling
FBN: XX00TEST0001
Project Site(s): TST001
Project Name: XX00TEST0001-tst1-exemplo
SPS Project ID: SPS-00001
SOW UID: SOW-00001
PROJECT SCHEDULE
1. Vendor Walkthrough Date: 2030-01-10 08:00:00
2. Bid Submission Due Date: 2030-01-15 18:00:00
3. Estimated AWS PO Generation Date: 2030-01-20
4. Expected Cabling Start Date: 2030-02-01
${FOOTER}
=== página 2 ===
5. Expected Cabling Completion Date: 2030-02-10
POINTS OF CONTACT
AWS Primary POC Email: primario@exemplo.test
AWS Secondary POC Email: secundario@exemplo.test
AWS Team Email: time@exemplo.test`;

/** Formato das linhas de conexão com "from ... to" e racks com "-- Live|Not live". */
const SOW_CONEXOES = `${HEADER}
PROJECT DETAILS
Rack Type(s) / Loose Gear(s) / Device(s) & Quantity:
== Grupo A ==
tst1-rack-r[1-4] -- TST1.1-1.100 -- Not live, In scope
tst1-console-r9 -- TST1.1-1.100 -- Live, In scope
Additional Information:
MEWP (Mobile Elevating Working Platform) is not required for this site.
Connections & Cable Types:
== Rack A ==
- Management
--- 2x 2F LC-LC (30m) from TST1.1-1.100 to TST1.1-1.200
--- 1x 2F LC-LC (40m) from TST1.1-1.100 to TST1.1-1.300
- Console
--- 3x Cat6 green (6m) from TST1.1-1.100 to TST1.1-1.MR1
${FOOTER}
=== página 5 ===
- Uplinks
--- 2x 36F LC-LC (25m) from TST1.1-1.100 to TST1.1-1.400 (Path A)
--- 4x 8F MPO-LC (2m) from TST1.1-1.100 to TST1.1-1.400
--- 1x 2F LC-LC (30m) from TST1.1-1.101 to TST1.1-1.200
--- 5x algo estranho sem medida
AWS STANDARD GUIDELINES
--- 99x 2F LC-LC (99m) from fora da seção
REVISION HISTORY
4. Expected Cabling Start Date: 2029-12-01`;

/** Formato com tabela de resumo "Cable Types" e conexões "A <> B - 35m". */
const SOW_RESUMO = `${HEADER}
Hardware Type Rack Device Hostname Rack/Device Location(s) Live vs Not Live
Devices tst1-dev-r1 TST1.1-2.10 Live
Devices tst1-dev-r2 TST1.1-2.11 Live
Devices tst1-dev-r3 TST1.1-2.12 Not Live
Connections & Cable Types:
Cable Types:
Type Length Quantity
8F 4LC-MPO 25m 2
8F 4LC-MPO 35m 2
8F MPO-MPO 20m 3
Connections:
2x 8F MPO-4LC TST1.1-2.10 <> TST1.1-2.90 - 25m
2x 8F MPO-4LC TST1.1-2.11 <> TST1.1-2.90 - 35m
1x 8F MPO-MPO TST1.1-2.10 <> TST1.1-2.91 - 20m Route A
1x 8F MPO-MPO TST1.1-2.11 <> TST1.1-2.91 - 20m Route B
AWS STANDARD GUIDELINES`;

describe('parseSow — linhas de conexão', () => {
  const r = parseSow(SOW_CONEXOES);

  it('lê o cabeçalho e ignora valores antigos do histórico de revisões', () => {
    expect(r.header).toMatchObject({
      sowType: 'Original',
      projectType: 'Scaling',
      fbn: 'XX00TEST0001',
      sites: 'TST001',
      sowUid: 'SOW-00001',
      spsProjectId: 'SPS-00001',
      walkthroughAt: '2030-01-10 08:00:00',
      bidDueAt: '2030-01-15 18:00:00',
      poDate: '2030-01-20',
      startDate: '2030-02-01',
      endDate: '2030-02-10',
      contacts: { primary: 'primario@exemplo.test', secondary: 'secundario@exemplo.test', team: 'time@exemplo.test' },
      platform: 'nao_precisa',
    });
  });

  it('conta racks com faixas e marca os live', () => {
    expect(r.devices).toEqual({ total: 5, live: 1, notLive: 4 });
  });

  it('soma por tipo e comprimento só dentro da seção de cabos, através das quebras de página', () => {
    expect(r.cableSource).toBe('conexoes');
    expect(r.cables).toEqual([
      { type: '2F LC-LC', kind: 'fibra', fibers: 2, lengthM: 30, quantity: 3 },
      { type: '2F LC-LC', kind: 'fibra', fibers: 2, lengthM: 40, quantity: 1 },
      { type: '36F LC-LC', kind: 'fibra', fibers: 36, lengthM: 25, quantity: 2 },
      { type: '8F LC-MPO', kind: 'fibra', fibers: 8, lengthM: 2, quantity: 4 },
      { type: 'Cat6 green', kind: 'cobre', fibers: 0, lengthM: 6, quantity: 3 },
    ]);
  });

  it('resume por tipo com comprimento médio e portas', () => {
    expect(r.types.find((t) => t.type === '2F LC-LC')).toEqual({ type: '2F LC-LC', kind: 'fibra', fibers: 2, quantity: 4, meters: 130, averageLengthM: 33, ports: 4 });
    expect(r.types.find((t) => t.type === 'Cat6 green')?.ports).toBe(0);
    expect(r.totals).toEqual({ cables: 13, meters: 206, ports: 56 });
  });

  it('avisa a linha de cabo que não entendeu', () => {
    expect(r.warnings).toEqual(['Linha de cabo não reconhecida: "--- 5x algo estranho sem medida"']);
  });
});

describe('parseSow — tabela de resumo', () => {
  const r = parseSow(SOW_RESUMO);

  it('usa a tabela de resumo e junta MPO-4LC com 4LC-MPO', () => {
    expect(r.cableSource).toBe('resumo');
    expect(r.types.map((t) => [t.type, t.quantity, t.meters, t.averageLengthM, t.ports])).toEqual([
      ['8F 4LC-MPO', 4, 120, 30, 16],
      ['8F MPO-MPO', 3, 60, 20, 12],
    ]);
    expect(r.devices).toEqual({ total: 3, live: 2, notLive: 1 });
    expect(r.header.platform).toBe('nao_mencionada');
  });

  it('avisa quando as conexões não batem com o resumo', () => {
    // O resumo diz 3 MPO-MPO; as conexões listam 2.
    expect(r.warnings).toEqual(['A tabela de resumo soma 7 cabos e as conexões listadas somam 6. Valeu a tabela de resumo; confira com o cliente.']);
  });
});

describe('peças do parser', () => {
  it('normaliza tipos', () => {
    expect(normalizeType('8F MPO-4LC')).toEqual({ type: '8F 4LC-MPO', kind: 'fibra', fibers: 8 });
    expect(normalizeType('8f  4lc-mpo').type).toBe('8F 4LC-MPO');
    expect(normalizeType('Cat6 Orange')).toEqual({ type: 'Cat6 orange', kind: 'cobre', fibers: 0 });
    expect(normalizeType('Coaxial RG6').kind).toBe('outro');
  });

  it('expande faixas de host', () => {
    expect(expandCount('x-r[1-16]')).toBe(16);
    expect(expandCount('x-c[1-2]-r[1-3]')).toBe(6);
    expect(expandCount('x-r9')).toBe(1);
  });

  it('remove rodapé e marcadores de página', () => {
    expect(cleanLines(`A\n${FOOTER}\n=== página 3 ===\nB`)).toEqual(['A', 'B']);
  });

  it('SOW sem nada útil gera avisos, não erro', () => {
    const r = parseSow('texto qualquer');
    expect(r.cableSource).toBe('nenhum');
    expect(r.warnings).toEqual(['FBN não encontrado.', 'SOW UID não encontrado.', 'Início ou conclusão do cabeamento não encontrados.', 'Nenhum cabo encontrado na SOW. Inclua as linhas à mão.']);
  });
});
