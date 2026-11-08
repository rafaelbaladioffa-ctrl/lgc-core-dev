import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClientsService } from './clients.service.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

/** Cadastro de cliente: razão social, nome fantasia, contato e endereço estruturado (docs/dominio/cadastros.md §9). */

const ROW = { id: 'cli-1', code: 100, legalName: 'A100 ROW SERVICOS DE DADOS BRASIL LTDA' };

function fixture() {
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    client: {
      findUnique: vi.fn().mockResolvedValue(ROW),
      create: vi.fn(async ({ data }) => ({ ...ROW, ...data })),
      update: vi.fn(async ({ data }) => ({ ...ROW, ...data })),
      delete: vi.fn(async () => ROW),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ nextval: 100n }]),
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { service: new ClientsService(prisma, outbox as any), prisma, outbox };
}

describe('ClientsService', () => {
  it('grava os dados cadastrais e o endereço, com UF em maiúsculas', async () => {
    const { service, prisma, outbox } = fixture();
    await service.create({
      legalName: ROW.legalName,
      tradeName: 'A100 ROW',
      cnpj: '12.345.678/0001-90',
      phone: '(19) 99999-0000',
      email: 'contato@a100row.com',
      cep: '13170-000',
      addressStreet: 'Rua A',
      addressNumber: '10',
      addressDistrict: 'Centro',
      addressCity: 'Sumaré',
      addressState: 'sp',
    });
    const data = prisma.client.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      code: 100,
      tradeName: 'A100 ROW',
      phone: '(19) 99999-0000',
      email: 'contato@a100row.com',
      cep: '13170-000',
      addressCity: 'Sumaré',
      addressState: 'SP',
    });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'client.created', {
      client_id: 'cli-1',
      code: 100,
      name: ROW.legalName,
      legal_name: ROW.legalName,
      trade_name: 'A100 ROW',
      cnpj: '12.345.678/0001-90',
      phone: '(19) 99999-0000',
      email: 'contato@a100row.com',
      cep: '13170-000',
      address_street: 'Rua A',
      address_number: '10',
      address_complement: undefined,
      address_district: 'Centro',
      address_city: 'Sumaré',
      address_state: 'SP',
      active: true,
    });
  });

  it('client.updated leva o estado completo depois da edição e mantém changed_fields', async () => {
    const { service, prisma, outbox } = fixture();
    prisma.client.update.mockResolvedValueOnce({
      ...ROW,
      tradeName: 'A100',
      cnpj: null,
      phone: '(19) 3333-4444',
      email: null,
      cep: null,
      addressStreet: null,
      addressNumber: null,
      addressComplement: null,
      addressDistrict: null,
      addressCity: 'Campinas',
      addressState: 'SP',
    });
    await service.update('cli-1', { phone: '(19) 3333-4444', addressCity: 'Campinas' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'client.updated', {
      client_id: 'cli-1',
      code: 100,
      name: ROW.legalName,
      legal_name: ROW.legalName,
      trade_name: 'A100',
      cnpj: null,
      phone: '(19) 3333-4444',
      email: null,
      cep: null,
      address_street: null,
      address_number: null,
      address_complement: null,
      address_district: null,
      address_city: 'Campinas',
      address_state: 'SP',
      active: true,
      changed_fields: ['phone', 'addressCity'],
    });
  });

  it('exclusão grava client.deleted na mesma transação', async () => {
    const { service, prisma, outbox } = fixture();
    await service.remove('cli-1');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'client.deleted', { client_id: 'cli-1', code: 100, active: false, deleted: true });
  });

  it('exclusão com projetos vinculados vira 409 e não grava evento', async () => {
    const { service, prisma, outbox } = fixture();
    prisma.client.delete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }),
    );
    await expect(service.remove('cli-1')).rejects.toBeInstanceOf(ConflictException);
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('na edição, null limpa o campo e campo ausente não é alterado', async () => {
    const { service, prisma } = fixture();
    await service.update('cli-1', { email: null, addressState: null });
    const data = prisma.client.update.mock.calls[0][0].data;
    expect(data.email).toBeNull();
    expect(data.addressState).toBeNull();
    expect(data.phone).toBeUndefined();
    expect(data.legalName).toBeUndefined();
  });

  it('CNPJ duplicado vira 409', async () => {
    const { service, prisma } = fixture();
    prisma.client.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(service.create({ legalName: 'X', cnpj: '12.345.678/0001-90' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CreateClientDto', () => {
  const check = (input: object) => validate(plainToInstance(CreateClientDto, input));

  it('aceita campos opcionais nulos', async () => {
    expect(await check({ legalName: 'X', tradeName: null, email: null, cep: null })).toHaveLength(0);
  });

  it('rejeita e-mail, CEP e UF inválidos', async () => {
    const errors = await check({ legalName: 'X', email: 'nao-e-email', cep: '123', addressState: 'SPX' });
    expect(errors.map((e) => e.property).sort()).toEqual(['addressState', 'cep', 'email']);
  });

  it('edição aceita só parte dos campos', async () => {
    expect(await validate(plainToInstance(UpdateClientDto, { phone: '(19) 3333-4444' }))).toHaveLength(0);
  });
});
