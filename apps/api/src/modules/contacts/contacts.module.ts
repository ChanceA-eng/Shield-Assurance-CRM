import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller.js';
import { ContactsService } from './contacts.service.js';
import { PrismaService } from '../../common/prisma.service.js';

@Module({
  controllers: [ContactsController],
  providers: [ContactsService, PrismaService],
  exports: [ContactsService],
})
export class ContactsModule {}
