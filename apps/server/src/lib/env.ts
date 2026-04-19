/**
 * Environment configuration.
 * All values are read once at startup and exported as typed constants.
 */

export const PORT: number = parseInt(process.env['PORT'] ?? '3001', 10);
export const DB_PATH: string = process.env['DB_PATH'] ?? './arielcharts.db';
export const ALLOWED_ORIGINS: string[] = (process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
