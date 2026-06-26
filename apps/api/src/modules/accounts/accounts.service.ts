import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service.js';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.account.findMany({ include: { contacts: true, deals: true } });
  }

  create(input: { name: string; isCorporate?: boolean }) {
    return this.prisma.account.create({
      data: {
        name: input.name,
        isCorporate: input.isCorporate ?? false,
      },
    });
  }
}
