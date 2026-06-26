import { Module } from '@nestjs/common';
import { DealsController } from './deals.controller.js';
import { DealsService } from './deals.service.js';
import { PrismaService } from '../../common/prisma.service.js';
import { WorkflowModule } from '../workflow/workflow.module.js';

@Module({
  imports: [WorkflowModule],
  controllers: [DealsController],
  providers: [DealsService, PrismaService],
  exports: [DealsService],
})
export class DealsModule {}
