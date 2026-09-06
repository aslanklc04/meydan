import { and, eq } from 'drizzle-orm';
import { db, withTransaction, type Tx } from '@/server/db';
import { eventOutcomes, eventTemplates, events } from '@/server/db/schema';
import { isUniqueViolation } from '@/server/errors';

/**
 * Tekrarlayan etkinlik üretimi — ADR-16.
 *
 * TASARIM KARARI: üretim İDEMPOTENTTİR. Aynı gün için ikinci kez çalıştırmak
 * kopya etkinlik üretmez. Bunu üç katman garanti eder:
 *   1. Üretimden önce bu şablonun var olan `occurrence_key`'leri okunur ve
 *      üretilmiş günler elenir.
 *   2. `event (template_id, occurrence_key)` üzerindeki UNIQUE index yarış
 *      durumunda son savunmadır — çakışma yakalanır, o gün "atlandı" sayılır.
 *   3. `event.slug` UNIQUE index'i, desen çakışmasına karşı ayrıca korur.
 *
 * `occurrence_key` (gün) doğal anahtardır; slug deseni değişse bile aynı gün
 * için ikinci etkinlik üretilemez. Bu yüzden iş bir zamanlayıcıdan günde
 * birkaç kez çalıştırılabilir; "tam olarak bir kez çalıştırma" garantisi
 * gerekmez.
 */

type Ctx = Tx | typeof db;

type TemplateOutcome = { readonly key: string; readonly label: string };

export type GenerationResult = {
  readonly created: number;
  readonly skipped: number;
  readonly templates: number;
};

/** "18:30" → { hour: 18, minute: 30 } */
function parseLocalTime(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':');
  const hour = Number(h);
  const minute = Number(m ?? '0');
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error(`Geçersiz saat biçimi: ${value}`);
  }
  return { hour, minute };
}

/** YYYY-MM-DD — slug ve desen değişkeni olarak kullanılır. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Bir tarihin bu tekrar kuralına uyup uymadığı. */
function matchesRecurrence(date: Date, kind: string, config: unknown): boolean {
  const dow = date.getUTCDay(); // 0 = Pazar
  switch (kind) {
    case 'DAILY':
      return true;
    case 'WEEKDAYS':
      return dow >= 1 && dow <= 5;
    case 'WEEKLY': {
      const target = readNumber(config, 'weekday');
      return dow === (target ?? 1);
    }
    case 'MONTHLY': {
      const target = readNumber(config, 'dayOfMonth');
      return date.getUTCDate() === (target ?? 1);
    }
    default:
      return false;
  }
}

function readNumber(config: unknown, key: string): number | null {
  if (typeof config !== 'object' || config === null) return null;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : null;
}

/** `{tarih}` gibi değişkenleri doldurur. */
function fill(pattern: string, vars: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

function readOutcomes(value: unknown): TemplateOutcome[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) return [];
    const { key, label } = raw as Record<string, unknown>;
    if (typeof key !== 'string' || typeof label !== 'string') return [];
    return [{ key, label }];
  });
}

export const recurringService = {
  /**
   * Aktif şablonlardan, bugünden itibaren `generateAheadDays` gün ilerisi için
   * eksik etkinlikleri üretir.
   */
  async generate(now: Date = new Date(), ctx: Ctx = db): Promise<GenerationResult> {
    const templates = await ctx
      .select()
      .from(eventTemplates)
      .where(eq(eventTemplates.active, true));

    let created = 0;
    let skipped = 0;

    for (const template of templates) {
      const outcomes = readOutcomes(template.outcomes);
      // İki sonuçtan az olan şablon ürün kuralına aykırıdır; sessizce atlanır.
      if (outcomes.length < 2) {
        skipped += 1;
        continue;
      }

      const closes = parseLocalTime(template.closesAtLocal);
      const resolves = parseLocalTime(template.resolvesAtLocal);

      // Hedef günler.
      const candidates: { date: Date; slug: string; occurrenceKey: string }[] = [];
      for (let offset = 0; offset <= template.generateAheadDays; offset += 1) {
        const day = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset),
        );
        if (!matchesRecurrence(day, template.recurrence, template.recurrenceConfig)) continue;

        const occurrenceKey = isoDate(day);
        const slug = fill(template.slugPattern, { tarih: occurrenceKey }).toLowerCase();
        candidates.push({ date: day, slug, occurrenceKey });
      }

      if (candidates.length === 0) continue;

      // KATMAN 1 — bu şablon için üretilmiş günleri tek sorguda ele.
      const existing = await ctx
        .select({ occurrenceKey: events.occurrenceKey })
        .from(events)
        .where(eq(events.templateId, template.id));
      const taken = new Set(existing.map((e) => e.occurrenceKey));

      for (const candidate of candidates) {
        if (taken.has(candidate.occurrenceKey)) {
          skipped += 1;
          continue;
        }

        const closesAt = new Date(candidate.date);
        closesAt.setUTCHours(closes.hour, closes.minute, 0, 0);
        const resolvesAt = new Date(candidate.date);
        resolvesAt.setUTCHours(resolves.hour, resolves.minute, 0, 0);
        // Sonuç saati kapanıştan önceyse ertesi güne taşınır.
        if (resolvesAt <= closesAt) resolvesAt.setUTCDate(resolvesAt.getUTCDate() + 1);

        // Kapanışı geçmiş bir gün için etkinlik üretmek anlamsızdır.
        if (closesAt <= now) {
          skipped += 1;
          continue;
        }

        const vars = { tarih: isoDate(candidate.date) };

        try {
          await withTransaction(async (tx) => {
            const inserted = await tx
              .insert(events)
              .values({
                categoryId: template.categoryId,
                title: fill(template.titlePattern, vars),
                question: fill(template.questionPattern, vars),
                slug: candidate.slug,
                closesAt,
                resolvesAt,
                status: 'OPEN',
                resolutionSource: template.resolutionSource,
                templateId: template.id,
                // CHECK: template_id ile occurrence_key ya İKİSİ birden dolu
                // ya da ikisi birden boş olmalı.
                occurrenceKey: candidate.occurrenceKey,
              })
              .returning({ id: events.id });

            const eventId = inserted[0]?.id;
            if (!eventId) throw new Error('Etkinlik oluşturulamadı.');

            await tx.insert(eventOutcomes).values(
              outcomes.map((o, i) => ({
                eventId,
                key: o.key,
                label: o.label,
                sortOrder: i,
              })),
            );
          });
          created += 1;
        } catch (error) {
          // KATMAN 2 — yarış durumu: aynı slug paralel bir çalıştırmada üretildi.
          if (isUniqueViolation(error)) {
            skipped += 1;
            continue;
          }
          throw error;
        }
      }
    }

    return { created, skipped, templates: templates.length };
  },

  async listTemplates(ctx: Ctx = db) {
    return ctx.select().from(eventTemplates).orderBy(eventTemplates.slug);
  },

  async setActive(templateId: string, active: boolean, ctx: Ctx = db): Promise<void> {
    await ctx
      .update(eventTemplates)
      .set({ active })
      .where(and(eq(eventTemplates.id, templateId)));
  },
};
