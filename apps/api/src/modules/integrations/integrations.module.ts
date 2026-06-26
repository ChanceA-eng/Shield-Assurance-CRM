import { Module } from '@nestjs/common';
import { GraphWebhookController } from './graph-webhook.controller.js';
import { MsalAuthService } from './msal-auth.service.js';
import { SharePointFolderService } from './sharepoint-folder.service.js';
import { GraphSyncService } from './graph-sync.service.js';
import { PrismaService } from '../../common/prisma.service.js';
import { ActivitiesService } from '../activities/activities.service.js';
import { ActivityGateway } from '../realtime/activity.gateway.js';
import { ActivitiesModule } from '../activities/activities.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

@Module({
  imports: [ActivitiesModule, RealtimeModule],
  controllers: [GraphWebhookController],
  providers: [
    MsalAuthService,
    SharePointFolderService,
    GraphSyncService,
    PrismaService,
    ActivitiesService,
    ActivityGateway,
  ],
  exports: [MsalAuthService, SharePointFolderService, GraphSyncService],
})
export class IntegrationsModule {}
