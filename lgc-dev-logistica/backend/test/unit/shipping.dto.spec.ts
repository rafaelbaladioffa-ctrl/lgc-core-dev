import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConfirmDeliveryDto, DispatchDto, PackageDto, PackDto, ScanDto } from '../../src/shipping/shipping.dto.js';

// Validação isolada dos DTOs de expedição (sem banco). O ValidationPipe da aplicação usa
// whitelist + transform + forbidNonWhitelisted; o mesmo conjunto é aplicado aqui.
const UUID = '6f1c2b8e-3d4a-4b5c-8d6e-7f8091a2b3c4';
const check = async <T extends object>(cls: new () => T, body: Record<string, unknown>) => {
  const dto = plainToInstance(cls, body, { enableImplicitConversion: false });
  const errors = await validate(dto as object, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors, failing: errors.map((e) => e.property) };
};
const scanBase = { pickingItemId: UUID, locationId: UUID, materialId: UUID };
const deliveryBase = { outcome: 'ENTREGUE', receiverName: 'Fulano' };

describe('ScanDto — quantidades', () => {
  it('aceita quantidade positiva com até 6 casas decimais', async () => {
    expect((await check(ScanDto, { ...scanBase, quantity: 2.5 })).errors).toHaveLength(0);
    expect((await check(ScanDto, { ...scanBase, quantity: '0.000001' })).errors).toHaveLength(0);
  });

  it.each([0, -1, '0', '-3'])('rejeita quantidade %s', async (q) => {
    expect((await check(ScanDto, { ...scanBase, quantity: q })).failing).toContain('quantity');
  });

  it('rejeita quantidade não numérica e com mais de 6 casas decimais', async () => {
    expect((await check(ScanDto, { ...scanBase, quantity: 'abc' })).failing).toContain('quantity');
    expect((await check(ScanDto, { ...scanBase, quantity: 1.1234567 })).failing).toContain('quantity');
  });

  it('quantidade é obrigatória', async () => {
    expect((await check(ScanDto, scanBase)).failing).toContain('quantity');
  });

  it('exige ids em formato UUID (item e endereço)', async () => {
    expect((await check(ScanDto, { ...scanBase, pickingItemId: 'nao-uuid', quantity: 1 })).failing).toContain('pickingItemId');
    expect((await check(ScanDto, { ...scanBase, locationId: '123', quantity: 1 })).failing).toContain('locationId');
    expect((await check(ScanDto, { ...scanBase, lotId: 'x', quantity: 1 })).failing).toContain('lotId');
    expect((await check(ScanDto, { ...scanBase, serialId: 'x', quantity: 1 })).failing).toContain('serialId');
  });

  it('código de barras limitado a 80 caracteres', async () => {
    expect((await check(ScanDto, { ...scanBase, barcode: '7'.repeat(80), quantity: 1 })).errors).toHaveLength(0);
    expect((await check(ScanDto, { ...scanBase, barcode: '7'.repeat(81), quantity: 1 })).failing).toContain('barcode');
  });

  it('motivo de divergência com 3 a 300 caracteres', async () => {
    expect((await check(ScanDto, { ...scanBase, quantity: 1, closeShort: true, divergenceReason: 'ab' })).failing).toContain('divergenceReason');
    expect((await check(ScanDto, { ...scanBase, quantity: 1, closeShort: true, divergenceReason: 'a'.repeat(301) })).failing).toContain('divergenceReason');
  });

  it('campo fora da lista branca é rejeitado', async () => {
    expect((await check(ScanDto, { ...scanBase, quantity: 1, unitCost: 0 })).failing).toContain('unitCost');
  });
});

describe('PackageDto / PackDto', () => {
  const pkg = (extra: Record<string, unknown> = {}) => ({ items: [{ pickingItemId: UUID, quantity: 1 }], ...extra });

  it('pesos e dimensões não podem ser negativos', async () => {
    expect((await check(PackageDto, pkg({ weightKg: -0.1 }))).failing).toContain('weightKg');
    expect((await check(PackageDto, pkg({ lengthCm: -1 }))).failing).toContain('lengthCm');
    expect((await check(PackageDto, pkg({ widthCm: -1 }))).failing).toContain('widthCm');
    expect((await check(PackageDto, pkg({ heightCm: -1 }))).failing).toContain('heightCm');
  });

  it('peso com mais de 4 casas e dimensão com mais de 2 casas são rejeitados', async () => {
    expect((await check(PackageDto, pkg({ weightKg: 1.12345 }))).failing).toContain('weightKg');
    expect((await check(PackageDto, pkg({ lengthCm: 10.123 }))).failing).toContain('lengthCm');
  });

  it('volume sem itens é rejeitado', async () => {
    expect((await check(PackageDto, { items: [] })).failing).toContain('items');
  });

  it('item do volume exige quantidade positiva', async () => {
    const r = await check(PackDto, { packages: [{ items: [{ pickingItemId: UUID, quantity: 0 }] }] });
    expect(r.errors.length).toBeGreaterThan(0);
    const neg = await check(PackDto, { packages: [{ items: [{ pickingItemId: UUID, quantity: -2 }] }] });
    expect(neg.errors.length).toBeGreaterThan(0);
  });

  it('pacote exige ao menos um volume e lacre com até 60 caracteres', async () => {
    expect((await check(PackDto, { packages: [] })).failing).toContain('packages');
    expect((await check(PackageDto, pkg({ seal: 'L'.repeat(61) }))).failing).toContain('seal');
  });
});

describe('ConfirmDeliveryDto — datas e coordenadas', () => {
  it('latitude fora de [-90, 90] é rejeitada', async () => {
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, latitude: 91 })).failing).toContain('latitude');
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, latitude: -90.01 })).failing).toContain('latitude');
  });

  it('longitude fora de [-180, 180] é rejeitada; limites são aceitos', async () => {
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, longitude: 180.5 })).failing).toContain('longitude');
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, longitude: 180, latitude: -90 })).errors).toHaveLength(0);
  });

  it('data da entrega precisa ser ISO 8601', async () => {
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, deliveredAt: 'ontem' })).failing).toContain('deliveredAt');
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, deliveredAt: '31/10/2026' })).failing).toContain('deliveredAt');
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, deliveredAt: '2026-10-31T14:00:00Z' })).errors).toHaveLength(0);
  });

  it('resultado restrito ao enum e recebedor com 2 a 120 caracteres', async () => {
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, outcome: 'PERDIDA' })).failing).toContain('outcome');
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, receiverName: 'A' })).failing).toContain('receiverName');
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, receiverName: 'N'.repeat(121) })).failing).toContain('receiverName');
  });

  it('packageIds precisa ser lista de UUIDs', async () => {
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, outcome: 'PARCIAL', packageIds: ['x'] })).failing).toContain('packageIds');
    expect((await check(ConfirmDeliveryDto, { ...deliveryBase, outcome: 'PARCIAL', packageIds: 'x' })).failing).toContain('packageIds');
  });

  // Bug: class-transformer converte '' em 0 (Number('') === 0), e 0 é uma latitude válida.
  // Um campo vazio viraria a coordenada (0, 0) e seria gravada como comprovante.
  it('latitude vazia não vira 0 (Null Island): é tratada como ausente', async () => {
    const r = await check(ConfirmDeliveryDto, { ...deliveryBase, latitude: '' });
    expect(r.failing).not.toContain('latitude');
    expect((r.dto as { latitude?: number }).latitude).toBeUndefined();
  });
});

describe('DispatchDto', () => {
  it('transportador obrigatório com 2 a 120 caracteres', async () => {
    expect((await check(DispatchDto, {})).failing).toContain('carrier');
    expect((await check(DispatchDto, { carrier: 'X' })).failing).toContain('carrier');
    expect((await check(DispatchDto, { carrier: 'Frota própria' })).errors).toHaveLength(0);
  });

  it('placa/veículo limitado a 40 caracteres', async () => {
    expect((await check(DispatchDto, { carrier: 'Frota', vehicle: 'V'.repeat(41) })).failing).toContain('vehicle');
  });
});
