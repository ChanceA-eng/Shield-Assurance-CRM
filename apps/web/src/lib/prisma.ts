import { Prisma, PrismaClient } from '@prisma/client';

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

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

const databaseUrl = buildPrismaDatabaseUrl();

if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
}

const prismaOptions: Prisma.PrismaClientOptions = { log: ['error'] };
if (databaseUrl) {
  prismaOptions.datasourceUrl = databaseUrl;
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient(prismaOptions);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}