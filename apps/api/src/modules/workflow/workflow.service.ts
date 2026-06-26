import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { WORKFLOW_EVENTS, type DealBoundEventPayload } from '@crm/shared';

@Injectable()
export class WorkflowService implements OnModuleDestroy {
  private readonly workflowQueue = new Queue('insurance-workflows', {
    connection: {
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  });

  async enqueueDealBound(payload: DealBoundEventPayload): Promise<void> {
    await this.workflowQueue.add(WORKFLOW_EVENTS.DEAL_BOUND, payload);
  }

  async onModuleDestroy(): Promise<void> {
    await this.workflowQueue.close();
  }
}
