import { db } from '../../src/server/db';
import { categories, challenges, eventOutcomes, events } from '../../src/server/db/schema';
import { identityService } from '../../src/server/modules/identity/service';
import { catalogService } from '../../src/server/modules/catalog/service';
import { eq } from 'drizzle-orm';
import { challengeService } from '../../src/server/modules/challenge/service';

/** Test veri üreticileri. Gerçek servisleri kullanır — kısayol yoktur. */

let counter = 0;
export function uid(prefix = 'u'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export async function createUser(name = 'emir') {
  const suffix = uid('');
  const username = `${name}${suffix}`.slice(0, 20);
  const input = {
    username,
    email: `${username}@example.com`.toLowerCase(),
    password: 'meydan-tahmin-2026',
    acceptTerms: true as const,
  };
  const { userId } = await identityService.register(input);
  return { userId, ...input };
}

/** Kategori adı slug'tan türetilir; sabit "Spor" adı testlerde yanıltıcıydı. */
const CATEGORY_NAMES: Record<string, { name: string; icon: string; financial?: boolean }> = {
  spor: { name: 'Spor', icon: '⚽' },
  kripto: { name: 'Kripto', icon: '🪙', financial: true },
  finans: { name: 'Finans', icon: '💰', financial: true },
  oyun: { name: 'Oyun', icon: '🎮' },
  hava: { name: 'Hava', icon: '🌦️' },
};

export async function ensureCategory(slug = 'spor') {
  const found = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  if (found[0]) return found[0].id;

  const meta = CATEGORY_NAMES[slug] ?? { name: slug, icon: '📌' };
  const inserted = await db
    .insert(categories)
    .values({
      slug,
      name: meta.name,
      icon: meta.icon,
      kind: meta.financial ? 'FINANCIAL' : 'GENERAL',
      sortOrder: 0,
    })
    .returning({ id: categories.id });
  return inserted[0]!.id;
}

export type TestEvent = {
  eventId: string;
  outcomes: { id: string; key: string; label: string }[];
};

/** Galatasaray — Fenerbahçe · Beraberlik. Üç sonuçlu gerçekçi bir etkinlik. */
export async function createEvent(options?: {
  adminId?: string;
  closesInMinutes?: number;
  outcomes?: { key: string; label: string }[];
  categorySlug?: string;
}): Promise<TestEvent> {
  const slug = options?.categorySlug ?? 'spor';
  await ensureCategory(slug);

  const closesAt = new Date(Date.now() + (options?.closesInMinutes ?? 240) * 60_000);
  const { eventId } = await catalogService.createEvent({
    categorySlug: slug,
    title: 'Galatasaray — Fenerbahçe',
    question: 'Maçı kim kazanacak?',
    slug: `gs-fb-${uid('e')}`,
    closesAt,
    resolvesAt: new Date(closesAt.getTime() + 2 * 3600_000),
    outcomes: options?.outcomes ?? [
      { key: 'GALATASARAY', label: 'Galatasaray' },
      { key: 'FENERBAHCE', label: 'Fenerbahçe' },
      { key: 'DRAW', label: 'Beraberlik' },
    ],
    createdById: options?.adminId ?? null!,
    status: 'OPEN',
  });

  const outcomes = await db
    .select({ id: eventOutcomes.id, key: eventOutcomes.key, label: eventOutcomes.label })
    .from(eventOutcomes)
    .where(eq(eventOutcomes.eventId, eventId))
    .orderBy(eventOutcomes.sortOrder);

  return { eventId, outcomes };
}

/** Tahmin süresi dolmuş etkinlik — CHECK'leri aşmak için doğrudan UPDATE. */
export async function forceCloseDeadline(eventId: string): Promise<void> {
  const past = new Date(Date.now() - 60_000);
  await db
    .update(events)
    .set({ closesAt: past, resolvesAt: new Date(past.getTime() + 3600_000) })
    .where(eq(events.id, eventId));
}

/**
 * Meydan Okumayı kabul et — karşı tarafı otomatik seçerek.
 *
 * Göç 0018'den beri kabul eden kendi tarafını seçmek ZORUNDA (eskiden karşı
 * taraf oluşturmada atanıyordu ve üç sonuçlu maçlarda kabul edene çoğunlukla
 * beraberliği veriyordu).
 *
 * Testlerin çoğunda hangi tarafın seçildiği önemli değil; önemli olan
 * oluşturanınkinden FARKLI olması. Bu yardımcı, her çağrıda aynı sorguyu
 * tekrar yazmamak için o "doğal karşı tarafı" bulur. Belirli bir taraf
 * sınanacaksa `outcomeId` açıkça verilir.
 */
export async function acceptChallenge(
  challengeId: string,
  userId: string,
  outcomeId?: string,
): Promise<{ balance: number }> {
  if (outcomeId) return challengeService.accept(challengeId, userId, outcomeId);

  const rows = await db
    .select({
      eventId: challenges.eventId,
      creatorOutcomeId: challenges.creatorOutcomeId,
    })
    .from(challenges)
    .where(eq(challenges.id, challengeId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new Error(`Meydan Okuma bulunamadı: ${challengeId}`);

  const outcomes = await db
    .select({ id: eventOutcomes.id })
    .from(eventOutcomes)
    .where(eq(eventOutcomes.eventId, row.eventId))
    .orderBy(eventOutcomes.sortOrder);

  const counter = outcomes.find((o) => o.id !== row.creatorOutcomeId);
  if (!counter) throw new Error('Karşı taraf seçeneği yok.');

  return challengeService.accept(challengeId, userId, counter.id);
}
