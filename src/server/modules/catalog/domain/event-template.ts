/**
 * Tekrarlayan etkinlik üretimi — ADR-16. Saf domain: I/O yok.
 *
 * Şablon, etkinliğin kalıbını ve tekrar kuralını tutar. Üretim işi, gelecek pencere
 * için "örnek" (occurrence) hesaplar ve her örneği yalnızca BİR KEZ üretir.
 *
 * Duplicate engeli iki katmanlıdır:
 *   1. Veritabanı: UNIQUE (template_id, occurrence_key)  ← nihai savunma
 *   2. İş idempotency'si: template:{id}:occurrence:{key}
 */

export type Recurrence = 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY';

export type EventTemplateSpec = {
  readonly id: string;
  readonly slug: string;
  readonly recurrence: Recurrence;
  /** IANA saat dilimi. Seans günü BU dilimde belirlenir — yaz saatinde gün kaymaz. */
  readonly timezone: string;
  /** WEEKLY için 0=Pazar…6=Cumartesi; MONTHLY için ayın günü. */
  readonly recurrenceConfig?: { readonly weekday?: number; readonly monthDay?: number };
  readonly titlePattern: string;
  readonly slugPattern: string;
  readonly generateAheadDays: number;
  readonly active: boolean;
};

/**
 * Bir tarihin, şablonun saat diliminde takvim gününü verir: "2026-09-03".
 * Occurrence anahtarının temelidir — UTC'ye göre hesaplamak, Europe/Istanbul
 * şablonlarında gece yarısı civarında yanlış güne düşer.
 */
export function calendarDayInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Şablonun saat diliminde haftanın günü (0=Pazar…6=Cumartesi). */
export function weekdayInZone(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[name] ?? 0;
}

/** Bu takvim günü şablonun tekrar kuralına uyuyor mu? */
export function matchesRecurrence(template: EventTemplateSpec, date: Date): boolean {
  const weekday = weekdayInZone(date, template.timezone);

  switch (template.recurrence) {
    case 'DAILY':
      return true;
    case 'WEEKDAYS':
      return weekday >= 1 && weekday <= 5;
    case 'WEEKLY':
      return weekday === (template.recurrenceConfig?.weekday ?? 1);
    case 'MONTHLY': {
      const day = Number(calendarDayInZone(date, template.timezone).slice(8, 10));
      return day === (template.recurrenceConfig?.monthDay ?? 1);
    }
  }
}

/**
 * Örnek kimliği. Aynı şablon + aynı takvim günü = aynı anahtar.
 * Veritabanındaki UNIQUE (template_id, occurrence_key) bu değeri kullanır.
 */
export function occurrenceKey(template: EventTemplateSpec, date: Date): string {
  return calendarDayInZone(date, template.timezone);
}

/** İş kuyruğu idempotency anahtarı — aynı örnek iki kez üretilmeye çalışılamaz. */
export function generationIdempotencyKey(templateId: string, key: string): string {
  return `template:${templateId}:occurrence:${key}`;
}

/**
 * Üretilecek örneklerin listesi. `existingKeys` zaten üretilmiş olanları taşır;
 * bunlar atlanır. Veritabanı yine de nihai savunmadır — iki worker aynı anda
 * çalışırsa biri 23505 alır ve bunu "zaten üretilmiş" olarak yorumlar.
 */
export function planOccurrences(
  template: EventTemplateSpec,
  from: Date,
  existingKeys: ReadonlySet<string>,
): readonly string[] {
  if (!template.active) return [];

  const planned: string[] = [];
  const seen = new Set<string>();

  for (let offset = 0; offset < template.generateAheadDays; offset += 1) {
    const day = new Date(from.getTime() + offset * 24 * 60 * 60 * 1000);
    if (!matchesRecurrence(template, day)) continue;

    const key = occurrenceKey(template, day);
    if (seen.has(key) || existingKeys.has(key)) continue;

    seen.add(key);
    planned.push(key);
  }

  return planned;
}

/** Kalıptaki {date} yer tutucusunu örnek anahtarıyla doldurur. */
export function renderPattern(pattern: string, key: string): string {
  return pattern.replaceAll('{date}', key);
}

/** Üretilecek etkinliğin slug'ı — Event.slug global olarak eşsizdir. */
export function buildEventSlug(template: EventTemplateSpec, key: string): string {
  return renderPattern(template.slugPattern, key);
}
