import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService, PrismaService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}