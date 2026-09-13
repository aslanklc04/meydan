import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createSql, migrateTestDatabase } from './setup';
import { db } from '../../src/server/db';
import { detectiveAttempts, detectiveOptions } from '../../src/server/db/schema';
import { detectiveService } from '../../src/server/modules/detective/service';
import { createUser } from '../factories';

/**
 * KISA DEDEKTİF.
 *
 * ── KORUNAN ASIL ŞEY ───────────────────────────────────────────────────────
 * Bu oyunun tek sermayesi, cevabın CEVAP VERİLENE KADAR bilinmemesi. Çözüm
 * metni ya da doğru seçenek sunucudan erken çıkarsa oyun biter — ve bunu
 * kimse fark etmez, çünkü ekranda hâlâ düzgün görünür.
 *
 * Bu yüzden aşağıdaki testler "ekranda görünmüyor" demiyor; "veri hiç
 * gelmiyor" diyor.
 */

const sql = createSql();

beforeAll(() => {
  migrateTestDatabase();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE detective_attempt, detective_option, detective_case,
                           event_comment, prediction, event_outcome, event, category,
                           coin_ledger, coin_account, "user" CASCADE`;
});

afterAll(async () => {
  await sql.end();
});

async function vakaKur(yoneticiId: string, slug = 'deneme-vaka') {
  return detectiveService.createCase({
    slug,
    title: 'Deneme Vakası',
    scenario: 'Bir odada üç kutu var. Biri boş.',
    question: 'Hangi kutu boş?',
    explanation: 'Çözüm: ikinci kutu boştur çünkü ağırlığı diğerlerinden az.',
    difficulty: 2,
    createdById: yoneticiId,
    options: [
      { label: 'Birinci kutu', correct: false },
      { label: 'İkinci kutu', correct: true },
      { label: 'Üçüncü kutu', correct: false },
    ],
  });
}

describe('cevap vermeden çözüm görünmez', () => {
  it('çözüm metni ve doğru seçenek SUNUCUDAN HİÇ GELMEZ', async () => {
    const y = await createUser('yonetici');
    const { caseId } = await vakaKur(y.userId);
    void caseId;

    const meraklı = await createUser('merakli');
    const vaka = await detectiveService.bySlug('deneme-vaka', meraklı.userId);

    expect(vaka).toBeTruthy();
    expect(vaka!.sonuc).toBeNull();
    // Metnin tamamı sorgulanır: arayüzde gizlemek yetmez.
    const hepsi = JSON.stringify(vaka);
    expect(hepsi).not.toContain('ağırlığı diğerlerinden az');
    expect(hepsi).not.toContain('isCorrect');
  });

  it('giriş yapmamış ziyaretçiye de gelmez', async () => {
    const y = await createUser('yonetici');
    await vakaKur(y.userId);
    const vaka = await detectiveService.bySlug('deneme-vaka', null);
    expect(vaka!.sonuc).toBeNull();
    expect(JSON.stringify(vaka)).not.toContain('ağırlığı');
  });

  it('cevap VERİLİNCE çözüm gelir', async () => {
    const y = await createUser('yonetici');
    const { caseId } = await vakaKur(y.userId);
    const u = await createUser('emir');
    const secenekler = await db
      .select()
      .from(detectiveOptions)
      .where(eq(detectiveOptions.caseId, caseId));
    const yanlis = secenekler.find((o) => !o.isCorrect)!;

    await detectiveService.answer({ caseId, userId: u.userId, optionId: yanlis.id });

    const vaka = await detectiveService.bySlug('deneme-vaka', u.userId);
    expect(vaka!.sonuc).not.toBeNull();
    expect(vaka!.sonuc!.dogruMu).toBe(false);
    // Yanılana da çözüm gösterilir — oyunun asıl değeri burada.
    expect(vaka!.sonuc!.explanation).toContain('ağırlığı');
  });
});

describe('bir vakaya bir cevap', () => {
  it('ikinci cevap REDDEDİLİR', async () => {
    /*
     * İkinci deneme, ilk cevabın sonucunu öğrendikten sonra yapılırdı ve
     * karneyi anlamsız kılardı.
     */
    const y = await createUser('yonetici');
    const { caseId } = await vakaKur(y.userId);
    const u = await createUser('emir');
    const secenekler = await db
      .select()
      .from(detectiveOptions)
      .where(eq(detectiveOptions.caseId, caseId));

    await detectiveService.answer({ caseId, userId: u.userId, optionId: secenekler[0]!.id });
    await expect(
      detectiveService.answer({ caseId, userId: u.userId, optionId: secenekler[1]!.id }),
    ).rejects.toThrow(/zaten cevap/i);
  });

  it('verilen cevap VERİTABANI seviyesinde donuyor', async () => {
    const y = await createUser('yonetici');
    const { caseId } = await vakaKur(y.userId);
    const u = await createUser('emir');
    const secenekler = await db
      .select()
      .from(detectiveOptions)
      .where(eq(detectiveOptions.caseId, caseId));
    await detectiveService.answer({ caseId, userId: u.userId, optionId: secenekler[0]!.id });

    const satir = (await db.select().from(detectiveAttempts))[0]!;
    let mesaj = '';
    try {
      await db
        .update(detectiveAttempts)
        .set({ optionId: secenekler[1]!.id })
        .where(eq(detectiveAttempts.id, satir.id));
    } catch (error) {
      const e = error as { message?: string; cause?: { message?: string } };
      mesaj = `${e.cause?.message ?? ''} ${e.message ?? ''}`;
    }
    expect(mesaj).toContain('detective_answer_immutable');
  });

  it('sonuç da donuyor — yanlış cevap sonradan doğruya çevrilemez', async () => {
    const y = await createUser('yonetici');
    const { caseId } = await vakaKur(y.userId);
    const u = await createUser('emir');
    const secenekler = await db
      .select()
      .from(detectiveOptions)
      .where(eq(detectiveOptions.caseId, caseId));
    const yanlis = secenekler.find((o) => !o.isCorrect)!;
    await detectiveService.answer({ caseId, userId: u.userId, optionId: yanlis.id });

    const satir = (await db.select().from(detectiveAttempts))[0]!;
    let mesaj = '';
    try {
      await db
        .update(detectiveAttempts)
        .set({ correct: true })
        .where(eq(detectiveAttempts.id, satir.id));
    } catch (error) {
      const e = error as { message?: string; cause?: { message?: string } };
      mesaj = `${e.cause?.message ?? ''} ${e.message ?? ''}`;
    }
    expect(mesaj).toContain('detective_result_immutable');
  });
});

describe('vaka kurma kuralları', () => {
  it('doğru seçenek TAM OLARAK BİR tane olmalı', async () => {
    const y = await createUser('yonetici');
    await expect(
      detectiveService.createCase({
        slug: 'iki-dogru',
        title: 'İki doğru',
        scenario: 'metin',
        question: 'soru',
        explanation: 'çözüm',
        difficulty: 1,
        createdById: y.userId,
        options: [
          { label: 'a', correct: true },
          { label: 'b', correct: true },
        ],
      }),
    ).rejects.toThrow(/bir seçenek doğru/i);
  });

  it('doğru seçeneksiz vaka kurulamaz', async () => {
    const y = await createUser('yonetici');
    await expect(
      detectiveService.createCase({
        slug: 'dogrusuz',
        title: 'Doğrusuz',
        scenario: 'metin',
        question: 'soru',
        explanation: 'çözüm',
        difficulty: 1,
        createdById: y.userId,
        options: [
          { label: 'a', correct: false },
          { label: 'b', correct: false },
        ],
      }),
    ).rejects.toThrow(/bir seçenek doğru/i);
  });

  it('tek seçenekli vaka kurulamaz', async () => {
    const y = await createUser('yonetici');
    await expect(
      detectiveService.createCase({
        slug: 'tek',
        title: 'Tek',
        scenario: 'metin',
        question: 'soru',
        explanation: 'çözüm',
        difficulty: 1,
        createdById: y.userId,
        options: [{ label: 'a', correct: true }],
      }),
    ).rejects.toThrow(/en az iki/i);
  });
});

describe('sayaçlar ve karne', () => {
  it('deneme ve doğru sayıları birlikte artar', async () => {
    const y = await createUser('yonetici');
    const { caseId } = await vakaKur(y.userId);
    const secenekler = await db
      .select()
      .from(detectiveOptions)
      .where(eq(detectiveOptions.caseId, caseId));
    const dogru = secenekler.find((o) => o.isCorrect)!;
    const yanlis = secenekler.find((o) => !o.isCorrect)!;

    const a = await createUser('emir');
    const b = await createUser('zeynep');
    await detectiveService.answer({ caseId, userId: a.userId, optionId: dogru.id });
    await detectiveService.answer({ caseId, userId: b.userId, optionId: yanlis.id });

    const vaka = await detectiveService.bySlug('deneme-vaka', null);
    expect(vaka!.attemptCount).toBe(2);
    expect(vaka!.correctCount).toBe(1);
  });

  it('dedektif karnesi ayrı tutuluyor', async () => {
    const y = await createUser('yonetici');
    const { caseId } = await vakaKur(y.userId, 'v1');
    const ikinci = await vakaKur(y.userId, 'v2');
    const u = await createUser('emir');

    const s1 = await db.select().from(detectiveOptions).where(eq(detectiveOptions.caseId, caseId));
    const s2 = await db
      .select()
      .from(detectiveOptions)
      .where(eq(detectiveOptions.caseId, ikinci.caseId));

    await detectiveService.answer({
      caseId,
      userId: u.userId,
      optionId: s1.find((o) => o.isCorrect)!.id,
    });
    await detectiveService.answer({
      caseId: ikinci.caseId,
      userId: u.userId,
      optionId: s2.find((o) => !o.isCorrect)!.id,
    });

    const karne = await detectiveService.karne(u.userId);
    expect(karne.cozulen).toBe(2);
    expect(karne.dogru).toBe(1);
  });

  it('dedektif cevabı TAHMİN GÜCÜNÜ değiştirmez', async () => {
    /*
     * İkisi farklı yetenek: "geleceği ne kadar iyi biliyor" ile "geçmişi ne
     * kadar iyi çözüyor". Aynı sayıya karışsalardı Tahmin Gücü ölçtüğü şeyi
     * ölçmez olurdu.
     */
    const { reputationService } = await import('../../src/server/modules/reputation/service');
    const y = await createUser('yonetici');
    const { caseId } = await vakaKur(y.userId);
    const u = await createUser('emir');
    const secenekler = await db
      .select()
      .from(detectiveOptions)
      .where(eq(detectiveOptions.caseId, caseId));

    const once = (await reputationService.getSummary(u.userId)).power;
    await detectiveService.answer({
      caseId,
      userId: u.userId,
      optionId: secenekler.find((o) => o.isCorrect)!.id,
    });
    expect((await reputationService.getSummary(u.userId)).power).toBe(once);
  });
});
