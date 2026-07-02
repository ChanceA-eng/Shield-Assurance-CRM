import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

const envPaths = [
  path.resolve(configDir, "apps/web/.env.local"),
  path.resolve(configDir, ".env.local"),
  path.resolve(configDir, "apps/api/.env"),
  path.resolve(configDir, ".env"),
];

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) {
    return;
  }

  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function buildPrismaDatabaseUrl(): string {
  const rawUrl = process.env.DATABASE_URL ?? "";
  if (!rawUrl) {
    return rawUrl;
  }

  const url = new URL(rawUrl);
  const isDirectSupabaseHost = url.hostname.endsWith('.supabase.co') && url.port === '5432';
  const usesSupabasePooler = url.hostname.includes('pooler.supabase.com') || url.port === '6543';

  if (isDirectSupabaseHost) {
    url.port = '6543';
  }

  if (usesSupabasePooler || isDirectSupabaseHost) {
    url.searchParams.set('pgbouncer', 'true');
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '1');
    }
  }

  return url.toString();
}

if (!process.env.DATABASE_URL) {
  for (const envPath of envPaths) {
    loadEnvFile(envPath);
    if (process.env.DATABASE_URL) {
      break;
    }
  }
}

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = buildPrismaDatabaseUrl();
}

export default {
  schema: path.resolve(configDir, 'apps/api/prisma/schema.prisma'),
  migrations: {
    path: path.resolve(configDir, 'apps/api/prisma/migrations'),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
};
