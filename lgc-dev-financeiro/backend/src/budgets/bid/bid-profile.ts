import { BadRequestException } from '@nestjs/common';
import type { BidHeaderProfile, CableLineProfile } from './bid-plan.js';

export interface BidProfileUpdate {
  header?: Partial<BidHeaderProfile>;
  cables?: Record<string, CableLineProfile | null>;
  roles?: Record<string, string | null>;
}

const CODE = /^[\w./+-]{1,80}$/;
const trimOrNull = (v: unknown, max: number, label: string): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new BadRequestException(`${label}: texto inválido.`);
  const t = v.trim();
  if (t.length > max) throw new BadRequestException(`${label}: até ${max} caracteres.`);
  return t || null;
};

/** Confere o corpo do perfil da Bid (os mapas não passam pelo class-validator campo a campo). */
export function validateBidProfile(dto: { header?: Partial<BidHeaderProfile>; cables?: Record<string, unknown>; roles?: Record<string, unknown> }): BidProfileUpdate {
  const out: BidProfileUpdate = {};
  if (dto.header) {
    out.header = {};
    if ('vendorName' in dto.header) out.header.vendorName = trimOrNull(dto.header.vendorName, 120, 'Fornecedor');
    if ('pocName' in dto.header) out.header.pocName = trimOrNull(dto.header.pocName, 120, 'Contato');
    if ('pocEmail' in dto.header) {
      const email = trimOrNull(dto.header.pocEmail, 255, 'E-mail');
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('E-mail do contato inválido.');
      out.header.pocEmail = email;
    }
    if ('leadTimeDays' in dto.header) out.header.leadTimeDays = dto.header.leadTimeDays ?? 0;
  }
  if (dto.cables) {
    const entries = Object.entries(dto.cables);
    if (entries.length > 200) throw new BadRequestException('Mapeamentos de cabo demais.');
    out.cables = {};
    for (const [type, raw] of entries) {
      if (!type.trim() || type.length > 80) throw new BadRequestException('Tipo de cabo inválido.');
      if (raw === null) {
        out.cables[type] = null;
        continue;
      }
      const v = raw as Record<string, unknown>;
      const code = trimOrNull(v.code, 80, 'Código da linha');
      if (!code || !CODE.test(code)) throw new BadRequestException(`Código da linha inválido para ${type}.`);
      out.cables[type] = {
        code,
        description: trimOrNull(v.description, 200, 'Descrição'),
        supplier: trimOrNull(v.supplier, 80, 'Fornecedor do cabo'),
        partNumber: trimOrNull(v.partNumber, 80, 'Código do fabricante'),
        unit: trimOrNull(v.unit, 10, 'Unidade'),
      };
    }
  }
  if (dto.roles) {
    out.roles = {};
    for (const [roleKey, raw] of Object.entries(dto.roles)) {
      if (!/^[\w-]{1,60}$/.test(roleKey)) throw new BadRequestException('Função inválida.');
      const code = raw === null ? null : trimOrNull(raw, 80, 'Código da mão de obra');
      if (code !== null && !CODE.test(code)) throw new BadRequestException(`Código de mão de obra inválido para ${roleKey}.`);
      out.roles[roleKey] = code;
    }
  }
  return out;
}
