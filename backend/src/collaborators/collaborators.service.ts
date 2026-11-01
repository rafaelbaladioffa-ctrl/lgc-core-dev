import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto.js';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto.js';
import type { Collaborator, CostCenter, JobTitle, WorkSchedule } from '@prisma/client';

type CollaboratorWithRelations = Collaborator & {
  jobTitle: JobTitle;
  workSchedule: WorkSchedule | null;
  costCenter: CostCenter | null;
};

const WITH_RELATIONS = { jobTitle: true, workSchedule: true, costCenter: true } as const;

export interface CollaboratorSafeView {
  id: string;
  matricula: string;
  fullName: string;
  personalEmail: string | null;
  corporateEmail: string;
  jobTitleId: string;
  jobTitleName: string;
  isTechnician: boolean;
  sectorId: string;
  supervisorId: string | null;
  asoDate: Date | null;
  asoValidity: Date | null;
  yellowBadge: string | null;
  status: string;
  offboardedAt: Date | null;
  managementLevel: string;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  birthDate: Date | null;
  maritalStatus: string | null;
  gender: string | null;
  cep: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressState: string | null;
  admissionDate: Date | null;
  contractType: string | null;
  workScheduleId: string | null;
  workScheduleName: string | null;
  costCenterId: string | null;
  costCenterName: string | null;
  photoFilename: string | null;
  photoStoragePath: string | null;
  uniformSize: string | null;
  cnhCategory: string | null;
  cnhNumber: string | null;
  cnhExpiresAt: Date | null;
}

export interface CollaboratorFullView extends CollaboratorSafeView {
  rg: string;
  cpf: string;
  ctps: string | null;
  pis: string | null;
}

@Injectable()
export class CollaboratorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
    private readonly outbox: OutboxService,
  ) {}

  async create(dto: CreateCollaboratorDto): Promise<CollaboratorSafeView> {
    const cpfHash = this.fieldEncryption.hashForLookup(dto.cpf);
    const existing = await this.prisma.collaborator.findUnique({ where: { cpfHash } });
    if (existing) throw new ConflictException('CPF already registered');

    await this.assertJobTitleExists(dto.jobTitleId);
    if (dto.workScheduleId) await this.assertWorkScheduleExists(dto.workScheduleId);
    if (dto.costCenterId) await this.assertCostCenterExists(dto.costCenterId);
    if (dto.supervisorId) await this.assertSupervisorExists(dto.supervisorId);

    const created = await this.prisma.$transaction(async (tx) => {
      // Matrícula: atomic sequential employee code (0000, 0001, ...), same pattern as the client
      // code / project proposal sequence — nextval() is race-free under concurrent creates.
      const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('collaborator_matricula_seq') AS nextval`;
      const matricula = String(rows[0].nextval).padStart(4, '0');

      const collaborator = await tx.collaborator.create({
        data: {
          matricula,
          fullName: dto.fullName,
          rgEnc: this.fieldEncryption.encrypt(dto.rg),
          cpfEnc: this.fieldEncryption.encrypt(dto.cpf),
          cpfHash,
          ctpsEnc: dto.ctps ? this.fieldEncryption.encrypt(dto.ctps) : null,
          pisEnc: dto.pis ? this.fieldEncryption.encrypt(dto.pis) : null,
          corporateEmail: dto.corporateEmail,
          personalEmail: dto.personalEmail,
          jobTitleId: dto.jobTitleId,
          sectorId: dto.sectorId,
          supervisorId: dto.supervisorId,
          asoDate: dto.asoDate ? new Date(dto.asoDate) : null,
          asoValidity: dto.asoValidity ? new Date(dto.asoValidity) : null,
          yellowBadge: dto.yellowBadge,
          managementLevel: dto.managementLevel,
          phone: dto.phone,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
          maritalStatus: dto.maritalStatus,
          gender: dto.gender,
          cep: dto.cep,
          addressStreet: dto.addressStreet,
          addressNumber: dto.addressNumber,
          addressComplement: dto.addressComplement,
          addressDistrict: dto.addressDistrict,
          addressCity: dto.addressCity,
          addressState: dto.addressState,
          admissionDate: dto.admissionDate ? new Date(dto.admissionDate) : null,
          contractType: dto.contractType,
          workScheduleId: dto.workScheduleId,
          costCenterId: dto.costCenterId,
          photoFilename: dto.photoFilename,
          photoStoragePath: dto.photoStoragePath,
          uniformSize: dto.uniformSize,
          cnhCategory: dto.cnhCategory,
          cnhNumber: dto.cnhNumber,
          cnhExpiresAt: dto.cnhExpiresAt ? new Date(dto.cnhExpiresAt) : null,
        },
        include: WITH_RELATIONS,
      });
      await this.outbox.record(tx, 'collaborator.created', {
        collaborator_id: collaborator.id,
        name: collaborator.fullName,
        sector_id: collaborator.sectorId,
      });
      return collaborator;
    });
    return this.toSafeView(created);
  }

  async findAll(): Promise<CollaboratorSafeView[]> {
    const collaborators = await this.prisma.collaborator.findMany({
      orderBy: { fullName: 'asc' },
      include: WITH_RELATIONS,
    });
    return collaborators.map((c) => this.toSafeView(c));
  }

  async findOneSafe(id: string): Promise<CollaboratorSafeView> {
    const collaborator = await this.getOrThrow(id);
    return this.toSafeView(collaborator);
  }

  /** Decrypts sensitive fields. Caller is responsible for authorization and access logging. */
  async findOneFull(id: string): Promise<CollaboratorFullView> {
    const collaborator = await this.getOrThrow(id);
    return this.toFullView(collaborator);
  }

  async update(id: string, dto: UpdateCollaboratorDto): Promise<CollaboratorSafeView> {
    const collaborator = await this.getOrThrow(id);

    if (dto.supervisorId) {
      if (dto.supervisorId === id) throw new BadRequestException('Collaborator cannot supervise themselves');
      await this.assertSupervisorExists(dto.supervisorId);
      await this.assertNoCycle(id, dto.supervisorId);
    }
    if (dto.jobTitleId) await this.assertJobTitleExists(dto.jobTitleId);
    if (dto.workScheduleId) await this.assertWorkScheduleExists(dto.workScheduleId);
    if (dto.costCenterId) await this.assertCostCenterExists(dto.costCenterId);

    if (dto.cpf) {
      const cpfHash = this.fieldEncryption.hashForLookup(dto.cpf);
      const existing = await this.prisma.collaborator.findUnique({ where: { cpfHash } });
      if (existing && existing.id !== id) throw new ConflictException('CPF already registered');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.collaborator.update({
        where: { id },
        data: {
          fullName: dto.fullName,
          rgEnc: dto.rg ? this.fieldEncryption.encrypt(dto.rg) : undefined,
          cpfEnc: dto.cpf ? this.fieldEncryption.encrypt(dto.cpf) : undefined,
          cpfHash: dto.cpf ? this.fieldEncryption.hashForLookup(dto.cpf) : undefined,
          ctpsEnc: dto.ctps !== undefined ? this.fieldEncryption.encrypt(dto.ctps) : undefined,
          pisEnc: dto.pis !== undefined ? this.fieldEncryption.encrypt(dto.pis) : undefined,
          corporateEmail: dto.corporateEmail,
          personalEmail: dto.personalEmail,
          jobTitleId: dto.jobTitleId,
          sectorId: dto.sectorId,
          supervisorId: dto.supervisorId,
          asoDate: dto.asoDate ? new Date(dto.asoDate) : undefined,
          asoValidity: dto.asoValidity ? new Date(dto.asoValidity) : undefined,
          yellowBadge: dto.yellowBadge,
          status: dto.status,
          managementLevel: dto.managementLevel,
          phone: dto.phone,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
          maritalStatus: dto.maritalStatus,
          gender: dto.gender,
          cep: dto.cep,
          addressStreet: dto.addressStreet,
          addressNumber: dto.addressNumber,
          addressComplement: dto.addressComplement,
          addressDistrict: dto.addressDistrict,
          addressCity: dto.addressCity,
          addressState: dto.addressState,
          admissionDate: dto.admissionDate ? new Date(dto.admissionDate) : undefined,
          contractType: dto.contractType,
          workScheduleId: dto.workScheduleId,
          costCenterId: dto.costCenterId,
          photoFilename: dto.photoFilename,
          photoStoragePath: dto.photoStoragePath,
          uniformSize: dto.uniformSize,
          cnhCategory: dto.cnhCategory,
          cnhNumber: dto.cnhNumber,
          cnhExpiresAt: dto.cnhExpiresAt ? new Date(dto.cnhExpiresAt) : undefined,
        },
        include: WITH_RELATIONS,
      });
      await this.outbox.record(tx, 'collaborator.updated', {
        collaborator_id: result.id,
        changed_fields: Object.keys(dto),
      });
      return result;
    });
    void collaborator;
    return this.toSafeView(updated);
  }

  async offboard(id: string): Promise<CollaboratorSafeView> {
    await this.getOrThrow(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.collaborator.update({
        where: { id },
        data: { status: 'desligado', offboardedAt: new Date() },
        include: WITH_RELATIONS,
      });
      await this.outbox.record(tx, 'collaborator.offboarded', {
        collaborator_id: result.id,
        offboarded_at: result.offboardedAt,
      });
      return result;
    });
    return this.toSafeView(updated);
  }

  /** Builds the full org chart as a forest of trees rooted at collaborators with no supervisor. */
  async getOrgChart() {
    const collaborators = await this.prisma.collaborator.findMany({
      where: { status: { in: ['ativo', 'afastado', 'ferias'] } },
      orderBy: { fullName: 'asc' },
      include: WITH_RELATIONS,
    });

    type Node = CollaboratorSafeView & { children: Node[] };
    const byId = new Map<string, Node>();
    for (const c of collaborators) {
      byId.set(c.id, { ...this.toSafeView(c), children: [] });
    }

    const roots: Node[] = [];
    for (const node of byId.values()) {
      if (node.supervisorId && byId.has(node.supervisorId)) {
        byId.get(node.supervisorId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  private async getOrThrow(id: string): Promise<CollaboratorWithRelations> {
    const collaborator = await this.prisma.collaborator.findUnique({ where: { id }, include: WITH_RELATIONS });
    if (!collaborator) throw new NotFoundException('Collaborator not found');
    return collaborator;
  }

  private async assertSupervisorExists(supervisorId: string): Promise<void> {
    const supervisor = await this.prisma.collaborator.findUnique({ where: { id: supervisorId } });
    if (!supervisor) throw new BadRequestException('Supervisor not found');
  }

  private async assertJobTitleExists(jobTitleId: string): Promise<void> {
    const jobTitle = await this.prisma.jobTitle.findUnique({ where: { id: jobTitleId } });
    if (!jobTitle) throw new BadRequestException('Job title not found');
  }

  private async assertWorkScheduleExists(workScheduleId: string): Promise<void> {
    const workSchedule = await this.prisma.workSchedule.findUnique({ where: { id: workScheduleId } });
    if (!workSchedule) throw new BadRequestException('Work schedule not found');
  }

  private async assertCostCenterExists(costCenterId: string): Promise<void> {
    const costCenter = await this.prisma.costCenter.findUnique({ where: { id: costCenterId } });
    if (!costCenter) throw new BadRequestException('Cost center not found');
  }

  /** Walks up the chain from the prospective supervisor to ensure `id` is not an ancestor (would create a cycle). */
  private async assertNoCycle(id: string, supervisorId: string): Promise<void> {
    let current: string | null = supervisorId;
    const visited = new Set<string>();
    while (current) {
      if (current === id) throw new BadRequestException('Assignment would create a hierarchy cycle');
      if (visited.has(current)) break;
      visited.add(current);
      const next: { supervisorId: string | null } | null = await this.prisma.collaborator.findUnique({
        where: { id: current },
        select: { supervisorId: true },
      });
      current = next?.supervisorId ?? null;
    }
  }

  private toSafeView(c: CollaboratorWithRelations): CollaboratorSafeView {
    return {
      id: c.id,
      matricula: c.matricula,
      fullName: c.fullName,
      personalEmail: c.personalEmail,
      corporateEmail: c.corporateEmail,
      jobTitleId: c.jobTitleId,
      jobTitleName: c.jobTitle.name,
      isTechnician: c.jobTitle.isTechnician,
      sectorId: c.sectorId,
      supervisorId: c.supervisorId,
      asoDate: c.asoDate,
      asoValidity: c.asoValidity,
      yellowBadge: c.yellowBadge,
      status: c.status,
      offboardedAt: c.offboardedAt,
      managementLevel: c.managementLevel,
      phone: c.phone,
      emergencyContactName: c.emergencyContactName,
      emergencyContactPhone: c.emergencyContactPhone,
      birthDate: c.birthDate,
      maritalStatus: c.maritalStatus,
      gender: c.gender,
      cep: c.cep,
      addressStreet: c.addressStreet,
      addressNumber: c.addressNumber,
      addressComplement: c.addressComplement,
      addressDistrict: c.addressDistrict,
      addressCity: c.addressCity,
      addressState: c.addressState,
      admissionDate: c.admissionDate,
      contractType: c.contractType,
      workScheduleId: c.workScheduleId,
      workScheduleName: c.workSchedule?.name ?? null,
      costCenterId: c.costCenterId,
      costCenterName: c.costCenter?.name ?? null,
      photoFilename: c.photoFilename,
      photoStoragePath: c.photoStoragePath,
      uniformSize: c.uniformSize,
      cnhCategory: c.cnhCategory,
      cnhNumber: c.cnhNumber,
      cnhExpiresAt: c.cnhExpiresAt,
    };
  }

  private toFullView(c: CollaboratorWithRelations): CollaboratorFullView {
    return {
      ...this.toSafeView(c),
      rg: this.fieldEncryption.decrypt(c.rgEnc),
      cpf: this.fieldEncryption.decrypt(c.cpfEnc),
      ctps: c.ctpsEnc ? this.fieldEncryption.decrypt(c.ctpsEnc) : null,
      pis: c.pisEnc ? this.fieldEncryption.decrypt(c.pisEnc) : null,
    };
  }
}
