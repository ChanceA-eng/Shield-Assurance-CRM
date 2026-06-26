import { Module } from '@nestjs/common';
import { ActivitiesController } from './activities.controller.js';
import { ActivitiesService } from './activities.service.js';
import { PrismaService } from '../../common/prisma.service.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { RolesGuard } from '../../common/auth/roles.guard.js';
import { ApiKeyGuard } from '../../common/auth/api-key.guard.js';
import { Reflector } from '@nestjs/core';

@Module({
  imports: [RealtimeModule],
  controllers: [ActivitiesController],
  providers: [ActivitiesService, PrismaService, RolesGuard, ApiKeyGuard, Reflector],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
