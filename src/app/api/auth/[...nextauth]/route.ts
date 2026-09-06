import { handlers } from '@/server/auth';

export const { GET, POST } = handlers;

/** Auth.js Node runtime gerektirir (argon2 ve veritabanı erişimi). */
export const runtime = 'nodejs';
