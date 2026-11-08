import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SitesService, siteEventPayload } from './sites.service.js';
import { CreateSiteDto } from './dto/create-site.dto.js';
import { UpdateSiteDto } from './dto/update-site.dto.js';

/** Sites com Prisma simulado (PA-05): cadastro, unicidade por cliente e eventos no outbox na
 * mesma transação. */

function siteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'site-1',
    clientId: 'cl-1',
    code: 'GRU53',
    name: 'Aeroporto de Guarulhos — prédio 53',
    cep: '07190100',
    addressStreet: 'Rodovia Hélio Smidt',
    addressNumber: 's/n',
    addressComplement: null,
    addressDistrict: 'Cumbica',
    addressCity: 'Guarulhos',
    addressState: 'SP',
    latitude: -23.4356,
    longitude: -46.4731,
    active: true,
    createdAt: new Date('2026-11-08T12:00:00Z'),
    updatedAt: new Date('2026-11-08T12:00:00Z'),
    ...overrides,
  };
}

function fixture(current: Record<string, unknown> | null = siteRow()) {
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'cl-1' }) },
    site: {
      findUnique: vi.fn().mockResolvedValue(current),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(async ({ data }) => siteRow({ ...data })),
      update: vi.fn(async ({ data }) => siteRow({ ...current, ...data })),
    },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const service = new SitesService(prisma, outbox as any);
  return { service, prisma, outbox };
}

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

describe('SitesService.create', () => {
  const dto = { clientId: 'cl-1', code: 'GRU53', name: 'Aeroporto de Guarulhos — prédio 53', cep: '07190100', addressCity: 'Guarulhos', addressState: 'SP', latitude: -23.4356, longitude: -46.4731 };

  it('grava o site e emite site.created com o estado completo, na mesma transação', async () => {
    const { service, prisma, outbox } = fixture();
    await service.create(dto);

    expect(prisma.site.create.mock.calls[0][0].data).toMatchObject({ clientId: 'cl-1', code: 'GRU53', cep: '07190100', addressStreet: null, latitude: -23.4356 });
    expect(outbox.record).toHaveBeenCalledTimes(1);
    // O primeiro argumento é o `tx` da transação (aqui o próprio objeto simulado), nunca outro cliente.
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'site.created', expect.objectContaining({
      site_id: 'site-1',
      client_id: 'cl-1',
      code: 'GRU53',
      name: 'Aeroporto de Guarulhos — prédio 53',
      cep: '07190100',
      address_city: 'Guarulhos',
      address_state: 'SP',
      latitude: -23.4356,
      longitude: -46.4731,
      active: true,
    }));
  });

  it('cliente inexistente → 400, sem gravar nem emitir evento', async () => {
    const { service, prisma, outbox } = fixture();
    prisma.client.findUnique.mockResolvedValue(null);

    await expect(service.create(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.site.create).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('código repetido no mesmo cliente → 409 com mensagem clara', async () => {
    const { service, prisma } = fixture();
    prisma.site.create.mockRejectedValue(uniqueViolation());

    await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.create(dto)).rejects.toThrow('Já existe um site com este código para o cliente.');
  });
});

describe('SitesService.update', () => {
  it('emite site.updated com o estado completo e só os campos que mudaram', async () => {
    const { service, prisma, outbox } = fixture();
    await service.update('site-1', { name: 'Novo nome', addressNumber: 's/n', latitude: -23.5 });

    // addressNumber veio igual ao gravado: não entra no UPDATE nem em changed_fields.
    expect(prisma.site.update.mock.calls[0][0].data).toEqual({ name: 'Novo nome', latitude: -23.5 });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'site.updated', expect.objectContaining({
      site_id: 'site-1',
      code: 'GRU53',
      name: 'Novo nome',
      latitude: -23.5,
      changed_fields: ['name', 'latitude'],
    }));
  });

  it('inativar é uma edição: active=false vai no evento', async () => {
    const { service, prisma, outbox } = fixture();
    await service.update('site-1', { active: false });

    expect(prisma.site.update.mock.calls[0][0].data).toEqual({ active: false });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'site.updated', expect.objectContaining({ active: false, changed_fields: ['active'] }));
  });

  it('null apaga campo opcional (coordenadas)', async () => {
    const { service, prisma } = fixture();
    await service.update('site-1', { latitude: null, longitude: null });
    expect(prisma.site.update.mock.calls[0][0].data).toEqual({ latitude: null, longitude: null });
  });

  it('sem mudança real não grava nem emite evento', async () => {
    const { service, prisma, outbox } = fixture();
    await service.update('site-1', { name: 'Aeroporto de Guarulhos — prédio 53', active: true });
    expect(prisma.site.update).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('código ou nome nulos → 400', async () => {
    const { service, prisma } = fixture();
    await expect(service.update('site-1', { code: null as unknown as string })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('site-1', { name: null as unknown as string })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.site.update).not.toHaveBeenCalled();
  });

  it('trocar o código para um já usado pelo cliente → 409', async () => {
    const { service, prisma } = fixture();
    prisma.site.update.mockRejectedValue(uniqueViolation());
    await expect(service.update('site-1', { code: 'CGH01' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('site inexistente → 404', async () => {
    const { service } = fixture(null);
    await expect(service.update('nada', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SitesService.findAll', () => {
  it('filtra por cliente e situação no servidor', async () => {
    const { service, prisma } = fixture();
    await service.findAll({ clientId: 'cl-1', active: true });
    expect(prisma.site.findMany).toHaveBeenCalledWith({
      where: { clientId: 'cl-1', active: true },
      orderBy: [{ clientId: 'asc' }, { code: 'asc' }],
    });
  });
});

describe('siteEventPayload', () => {
  it('usa snake_case e não vaza campos internos', () => {
    const payload = siteEventPayload(siteRow() as any);
    expect(Object.keys(payload).sort()).toEqual([
      'active', 'address_city', 'address_complement', 'address_district', 'address_number', 'address_state',
      'address_street', 'cep', 'client_id', 'code', 'latitude', 'longitude', 'name', 'site_id',
    ]);
  });
});

describe('validação dos DTOs', () => {
  const valid = { clientId: '8f0f4f5e-0c3b-4c9a-8d5e-6f1b6d9f0a11', code: ' gru53 ', name: ' Prédio 53 ', cep: '07190-100', addressState: 'sp' };

  it('normaliza código (maiúsculas), nome, CEP (só dígitos) e UF', async () => {
    const dto = plainToInstance(CreateSiteDto, valid);
    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({ code: 'GRU53', name: 'Prédio 53', cep: '07190100', addressState: 'SP' });
  });

  it.each([
    ['código com espaço', { code: 'GRU 53' }],
    ['código vazio', { code: '  ' }],
    ['nome vazio', { name: '   ' }],
    ['CEP incompleto', { cep: '0719' }],
    ['UF com 3 letras', { addressState: 'SPA' }],
    ['latitude fora da faixa', { latitude: 91 }],
    ['longitude fora da faixa', { longitude: -181 }],
    ['cliente que não é UUID', { clientId: 'abc' }],
  ])('rejeita %s', async (_label, patch) => {
    const errors = await validate(plainToInstance(CreateSiteDto, { ...valid, ...patch }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('a edição herda a normalização e aceita null para limpar campos opcionais', async () => {
    const dto = plainToInstance(UpdateSiteDto, { code: ' cgh01 ', cep: '', addressState: '', latitude: null });
    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({ code: 'CGH01', cep: null, addressState: null, latitude: null });
  });

  it('a edição não aceita trocar o cliente e deixa tudo opcional', async () => {
    expect(await validate(plainToInstance(UpdateSiteDto, { active: false }), { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    const errors = await validate(plainToInstance(UpdateSiteDto, { clientId: valid.clientId }), { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
  });
});
