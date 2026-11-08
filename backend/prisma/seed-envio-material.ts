/**
 * Usuário de sistema "Axis (automático)" e categoria "Envio de material para obra" (PT-06 do plano projeto
 * aprovado → obra). Espelha a migração 20261127000001_usuario_sistema_categoria_envio: **idempotente**, pode rodar
 * quantas vezes quiser (o `prisma:seed` principal já chama). Rodar sozinho: `npm run seed:envio-material`.
 *
 * O usuário não consegue entrar (status `disabled` e hash que não é bcrypt) e o colaborador vinculado fica
 * `desligado` + `isSystem`, fora de listas, organograma e integrações. A categoria cai no setor "Almoxarifado e
 * Patrimônio" quando ele existe; senão, num setor técnico `SISTEMA`.
 */
import type { PrismaClient } from '@prisma/client';

const SYSTEM_EMAIL = 'axis-automatico@sistema.axis.local';
const SYSTEM_NAME = 'Axis (automático)';
const SYSTEM_JOB_TITLE = 'Sistema (automático)';
const CATEGORY_CODE = 'LOG-ENVIO-OBRA';

export async function ensureEnvioMaterial(prisma: PrismaClient): Promise<void> {
  let sector = await prisma.sector.findFirst({ where: { name: 'Almoxarifado e Patrimônio' }, orderBy: { code: 'asc' } });
  if (!sector) sector = await prisma.sector.upsert({ where: { code: 'SISTEMA' }, update: {}, create: { code: 'SISTEMA', name: 'Sistema (automático)' } });

  const jobTitle = await prisma.jobTitle.upsert({ where: { name: SYSTEM_JOB_TITLE }, update: {}, create: { name: SYSTEM_JOB_TITLE, isTechnician: false } });

  const collaborator = await prisma.collaborator.upsert({
    where: { corporateEmail: SYSTEM_EMAIL },
    update: { isSystem: true },
    create: {
      fullName: SYSTEM_NAME,
      rgEnc: 'n/a',
      cpfEnc: 'n/a',
      cpfHash: 'sistema-axis-automatico',
      corporateEmail: SYSTEM_EMAIL,
      jobTitleId: jobTitle.id,
      sectorId: sector.id,
      status: 'desligado',
      offboardedAt: new Date(),
      managementLevel: 'colaborador',
      matricula: 'SISTEMA-AUTO',
      isSystem: true,
    },
  });

  // `update: {}`: nunca reativa o usuário nem troca o hash se alguém mexeu.
  await prisma.user.upsert({
    where: { email: SYSTEM_EMAIL },
    update: {},
    create: { email: SYSTEM_EMAIL, passwordHash: '!', status: 'disabled', collaboratorId: collaborator.id },
  });

  const category = await prisma.requestCategory.upsert({
    where: { code: CATEGORY_CODE },
    update: {},
    create: { code: CATEGORY_CODE, name: 'Envio de material para obra', sectorId: sector.id, kind: 'envio_material', confidentiality: 'interna' },
  });
  const hasVersion = await prisma.categoryVersion.findFirst({ where: { categoryId: category.id } });
  if (!hasVersion) {
    await prisma.categoryVersion.create({
      data: {
        categoryId: category.id,
        version: 1,
        status: 'publicada',
        formSchema: [],
        workflowSchema: [],
        slaFirstResponseMinutes: 240,
        slaResolutionMinutes: 2880,
        publishedAt: new Date(),
      },
    });
  }
}

// Execução direta (`npm run seed:envio-material`); importado pelo seed principal, só exporta a função.
if (process.argv[1] && /seed-envio-material\.(ts|js)$/.test(process.argv[1])) {
  const { PrismaClient: Client } = await import('@prisma/client');
  const prisma = new Client();
  ensureEnvioMaterial(prisma)
    .then(() => console.log('Usuário de sistema e categoria "Envio de material para obra" garantidos.'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
