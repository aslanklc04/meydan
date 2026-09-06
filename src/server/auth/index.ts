import { AuthenticationError, AuthorizationError } from '@/server/errors';
import { auth } from './config';

export { auth, signIn, signOut, handlers } from './config';

export type Actor = {
  readonly id: string;
  readonly username: string;
  readonly role: 'USER' | 'MODERATOR' | 'ADMIN';
  readonly emailVerified: boolean;
};

/** Oturum sahibini döndürür; yoksa null. */
export async function currentActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    username: session.user.username,
    role: session.user.role,
    emailVerified: session.user.emailVerified,
  };
}

/**
 * Guard: oturum zorunlu. Her mutasyonun ilk adımı.
 * Spesifikasyon Bölüm 10.2 — üç katmanlı kontrolün birincisi.
 */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new AuthenticationError();
  return actor;
}

/** Guard: rol zorunlu. Middleware kontrolüne ek olarak her endpoint'te tekrarlanır. */
export async function requireRole(...roles: readonly Actor['role'][]): Promise<Actor> {
  const actor = await requireActor();
  if (!roles.includes(actor.role)) throw new AuthorizationError();
  return actor;
}
