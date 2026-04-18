/**
 * Environment configuration for ArielCharts server
 */

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  HOST: z.string().default('0.0.0.0'),
  ALLOWED_ORIGINS: z.string().default('*'),
  DATABASE_PATH: z.string().default('./data/arielcharts.db'),
  SESSION_CLEANUP_INTERVAL_MS: z.string().transform(Number).default('300000'), // 5 minutes
  SESSION_INACTIVE_TIMEOUT_MS: z.string().transform(Number).default('3600000'), // 1 hour
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.format());
    throw new Error('Invalid environment configuration');
  }
  
  return parsed.data;
}

export const env = loadEnv();

// Derived config values
export const config = {
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  cors: {
    origins: env.ALLOWED_ORIGINS === '*' 
      ? '*' 
      : env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean),
  },
  session: {
    cleanupIntervalMs: env.SESSION_CLEANUP_INTERVAL_MS,
    inactiveTimeoutMs: env.SESSION_INACTIVE_TIMEOUT_MS,
    idPattern: /^[a-z0-9_-]{6,32}$/,
  },
} as const;
