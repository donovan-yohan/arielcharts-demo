import { ALLOWED_ORIGINS } from './env';

/**
 * Returns true if the given origin is allowed.
 * - Always allows requests with no Origin header (server-to-server / same-origin).
 * - Compares against the ALLOWED_ORIGINS list with exact string equality.
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Returns CORS headers appropriate for the given origin.
 * If the origin is not allowed, returns an empty object so no CORS
 * headers are set — the browser will block the response itself.
 */
export function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!isOriginAllowed(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}
