import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ParameterSet, type ParameterSetRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { DEFAULT_ROLES, LEGAL_DEFAULTS, PARAMETER_FIELDS, PARAMETER_GROUPS, PARAMETER_KEYS, PAYROLL_ROLE_FIELDS, ROLE_FIELD_LABELS } from './parameter-fields.js';
import { hourlyCost, invoiceTaxRate, platformDailyCost } from './hourly-cost.js';
import type { ParameterSetRoleDto, UpdateParameterSetDto } from './parameter-sets.dto.js';

export const PAYROLL_PERMISSION = 'budget_params:read_payroll';
type SetWithRoles = ParameterSet & { roles: ParameterSetRole[] };

/** Data de hoje no fuso de São Paulo (AAAA-MM-DD). */
export function todaySaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const fromDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const canSeePayroll = (user: AuthenticatedUser) => user.permissions.includes(PAYROLL_PERMISSION);

/** O que falta para publicar: campos gerais obrigatórios vazios e funções incompletas. Vigência vazia vale a data da publicação. */
export function publishIssues(set: SetWithRoles): { missing: string[]; incompleteRoles: string[] } {
  const record = set as unknown as Record<string, unknown>;
  const missing = PARAMETER_FIELDS.filter((f) => f.required && (record[f.key] === null || record[f.key] === undefined)).map((f) => f.label);
  const incompleteRoles = set.roles.filter((r) => r.billingRate === null || (r.costPerHourOverride === null && r.monthlySalary === null)).map((r) => r.label);
  if (!set.roles.some((r) => r.fieldRole && !incompleteRoles.includes(r.label))) missing.push('Ao menos uma função de campo com valor hora e custo');
  return { missing, incompleteRoles };
}

@Injectable()
export class ParameterSetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  schema() {
    return { groups: PARAMETER_GROUPS, roleFields: ROLE_FIELD_LABELS, payrollFields: PAYROLL_ROLE_FIELDS };
  }

  async list() {
    const rows = await this.prisma.parameterSet.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, code: true, status: true, effectiveFrom: true, notes: true, createdAt: true, createdBy: true, publishedAt: true, publishedBy: true, updatedAt: true },
    });
    return rows.map((r) => ({ ...r, effectiveFrom: fromDate(r.effectiveFrom) }));
  }

  private async load(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<SetWithRoles> {
    const set = await tx.parameterSet.findUnique({ where: { id }, include: { roles: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] } } });
    if (!set) throw new NotFoundException('Conjunto de parâmetros não encontrado.');
    return set;
  }

  /** Visão para a tela. Sem `read_payroll`, salários, benefícios e custo hora não saem do servidor. */
  async get(id: string, user: AuthenticatedUser) {
    const set = await this.load(id);
    const payroll = canSeePayroll(user);
    if (payroll) await this.audit.record(user.userId, 'access.payroll', 'parameter_set', set.id, { code: set.code });
    return this.present(set, payroll);
  }

  present(set: SetWithRoles, payroll: boolean) {
    const { roles, effectiveFrom, ...rest } = set;
    return {
      ...rest,
      effectiveFrom: fromDate(effectiveFrom),
      roles: roles.map((r) => {
        const out: Record<string, unknown> = { id: r.id, roleKey: r.roleKey, label: r.label, fieldRole: r.fieldRole, sortOrder: r.sortOrder, billingRate: r.billingRate };
        if (payroll) {
          for (const k of PAYROLL_ROLE_FIELDS) out[k] = r[k];
          out.hourlyCost = hourlyCost(set, r);
        }
        return out;
      }),
      payrollVisible: payroll,
      derived: {
        invoiceTaxRate: invoiceTaxRate(set),
        platformDailyCost: platformDailyCost(set.platformMonthlyRent, set.platformDaysPerMonth),
      },
      publishIssues: set.status === 'rascunho' ? publishIssues(set) : null,
    };
  }

  /** Custo hora por função (com a composição do custo anual). Leitura registrada. */
  async hourlyCosts(id: string, user: AuthenticatedUser) {
    const set = await this.load(id);
    await this.audit.record(user.userId, 'access.payroll', 'parameter_set', set.id, { code: set.code, view: 'hourly_costs' });
    return set.roles.map((r) => ({ roleKey: r.roleKey, label: r.label, fieldRole: r.fieldRole, result: hourlyCost(set, r) }));
  }

  /** Novo rascunho copiado do vigente (ou de `basedOnId`); sem nenhum conjunto, parte das referências legais. */
  async createDraft(user: AuthenticatedUser, basedOnId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await tx.parameterSet.findFirst({ where: { status: 'rascunho' }, select: { code: true } });
      if (draft) throw new ConflictException(`Já existe o rascunho ${draft.code}. Edite-o ou publique-o antes de criar outro.`);

      const source = basedOnId ? await this.load(basedOnId, tx) : await tx.parameterSet.findFirst({ where: { status: 'vigente' }, include: { roles: true } });
      const [{ nextval }] = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('parameter_set_code_seq')`;
      const code = `PAR-${String(nextval).padStart(4, '0')}`;

      const values: Record<string, unknown> = {};
      for (const key of PARAMETER_KEYS) values[key] = source ? (source as unknown as Record<string, unknown>)[key] : (LEGAL_DEFAULTS[key] ?? null);
      const roles = source
        ? source.roles.map(({ id: _id, parameterSetId: _set, ...r }) => r)
        : DEFAULT_ROLES.map((r) => ({ ...r }));

      const created = await tx.parameterSet.create({
        data: {
          ...(values as Prisma.ParameterSetCreateInput),
          code,
          status: 'rascunho',
          basedOnId: source?.id ?? null,
          notes: null,
          effectiveFrom: null,
          createdBy: user.userId,
          updatedBy: user.userId,
          roles: { create: roles },
        },
      });
      await this.audit.record(user.userId, 'parameter_set.created', 'parameter_set', created.id, { code, basedOn: source?.code ?? null }, tx);
      return { id: created.id, code };
    });
  }

  async update(id: string, dto: UpdateParameterSetDto, user: AuthenticatedUser) {
    const payroll = canSeePayroll(user);
    if (!payroll && dto.roles?.some((r) => PAYROLL_ROLE_FIELDS.some((k) => r[k] !== undefined))) {
      throw new ForbiddenException('Salários e benefícios só podem ser alterados por quem tem acesso à folha (budget_params:read_payroll).');
    }
    const keys = new Set(dto.roles?.map((r) => r.roleKey));
    if (dto.roles && keys.size !== dto.roles.length) throw new BadRequestException('Há funções com o mesmo código.');

    return this.prisma.$transaction(async (tx) => {
      const current = await this.load(id, tx);
      if (current.status !== 'rascunho') throw new ConflictException(`O conjunto ${current.code} já foi publicado e não pode ser alterado. Crie um novo rascunho.`);

      const data: Record<string, unknown> = { updatedBy: user.userId };
      for (const key of PARAMETER_KEYS) if (dto[key] !== undefined) data[key] = dto[key];
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.effectiveFrom !== undefined) data.effectiveFrom = dto.effectiveFrom === null ? null : toDate(dto.effectiveFrom);
      await tx.parameterSet.update({ where: { id }, data: data as Prisma.ParameterSetUpdateInput });

      if (dto.roles) {
        const before = new Map(current.roles.map((r) => [r.roleKey, r]));
        await tx.parameterSetRole.deleteMany({ where: { parameterSetId: id } });
        await tx.parameterSetRole.createMany({ data: dto.roles.map((r, i) => this.roleData(id, r, i, before.get(r.roleKey), payroll)) });
      }

      const changed = [...Object.keys(data).filter((k) => k !== 'updatedBy'), ...(dto.roles ? ['roles'] : [])];
      await this.audit.record(user.userId, 'parameter_set.updated', 'parameter_set', id, { code: current.code, changedFields: changed }, tx);
      return this.present(await this.load(id, tx), payroll);
    });
  }

  /** Sem acesso à folha, a remuneração da função é preservada pelo código da função. */
  private roleData(parameterSetId: string, r: ParameterSetRoleDto, index: number, previous: ParameterSetRole | undefined, payroll: boolean): Prisma.ParameterSetRoleCreateManyInput {
    const out: Record<string, unknown> = {
      parameterSetId,
      roleKey: r.roleKey,
      label: r.label.trim(),
      fieldRole: r.fieldRole ?? true,
      sortOrder: r.sortOrder ?? index + 1,
      billingRate: r.billingRate ?? null,
    };
    for (const k of PAYROLL_ROLE_FIELDS) out[k] = payroll ? (r[k] ?? null) : (previous?.[k] ?? null);
    return out as Prisma.ParameterSetRoleCreateManyInput;
  }

  /** Publica o rascunho: arquiva o vigente e torna este o vigente, na mesma transação. */
  async publish(id: string, user: AuthenticatedUser, effectiveFrom?: string) {
    return this.prisma.$transaction(async (tx) => {
      const set = await this.load(id, tx);
      if (set.status !== 'rascunho') throw new ConflictException(`O conjunto ${set.code} já foi publicado.`);
      if (effectiveFrom) set.effectiveFrom = toDate(effectiveFrom);
      set.effectiveFrom ??= toDate(todaySaoPaulo());

      const { missing } = publishIssues(set);
      if (missing.length > 0) throw new BadRequestException(`Preencha antes de publicar: ${missing.join('; ')}.`);

      const current = await tx.parameterSet.findFirst({ where: { status: 'vigente' } });
      if (current?.effectiveFrom && set.effectiveFrom < current.effectiveFrom) {
        throw new BadRequestException(`A vigência não pode ser anterior à do conjunto atual ${current.code} (${fromDate(current.effectiveFrom)}).`);
      }
      if (current) await tx.parameterSet.update({ where: { id: current.id }, data: { status: 'arquivado', updatedBy: user.userId } });
      await tx.parameterSet.update({
        where: { id },
        data: { status: 'vigente', effectiveFrom: set.effectiveFrom, publishedBy: user.userId, publishedAt: new Date(), updatedBy: user.userId },
      });
      await this.audit.record(user.userId, 'parameter_set.published', 'parameter_set', id, { code: set.code, effectiveFrom: fromDate(set.effectiveFrom), replaced: current?.code ?? null }, tx);
      return this.present(await this.load(id, tx), canSeePayroll(user));
    });
  }
}
