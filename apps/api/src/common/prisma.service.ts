import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

function buildPrismaDatabaseUrl(): string | undefined {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return undefined;

  const url = new URL(rawUrl);
  const isDirectSupabaseHost = url.hostname.endsWith('.supabase.co') && url.port === '5432';
  const usesSupabasePooler = url.hostname.includes('pooler.supabase.com') || url.port === '6543';

  if (isDirectSupabaseHost) {
    url.port = '6543';
  }

  if (!usesSupabasePooler && !isDirectSupabaseHost) {
    return rawUrl;
  }

  url.searchParams.set('pgbouncer', 'true');
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', '1');
  }

  return url.toString();
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
