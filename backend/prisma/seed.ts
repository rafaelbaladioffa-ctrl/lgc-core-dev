import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createCipheriv, createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();

// Minimal standalone copy of FieldEncryptionService's scheme (AES-256-GCM, iv+authTag+ciphertext
// base64), used only to seed the admin's own collaborator record with encrypted placeholder values.
function encryptionKey(): Buffer {
  const hexKey = process.env.FIELD_ENCRYPTION_KEY;
  if (!hexKey || hexKey.length !== 64) {
    throw new Error('FIELD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hexKey, 'hex');
}

function encryptField(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function hashForLookup(plaintext: string): string {
  return createHash('sha256').update(encryptionKey()).update(plaintext).digest('hex');
}

const PERMISSIONS: Array<{ resource: string; action: string; description: string }> = [
  { resource: 'sector', action: 'create', description: 'Criar setores' },
  { resource: 'sector', action: 'read', description: 'Visualizar setores' },
  { resource: 'sector', action: 'update', description: 'Editar setores' },
  { resource: 'sector', action: 'delete', description: 'Remover setores' },
  { resource: 'cost_center', action: 'create', description: 'Criar centros de custo' },
  { resource: 'cost_center', action: 'read', description: 'Visualizar centros de custo' },
  { resource: 'cost_center', action: 'update', description: 'Editar centros de custo' },
  { resource: 'cost_center', action: 'delete', description: 'Remover centros de custo' },
  { resource: 'job_title', action: 'create', description: 'Criar cargos' },
  { resource: 'job_title', action: 'read', description: 'Visualizar cargos' },
  { resource: 'job_title', action: 'update', description: 'Editar cargos' },
  { resource: 'job_title', action: 'delete', description: 'Remover cargos' },
  { resource: 'work_schedule', action: 'create', description: 'Criar jornadas de trabalho' },
  { resource: 'work_schedule', action: 'read', description: 'Visualizar jornadas de trabalho' },
  { resource: 'work_schedule', action: 'update', description: 'Editar jornadas de trabalho' },
  { resource: 'work_schedule', action: 'delete', description: 'Remover jornadas de trabalho' },
  { resource: 'collaborator', action: 'create', description: 'Cadastrar colaboradores' },
  { resource: 'collaborator', action: 'read', description: 'Visualizar dados básicos de colaboradores' },
  { resource: 'collaborator', action: 'read_sensitive', description: 'Visualizar dados sensíveis (CPF/RG/CTPS/PIS)' },
  { resource: 'collaborator', action: 'update', description: 'Editar colaboradores' },
  { resource: 'collaborator', action: 'delete', description: 'Desligar colaboradores' },
  { resource: 'certification', action: 'create', description: 'Cadastrar certificações técnicas' },
  { resource: 'certification', action: 'read', description: 'Visualizar certificações técnicas' },
  { resource: 'certification', action: 'update', description: 'Editar certificações técnicas' },
  { resource: 'certification', action: 'delete', description: 'Remover certificações técnicas' },
  { resource: 'client', action: 'create', description: 'Cadastrar clientes' },
  { resource: 'client', action: 'read', description: 'Visualizar clientes' },
  { resource: 'client', action: 'update', description: 'Editar clientes' },
  { resource: 'client', action: 'delete', description: 'Remover clientes' },
  { resource: 'project', action: 'create', description: 'Criar projetos/propostas' },
  { resource: 'project', action: 'read', description: 'Visualizar projetos' },
  { resource: 'project', action: 'update', description: 'Editar projetos e seu status' },
  { resource: 'project', action: 'delete', description: 'Remover projetos' },
  { resource: 'request_category', action: 'create', description: 'Criar categorias e versões do catálogo de requisições' },
  { resource: 'request_category', action: 'read', description: 'Visualizar catálogo de requisições' },
  { resource: 'request_category', action: 'update', description: 'Editar categorias/versões do catálogo' },
  { resource: 'request', action: 'create', description: 'Abrir requisições' },
  { resource: 'request', action: 'read', description: 'Visualizar requisições' },
  { resource: 'request', action: 'update', description: 'Alterar status/dados de requisições (triagem, execução)' },
  { resource: 'request', action: 'assign', description: 'Atribuir/reatribuir requisições' },
  { resource: 'request', action: 'approve', description: 'Aprovar/reprovar etapas de requisições' },
  { resource: 'request', action: 'comment', description: 'Comentar e anexar arquivos em requisições' },
  { resource: 'delegation', action: 'create', description: 'Criar/revogar a própria delegação de aprovação' },
  { resource: 'delegation', action: 'read', description: 'Visualizar delegações (próprias ou recebidas)' },
  { resource: 'request', action: 'view_whistleblower_identity', description: 'Ver a identidade real do solicitante em denúncias marcadas como anônimas' },
  { resource: 'integration', action: 'read', description: 'Visualizar satélites integrados e status de entrega' },
  { resource: 'integration', action: 'manage', description: 'Registrar satélites e disparar testes de webhook' },
  { resource: 'user', action: 'create', description: 'Criar usuários de login vinculados a colaboradores' },
  { resource: 'user', action: 'read', description: 'Visualizar usuários de login' },
  { resource: 'user', action: 'update', description: 'Editar roles e ativar/desativar usuários de login' },
  { resource: 'user', action: 'reset_password', description: 'Redefinir senha temporária de usuários de login' },
];

const ROLES: Array<{ name: string; description: string; permissions: Array<[string, string]> }> = [
  {
    name: 'admin',
    description: 'Acesso administrativo completo ao sistema',
    permissions: PERMISSIONS.map((p) => [p.resource, p.action]),
  },
  {
    name: 'rh',
    description: 'Recursos Humanos — acesso completo a colaboradores, incluindo dados sensíveis',
    permissions: [
      ['sector', 'read'],
      ['cost_center', 'read'],
      ['job_title', 'read'],
      ['work_schedule', 'read'],
      ['collaborator', 'create'],
      ['collaborator', 'read'],
      ['collaborator', 'read_sensitive'],
      ['collaborator', 'update'],
      ['collaborator', 'delete'],
      ['certification', 'create'],
      ['certification', 'read'],
      ['certification', 'update'],
      ['certification', 'delete'],
      ['request', 'create'],
      ['request', 'read'],
      ['request', 'comment'],
      ['request', 'approve'],
      ['delegation', 'create'],
      ['delegation', 'read'],
      ['user', 'create'],
      ['user', 'read'],
      ['user', 'update'],
      ['user', 'reset_password'],
    ],
  },
  {
    name: 'gestor',
    description: 'Gestor de setor — gerencia equipe, projetos e chamados do setor, sem acesso a dados sensíveis',
    permissions: [
      ['sector', 'read'],
      ['cost_center', 'read'],
      ['job_title', 'read'],
      ['work_schedule', 'read'],
      ['collaborator', 'read'],
      ['collaborator', 'update'],
      ['certification', 'read'],
      ['client', 'read'],
      ['project', 'create'],
      ['project', 'read'],
      ['project', 'update'],
      ['request_category', 'read'],
      ['request', 'create'],
      ['request', 'read'],
      ['request', 'update'],
      ['request', 'assign'],
      ['request', 'approve'],
      ['request', 'comment'],
      ['delegation', 'create'],
      ['delegation', 'read'],
    ],
  },
  {
    name: 'tecnico',
    description: 'Técnico de campo — acesso de leitura ao próprio contexto operacional e atendimento de requisições',
    permissions: [
      ['sector', 'read'],
      ['collaborator', 'read'],
      ['certification', 'read'],
      ['request', 'create'],
      ['request', 'read'],
      ['request', 'update'],
      ['request', 'comment'],
    ],
  },
  {
    name: 'analista_suprimentos',
    description: 'Analista de Suprimentos — recebe e faz a triagem das requisições encaminhadas ao setor de Suprimentos',
    permissions: [
      ['sector', 'read'],
      ['collaborator', 'read'],
      ['request_category', 'read'],
      ['request', 'create'],
      ['request', 'read'],
      ['request', 'update'],
      ['request', 'assign'],
      ['request', 'comment'],
    ],
  },
  {
    name: 'colaborador',
    description: 'Colaborador padrão — acesso mínimo de leitura e abertura de requisições',
    permissions: [
      ['sector', 'read'],
      ['collaborator', 'read'],
      ['request', 'create'],
      ['request', 'read'],
      ['request', 'comment'],
    ],
  },
  {
    // Não atribuída a nenhum usuário por padrão (ver prisma/seed.ts main()) — fica disponível
    // pra ser dada a alguém via a tela de Usuários quando o usuário indicar quem exerce esse
    // papel (REQUISICOES_SPEC.md §7.3, escopo definido pela sessão de planejamento).
    name: 'compliance',
    description: 'Compliance — triagem/investigação de denúncias e dados de LGPD, com acesso à identidade real do denunciante',
    permissions: [
      ['sector', 'read'],
      ['collaborator', 'read'],
      ['request_category', 'read'],
      ['request', 'read'],
      ['request', 'update'],
      ['request', 'approve'],
      ['request', 'comment'],
      ['request', 'view_whistleblower_identity'],
    ],
  },
];

async function main() {
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { resource_action: { resource: perm.resource, action: perm.action } },
      update: { description: perm.description },
      create: perm,
    });
  }

  for (const role of ROLES) {
    const createdRole = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: { name: role.name, description: role.description },
    });

    for (const [resource, action] of role.permissions) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { resource_action: { resource, action } },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: createdRole.id, permissionId: permission.id } },
        update: {},
        create: { roleId: createdRole.id, permissionId: permission.id },
      });
    }
  }

  // Admin is also seeded as a collaborator (not just a login/service account) so it can use
  // collaborator-scoped actions out of the box — e.g. ticket comments/attachments, which are
  // attributed to a Collaborator, not a User (see PLANNING.md 5.1: not every user needs to be a
  // collaborator, but this one is, for convenience in dev/testing).
  const adminSector = await prisma.sector.upsert({
    where: { code: 'ADM' },
    update: {},
    create: { code: 'ADM', name: 'Administração' },
  });

  const adminJobTitle = await prisma.jobTitle.upsert({
    where: { name: 'Administrador' },
    update: {},
    create: { name: 'Administrador', isTechnician: false },
  });

  // A prior version of this seed hardcoded id "00000000-0000-0000-0000-000000000001" for the
  // default work schedule — not a valid UUID v4 (wrong version nibble), so `@IsUUID()` on
  // CreateCollaboratorDto.workScheduleId rejected it whenever the frontend tried to assign it to
  // a collaborator. Nothing could have referenced it successfully (every such assignment 400'd),
  // so it's safe to drop and let it be recreated below with a real generated id.
  await prisma.workSchedule.deleteMany({ where: { id: '00000000-0000-0000-0000-000000000001' } });

  // Default work schedule so the collaborator form's dropdown is never empty on a fresh install.
  // WorkSchedule.name isn't unique, so this is a find-then-create rather than an upsert — and
  // deliberately lets Prisma's @default(uuid()) generate the id, rather than a hardcoded one.
  const defaultWorkSchedule = await prisma.workSchedule.findFirst({ where: { name: 'Comercial (8h-18h)' } });
  if (!defaultWorkSchedule) {
    await prisma.workSchedule.create({
      data: {
        name: 'Comercial (8h-18h)',
        startTime: '08:00',
        endTime: '18:00',
        breakMinutes: 60,
        daysOfWeek: ['seg', 'ter', 'qua', 'qui', 'sex'],
      },
    });
  }

  const adminCpf = process.env.SEED_ADMIN_CPF ?? '00000000000';
  const adminMatriculaRows = await prisma.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('collaborator_matricula_seq') AS nextval`;
  const adminMatricula = String(adminMatriculaRows[0].nextval).padStart(4, '0');
  const adminCollaborator = await prisma.collaborator.upsert({
    where: { cpfHash: hashForLookup(adminCpf) },
    update: {},
    create: {
      matricula: adminMatricula,
      fullName: 'Administrador do Sistema',
      rgEnc: encryptField('000000000'),
      cpfEnc: encryptField(adminCpf),
      cpfHash: hashForLookup(adminCpf),
      corporateEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@axis.local',
      jobTitleId: adminJobTitle.id,
      sectorId: adminSector.id,
    },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@axis.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { collaboratorId: adminCollaborator.id },
    create: { email: adminEmail, passwordHash, status: 'active', collaboratorId: adminCollaborator.id },
  });

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });

  // Every sector must have a default service queue. Requests are routed to this
  // queue before any individual analyst is assigned.
  const sectors = await prisma.sector.findMany({ select: { id: true, name: true } });
  for (const sector of sectors) {
    let queue = await prisma.queue.findFirst({ where: { sectorId: sector.id }, orderBy: { createdAt: 'asc' } });
    if (!queue) queue = await prisma.queue.create({ data: { sectorId: sector.id, name: `Fila - ${sector.name}` } });
    await prisma.request.updateMany({ where: { sectorId: sector.id, queueId: null }, data: { queueId: queue.id } });
  }

  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log('—————————————————————————————————————————');
    console.log(`Admin seed user: ${adminEmail}`);
    console.log(`Admin seed password (generated, save it): ${adminPassword}`);
    console.log('Set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env vars to control this on future seeds.');
    console.log('—————————————————————————————————————————');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
