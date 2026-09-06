import { describe, expect, it } from 'vitest';
import {
  buildEventSlug,
  calendarDayInZone,
  generationIdempotencyKey,
  matchesRecurrence,
  occurrenceKey,
  planOccurrences,
  renderPattern,
  weekdayInZone,
  type EventTemplateSpec,
} from '../../src/server/modules/catalog/domain/event-template';

/** ADR-16 — tekrarlayan etkinlik üretimi ve duplicate engeli. */

const btcDaily: EventTemplateSpec = {
  id: 'tpl-btc',
  slug: 'btc-gunluk-kapanis',
  recurrence: 'DAILY',
  timezone: 'UTC',
  titlePattern: 'BTC {date} tarihinde yükselişle mi kapatacak?',
  slugPattern: 'btc-yukselis-{date}',
  generateAheadDays: 3,
  active: true,
};

const garanWeekdays: EventTemplateSpec = {
  ...btcDaily,
  id: 'tpl-garan',
  slug: 'garan-gunluk-kapanis',
  recurrence: 'WEEKDAYS',
  timezone: 'Europe/Istanbul',
  titlePattern: 'GARAN {date} tarihinde pozitif mi kapanacak?',
  slugPattern: 'garan-pozitif-{date}',
};

describe('takvim günü — şablonun kendi saat diliminde', () => {
  it('UTC şablonunda UTC günü kullanılır', () => {
    expect(calendarDayInZone(new Date('2026-09-03T23:30:00Z'), 'UTC')).toBe('2026-09-03');
  });

  it('Istanbul şablonunda gün UTC+3 ile kayar', () => {
    // 03 Eylül 22:30 UTC = 04 Eylül 01:30 Istanbul
    expect(calendarDayInZone(new Date('2026-09-03T22:30:00Z'), 'Europe/Istanbul')).toBe(
      '2026-09-04',
    );
  });

  it('aynı an iki farklı şablonda farklı güne düşebilir — bu yüzden anahtar timezone taşır', () => {
    const instant = new Date('2026-09-03T22:30:00Z');
    expect(occurrenceKey(btcDaily, instant)).toBe('2026-09-03');
    expect(occurrenceKey(garanWeekdays, instant)).toBe('2026-09-04');
  });

  it('haftanın gününü şablonun diliminde hesaplar', () => {
    // 2026-09-03 Perşembe
    expect(weekdayInZone(new Date('2026-09-03T12:00:00Z'), 'UTC')).toBe(4);
  });
});

describe('tekrar kuralı', () => {
  it('DAILY her gün eşleşir', () => {
    expect(matchesRecurrence(btcDaily, new Date('2026-09-05T12:00:00Z'))).toBe(true); // Cumartesi
    expect(matchesRecurrence(btcDaily, new Date('2026-09-06T12:00:00Z'))).toBe(true); // Pazar
  });

  it('WEEKDAYS hafta sonunu atlar', () => {
    expect(matchesRecurrence(garanWeekdays, new Date('2026-09-04T09:00:00Z'))).toBe(true); // Cuma
    expect(matchesRecurrence(garanWeekdays, new Date('2026-09-05T09:00:00Z'))).toBe(false); // Cmt
    expect(matchesRecurrence(garanWeekdays, new Date('2026-09-06T09:00:00Z'))).toBe(false); // Paz
  });

  it('WEEKLY yalnızca belirtilen günde eşleşir', () => {
    const weekly: EventTemplateSpec = {
      ...btcDaily,
      recurrence: 'WEEKLY',
      recurrenceConfig: { weekday: 1 }, // Pazartesi
    };
    expect(matchesRecurrence(weekly, new Date('2026-09-07T12:00:00Z'))).toBe(true);
    expect(matchesRecurrence(weekly, new Date('2026-09-08T12:00:00Z'))).toBe(false);
  });

  it('MONTHLY yalnızca ayın belirtilen gününde eşleşir', () => {
    const monthly: EventTemplateSpec = {
      ...btcDaily,
      recurrence: 'MONTHLY',
      recurrenceConfig: { monthDay: 15 },
    };
    expect(matchesRecurrence(monthly, new Date('2026-09-15T12:00:00Z'))).toBe(true);
    expect(matchesRecurrence(monthly, new Date('2026-09-16T12:00:00Z'))).toBe(false);
  });
});

describe('duplicate engeli — iş idempotency katmanı', () => {
  const from = new Date('2026-09-03T00:00:00Z');

  it('pencere içindeki tüm günleri planlar', () => {
    expect(planOccurrences(btcDaily, from, new Set())).toEqual([
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });

  it('zaten üretilmiş örnekleri atlar', () => {
    const existing = new Set(['2026-09-03', '2026-09-04']);
    expect(planOccurrences(btcDaily, from, existing)).toEqual(['2026-09-05']);
  });

  it('iş iki kez çalışsa da ikinci seferde hiçbir şey planlamaz', () => {
    const first = planOccurrences(btcDaily, from, new Set());
    const second = planOccurrences(btcDaily, from, new Set(first));
    expect(second).toEqual([]);
  });

  it('aynı anahtarı tek çalıştırmada iki kez planlamaz', () => {
    const planned = planOccurrences({ ...btcDaily, generateAheadDays: 10 }, from, new Set());
    expect(new Set(planned).size).toBe(planned.length);
  });

  it('WEEKDAYS şablonu hafta sonunu üretmez', () => {
    const friday = new Date('2026-09-04T06:00:00Z');
    const planned = planOccurrences({ ...garanWeekdays, generateAheadDays: 4 }, friday, new Set());
    expect(planned).toEqual(['2026-09-04', '2026-09-07']);
  });

  it('pasif şablon hiçbir şey üretmez', () => {
    expect(planOccurrences({ ...btcDaily, active: false }, from, new Set())).toEqual([]);
  });

  it('idempotency anahtarı şablon ve örneğe göre tekildir', () => {
    expect(generationIdempotencyKey('tpl-btc', '2026-09-03')).toBe(
      'template:tpl-btc:occurrence:2026-09-03',
    );
    expect(generationIdempotencyKey('tpl-btc', '2026-09-03')).not.toBe(
      generationIdempotencyKey('tpl-btc', '2026-09-04'),
    );
  });
});

describe('kalıp doldurma', () => {
  it('başlıktaki yer tutucuyu doldurur', () => {
    expect(renderPattern(btcDaily.titlePattern, '2026-09-03')).toBe(
      'BTC 2026-09-03 tarihinde yükselişle mi kapatacak?',
    );
  });

  it('slug üretir', () => {
    expect(buildEventSlug(btcDaily, '2026-09-03')).toBe('btc-yukselis-2026-09-03');
  });

  it('farklı örnekler farklı slug üretir — Event.slug global eşsizdir', () => {
    expect(buildEventSlug(btcDaily, '2026-09-03')).not.toBe(buildEventSlug(btcDaily, '2026-09-04'));
  });
});
