import { z } from 'zod';
import { contentLimits } from '@/config';

/**
 * Kimlik akışlarının Zod şemaları.
 *
 * İstemci ve sunucu aynı şemayı paylaşır — ancak sunucu HER ZAMAN yeniden
 * doğrular. İstemci doğrulaması yalnızca kullanıcı deneyimi içindir ve hiçbir
 * zaman tek güvenlik katmanı değildir (Spesifikasyon Bölüm 58).
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'E-posta adresi gerekli.')
  .max(255, 'E-posta adresi çok uzun.')
  .email('Geçerli bir e-posta adresi girin.');

export const usernameSchema = z
  .string()
  .trim()
  .min(contentLimits.usernameMinLength, `En az ${contentLimits.usernameMinLength} karakter.`)
  .max(contentLimits.usernameMaxLength, `En fazla ${contentLimits.usernameMaxLength} karakter.`);

export const passwordSchema = z
  .string()
  .min(10, 'Parola en az 10 karakter olmalı.')
  .max(200, 'Parola en fazla 200 karakter olabilir.');

export const registerSchema = z.object({
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, {
    message: 'Kullanım koşullarını kabul etmeniz gerekiyor.',
  }),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Parola gerekli.'),
});

export const requestResetSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
