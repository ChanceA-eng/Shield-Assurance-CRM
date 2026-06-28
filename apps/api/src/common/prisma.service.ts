import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

function buildPrismaDatabaseUrl(): string | undefined {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return undefined;

  const usesSupabasePooler = rawUrl.includes('pooler.supabase.com') || rawUrl.includes(':6543');
  const hasPgbouncerFlag = /[?&]pgbouncer=true(?:&|$)/i.test(rawUrl);

  if (!usesSupabasePooler || hasPgbouncerFlag) {
    return rawUrl;
  }

  const separator = rawUrl.includes('?') ? '&' : '?';
  return `${rawUrl}${separator}pgbouncer=true&connection_limit=1`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const databaseUrl = buildPrismaDatabaseUrl();

    super(
      databaseUrl
        ? {
            datasources: {
              db: {
                url: databaseUrl,
              },
            },
          }
        : undefined,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
