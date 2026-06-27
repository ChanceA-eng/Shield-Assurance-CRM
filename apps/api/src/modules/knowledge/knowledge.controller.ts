import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service.js';

interface CreateKnowledgeDocumentBody {
  title?: string;
  sourceType?: string;
  sourceUrl?: string;
  rawText?: string;
  carrierName?: string;
  stateContext?: string;
  policyType?: string;
  topic?: string;
  topicTags?: string[] | string;
}

interface AskRashiBody {
  question?: string;
  documentId?: string;
  carrierName?: string;
  stateContext?: string;
  policyType?: string;
  topic?: string;
  topicTags?: string[] | string;
  limit?: number;
}

@Controller('rashi')
export class KnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly knowledgeService: KnowledgeService) {}

  @Get('documents')
  listDocuments(
    @Query('carrierName') carrierName?: string,
    @Query('stateContext') stateContext?: string,
    @Query('policyType') policyType?: string,
    @Query('topic') topic?: string,
    @Query('topicTags') topicTags?: string,
  ) {
    return this.knowledgeService.listDocuments({
      carrierName,
      stateContext,
      policyType,
      topic,
      topicTags,
    });
  }

  @Get('stats')
  getStats(
    @Query('carrierName') carrierName?: string,
    @Query('stateContext') stateContext?: string,
    @Query('policyType') policyType?: string,
    @Query('topic') topic?: string,
  ) {
    return this.knowledgeService.getStats({
      carrierName,
      stateContext,
      policyType,
      topic,
    });
  }

  @Get('documents/:documentId')
  getDocument(@Param('documentId') documentId: string) {
    return this.knowledgeService.getDocument(documentId);
  }

  @Post('documents')
  createDocument(@Body() body: CreateKnowledgeDocumentBody) {
    return this.knowledgeService.createDocument(body);
  }

  @Post('ingest')
  ingestDocument(@Body() body: CreateKnowledgeDocumentBody) {
    return this.knowledgeService.createDocument(body);
  }

  @Post('query')
  askRashi(@Body() body: AskRashiBody) {
    return this.knowledgeService.askRashi(body);
  }
}