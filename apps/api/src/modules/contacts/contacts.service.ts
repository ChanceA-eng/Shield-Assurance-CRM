import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service.js';

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.contact.findMany({ include: { account: true } });
  }

  create(input: {
    accountId: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  }) {
    return this.prisma.contact.create({ data: input });
  }
}
