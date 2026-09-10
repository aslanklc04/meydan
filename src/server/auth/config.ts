import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { serverEnv } from '@/config/env';
import { identityService } from '@/server/modules/identity/service';
import { identityRepository } from '@/server/modules/identity/repository';

/**
 * Auth.js v5 yapılandırması — ADR-06a.
 *
 * Credentials provider yalnızca JWT stratejisiyle çalışır. Bu yüzden token bir
 * `sid` (oturum kimliği) ve `epoch` taşır; `session` callback'i HER İSTEKTE
 * veritabanındaki oturum satırını doğrular. Böylece ADR-06'nın asıl amacı —
 * oturumun anında iptal edilebilmesi — korunur:
 *
 *   - hesap askıya alındı  → status !== ACTIVE  → oturum düşer
 *   - parola değişti       → sessionEpoch arttı → tüm token'lar geçersiz
 *   - "tüm cihazlardan çık"→ revokedAt doldu    → oturum düşer
 *
 * JWT içinde YETKİ BİLGİSİ TAŞINMAZ; rol her istekte veritabanından okunur.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      username: string;
      role: 'USER' | 'MODERATOR' | 'ADMIN';
      emailVerified: boolean;
    };
    sessionId: string;
  }
}

/**
 * ── "BENİ HATIRLA" ─────────────────────────────────────────────────────────
 *
 * Önceden böyle bir seçenek yoktu ve HERKES 30 gün hatırlanıyordu. Ortak
 * kullanılan bir bilgisayarda (ev, iş, kütüphane) bu, bir sonraki kişinin
 * hazır açılmış bir hesap bulması demektir.
 *
 * Kutu işaretlenmezse oturum bir iş günü kadar sürer; işaretlenirse 30 gün.
 * Süre MUTLAKTIR, kayan değil: 30 gün, "son 30 gün içinde girdiysen devam"
 * demek değil, "girişten 30 gün sonra biter" demektir. Kayan süre, bir kez
 * ele geçirilen oturumun sonsuza kadar açık kalması anlamına gelirdi.
 *
 * Çerezin kendi ömrü uzun olanla aynı kalır; asıl kararı aşağıdaki `session`
 * geri çağrısı verir. Böylece süre dolduğunda oturum SUNUCUDA geçersiz olur —
 * çerezin tarayıcıda durup durmaması bir şeyi değiştirmez.
 */
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_MS = 12 * 60 * 60 * 1000;

export const authConfig = {
  secret: serverEnv.AUTH_SECRET,

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  providers: [
    Credentials({
      credentials: {
        email: { label: 'E-posta', type: 'email' },
        password: { label: 'Parola', type: 'password' },
        remember: { label: 'Beni hatırla', type: 'checkbox' },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== 'string' || typeof password !== 'string') return null;

        // Yokluk "hatırlama" demektir: seçenek gönderilmediyse kısa oturum.
        const remember = credentials?.remember === 'true';

        try {
          const user = await identityService.verifyCredentials(email, password);
          const session = await identityService.startSession({ userId: user.id });
          return { id: user.id, name: user.username, sessionId: session.sessionId, remember };
        } catch {
          // Hata ayrıntısı istemciye sızdırılmaz: "E-posta veya parola hatalı."
          return null;
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user && 'sessionId' in user && typeof user.sessionId === 'string') {
        token.sid = user.sessionId;
        const record = await identityRepository.findById(String(user.id));
        token.epoch = record?.sessionEpoch ?? 0;
        /*
         * Bitiş zamanı GİRİŞTE bir kez yazılır ve bir daha uzatılmaz. Her
         * istekte tazelenseydi süre kayar, oturum fiilen hiç bitmezdi.
         */
        const remember = 'remember' in user && user.remember === true;
        token.expiresAt = Date.now() + (remember ? REMEMBER_MS : SHORT_MS);
      }
      return token;
    },

    async session({ session, token }) {
      const sid = typeof token.sid === 'string' ? token.sid : null;
      const epoch = typeof token.epoch === 'number' ? token.epoch : -1;
      if (!sid) return { ...session, user: undefined } as unknown as typeof session;

      /*
       * Süre dolduysa oturum SUNUCUDA biter. Kontrol burada yapılır çünkü
       * çerezin tarayıcıda ne kadar durduğu bizim elimizde değil; kararı
       * veren taraf her istekte sunucu olmalı.
       *
       * `expiresAt` taşımayan eski çerezler geçerli sayılır: bu alan
       * eklenmeden önce giriş yapmış kullanıcılar, sırf sürüm geçtiği için
       * dışarı atılmamalı.
       */
      const expiresAt = typeof token.expiresAt === 'number' ? token.expiresAt : null;
      if (expiresAt !== null && Date.now() > expiresAt) {
        return { ...session, user: undefined } as unknown as typeof session;
      }

      const live = await identityService.resolveSession(sid, epoch);
      if (!live) return { ...session, user: undefined } as unknown as typeof session;

      return {
        ...session,
        sessionId: live.sessionId,
        user: {
          id: live.userId,
          username: live.username,
          role: live.role,
          emailVerified: live.emailVerified,
        },
      };
    },
  },

  events: {
    async signOut(message) {
      const token = 'token' in message ? message.token : null;
      const sid = token && typeof token.sid === 'string' ? token.sid : null;
      if (sid) await identityService.endSession(sid);
    },
  },

  trustHost: true,
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
