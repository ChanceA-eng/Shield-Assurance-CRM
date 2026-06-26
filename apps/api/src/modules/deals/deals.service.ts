import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';

type DealStage = 'LEAD' | 'QUOTING' | 'PRESENTED' | 'BOUND' | 'LOST';

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowService: WorkflowService,
  ) {}

  list() {
    return this.prisma.deal.findMany({ include: { account: true } });
  }

  create(input: {
    accountId: string;
    title: string;
    amount?: number;
    lineType: 'P_C' | 'LIFE_HEALTH';
    customFields?: Record<string, unknown>;
  }) {
    const data: Prisma.DealUncheckedCreateInput = {
      accountId: input.accountId,
      title: input.title,
      amount: input.amount,
      lineType: input.lineType,
      customFields: input.customFields ? (input.customFields as Prisma.InputJsonValue) : undefined,
    };

    return this.prisma.deal.create({ data });
  }

  async updateStage(input: { dealId: string; stage: DealStage; triggeredBy: string }) {
    const deal = await this.prisma.deal.update({
      where: { id: input.dealId },
      data: { stage: input.stage },
    });

    if (deal.stage === 'BOUND') {
      await this.workflowService.enqueueDealBound({
        dealId: deal.id,
        accountId: deal.accountId,
        triggeredBy: input.triggeredBy,
        occurredAt: new Date().toISOString(),
      });
    }

    return deal;
  }
}
