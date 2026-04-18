/**
 * Origin validation for CORS and security
 */

import type { Request } from 'express';
import { config } from './env.js';

export function isOriginAllowed(origin: string | undefined): boolean {
  // Allow requests with no origin (e.g., mobile apps, curl)
  if (!origin) {
    return true;
  }

  // Wildcard allows all origins
  if (config.cors.origins === '*') {
    return true;
  }

  // Check against allowed list
  if (Array.isArray(config.cors.origins)) {
    return config.cors.origins.some(allowed => {
      // Exact match
      if (allowed === origin) {
        return true;
      }
      // Wildcard subdomain match (e.g., *.example.com)
      if (allowed.startsWith('*.')) {
        const domain = allowed.slice(2);
        return origin.endsWith(domain) || origin === domain.slice(1);
      }
      return false;
    });
  }

  return false;
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.origin;
  
  if (isOriginAllowed(origin)) {
    return {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    };
  }

  return {};
}

export function validateOriginMiddleware(
  req: Request,
  res: Response,
  next: () => void
): void {
  const origin = req.headers.origin;
  
  if (!isOriginAllowed(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }
  
  next();
}

// Type augmentation for Express
import type { Response } from 'express';
