import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { serverEnv } from '@/config/env';

/**
 * Kriptografik yardımcılar — Spesifikasyon Bölüm 10.1 ve 10.6.
 */

/**
 * Argon2id parametreleri — OWASP 2024 asgarisi.
 * memoryCost 19 MiB · timeCost 2 · parallelism 1
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hashValue, password);
  } catch {
    return false;
  }
}

/**
 * Kullanıcı bulunamadığında da parola doğrulama maliyeti ödenir.
 * Aksi hâlde yanıt süresi farkı, e-postanın kayıtlı olup olmadığını sızdırır.
 */
const DUMMY_HASH_PROMISE = hashPassword(randomBytes(24).toString('hex'));

export async function burnPasswordVerification(): Promise<void> {
  const dummy = await DUMMY_HASH_PROMISE;
  await verifyPassword(dummy, 'gecersiz-parola-denemesi');
}

/** Tek kullanımlık token: ham değer kullanıcıya gider, veritabanında yalnızca özeti durur. */
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Sabit süreli karşılaştırma — token doğrulamada zamanlama sızıntısını kapatır. */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * IP adresi HMAC'lenerek saklanır; ham IP hiçbir yerde tutulmaz (KVKK — veri
 * minimizasyonu). Pepper ayrı bir sırdır ve dönemsel olarak döndürülür.
 */
export function hashIp(ip: string): string {
  return createHmac('sha256', serverEnv.IP_PEPPER).update(ip).digest('hex');
}
