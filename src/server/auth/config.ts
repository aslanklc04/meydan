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
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== 'string' || typeof password !== 'string') return null;

        try {
          const user = await identityService.verifyCredentials(email, password);
          const session = await identityService.startSession({ userId: user.id });
          return { id: user.id, name: user.username, sessionId: session.sessionId };
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
      }
      return token;
    },

    async session({ session, token }) {
      const sid = typeof token.sid === 'string' ? token.sid : null;
      const epoch = typeof token.epoch === 'number' ? token.epoch : -1;
      if (!sid) return { ...session, user: undefined } as unknown as typeof session;

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
