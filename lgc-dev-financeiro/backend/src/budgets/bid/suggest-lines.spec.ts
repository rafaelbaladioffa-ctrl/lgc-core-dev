import { lineFiberKey, preferredSuppliers, sowFiberKey, suggestCableLine, type TemplateLine } from './suggest-lines.js';

/** Linhas fictícias no formato das descrições do Bid Template (códigos inventados). */
const L = (row: number, code: string, description: string, supplier: string | null, category = 'Fiber'): TemplateLine => ({ row, code, description, category, subcategory: '', supplier });
const LINES: TemplateLine[] = [
  L(30, 'J-OM3', '2F OM3 Microcable, LSZH, Aqua, LC Uniboot/LC Uniboot, A-B', null),
  L(31, 'J-RED', '2F SM TB Robust, LSZH, Red, LC Duplex/LC Duplex, A-B', 'Marca B'),
  L(32, 'J-YEL-SEL', '2F SM ZDX, LSZH, Yellow, LC Duplex/LC Duplex, A-B', 'Select'),
  L(33, 'J-YEL-A', '2F SM ZDX, LSZH, Yellow, LC Duplex/LC Duplex, A-B, 150 mm Breakout End A', 'Marca A'),
  L(110, 'T36-B', '36F SM Microcable, LSZH, Yellow, LC Uniboot/LC Uniboot, A-B', 'Marca B'),
  L(111, 'T36-A', '36F SM Microcable, LSZH, Yellow, LC Uniboot/LC Uniboot, A-B', 'Marca A'),
  L(190, 'BO-8', '8F SM Microcable, LSZH, Yellow, MPO Female/LC Uniboot, QSFP 1-B', 'Marca A'),
  L(230, 'MM-8', '8F SM Microcable, LSZH, Yellow, MPO Female/MPO Female, Type B', 'Select'),
  L(324, 'free_copper_cables', 'Free Entry for Copper Cables', null, 'Wire and Cable'),
];

describe('chaves de comparação', () => {
  it('tipo da SOW e descrição da linha', () => {
    expect(sowFiberKey('8F 4LC-MPO')).toEqual({ fibers: 8, ends: 'LC|MPO' });
    expect(sowFiberKey('8F MTP-MTP')).toEqual({ fibers: 8, ends: 'MPO|MPO' });
    expect(sowFiberKey('Cat6 green')).toBeNull();
    expect(lineFiberKey('8F SM Microcable, LSZH, Yellow, MPO Female/LC Uniboot, QSFP 1-B')).toEqual({ fibers: 8, ends: 'LC|MPO', singleMode: true, yellow: true });
    expect(lineFiberKey('Free Entry for LC-LC Jumpers')).toBeNull();
  });
});

describe('suggestCableLine', () => {
  it('fibra: monomodo, amarelo e com fornecedor definido vencem', () => {
    expect(suggestCableLine('2F LC-LC', 'fibra', LINES)).toMatchObject({ code: 'J-YEL-A', supplier: null });
  });

  it('desempate pelo fornecedor mais usado no perfil; sem preferência, a primeira linha', () => {
    expect(suggestCableLine('36F LC-LC', 'fibra', LINES).code).toBe('T36-B');
    expect(suggestCableLine('36F LC-LC', 'fibra', LINES, ['Marca A']).code).toBe('T36-A');
  });

  it('leque de LC casa com MPO/LC; linha em "Select" recebe o fornecedor preferido', () => {
    expect(suggestCableLine('8F 4LC-MPO', 'fibra', LINES).code).toBe('BO-8');
    expect(suggestCableLine('8F MPO-MPO', 'fibra', LINES, ['Marca A'])).toMatchObject({ code: 'MM-8', supplier: 'Marca A' });
  });

  it('cobre vai para a linha livre de cobre; tipo sem linha não sugere', () => {
    expect(suggestCableLine('Cat6 orange', 'cobre', LINES)).toMatchObject({ code: 'free_copper_cables', supplier: 'AWS Internal', unit: 'm' });
    expect(suggestCableLine('144F LC-LC', 'fibra', LINES)).toBeNull();
    expect(suggestCableLine('Coaxial', 'outro', LINES)).toBeNull();
  });

  it('fornecedores preferidos pelas linhas já mapeadas', () => {
    expect(preferredSuppliers(['T36-A', 'BO-8', 'T36-B', 'free_copper_cables'], LINES)).toEqual(['Marca A', 'Marca B']);
  });
});
