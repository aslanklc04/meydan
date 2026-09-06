import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSql } from './setup';

/**
 * ADR-15 ve ADR-16'nın ŞEMA ETKİSİNİN doğrulanması.
 *
 * Bu tablolar Faz 3/4'te kalıcı şemaya girecek. Kararı bugün doğrulamak için
 * DDL'i izole bir şemada (`adr_probe`) çalıştırıp constraint davranışını gerçek
 * PostgreSQL üzerinde sınıyoruz. Faz 3'e geçildiğinde aynı DDL migration'a taşınır
 * ve bu test o tablolara yönlendirilir.
 */

const sql = createSql();

const DDL = `
DROP SCHEMA IF EXISTS adr_probe CASCADE;
CREATE SCHEMA adr_probe;
SET search_path TO adr_probe;

CREATE TYPE challenge_mode   AS ENUM ('DIRECT','OPEN');
CREATE TYPE challenge_status AS ENUM ('PENDING','ACCEPTED','ACTIVE','DECLINED','EXPIRED','CANCELLED','COMPLETED');

CREATE TABLE challenge (
  id                 text PRIMARY KEY,
  event_id           text NOT NULL,
  mode               challenge_mode   NOT NULL DEFAULT 'DIRECT',
  status             challenge_status NOT NULL DEFAULT 'PENDING',
  creator_id         text NOT NULL,
  opponent_id        text,
  creator_outcome_id text NOT NULL,
  stake_amount       integer NOT NULL,
  claimed_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Kendine meydan okuma yasağı — opponent_id null olabildiği için NULL-güvenli
ALTER TABLE challenge ADD CONSTRAINT challenge_not_self
  CHECK (opponent_id IS NULL OR creator_id <> opponent_id);

-- DIRECT'te rakip zorunlu; OPEN'da PENDING iken rakip boş olmalı
ALTER TABLE challenge ADD CONSTRAINT challenge_mode_opponent
  CHECK (
    (mode = 'DIRECT' AND opponent_id IS NOT NULL)
    OR (mode = 'OPEN' AND ((status = 'PENDING') = (opponent_id IS NULL)))
  );

ALTER TABLE challenge ADD CONSTRAINT challenge_stake_positive
  CHECK (stake_amount > 0);

CREATE UNIQUE INDEX challenge_no_duplicate_direct
  ON challenge (event_id, creator_id, opponent_id)
  WHERE mode = 'DIRECT' AND status IN ('PENDING','ACCEPTED','ACTIVE');

CREATE UNIQUE INDEX challenge_one_open_per_creator_event
  ON challenge (event_id, creator_id)
  WHERE mode = 'OPEN' AND status = 'PENDING';

-- ADR-16: tekrarlayan etkinlik duplicate engeli
CREATE TABLE event (
  id             text PRIMARY KEY,
  slug           text NOT NULL UNIQUE,
  template_id    text,
  occurrence_key text
);

CREATE UNIQUE INDEX event_template_occurrence_unique
  ON event (template_id, occurrence_key)
  WHERE template_id IS NOT NULL;
`;

beforeAll(async () => {
  await sql.unsafe(DDL);
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE adr_probe.challenge, adr_probe.event`;
});

afterAll(async () => {
  await sql.unsafe('DROP SCHEMA IF EXISTS adr_probe CASCADE');
  await sql.end();
});

const insertChallenge = (over: Record<string, unknown> = {}) => {
  const row = {
    id: `c_${Math.random().toString(36).slice(2, 10)}`,
    event_id: 'evt1',
    mode: 'OPEN',
    status: 'PENDING',
    creator_id: 'emir',
    opponent_id: null,
    creator_outcome_id: 'gs',
    stake_amount: 10,
    ...over,
  };
  return sql`INSERT INTO adr_probe.challenge ${sql(row)} RETURNING id`;
};

describe('ADR-15 · Açık Meydan Okuma şema etkisi', () => {
  it('OPEN modda rakipsiz meydan okuma yazılabilir', async () => {
    await expect(insertChallenge()).resolves.toHaveLength(1);
  });

  it('OPEN + PENDING iken rakip DOLU olamaz', async () => {
    await expect(insertChallenge({ opponent_id: 'mert' })).rejects.toThrow(
      /challenge_mode_opponent/,
    );
  });

  it('OPEN kabul edildiğinde rakip DOLMAK ZORUNDA', async () => {
    await expect(insertChallenge({ status: 'ACCEPTED', opponent_id: null })).rejects.toThrow(
      /challenge_mode_opponent/,
    );
    await expect(
      insertChallenge({ status: 'ACCEPTED', opponent_id: 'mert', claimed_at: new Date() }),
    ).resolves.toHaveLength(1);
  });

  it('DIRECT modda rakip zorunludur', async () => {
    await expect(insertChallenge({ mode: 'DIRECT', opponent_id: null })).rejects.toThrow(
      /challenge_mode_opponent/,
    );
  });

  it('kullanıcı kendine meydan okuyamaz — DIRECT', async () => {
    await expect(insertChallenge({ mode: 'DIRECT', opponent_id: 'emir' })).rejects.toThrow(
      /challenge_not_self/,
    );
  });

  it('kullanıcı kendi açık meydan okumasını kapamaz', async () => {
    await expect(insertChallenge({ status: 'ACCEPTED', opponent_id: 'emir' })).rejects.toThrow(
      /challenge_not_self/,
    );
  });

  it('aynı etkinlikte ikinci BEKLEYEN açık meydan okuma açılamaz', async () => {
    await insertChallenge();
    await expect(insertChallenge()).rejects.toThrow(/challenge_one_open_per_creator_event/);
  });

  it('kapılmış açık meydan okuma yeni bir tane açmayı engellemez', async () => {
    await insertChallenge({ status: 'ACCEPTED', opponent_id: 'mert' });
    await expect(insertChallenge()).resolves.toHaveLength(1);
  });

  it('aynı çift arasında tekrarlanan DIRECT meydan okuma engellenir', async () => {
    await insertChallenge({ mode: 'DIRECT', opponent_id: 'mert' });
    await expect(insertChallenge({ mode: 'DIRECT', opponent_id: 'mert' })).rejects.toThrow(
      /challenge_no_duplicate_direct/,
    );
  });

  it('DIRECT tekillik kuralı OPEN meydan okumaları etkilemez', async () => {
    await insertChallenge({ mode: 'DIRECT', opponent_id: 'mert' });
    await expect(insertChallenge()).resolves.toHaveLength(1);
  });

  it('sıfır veya negatif çip reddedilir', async () => {
    await expect(insertChallenge({ stake_amount: 0 })).rejects.toThrow(/challenge_stake_positive/);
  });

  /**
   * YARIŞ TESTİ — ADR-15'in kalbi.
   * İki kullanıcı aynı açık meydan okumayı aynı anda kabul etmeye çalışır.
   * Yalnızca biri kazanmalıdır.
   */
  it('eşzamanlı iki kabul denemesinden yalnızca BİRİ başarılı olur', async () => {
    const rows = await insertChallenge();
    const id = rows[0]?.id as string;

    const claim = async (opponentId: string): Promise<boolean> => {
      const connection = createSql();
      try {
        const result = await connection.begin(async (tx) => {
          // Satır kilidi: ikinci istek birinciyi bekler
          const locked = await tx`
            SELECT id, status FROM adr_probe.challenge WHERE id = ${id} FOR UPDATE`;
          if (locked[0]?.status !== 'PENDING') return false;

          // Koşullu UPDATE: etkilenen satır 0 ise yarış kaybedilmiştir
          const updated = await tx`
            UPDATE adr_probe.challenge
               SET status = 'ACCEPTED', opponent_id = ${opponentId}, claimed_at = now()
             WHERE id = ${id} AND status = 'PENDING'
            RETURNING id`;
          return updated.length === 1;
        });
        return result;
      } finally {
        await connection.end();
      }
    };

    const [a, b] = await Promise.all([claim('mert'), claim('can')]);

    expect([a, b].filter(Boolean)).toHaveLength(1);

    const final = await sql`SELECT status, opponent_id FROM adr_probe.challenge WHERE id = ${id}`;
    expect(final[0]?.status).toBe('ACCEPTED');
    expect(['mert', 'can']).toContain(final[0]?.opponent_id);
  });
});

describe('ADR-16 · Tekrarlayan etkinlik duplicate engeli', () => {
  const insertEvent = (over: Record<string, unknown> = {}) =>
    sql`INSERT INTO adr_probe.event ${sql({
      id: `e_${Math.random().toString(36).slice(2, 10)}`,
      slug: `btc-yukselis-${Math.random().toString(36).slice(2, 8)}`,
      template_id: 'tpl-btc',
      occurrence_key: '2026-09-03',
      ...over,
    })} RETURNING id`;

  it('şablondan etkinlik üretilebilir', async () => {
    await expect(insertEvent()).resolves.toHaveLength(1);
  });

  it('aynı şablon + aynı takvim günü İKİNCİ KEZ üretilemez', async () => {
    await insertEvent();
    await expect(insertEvent()).rejects.toThrow(/event_template_occurrence_unique/);
  });

  it('aynı şablon farklı günler için üretilebilir', async () => {
    await insertEvent({ occurrence_key: '2026-09-03' });
    await expect(insertEvent({ occurrence_key: '2026-09-04' })).resolves.toHaveLength(1);
  });

  it('farklı şablonlar aynı gün için üretilebilir', async () => {
    await insertEvent({ template_id: 'tpl-btc' });
    await expect(insertEvent({ template_id: 'tpl-garan' })).resolves.toHaveLength(1);
  });

  it('elle oluşturulan etkinlikler (template_id null) kısıttan etkilenmez', async () => {
    await insertEvent({ template_id: null, occurrence_key: null });
    await expect(insertEvent({ template_id: null, occurrence_key: null })).resolves.toHaveLength(1);
  });

  it('eşzamanlı iki üretim denemesinden yalnızca biri yazar', async () => {
    const attempt = async (): Promise<boolean> => {
      const connection = createSql();
      try {
        await connection`INSERT INTO adr_probe.event ${connection({
          id: `e_${Math.random().toString(36).slice(2, 10)}`,
          slug: `btc-${Math.random().toString(36).slice(2, 10)}`,
          template_id: 'tpl-race',
          occurrence_key: '2026-09-10',
        })}`;
        return true;
      } catch {
        // 23505 bir arıza değildir: "zaten üretilmiş" demektir
        return false;
      } finally {
        await connection.end();
      }
    };

    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
