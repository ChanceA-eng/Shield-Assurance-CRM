import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  isLegacyDealBoundAutomationEnabled,
  LEGACY_DEAL_BOUND_AUTOMATION_ENV,
  WORKFLOW_EVENTS,
  type DealBoundEventPayload,
} from '@crm/shared';

@Injectable()
export class WorkflowService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkflowService.name);
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
    if (!isLegacyDealBoundAutomationEnabled(process.env[LEGACY_DEAL_BOUND_AUTOMATION_ENV])) {
      this.logger.warn(`Skipped legacy deal-bound automation for ${payload.dealId}; runtime policy is disabled.`);
      return;
    }

    await this.workflowQueue.add(WORKFLOW_EVENTS.DEAL_BOUND, payload);
  }

  async onModuleDestroy(): Promise<void> {
    await this.workflowQueue.close();
  }
}
