export const PORT = parseInt(process.env.PORT ?? '3001', 10);
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',');
export const DATA_DIR = process.env.DATA_DIR ?? '.';
