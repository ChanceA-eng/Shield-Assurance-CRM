import { Module } from '@nestjs/common';
import { PrismaService } from './common/prisma.service.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { ContactsModule } from './modules/contacts/contacts.module.js';
import { DealsModule } from './modules/deals/deals.module.js';
import { ActivitiesModule } from './modules/activities/activities.module.js';
import { WorkflowModule } from './modules/workflow/workflow.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';

@Module({
  imports: [
    AccountsModule,
    ContactsModule,
    DealsModule,
    ActivitiesModule,
    WorkflowModule,
    IntegrationsModule,
    RealtimeModule,
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
