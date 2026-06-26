import { Body, Controller, Get, Post } from '@nestjs/common';
import { ContactsService } from './contacts.service.js';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  list() {
    return this.contactsService.list();
  }

  @Post()
  create(
    @Body()
    body: {
      accountId: string;
      firstName: string;
      lastName: string;
      email: string;
      phone?: string;
    },
  ) {
    return this.contactsService.create(body);
  }
}
