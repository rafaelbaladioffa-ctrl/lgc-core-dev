import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateApprovalAuthorityRuleDto } from './dto/create-approval-authority-rule.dto.js';

@Injectable()
export class ApprovalAuthorityRulesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateApprovalAuthorityRuleDto) {
    return this.prisma.approvalAuthorityRule.create({
      data: { sectorId: dto.sectorId, minValue: dto.minValue, maxValue: dto.maxValue, levels: dto.levels },
    });
  }

  findAll() {
    return this.prisma.approvalAuthorityRule.findMany({ orderBy: [{ sectorId: 'asc' }, { minValue: 'asc' }] });
  }

  /** §9.2: a regra com `sectorId` específico tem prioridade sobre uma regra global (`sectorId`
   * nulo) que cubra o mesmo valor; `null` quando nenhuma faixa ativa cobre o valor dado. */
  async findApplicableRule(value: number, sectorId: string) {
    const rules = await this.prisma.approvalAuthorityRule.findMany({ where: { active: true, OR: [{ sectorId }, { sectorId: null }] } });
    const matches = rules.filter((r) => value >= Number(r.minValue) && (r.maxValue === null || value <= Number(r.maxValue)));
    if (matches.length === 0) return null;
    return matches.find((r) => r.sectorId === sectorId) ?? matches[0];
  }

  async remove(id: string) {
    const rule = await this.prisma.approvalAuthorityRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Regra de alçada não encontrada');
    await this.prisma.approvalAuthorityRule.update({ where: { id }, data: { active: false } });
  }
}
