import { brand } from '@/config';
import { looksLikeEmail, resolveEmailProvider, serverEnv } from '@/config/env';
import { log } from '@/server/observability/logger';

/**
 * E-POSTA GÖNDERİMİ — sağlayıcı adaptörü (Faz 6).
 *
 * Uygulamanın geri kalanı yalnızca `Mailer` arayüzünü bilir. Sağlayıcı
 * `EMAIL_PROVIDER` ortam değişkeniyle seçilir; kod değişmez.
 *
 *   console  → geliştirme. Bağlantı terminale yazılır. (varsayılan)
 *   http     → HTTP API'li sağlayıcılar (Resend, Postmark, Brevo, Mailgun…)
 *
 * NEDEN "http" ADINDA GENEL BİR ADAPTÖR: bu sağlayıcıların hepsi aynı şeyi
 * yapar — bir uç noktaya Bearer anahtarıyla JSON POST etmek. Her biri için
 * ayrı bir SDK bağımlılığı eklemek (Faz 6 talimatı: gereksiz bağımlılık
 * ekleme) hem paket boyutu hem de kilitlenme demektir. Tek bir `fetch`
 * yeterlidir; sağlayıcı değişimi iki ortam değişkeni değişimidir.
 *
 * MALİYET NOTU: adı geçen sağlayıcıların hepsinin ücretsiz katmanı, bu
 * aşamadaki hacmi karşılar (ayda birkaç bin e-posta). Yeni bir aylık gider
 * doğmaz.
 *
 * GÜVENLİK — DEĞİŞMEZ KURAL: ham doğrulama/sıfırlama token'ı YALNIZCA bu
 * sınırdan geçer. Günlüğe, hata izlemeye, analytics'e ya da denetim kaydına
 * ASLA yazılmaz. Aşağıdaki günlük satırları token değil, yalnızca sonucu
 * taşır.
 */

export type MailKind = 'verification' | 'password_reset' | 'account_exists';

export type Mailer = {
  sendEmailVerification(to: string, token: string): Promise<void>;
  sendPasswordReset(to: string, token: string): Promise<void>;
  /** Zaten kayıtlı bir adrese kayıt denemesi yapıldığında gönderilir. */
  sendAccountExistsNotice(to: string): Promise<void>;
};

const appUrl = (): string => (serverEnv.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

// ── Metinler ───────────────────────────────────────────────────────────────

type Message = { readonly subject: string; readonly text: string };

function verificationMessage(token: string): Message {
  return {
    subject: `${brand.appName} — hesabını doğrula`,
    text: [
      `${brand.appName}'a hoş geldin.`,
      '',
      'Hesabını doğrulamak için bağlantıya tıkla:',
      `${appUrl()}/verify-email?token=${token}`,
      '',
      'Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin.',
    ].join('\n'),
  };
}

function passwordResetMessage(token: string): Message {
  return {
    subject: `${brand.appName} — parola sıfırlama`,
    text: [
      'Parolanı sıfırlamak için bağlantıya tıkla:',
      `${appUrl()}/reset-password?token=${token}`,
      '',
      'Bağlantı kısa süre sonra geçersiz olur.',
      'Bu isteği sen yapmadıysan parolan değişmedi; bu e-postayı yok sayabilirsin.',
    ].join('\n'),
  };
}

function accountExistsMessage(): Message {
  return {
    subject: `${brand.appName} — bu adres zaten kayıtlı`,
    text: [
      `Bu adresle ${brand.appName}'da zaten bir hesap var.`,
      '',
      `Giriş yapabilirsin: ${appUrl()}/login`,
      `Parolanı unuttuysan: ${appUrl()}/forgot-password`,
    ].join('\n'),
  };
}

// ── Geliştirme adaptörü ────────────────────────────────────────────────────

export const consoleMailer: Mailer = {
  async sendEmailVerification(to, token) {
    console.warn(
      `[mail] ${brand.appName} doğrulama → ${to}\n  ${appUrl()}/verify-email?token=${token}`,
    );
  },
  async sendPasswordReset(to, token) {
    console.warn(
      `[mail] ${brand.appName} parola sıfırlama → ${to}\n  ${appUrl()}/reset-password?token=${token}`,
    );
  },
  async sendAccountExistsNotice(to) {
    console.warn(`[mail] ${brand.appName} — ${to} adresi zaten kayıtlı, giriş yapılabilir.`);
  },
};

// ── Üretim adaptörü (HTTP API) ─────────────────────────────────────────────

/**
 * Sağlayıcıya JSON POST eder.
 *
 * HATA DAVRANIŞI — bilinçli: gönderim başarısızsa hata FIRLATILMAZ, günlüğe
 * yazılır. Sebep: kayıt akışı e-posta yüzünden çökmemelidir. Kullanıcının
 * hesabı oluşmuştur; doğrulama bağlantısı yeniden istenebilir. Hatayı yukarı
 * fırlatmak, sağlayıcının kısa bir kesintisinde kayıt akışını tamamen
 * durdururdu.
 */
async function postToProvider(to: string, message: Message, kind: MailKind): Promise<void> {
  const endpoint = process.env.EMAIL_API_URL;
  const apiKey = process.env.EMAIL_API_KEY;
  const from = serverEnv.EMAIL_FROM;

  // Biçim burada denetlenir, uygulama açılışında DEĞİL: eksik ya da bozuk bir
  // e-posta ayarı gönderimi durdurmalı, siteyi değil (bkz. config/env.ts).
  const invalidFrom = !looksLikeEmail(from);
  if (!endpoint || !apiKey || invalidFrom) {
    log.error('email.misconfigured', {
      operation: 'email.send',
      outcome: 'failure',
      kind,
      // Adres ve anahtar YAZILMAZ; yalnızca hangisinin eksik/bozuk olduğu.
      missing: [
        !endpoint && 'EMAIL_API_URL',
        !apiKey && 'EMAIL_API_KEY',
        invalidFrom && (from ? 'EMAIL_FROM(geçersiz)' : 'EMAIL_FROM'),
      ]
        .filter(Boolean)
        .join(','),
    });
    return;
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from, to, subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      log.error('email.rejected', {
        operation: 'email.send',
        outcome: 'failure',
        kind,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    log.info('email.sent', {
      operation: 'email.send',
      outcome: 'success',
      kind,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    log.error('email.failed', {
      operation: 'email.send',
      outcome: 'failure',
      kind,
      durationMs: Date.now() - startedAt,
      error,
    });
  }
}

export const httpMailer: Mailer = {
  async sendEmailVerification(to, token) {
    await postToProvider(to, verificationMessage(token), 'verification');
  },
  async sendPasswordReset(to, token) {
    await postToProvider(to, passwordResetMessage(token), 'password_reset');
  },
  async sendAccountExistsNotice(to) {
    await postToProvider(to, accountExistsMessage(), 'account_exists');
  },
};

// ── Seçim ──────────────────────────────────────────────────────────────────

/**
 * `EMAIL_PROVIDER` değerinden adaptör seçer.
 *
 * Bilinmeyen değer arıza DEĞİLDİR: uyarı yazılır ve güvenli varsayılana
 * (console) dönülür. Yanlış yazılmış bir sağlayıcı adının bütün siteyi
 * durdurması orantısız olurdu — en kötü sonuç e-postanın gitmemesidir ve bu
 * günlükte görünür.
 */
export function selectMailer(raw = process.env.EMAIL_PROVIDER): Mailer {
  const trimmed = raw?.trim();
  const resolved = resolveEmailProvider(trimmed);

  if (trimmed && trimmed.toLowerCase() !== 'console' && trimmed.toLowerCase() !== 'http') {
    // Değerin kendisi günlüğe YAZILMAZ; yalnızca tanınmadığı ve ne yapıldığı.
    log.warn('email.unknown_provider', { operation: 'email.select', fallback: 'console' });
  }

  return resolved === 'http' ? httpMailer : consoleMailer;
}

export const mailer: Mailer = selectMailer();
