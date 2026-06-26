import { Body, Controller, Headers, HttpCode, Post, Query } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service.js';
import { ActivitiesService } from '../activities/activities.service.js';
import { GraphSyncService } from './graph-sync.service.js';

interface GraphWebhookNotification {
  value?: Array<{
    resourceData?: { id?: string };
  }>;
}

@Controller('integrations/microsoft/graph')
export class GraphWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activitiesService: ActivitiesService,
    private readonly graphSyncService: GraphSyncService,
  ) {}

  @Post('webhook')
  @HttpCode(202)
  async receive(
    @Query('validationToken') validationToken?: string,
    @Headers('client-state') clientState?: string,
    @Body() body?: unknown,
  ) {
    if (validationToken) {
      return validationToken;
    }

    const payload = body as GraphWebhookNotification;
    const firstMessageId = payload.value?.[0]?.resourceData?.id;

    if (firstMessageId) {
      const message = await this.graphSyncService.fetchMessageSummary(firstMessageId);
      const contact = message.senderEmail
        ? await this.prisma.contact.findUnique({ where: { email: message.senderEmail } })
        : null;

      if (contact) {
        await this.activitiesService.create({
          contactId: contact.id,
          type: 'EMAIL',
          direction: 'INBOUND',
          subject: message.subject,
          body: message.bodyPreview,
          externalId: message.externalId,
        });
      }
    }

    return {
      accepted: true,
      clientState,
      eventsReceived: body,
    };
  }
}
