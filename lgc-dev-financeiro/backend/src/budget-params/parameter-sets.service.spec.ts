import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { ParameterSetsService, publishIssues, todaySaoPaulo } from './parameter-sets.service.js';
import { UpdateParameterSetDto } from './parameter-sets.dto.js';
import { CatalogsService } from './catalogs.service.js';

// Valores fictícios (repositório público).
const D = (v: string) => new Prisma.Decimal(v);
const user = (permissions: string[]): AuthenticatedUser => ({ userId: 'u1', email: 'a@b.c', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions });
const CONTROLADORIA = user(['budget_params:read', 'budget_params:write', 'budget_params:read_payroll', 'budget:read_cost']);
const SEM_FOLHA = user(['budget_params:read', 'budget_params:write']);

function role(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', parameterSetId: 's1', roleKey: 'tecnico', label: 'Técnico', fieldRole: true, sortOrder: 1,
    billingRate: D('60'), monthlySalary: D('3000'), plrSalariesPerYear: D('1'), mealPerWorkedDay: D('30'), transportPerMonth: D('200'),
    gymPerMonth: null, healthPerMonth: D('500'), otherBenefitsPerMonth: null, costPerHourOverride: null, ...over,
  };
}

function set(over: Record<string, unknown> = {}) {
  return {
    id: 's1', code: 'PAR-0002', status: 'rascunho', effectiveFrom: new Date('2026-12-01T00:00:00Z'), notes: null, basedOnId: null,
    hoursPerDay: D('8'), workingDaysYear: 252, vacationWorkDays: 22,
    inssRate: D('0.2'), ratRate: D('0.03'), thirdPartyRate: D('0.058'), fgtsRate: D('0.08'), fgtsFineProvision: D('0'), vtSalaryDiscount: false,
    pisRate: D('0.0065'), cofinsRate: D('0.03'), issRate: D('0.05'), irpjPresumption: D('0.32'), irpjRate: D('0.15'), irpjSurcharge: true, csllPresumption: D('0.32'), csllRate: D('0.09'),
    kmRate: D('1'), fuelKmPerLiter: D('10'), fuelPricePerLiter: D('6'), vehicleWearPerKm: null,
    materialMarkup: null, rj45SpareRate: null, platformMonthlyRent: D('2100'), platformDaysPerMonth: 21, platformFreight: null, platformDailyBilled: null,
    contingencyRate: null, overheadRate: null, commissionRate: null, receivableDays: null, moneyCostMonthly: null, targetProfitOnCost: D('1'),
    createdBy: 'u0', createdAt: new Date(), updatedBy: 'u0', updatedAt: new Date(), publishedBy: null, publishedAt: null,
    roles: [role()],
    ...over,
  };
}

function setup(state: { current?: ReturnType<typeof set> | null; draft?: { code: string } | null; vigente?: ReturnType<typeof set> | null } = {}) {
  const tx = {
    parameterSet: {
      findUnique: vi.fn().mockResolvedValue(state.current ?? null),
      findFirst: vi.fn(({ where }: { where: { status: string } }) => Promise.resolve(where.status === 'rascunho' ? (state.draft ?? null) : (state.vigente ?? null))),
      create: vi.fn().mockResolvedValue({ id: 'novo' }),
      update: vi.fn().mockResolvedValue({}),
    },
    parameterSetRole: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue([{ nextval: 7n }]),
  };
  const prisma = { ...tx, $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService & { record: ReturnType<typeof vi.fn> };
  return { service: new ParameterSetsService(prisma, audit), tx, audit };
}

describe('ParameterSetsService — rascunho', () => {
  it('primeiro conjunto parte só das referências legais e das funções padrão', async () => {
    const { service, tx } = setup();
    await expect(service.createDraft(CONTROLADORIA)).resolves.toEqual({ id: 'novo', code: 'PAR-0007' });
    const data = tx.parameterSet.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ code: 'PAR-0007', status: 'rascunho', inssRate: '0.2', issRate: null, kmRate: null, targetProfitOnCost: null, basedOnId: null });
    expect(data.roles.create.map((r: { roleKey: string }) => r.roleKey)).toEqual(['tecnico', 'encarregado', 'gerente_projeto']);
  });

  it('novo rascunho copia o vigente, inclusive as funções', async () => {
    const vigente = set({ id: 'v1', code: 'PAR-0001', status: 'vigente' });
    const { service, tx } = setup({ vigente });
    await service.createDraft(CONTROLADORIA);
    const data = tx.parameterSet.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ basedOnId: 'v1', kmRate: D('1'), effectiveFrom: null });
    expect(data.roles.create[0]).toMatchObject({ roleKey: 'tecnico', monthlySalary: D('3000') });
    expect(data.roles.create[0].id).toBeUndefined();
  });

  it('só um rascunho por vez', async () => {
    const { service } = setup({ draft: { code: 'PAR-0003' } });
    await expect(service.createDraft(CONTROLADORIA)).rejects.toThrow(new ConflictException('Já existe o rascunho PAR-0003. Edite-o ou publique-o antes de criar outro.'));
  });

  it('conjunto publicado não é alterado', async () => {
    const { service } = setup({ current: set({ status: 'vigente' }) });
    await expect(service.update('s1', { issRate: '0.02' } as UpdateParameterSetDto, CONTROLADORIA)).rejects.toThrow(ConflictException);
  });

  it('sem acesso à folha não altera salário, mas preserva o que já existe', async () => {
    const { service, tx } = setup({ current: set() });
    await expect(service.update('s1', { roles: [{ roleKey: 'tecnico', label: 'Técnico', monthlySalary: '1' }] } as UpdateParameterSetDto, SEM_FOLHA)).rejects.toThrow(ForbiddenException);

    await service.update('s1', { roles: [{ roleKey: 'tecnico', label: 'Técnico de campo', billingRate: '70' }] } as UpdateParameterSetDto, SEM_FOLHA);
    expect(tx.parameterSetRole.createMany.mock.calls[0][0].data[0]).toMatchObject({ label: 'Técnico de campo', billingRate: '70', monthlySalary: D('3000'), healthPerMonth: D('500') });
  });

  it('funções com código repetido são recusadas', async () => {
    const { service } = setup({ current: set() });
    const dto = { roles: [{ roleKey: 'tecnico', label: 'A' }, { roleKey: 'tecnico', label: 'B' }] } as UpdateParameterSetDto;
    await expect(service.update('s1', dto, CONTROLADORIA)).rejects.toThrow(BadRequestException);
  });

  it('a auditoria registra só os nomes dos campos alterados', async () => {
    const { service, audit } = setup({ current: set() });
    await service.update('s1', { issRate: '0.02', notes: 'x' } as UpdateParameterSetDto, CONTROLADORIA);
    expect(audit.record).toHaveBeenCalledWith('u1', 'parameter_set.updated', 'parameter_set', 's1', { code: 'PAR-0002', changedFields: ['issRate', 'notes'] }, expect.anything());
  });
});

describe('ParameterSetsService — leitura', () => {
  it('sem acesso à folha, salário e custo hora não saem do servidor', async () => {
    const { service, audit } = setup({ current: set() });
    const out = await service.get('s1', SEM_FOLHA);
    expect(out.roles[0]).toEqual({ id: 'r1', roleKey: 'tecnico', label: 'Técnico', fieldRole: true, sortOrder: 1, billingRate: D('60') });
    expect(out.payrollVisible).toBe(false);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('com acesso à folha mostra o custo hora e registra a leitura', async () => {
    const { service, audit } = setup({ current: set() });
    const out = await service.get('s1', CONTROLADORIA);
    expect(out.roles[0]).toMatchObject({ monthlySalary: D('3000'), hourlyCost: { ok: true, value: { costPerHour: '39.5761' } } });
    expect(out.derived).toEqual({ invoiceTaxRate: '0.195300', platformDailyCost: '100.00' });
    expect(out.effectiveFrom).toBe('2026-12-01');
    expect(audit.record).toHaveBeenCalledWith('u1', 'access.payroll', 'parameter_set', 's1', { code: 'PAR-0002' });
  });
});

describe('ParameterSetsService — publicação', () => {
  it('lista o que falta, inclusive função sem valor hora', () => {
    const issues = publishIssues(set({ issRate: null, targetProfitOnCost: null, effectiveFrom: null, roles: [role({ billingRate: null })] }) as never);
    expect(issues.missing).toEqual(['ISS', 'Meta de lucro sobre o custo', 'Ao menos uma função de campo com valor hora e custo']);
    expect(issues.incompleteRoles).toEqual(['Técnico']);
  });

  it('recusa publicar com campo obrigatório vazio', async () => {
    const { service } = setup({ current: set({ issRate: null }) });
    await expect(service.publish('s1', CONTROLADORIA)).rejects.toThrow('Preencha antes de publicar: ISS.');
  });

  it('arquiva o vigente e publica na mesma transação', async () => {
    const vigente = set({ id: 'v1', code: 'PAR-0001', status: 'vigente', effectiveFrom: new Date('2026-11-01T00:00:00Z') });
    const { service, tx, audit } = setup({ current: set(), vigente });
    await service.publish('s1', CONTROLADORIA);
    expect(tx.parameterSet.update.mock.calls[0][0]).toEqual({ where: { id: 'v1' }, data: { status: 'arquivado', updatedBy: 'u1' } });
    expect(tx.parameterSet.update.mock.calls[1][0]).toMatchObject({ where: { id: 's1' }, data: { status: 'vigente', publishedBy: 'u1' } });
    expect(audit.record).toHaveBeenCalledWith('u1', 'parameter_set.published', 'parameter_set', 's1', { code: 'PAR-0002', effectiveFrom: '2026-12-01', replaced: 'PAR-0001' }, expect.anything());
  });

  it('vigência não pode ser anterior à do conjunto atual', async () => {
    const vigente = set({ id: 'v1', code: 'PAR-0001', status: 'vigente', effectiveFrom: new Date('2026-12-10T00:00:00Z') });
    const { service } = setup({ current: set(), vigente });
    await expect(service.publish('s1', CONTROLADORIA)).rejects.toThrow('A vigência não pode ser anterior à do conjunto atual PAR-0001 (2026-12-10).');
  });

  it('sem vigência informada, vale a data de hoje em São Paulo', () => {
    expect(todaySaoPaulo(new Date('2026-11-08T02:30:00Z'))).toBe('2026-11-07');
  });
});

describe('UpdateParameterSetDto', () => {
  const errors = async (body: Record<string, unknown>) => (await validate(plainToInstance(UpdateParameterSetDto, body))).map((e) => e.property);

  it('aceita fração, inteiro, booleano e nulo (limpar no rascunho)', async () => {
    expect(await errors({ inssRate: '0.2', workingDaysYear: 252, irpjSurcharge: true, issRate: null, kmRate: '1.30' })).toEqual([]);
  });

  it('recusa percentual fora do formato, negativo e casas demais', async () => {
    expect((await errors({ inssRate: '20%', kmRate: '-1', fgtsRate: '0.1234567', workingDaysYear: 2.5 })).sort()).toEqual(['fgtsRate', 'inssRate', 'kmRate', 'workingDaysYear']);
  });
});

describe('CatalogsService — custo real', () => {
  const m = { id: 'm1', name: 'Item', manufacturer: null, partNumber: null, unit: 'un', billedPrice: D('10'), realCost: D('4'), clientRef: null, active: true, createdBy: 'u', createdAt: new Date(), updatedBy: 'u', updatedAt: new Date() };
  const service = new CatalogsService({ budgetMaterial: { findUnique: vi.fn().mockResolvedValue(m) } } as unknown as PrismaService, {} as AuditService);

  it('só aparece para quem vê custo', async () => {
    expect(await service.getMaterial('m1', user(['budget_params:read']))).not.toHaveProperty('realCost');
    expect(await service.getMaterial('m1', user(['budget_params:read', 'budget:read_cost']))).toHaveProperty('realCost', D('4'));
  });

  it('não pode ser informado por quem não vê custo', async () => {
    await expect(service.createMaterial({ name: 'X', billedPrice: '1', realCost: '0.5' }, user(['budget_params:write']))).rejects.toThrow(ForbiddenException);
  });
});
