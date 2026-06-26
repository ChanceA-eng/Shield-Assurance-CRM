import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ActivitiesService } from './activities.service.js';
import { Roles } from '../../common/auth/roles.decorator.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ApiKeyGuard } from '../../common/auth/api-key.guard.js';

@Controller('activities')
@UseGuards(ApiKeyGuard, RolesGuard)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get()
  @Roles('ADMIN', 'MANAGER', 'AGENT')
  list(@Query('contactId') contactId?: string) {
    return this.activitiesService.list(contactId);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER', 'AGENT')
  create(
    @Body()
    body: {
      contactId: string;
      type: 'EMAIL' | 'SMS' | 'CALL' | 'SYSTEM_NOTE';
      direction: 'INBOUND' | 'OUTBOUND';
      subject: string;
      body: string;
      externalId?: string;
    },
  ) {
    return this.activitiesService.create(body);
  }
}
