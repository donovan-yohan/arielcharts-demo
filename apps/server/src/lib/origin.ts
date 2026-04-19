import type { Request, Response } from 'express';

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes('*') || allowedOrigins.includes(origin);
}

export function assertAllowedOrigin(request: Request, response: Response, allowedOrigins: string[]) {
  const origin = request.headers.origin;
  if (!isOriginAllowed(origin, allowedOrigins)) {
    response.status(403).json({ error: 'origin_not_allowed' });
    return false;
  }

  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }

  response.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-session-id');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return true;
}
