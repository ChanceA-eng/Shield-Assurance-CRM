import { Body, Controller, Get, Post } from '@nestjs/common';
import { AccountsService } from './accounts.service.js';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  list() {
    return this.accountsService.list();
  }

  @Post()
  create(@Body() body: { name: string; isCorporate?: boolean }) {
    return this.accountsService.create(body);
  }
}
