import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { FieldEncryptionModule } from './common/crypto/field-encryption.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SectorsModule } from './sectors/sectors.module.js';
import { CostCentersModule } from './cost-centers/cost-centers.module.js';
import { JobTitlesModule } from './job-titles/job-titles.module.js';
import { WorkSchedulesModule } from './work-schedules/work-schedules.module.js';
import { CollaboratorsModule } from './collaborators/collaborators.module.js';
import { CertificationsModule } from './certifications/certifications.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { SitesModule } from './sites/sites.module.js';
import { RequestCategoriesModule } from './request-categories/request-categories.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { DelegationsModule } from './delegations/delegations.module.js';
import { ApprovalAuthorityRulesModule } from './approval-authority-rules/approval-authority-rules.module.js';
import { HolidaysModule } from './holidays/holidays.module.js';
import { IntegrationModule } from './integration/integration.module.js';
import { UsersModule } from './users/users.module.js';
import { AuditLogInterceptor } from './audit/audit-log.interceptor.js';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    FieldEncryptionModule,
    AuditModule,
    AuthModule,
    SectorsModule,
    CostCentersModule,
    JobTitlesModule,
    WorkSchedulesModule,
    CollaboratorsModule,
    CertificationsModule,
    ClientsModule,
    ProjectsModule,
    SitesModule,
    RequestCategoriesModule,
    RequestsModule,
    DelegationsModule,
    ApprovalAuthorityRulesModule,
    HolidaysModule,
    IntegrationModule,
    UsersModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor }],
})
export class AppModule {}
