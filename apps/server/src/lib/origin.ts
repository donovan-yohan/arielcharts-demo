import { ALLOWED_ORIGINS } from './env.js';

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin or server-to-server
  return ALLOWED_ORIGINS.some(allowed => {
    const a = allowed.trim();
    if (a === '*') return true;
    return origin === a || origin.startsWith(a);
  });
}
