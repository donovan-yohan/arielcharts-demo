import path from 'node:path';

export interface EnvConfig {
  host: string;
  port: number;
  allowedOrigins: string[];
  dataDir: string;
  databasePath: string;
  sessionTtlMs: number;
  origin: string;
}

function parseOrigins(value: string | undefined) {
  if (!value) {
    return ['http://localhost:3000'];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function readEnv(env = process.env): EnvConfig {
  const dataDir = env.DATA_DIR ?? path.resolve(process.cwd(), '.data');

  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 4000),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    dataDir,
    databasePath: env.DATABASE_PATH ?? path.join(dataDir, 'arielcharts.db'),
    sessionTtlMs: Number(env.SESSION_TTL_MS ?? 1000 * 60 * 60 * 12),
    origin: env.PUBLIC_ORIGIN ?? `http://localhost:${env.PORT ?? 4000}`,
  };
}
