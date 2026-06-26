import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { DealsService } from './deals.service.js';
import { ApiKeyGuard } from '../../common/auth/api-key.guard.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';

@Controller('deals')
@UseGuards(ApiKeyGuard, RolesGuard)
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'AGENT')
  list() {
    return this.dealsService.list();
  }

  @Post()
  @Roles('ADMIN', 'MANAGER')
  create(
    @Body()
    body: {
      accountId: string;
      title: string;
      amount?: number;
      lineType: 'P_C' | 'LIFE_HEALTH';
      customFields?: Record<string, unknown>;
    },
  ) {
    return this.dealsService.create(body);
  }

  @Patch('stage')
  @Roles('ADMIN', 'MANAGER')
  updateStage(
    @Body()
    body: {
      dealId: string;
      stage: 'LEAD' | 'QUOTING' | 'PRESENTED' | 'BOUND' | 'LOST';
      triggeredBy: string;
    },
  ) {
    return this.dealsService.updateStage(body);
  }
}
