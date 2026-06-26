import { Injectable, Logger } from '@nestjs/common';

interface GraphMessageSummary {
  externalId: string;
  subject: string;
  bodyPreview: string;
  senderEmail?: string;
}

@Injectable()
export class GraphSyncService {
  private readonly logger = new Logger(GraphSyncService.name);

  async fetchMessageSummary(messageId: string): Promise<GraphMessageSummary> {
    const token = process.env.GRAPH_ACCESS_TOKEN;

    if (!token) {
      this.logger.warn('GRAPH_ACCESS_TOKEN not set, returning webhook payload fallback summary.');
      return {
        externalId: messageId,
        subject: 'Graph message received',
        bodyPreview: 'Graph token missing; saved webhook metadata only.',
      };
    }

    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${messageId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Graph request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      id: string;
      subject?: string;
      bodyPreview?: string;
      from?: { emailAddress?: { address?: string } };
    };

    return {
      externalId: payload.id,
      subject: payload.subject ?? 'No subject',
      bodyPreview: payload.bodyPreview ?? '',
      senderEmail: payload.from?.emailAddress?.address,
    };
  }
}
