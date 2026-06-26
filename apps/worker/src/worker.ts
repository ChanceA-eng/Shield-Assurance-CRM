import 'dotenv/config';
import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { WORKFLOW_EVENTS, type DealBoundEventPayload } from '@crm/shared';
import { sendSms, sendWelcomeEmail } from './services.js';

const prisma = new PrismaClient();

const workflowWorker = new Worker(
  'insurance-workflows',
  async (job) => {
    if (job.name !== WORKFLOW_EVENTS.DEAL_BOUND) {
      return;
    }

    const payload = job.data as DealBoundEventPayload;

    const deal = await prisma.deal.findUnique({ where: { id: payload.dealId } });
    if (!deal) {
      throw new Error(`Deal not found: ${payload.dealId}`);
    }

    const account = await prisma.account.findUnique({ where: { id: deal.accountId } });
    if (!account) {
      throw new Error(`Account not found: ${deal.accountId}`);
    }

    const primaryContact = await prisma.contact.findFirst({
      where: { accountId: account.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!primaryContact) {
      throw new Error(`No primary contact found for account: ${account.id}`);
    }

    const smsResult = await sendSms({
      to: primaryContact.phone ?? '',
      body: `Congrats ${primaryContact.firstName}, your policy for ${account.name} is now bound.`,
    });

    const emailResult = await sendWelcomeEmail({
      to: primaryContact.email,
      accountName: account.name,
      dealTitle: deal.title,
    });

    await prisma.activity.create({
      data: {
        contactId: primaryContact.id,
        type: 'SYSTEM_NOTE',
        direction: 'OUTBOUND',
        subject: 'Policy Bound Automation Completed',
        body: `Automation sent SMS (${smsResult.providerId}) and Email (${emailResult.providerId}) for deal ${deal.id}.`,
      },
    });
  },
  {
    connection: {
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
    concurrency: 5,
    lockDuration: 60000,
  },
);

workflowWorker.on('completed', (job) => {
  console.log(`[worker] Completed ${job.name} (${job.id})`);
});

workflowWorker.on('failed', (job, err) => {
  console.error(`[worker] Failed ${job?.name} (${job?.id}):`, err.message);
});

async function shutdown(): Promise<void> {
  await workflowWorker.close();
  await prisma.$disconnect();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
