import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service.js';
import { ActivityGateway } from '../realtime/activity.gateway.js';

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityGateway: ActivityGateway,
  ) {}

  list(contactId?: string) {
    return this.prisma.activity.findMany({
      where: contactId ? { contactId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { contact: true },
    });
  }

  create(input: {
    contactId: string;
    type: 'EMAIL' | 'SMS' | 'CALL' | 'SYSTEM_NOTE';
    direction: 'INBOUND' | 'OUTBOUND';
    subject: string;
    body: string;
    externalId?: string;
  }) {
    return this.prisma.activity.create({ data: input }).then((activity: {
      id: string;
      type: 'EMAIL' | 'SMS' | 'CALL' | 'SYSTEM_NOTE';
      subject: string;
    }) => {
      this.activityGateway.publishActivity({
        id: activity.id,
        type: activity.type,
        message: activity.subject,
        at: 'just now',
      });
      return activity;
    });
  }
}
