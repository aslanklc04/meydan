import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql, migrateTestDatabase, truncateAll, uniqueSuffix } from './setup';
import { identityService } from '../../src/server/modules/identity/service';
import { identityRepository } from '../../src/server/modules/identity/repository';
import { hashToken } from '../../src/server/security/hash';

/**
 * Kimlik akışlarının uçtan uca doğrulaması — gerçek veritabanı üzerinde.
 * Faz 2 çıkış kriteri: kayıt → doğrulama → giriş → oturum → iptal → sıfırlama.
 */

const sql = createSql();

const newUser = () => {
  const s = uniqueSuffix();
  return {
    username: `emir${s}`.slice(0, 20),
    email: `emir${s}@example.com`,
    password: 'meydan-tahmin-2026',
    acceptTerms: true as const,
  };
};

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await truncateAll(sql);
});

afterAll(async () => {
  await sql.end();
});

describe('kayıt', () => {
  it('kullanıcı, profil ve doğrulama token kaydı oluşturur', async () => {
    const input = newUser();
    const result = await identityService.register(input);

    expect(result.userId).toBeTruthy();
    expect(result.verificationToken).toBeTruthy();

    const user = await identityRepository.findById(result.userId);
    expect(user?.email).toBe(input.email);
    expect(user?.usernameLower).toBe(input.username.toLowerCase());
    expect(user?.emailVerified).toBeNull();
    expect(user?.status).toBe('ACTIVE');
    expect(user?.role).toBe('USER');

    const profile = await sql`SELECT * FROM "profile" WHERE user_id = ${result.userId}`;
    expect(profile).toHaveLength(1);
  });

  it('parolayı düz metin saklamaz ve argon2id kullanır', async () => {
    const input = newUser();
    const { userId } = await identityService.register(input);
    const user = await identityRepository.findById(userId);

    expect(user?.passwordHash).not.toContain(input.password);
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('ham token veritabanında tutulmaz — yalnızca sha256 özeti', async () => {
    const { userId, verificationToken } = await identityService.register(newUser());
    const rows = await sql`SELECT token_hash FROM "verification_token" WHERE user_id = ${userId}`;

    expect(rows[0]?.token_hash).toBe(hashToken(verificationToken));
    expect(rows[0]?.token_hash).not.toBe(verificationToken);
  });

  it('kullanıcı adı çakışmasını reddeder — büyük/küçük harften bağımsız', async () => {
    const input = newUser();
    await identityService.register(input);

    await expect(
      identityService.register({
        ...newUser(),
        username: input.username.toUpperCase(),
      }),
    ).rejects.toThrow(/kullanıcı adı alınmış/i);
  });

  it('rezerve kullanıcı adını reddeder', async () => {
    await expect(identityService.register({ ...newUser(), username: 'admin' })).rejects.toThrow(
      /kullanılamaz/i,
    );
  });

  it('zayıf parolayı reddeder ve hesap oluşturmaz', async () => {
    const input = { ...newUser(), password: 'password123' };
    await expect(identityService.register(input)).rejects.toThrow(/yaygın/i);

    const found = await identityRepository.findByEmail(input.email);
    expect(found).toBeUndefined();
  });

  it('kullanıcı adını içeren parolayı reddeder', async () => {
    const input = newUser();
    await expect(
      identityService.register({ ...input, password: `${input.username}-guclu-parola` }),
    ).rejects.toThrow(/kullanıcı adınızı/i);
  });

  it('koşullar kabul edilmeden kayıt yapılamaz', async () => {
    await expect(
      identityService.register({ ...newUser(), acceptTerms: false as unknown as true }),
    ).rejects.toThrow(/kullanım koşullarını/i);
  });
});

describe('e-posta doğrulama', () => {
  it('geçerli token e-postayı doğrular', async () => {
    const { userId, verificationToken } = await identityService.register(newUser());
    await identityService.verifyEmail(verificationToken);

    const user = await identityRepository.findById(userId);
    expect(user?.emailVerified).toBeInstanceOf(Date);
  });

  it('aynı bağlantı ikinci kez kullanılamaz', async () => {
    const { verificationToken } = await identityService.register(newUser());
    await identityService.verifyEmail(verificationToken);
    await expect(identityService.verifyEmail(verificationToken)).rejects.toThrow(
      /daha önce kullanılmış/i,
    );
  });

  it('geçersiz token reddedilir', async () => {
    await expect(identityService.verifyEmail('uydurma-token')).rejects.toThrow(/geçersiz/i);
  });
});

describe('giriş', () => {
  it('doğru bilgilerle giriş yapılır', async () => {
    const input = newUser();
    await identityService.register(input);

    const user = await identityService.verifyCredentials(input.email, input.password);
    expect(user.username).toBe(input.username);
  });

  it('e-posta büyük/küçük harften bağımsızdır', async () => {
    const input = newUser();
    await identityService.register(input);
    await expect(
      identityService.verifyCredentials(input.email.toUpperCase(), input.password),
    ).resolves.toBeDefined();
  });

  it('yanlış parola reddedilir', async () => {
    const input = newUser();
    await identityService.register(input);
    await expect(
      identityService.verifyCredentials(input.email, 'yanlis-parola-123'),
    ).rejects.toThrow(/e-posta veya parola hatalı/i);
  });

  it('olmayan hesap için AYNI mesaj döner — numaralandırma sızıntısı yok', async () => {
    await expect(
      identityService.verifyCredentials('yok@example.com', 'herhangi-bir-parola'),
    ).rejects.toThrow(/e-posta veya parola hatalı/i);
  });

  it('askıya alınmış hesap giriş yapamaz', async () => {
    const input = newUser();
    const { userId } = await identityService.register(input);
    await sql`UPDATE "user" SET status = 'SUSPENDED' WHERE id = ${userId}`;

    await expect(identityService.verifyCredentials(input.email, input.password)).rejects.toThrow(
      /askıya alınmış/i,
    );
  });
});

describe('oturum yaşam döngüsü (ADR-06a)', () => {
  const registerAndStart = async () => {
    const input = newUser();
    const { userId } = await identityService.register(input);
    const session = await identityService.startSession({ userId });
    const user = await identityRepository.findById(userId);
    return { userId, sessionId: session.sessionId, epoch: user?.sessionEpoch ?? 0, input };
  };

  it('başlatılan oturum çözümlenir', async () => {
    const { userId, sessionId, epoch } = await registerAndStart();
    const live = await identityService.resolveSession(sessionId, epoch);
    expect(live?.userId).toBe(userId);
    expect(live?.role).toBe('USER');
  });

  it('iptal edilen oturum ANINDA düşer', async () => {
    const { sessionId, epoch } = await registerAndStart();
    await identityService.endSession(sessionId);
    expect(await identityService.resolveSession(sessionId, epoch)).toBeNull();
  });

  it('hesap askıya alınınca oturum düşer', async () => {
    const { userId, sessionId, epoch } = await registerAndStart();
    await sql`UPDATE "user" SET status = 'SUSPENDED' WHERE id = ${userId}`;
    expect(await identityService.resolveSession(sessionId, epoch)).toBeNull();
  });

  it('süresi dolan oturum düşer', async () => {
    const { sessionId, epoch } = await registerAndStart();
    const future = new Date(Date.now() + 40 * 24 * 3600_000);
    expect(await identityService.resolveSession(sessionId, epoch, future)).toBeNull();
  });

  it('epoch uyuşmazlığı oturumu geçersiz kılar', async () => {
    const { sessionId, epoch } = await registerAndStart();
    expect(await identityService.resolveSession(sessionId, epoch + 1)).toBeNull();
  });

  it('"tüm cihazlardan çık" bütün oturumları kapatır', async () => {
    const { userId, epoch } = await registerAndStart();
    const s2 = await identityService.startSession({ userId });
    const s3 = await identityService.startSession({ userId });

    await identityService.endAllSessions(userId);

    expect(await identityService.resolveSession(s2.sessionId, epoch)).toBeNull();
    expect(await identityService.resolveSession(s3.sessionId, epoch)).toBeNull();
  });
});

describe('parola sıfırlama', () => {
  it('sıfırlama sonrası yeni parola çalışır, eskisi çalışmaz', async () => {
    const input = newUser();
    await identityService.register(input);

    const request = await identityService.requestPasswordReset(input.email);
    expect(request?.token).toBeTruthy();

    await identityService.resetPassword(request!.token, 'yeni-guclu-parola-2026');

    await expect(
      identityService.verifyCredentials(input.email, 'yeni-guclu-parola-2026'),
    ).resolves.toBeDefined();
    await expect(identityService.verifyCredentials(input.email, input.password)).rejects.toThrow();
  });

  it('sıfırlama TÜM oturumları kapatır', async () => {
    const input = newUser();
    const { userId } = await identityService.register(input);
    const session = await identityService.startSession({ userId });
    const before = await identityRepository.findById(userId);

    const request = await identityService.requestPasswordReset(input.email);
    await identityService.resetPassword(request!.token, 'yeni-guclu-parola-2026');

    expect(
      await identityService.resolveSession(session.sessionId, before?.sessionEpoch ?? 0),
    ).toBeNull();
  });

  it('token tek kullanımlıktır', async () => {
    const input = newUser();
    await identityService.register(input);
    const request = await identityService.requestPasswordReset(input.email);

    await identityService.resetPassword(request!.token, 'yeni-guclu-parola-2026');
    await expect(
      identityService.resetPassword(request!.token, 'baska-guclu-parola-2026'),
    ).rejects.toThrow(/daha önce kullanılmış/i);
  });

  it('yeni talep öncekini geçersiz kılar', async () => {
    const input = newUser();
    await identityService.register(input);

    const first = await identityService.requestPasswordReset(input.email);
    const second = await identityService.requestPasswordReset(input.email);

    await expect(
      identityService.resetPassword(first!.token, 'yeni-guclu-parola-2026'),
    ).rejects.toThrow(/daha önce kullanılmış/i);
    await expect(
      identityService.resetPassword(second!.token, 'yeni-guclu-parola-2026'),
    ).resolves.toBeUndefined();
  });

  it('kayıtlı olmayan e-posta için token üretmez ama HATA DA VERMEZ', async () => {
    await expect(identityService.requestPasswordReset('yok@example.com')).resolves.toBeNull();
  });

  it('sıfırlamada zayıf parola reddedilir ve token tüketilmez', async () => {
    const input = newUser();
    await identityService.register(input);
    const request = await identityService.requestPasswordReset(input.email);

    await expect(identityService.resetPassword(request!.token, 'kisa')).rejects.toThrow(
      /en az 10 karakter/i,
    );
    await expect(
      identityService.resetPassword(request!.token, 'yeni-guclu-parola-2026'),
    ).resolves.toBeUndefined();
  });
});
