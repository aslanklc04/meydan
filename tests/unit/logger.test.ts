import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log, newCorrelationId, timed } from '../../src/server/observability/logger';

/**
 * YAPILANDIRILMIŞ GÜNLÜK — Faz 6.
 *
 * İki ayrı arıza türü sınanır ve İKİSİ DE ciddidir:
 *   1. Hassas verinin günlüğe düşmesi — güvenlik olayı.
 *   2. Gereksiz gizleme — operatör üretimdeki sorunu göremez. Faz 6'da
 *      `skippedEvents` alanı "ip" alt dizesi yüzünden gizleniyordu.
 */

let lines: string[] = [];
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  lines = [];
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

const parsed = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);

describe('biçim', () => {
  it('her satır tek satırlık JSON, zaman damgası ve seviye taşır', () => {
    log.info('test.olay', { operation: 'test' });

    const [row] = parsed();
    expect(row).toMatchObject({ level: 'info', event: 'test.olay', operation: 'test' });
    expect(typeof row!.ts).toBe('string');
    expect(lines[0]).not.toContain('\n');
  });

  it('hata nesnesi mesaja indirgenir — yığın izi günlüğe basılmaz', () => {
    log.error('test.hata', { error: new Error('bir şeyler ters gitti') });
    expect(parsed()[0]!.error).toBe('bir şeyler ters gitti');
  });
});

describe('gizleme', () => {
  // Değerler bilinçli olarak "[gizlendi]" işaretiyle ÇAKIŞMAYACAK şekilde
  // seçildi: "gizli" gibi bir değer, işaretin kendi içinde geçtiği için
  // testi sahte biçimde düşürürdü.
  const secrets = {
    password: 'S1FRE-AAA',
    parola: 'S1FRE-BBB',
    token: 'abc',
    accessToken: 'abc',
    sessionId: 'sid',
    session_id: 'sid',
    cookie: 'c=1',
    authorization: 'Bearer x',
    ipHash: 'deadbeef',
    ip: '1.2.3.4',
    email: 'a@b.com',
    userEmail: 'a@b.com',
    phone: '5xx',
  };

  it('hassas alanların DEĞERİ günlüğe yazılmaz', () => {
    log.info('test.gizli', secrets);
    const row = parsed()[0]!;

    for (const key of Object.keys(secrets)) {
      expect(row[key], `${key} gizlenmeliydi`).toBe('[gizlendi]');
    }
    // Ham değerlerin hiçbiri satırda geçmemeli.
    for (const value of Object.values(secrets)) {
      expect(lines[0]).not.toContain(value);
    }
  });

  it('MASUM alanlar gizlenmez — fazla gizleme de bir arızadır', () => {
    log.info('test.masum', {
      skippedEvents: 3,
      expiredChallenges: 1,
      participantCount: 20,
      description: 'açıklama',
      recipientCount: 4,
      correlationId: 'abc123',
      userId: 'u_1',
      eventId: 'e_1',
      challengeId: 'c_1',
      durationMs: 42,
    });

    const row = parsed()[0]!;
    expect(row.skippedEvents).toBe(3);
    expect(row.expiredChallenges).toBe(1);
    expect(row.participantCount).toBe(20);
    expect(row.description).toBe('açıklama');
    expect(row.recipientCount).toBe(4);
    expect(row.correlationId).toBe('abc123');
    // Kimlikler teknik takip içindir ve hassas veri DEĞİLDİR.
    expect(row.userId).toBe('u_1');
    expect(row.eventId).toBe('e_1');
    expect(row.challengeId).toBe('c_1');
    expect(row.durationMs).toBe(42);
  });

  it('alan adı yazımından bağımsız gizler (camelCase, snake_case)', () => {
    log.info('test.bicim', { ip_hash: 'x', IPHash: 'y', user_password: 'z' });
    const row = parsed()[0]!;
    expect(row.ip_hash).toBe('[gizlendi]');
    expect(row.IPHash).toBe('[gizlendi]');
    expect(row.user_password).toBe('[gizlendi]');
  });
});

describe('correlation id', () => {
  it('her çağrıda farklıdır', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newCorrelationId()));
    expect(ids.size).toBe(200);
  });
});

describe('timed()', () => {
  it('başarıda süre ve sonuç yazar, değeri döndürür', async () => {
    const value = await timed('test.islem', { userId: 'u_1' }, async () => 42);

    expect(value).toBe(42);
    const row = parsed()[0]!;
    expect(row).toMatchObject({ event: 'test.islem', operation: 'test.islem', outcome: 'success' });
    expect(typeof row.durationMs).toBe('number');
  });

  it('hatada kaydeder ve hatayı YUTMAZ', async () => {
    await expect(
      timed('test.islem', {}, async () => {
        throw new Error('patladı');
      }),
    ).rejects.toThrow('patladı');

    const row = parsed()[0]!;
    expect(row.outcome).toBe('failure');
    expect(row.error).toBe('patladı');
  });
});
