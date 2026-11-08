import { buildBidPlan, type BidPlanInput } from './bid-plan.js';
import type { AwsQuote } from './aws-quote.js';

/** Plano da Bid no formato da Bid real da LGC (valores fictícios). */

const quote = {
  perType: [
    { type: '2F LC-LC', kind: 'fibra', fibers: 2, quantity: 44, meters: 1466, averageLengthM: 33, consideredMeters: 1452, ports: 44, targetHours: 0, hoursTAuto: 67, hoursT: 67, overridden: false },
    { type: 'Cat6 green', kind: 'cobre', fibers: 0, quantity: 13, meters: 86, averageLengthM: 7, consideredMeters: 91, ports: 0, targetHours: 0, hoursTAuto: 20, hoursT: 20, overridden: false },
    { type: 'Cat6 orange', kind: 'cobre', fibers: 0, quantity: 5, meters: 32, averageLengthM: 6, consideredMeters: 30, ports: 0, targetHours: 0, hoursTAuto: 9, hoursT: 9, overridden: false },
  ],
  kpis: [
    { key: 'laborCostPerPort', flagged: true },
    { key: 'hoursPerMeter', flagged: true },
    { key: 'efficiency', flagged: false },
  ],
  bidValues: { start: '2030-02-01', end: '2030-02-08' },
} as unknown as AwsQuote;

function input(over: Partial<BidPlanInput> = {}): BidPlanInput {
  return {
    projectCode: 'PROP-100.001-1126',
    submissionDate: '2030-01-15',
    quote,
    hoursPerDay: 8,
    result: {
      workDays: 6,
      vehicleDays: 12,
      labor: [
        { roleKey: 'tecnico', label: 'Técnico', fieldRole: true, people: 3, hours: '144.00', billingRate: '80.00' },
        { roleKey: 'encarregado', label: 'Encarregado', fieldRole: true, people: 1, hours: '48.00', billingRate: '130.00' },
        { roleKey: 'gerente_projeto', label: 'Gerente', fieldRole: false, people: null, hours: '0.00', billingRate: '200.00' },
      ],
      materials: [{ materialId: 'm1', description: 'Caneta de limpeza', unit: 'un', quantity: '2', billed: '360.00' }],
      revenue: { travel: '1000.00', platform: '0.00' },
    },
    inputs: { travel: { destinationName: 'Site Teste', kmRoundTrip: '64', cars: 2 } },
    catalog: new Map([['m1', { clientRef: 'free_cleaners', manufacturer: 'Marca', partNumber: 'P-1', name: 'Caneta de limpeza', unit: 'ea' }]]),
    profile: {
      header: { vendorName: 'LGC', pocName: 'Contato', pocEmail: 'contato@lgc.test', leadTimeDays: 0 },
      cables: {
        '2F LC-LC': { code: '110000-XXXM' },
        'Cat6 green': { code: 'free_copper_cables', description: 'Cat6 UTP Cable', supplier: 'AWS Internal', partNumber: 'CAT6-XXXM', unit: 'm' },
        'Cat6 orange': { code: 'free_copper_cables', description: 'Cat6 UTP Cable', supplier: 'AWS Internal', partNumber: 'CAT6-XXXM', unit: 'm' },
      },
      roles: {},
    },
    ...over,
  };
}

describe('buildBidPlan', () => {
  const { plan, blockers } = buildBidPlan(input());
  const line = (code: string) => plan!.lines.find((l) => l.code === code)!;

  it('sem pendências gera o plano com o cabeçalho e o código do projeto como nome da proposta', () => {
    expect(blockers).toEqual([]);
    expect(plan!.header).toEqual({ vendorName: 'LGC', pocName: 'Contato', pocEmail: 'contato@lgc.test', proposalName: 'PROP-100.001-1126', start: '2030-02-01', end: '2030-02-08', submissionDate: '2030-01-15', leadTimeDays: 0 });
  });

  it('cabo de catálogo: comprimento médio, quantidade instalada, horas e comentário', () => {
    expect(line('110000-XXXM').cells).toEqual({ G: 33, S: 44, T: 67, U: 'AWS-provided material (install only). 44x 2F LC-LC, 1,466 m total; average length shown.' });
  });

  it('tipos na mesma linha livre são somados (Cat6 verde + laranja = uma linha)', () => {
    // 18 cabos, 118 m → médio 7 m; horas 20 + 9.
    expect(line('free_copper_cables').cells).toMatchObject({ G: 7, S: 18, T: 29, A: 'Cat6 UTP Cable', D: 'AWS Internal', E: 'CAT6-XXXM', K: 'm' });
    expect(line('free_copper_cables').label).toBe('Cabos: Cat6 green + Cat6 orange');
  });

  it('material do catálogo pela referência do cliente; deslocamento por carro/dia; mão de obra pelos códigos padrão', () => {
    expect(line('free_cleaners').cells).toEqual({ J: 180, M: 2, A: 'Caneta de limpeza', D: 'Marca', E: 'P-1', K: 'ea' });
    expect(line('transport').cells).toMatchObject({ J: 83.33, M: 12, B: 'Daily round trip to Site Teste: 64 km/day, 2 vehicle(s).' });
    expect(line('T-H-S').cells).toEqual({ J: 80, M: 144, U: '3 x 6 working days x 8 h' });
    expect(line('GF-H-S').cells).toMatchObject({ J: 130, M: 48 });
    expect(plan!.lines.some((l) => l.code === 'PM-H-S')).toBe(false); // gerente sem horas fica de fora
    expect(plan!.kpiYes).toEqual(['Labor Cost per Port', 'Hours per Meter']);
  });

  it('lista o que falta: perfil, tipo sem linha, material avulso e linha repetida', () => {
    const out = buildBidPlan(
      input({
        profile: { header: { vendorName: null, pocName: null, pocEmail: null, leadTimeDays: 0 }, cables: { '2F LC-LC': { code: 'free_cleaners', description: 'x', unit: 'm' } }, roles: {} },
        result: { ...input().result, materials: [...input().result.materials, { materialId: null, description: 'Fita avulsa', unit: 'un', quantity: '1', billed: '10' }] },
      }),
    );
    expect(out.plan).toBeNull();
    expect(out.unmappedCables).toEqual(['Cat6 green', 'Cat6 orange']);
    expect(out.blockers).toEqual(
      expect.arrayContaining([
        'Preencha o nome do fornecedor no perfil da Bid (como aparece na lista da AWS).',
        'Preencha o contato e o e-mail da proposta no perfil da Bid.',
        'Escolha a linha do Bid Template para: Cat6 green, Cat6 orange.',
        'O material avulso "Fita avulsa" precisa estar no catálogo, com a linha do Bid Template.',
        '"Caneta de limpeza" e "2F LC-LC" caem na mesma linha do Bid Template (free_cleaners); o modelo tem uma linha por item.',
      ]),
    );
  });

  it('função sem linha conhecida pede escolha', () => {
    const out = buildBidPlan(input({ result: { ...input().result, labor: [{ roleKey: 'eletricista', label: 'Eletricista', fieldRole: true, people: 1, hours: '8', billingRate: '50' }] } }));
    expect(out.unmappedRoles).toEqual(['Eletricista']);
  });
});
