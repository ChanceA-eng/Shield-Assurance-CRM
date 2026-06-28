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

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

const databaseUrl = buildPrismaDatabaseUrl();

if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: ['error'] });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}