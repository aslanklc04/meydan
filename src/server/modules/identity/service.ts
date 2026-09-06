import { withTransaction } from '@/server/db';
import {
  AuthenticationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
  isUniqueViolation,
} from '@/server/errors';
import {
  burnPasswordVerification,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '@/server/security/hash';
import { coinService } from '@/server/modules/economy/service';
import { identityRepository } from './repository';
import { checkUsername, normalizeEmail, usernameRejectionMessages } from './domain/username';
import { checkPassword, passwordRejectionMessages } from './domain/password';

/**
 * Identity use-case servisi — Spesifikasyon Bölüm 5.1.
 *
 * Transaction sınırı burada başlar ve biter. Repository kendi başına commit etmez.
 */

export const TERMS_VERSION = '2026-09-01';
const SESSION_TTL_DAYS = 30;
const EMAIL_TOKEN_TTL_HOURS = 24;
const RESET_TOKEN_TTL_MINUTES = 15;

export type RegisterInput = {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly acceptTerms: boolean;
};

export type RegisterResult = {
  readonly userId: string;
  /** Doğrulama bağlantısı için ham token. Yalnızca e-posta ile iletilir, log'lanmaz. */
  readonly verificationToken: string;
};

export const identityService = {
  async register(input: RegisterInput): Promise<RegisterResult> {
    if (!input.acceptTerms) {
      throw new ValidationError('Kullanım koşullarını kabul etmeniz gerekiyor.', 'acceptTerms');
    }

    const usernameCheck = checkUsername(input.username);
    if (!usernameCheck.ok) {
      throw new ValidationError(usernameRejectionMessages[usernameCheck.reason], 'username');
    }

    const email = normalizeEmail(input.email);

    const passwordCheck = checkPassword(input.password, [usernameCheck.username, email]);
    if (!passwordCheck.ok) {
      throw new ValidationError(passwordRejectionMessages[passwordCheck.reason], 'password');
    }

    const taken = await identityRepository.identifierTaken(email, usernameCheck.usernameLower);
    if (taken.username) {
      throw new ConflictError('USERNAME_TAKEN', 'Bu kullanıcı adı alınmış.', 'username');
    }
    // NOT: e-posta çakışması burada kullanıcıya SÖYLENMEZ (numaralandırma koruması).
    // Sessizce başarı döndürülür ve zaten kayıtlı adrese bilgilendirme e-postası gider.

    const passwordHash = await hashPassword(input.password);
    const { token, tokenHash } = generateToken();

    try {
      return await withTransaction(async (tx) => {
        const user = await identityRepository.createUser(
          {
            username: usernameCheck.username,
            usernameLower: usernameCheck.usernameLower,
            email,
            passwordHash,
            termsAcceptedAt: new Date(),
            termsVersion: TERMS_VERSION,
          },
          usernameCheck.username,
          tx,
        );

        await identityRepository.issueToken(
          {
            userId: user.id,
            tokenHash,
            purpose: 'EMAIL_VERIFICATION',
            expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_HOURS * 3600_000),
          },
          tx,
        );

        // Başlangıç Gümüş Çipi — kayıtla aynı transaction içinde.
        // Yeni kullanıcı boş ekran görmez (ürün kuralı 19).
        await coinService.grantInitial(tx, user.id);

        return { userId: user.id, verificationToken: token };
      });
    } catch (error) {
      // Yarış koşulu: iki kayıt isteği aynı anda kontrolü geçebilir.
      // Unique index ikinciyi reddeder — nihai savunma budur.
      if (isUniqueViolation(error)) {
        throw new ConflictError('IDENTIFIER_TAKEN', 'Bu kullanıcı adı alınmış.', 'username');
      }
      throw error;
    }
  },

  /**
   * Kimlik doğrulama. Kullanıcı bulunamasa dahi parola doğrulama maliyeti ödenir;
   * aksi hâlde yanıt süresi e-postanın kayıtlı olup olmadığını sızdırır.
   */
  async verifyCredentials(
    emailInput: string,
    password: string,
  ): Promise<{ id: string; username: string }> {
    const email = normalizeEmail(emailInput);
    const user = await identityRepository.findByEmail(email);

    if (!user?.passwordHash) {
      await burnPasswordVerification();
      throw new AuthenticationError('E-posta veya parola hatalı.', 'INVALID_CREDENTIALS');
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      throw new AuthenticationError('E-posta veya parola hatalı.', 'INVALID_CREDENTIALS');
    }

    if (user.status !== 'ACTIVE') {
      throw new AuthenticationError('Bu hesap askıya alınmış.', 'ACCOUNT_NOT_ACTIVE');
    }

    return { id: user.id, username: user.username };
  },

  async startSession(input: {
    userId: string;
    ipHash?: string;
    userAgent?: string;
  }): Promise<{ sessionId: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600_000);
    const session = await identityRepository.createSession({
      userId: input.userId,
      expiresAt,
      ...(input.ipHash === undefined ? {} : { ipHash: input.ipHash }),
      ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
    });
    await identityRepository.touchLogin(input.userId);
    return { sessionId: session.id, expiresAt };
  },

  /**
   * Her istekte çağrılır (ADR-06a). Oturumun canlı olup olmadığını veritabanından
   * doğrular; JWT'nin kendisi yetki taşımaz.
   */
  async resolveSession(sessionId: string, tokenEpoch: number, now = new Date()) {
    const row = await identityRepository.findLiveSession(sessionId);
    if (!row) return null;
    if (row.revokedAt !== null) return null;
    if (row.expiresAt.getTime() <= now.getTime()) return null;
    if (row.status !== 'ACTIVE') return null;
    // Parola değişimi epoch'u artırır → eski token'lar anında geçersiz.
    if (row.sessionEpoch !== tokenEpoch) return null;

    return {
      sessionId: row.sessionId,
      userId: row.userId,
      username: row.username,
      role: row.role,
      emailVerified: row.emailVerified !== null,
    };
  },

  async endSession(sessionId: string): Promise<void> {
    await identityRepository.revokeSession(sessionId);
  },

  async endAllSessions(userId: string): Promise<void> {
    await identityRepository.revokeAllSessions(userId);
  },

  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const record = await identityRepository.findToken(tokenHash);

    if (!record || record.purpose !== 'EMAIL_VERIFICATION') {
      throw new NotFoundError('Doğrulama bağlantısı geçersiz.');
    }
    if (record.consumedAt !== null) {
      throw new BusinessRuleError('TOKEN_USED', 'Bu bağlantı daha önce kullanılmış.');
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BusinessRuleError('TOKEN_EXPIRED', 'Doğrulama bağlantısının süresi dolmuş.');
    }

    await withTransaction(async (tx) => {
      const consumed = await identityRepository.consumeToken(tokenHash, tx);
      if (!consumed) {
        throw new BusinessRuleError('TOKEN_USED', 'Bu bağlantı daha önce kullanılmış.');
      }
      await identityRepository.markEmailVerified(record.userId, tx);
    });
  },

  /**
   * Parola sıfırlama talebi. Yanıt HER ZAMAN aynıdır — e-postanın kayıtlı olup
   * olmadığı sızdırılmaz. Token yalnızca hesap varsa üretilir.
   */
  async requestPasswordReset(emailInput: string): Promise<{ token: string } | null> {
    const email = normalizeEmail(emailInput);
    const user = await identityRepository.findByEmail(email);
    if (!user || user.status !== 'ACTIVE') return null;

    const { token, tokenHash } = generateToken();
    await identityRepository.issueToken({
      userId: user.id,
      tokenHash,
      purpose: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
    });

    return { token };
  },

  /** Sıfırlama tamamlandığında kullanıcının TÜM oturumları kapatılır. */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const record = await identityRepository.findToken(tokenHash);

    if (!record || record.purpose !== 'PASSWORD_RESET') {
      throw new NotFoundError('Sıfırlama bağlantısı geçersiz.');
    }
    if (record.consumedAt !== null) {
      throw new BusinessRuleError('TOKEN_USED', 'Bu bağlantı daha önce kullanılmış.');
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BusinessRuleError('TOKEN_EXPIRED', 'Sıfırlama bağlantısının süresi dolmuş.');
    }

    const user = await identityRepository.findById(record.userId);
    if (!user) throw new NotFoundError('Hesap bulunamadı.');

    const check = checkPassword(newPassword, [user.username, user.email]);
    if (!check.ok) {
      throw new ValidationError(passwordRejectionMessages[check.reason], 'password');
    }

    const passwordHash = await hashPassword(newPassword);

    await withTransaction(async (tx) => {
      const consumed = await identityRepository.consumeToken(tokenHash, tx);
      if (!consumed) {
        throw new BusinessRuleError('TOKEN_USED', 'Bu bağlantı daha önce kullanılmış.');
      }
      await identityRepository.setPassword(record.userId, passwordHash, tx);
      await identityRepository.revokeAllSessions(record.userId, tx);
    });
  },
};
