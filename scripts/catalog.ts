/**
 * BAŞLANGIÇ İÇERİĞİ — kategoriler, rozetler, sezon, tekrarlayan şablon,
 * açılış etkinlikleri.
 *
 * Bu dosya HEM geliştirme tohumlaması (`scripts/seed.ts`) HEM de üretim
 * kurulumu (`scripts/deploy.ts`) tarafından kullanılır. Tek kaynak olması
 * bilinçlidir: iki liste birbirinden kayarsa üretimde eksik rozet ya da eksik
 * kategori doğar ve bu sessizce fark edilir.
 *
 * BURADA SAHTE KULLANICI, SAHTE TAKİPÇİ VE SAHTE ETKİLEŞİM YOKTUR.
 * Yalnızca yöneticinin kendisinin de elle açabileceği içerik vardır.
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/server/db';
import { badges, categories, events, seasons } from '../src/server/db/schema';
import { catalogService } from '../src/server/modules/catalog/service';

export const CATEGORIES = [
  { slug: 'spor', name: 'Spor', icon: '⚽', kind: 'GENERAL' as const, sortOrder: 0 },
  { slug: 'oyun', name: 'Oyun', icon: '🎮', kind: 'GENERAL' as const, sortOrder: 1 },
  { slug: 'sinema', name: 'Sinema & TV', icon: '🎬', kind: 'GENERAL' as const, sortOrder: 2 },
  { slug: 'muzik', name: 'Müzik', icon: '🎵', kind: 'GENERAL' as const, sortOrder: 3 },
  { slug: 'dunya', name: 'Dünya', icon: '🌍', kind: 'GENERAL' as const, sortOrder: 4 },
  { slug: 'hava', name: 'Hava', icon: '🌦️', kind: 'GENERAL' as const, sortOrder: 5 },
  { slug: 'finans', name: 'Finans', icon: '💰', kind: 'FINANCIAL' as const, sortOrder: 6 },
  { slug: 'kripto', name: 'Kripto', icon: '🪙', kind: 'FINANCIAL' as const, sortOrder: 7 },
];

/**
 * Rozet kuralları VERİTABANINDA yaşar — frontend'de sabit liste yoktur.
 * Yeni rozet eklemek buraya bir satır eklemektir.
 */
export const BADGES = [
  {
    slug: 'ilk-zafer',
    name: 'İlk Zafer',
    description: 'İlk Meydan Okumanı kazandın.',
    icon: '🏆',
    rule: 'CHALLENGE_WINS' as const,
    ruleConfig: { count: 1 },
    sortOrder: 0,
  },
  {
    slug: 'meydan-ustasi',
    name: 'Meydan Ustası',
    description: '10 Meydan Okuma kazandın.',
    icon: '⚔️',
    rule: 'CHALLENGE_WINS' as const,
    ruleConfig: { count: 10 },
    sortOrder: 1,
  },
  {
    slug: 'on-dogru',
    name: '10 Doğru',
    description: '10 tahminin doğru çıktı.',
    icon: '🔥',
    rule: 'CORRECT_PREDICTIONS' as const,
    ruleConfig: { count: 10 },
    sortOrder: 2,
  },
  {
    slug: 'isabetli',
    name: 'İsabetli',
    description: 'En az 20 tahminle Tahmin Gücün 75i geçti.',
    icon: '🎯',
    rule: 'PREDICTION_POWER' as const,
    ruleConfig: { power: 75, count: 20 },
    sortOrder: 3,
  },
  {
    slug: 'tecrubeli',
    name: 'Tecrübeli',
    description: '50 tahmin tamamladın.',
    icon: '📊',
    rule: 'COMPLETED_PREDICTIONS' as const,
    ruleConfig: { count: 50 },
    sortOrder: 4,
  },
  {
    slug: 'spor-uzmani',
    name: 'Spor Uzmanı',
    description: 'Spor kategorisinde uzmanlık eşiğini geçtin.',
    icon: '⚽',
    rule: 'CATEGORY_EXPERT' as const,
    ruleConfig: { categorySlug: 'spor' },
    sortOrder: 5,
  },
];

export type StarterEvent = {
  readonly categorySlug: string;
  readonly title: string;
  readonly question: string;
  readonly slug: string;
  readonly hours: number;
  readonly outcomes: readonly { key: string; label: string }[];
};

/**
 * AÇILIŞ ETKİNLİKLERİ — her kategoride en az bir tane.
 *
 * GEREKÇE: yeni kullanıcı ilgi alanını seçtiğinde akışı boş kalmasın.
 * Boş akış, kapalı betanın en hızlı terk sebebidir.
 *
 * Bunlar gerçek, sonuçlanabilir sorulardır; sahte etkileşim taşımazlar.
 * Yönetici bunları yönetim panelinden silebilir ya da değiştirebilir.
 */
export const STARTER_EVENTS: readonly StarterEvent[] = [
  // NOT: spor kategorisinde OTOMATİK açılış etkinliği yoktur.
  // Sebep yasak değil, CEVAPLANABİLİRLİK: takım adı içermeyen bir soru
  // ("haftanın derbisi") sonradan sonuçlandırılamaz. Gerçek maçlar,
  // takım adlarıyla birlikte yönetim panelinden açılır — spor kategorisi
  // yerinde duruyor ve çalışıyor.
  {
    categorySlug: 'dunya',
    title: 'Bu yıl Nobel Barış Ödülü',
    question: 'Bu yılki Nobel Barış Ödülü bir kuruma mı verilecek?',
    slug: 'nobel-baris-odulu-kurum',
    hours: 72,
    outcomes: [
      { key: 'ORG', label: 'Bir kuruma' },
      { key: 'PERSON', label: 'Bir kişiye' },
    ],
  },
  {
    categorySlug: 'kripto',
    title: 'BTC günlük kapanış',
    question: 'BTC bugünü yükselişle mi kapatacak?',
    slug: 'btc-gunluk-kapanis',
    hours: 12,
    outcomes: [
      { key: 'UP', label: 'Yükseliş' },
      { key: 'DOWN', label: 'Düşüş' },
      { key: 'UNCHANGED', label: 'Değişmez' },
    ],
  },
  {
    categorySlug: 'hava',
    title: 'İstanbul hava durumu',
    question: 'Yarın İstanbulda yağmur yağacak mı?',
    slug: 'istanbul-hava-yarin',
    hours: 18,
    outcomes: [
      { key: 'YES', label: 'Evet' },
      { key: 'NO', label: 'Hayır' },
    ],
  },
  {
    categorySlug: 'oyun',
    title: 'Yılın oyunu ödülü',
    question: 'Bu yılın oyunu ödülünü bir Türk stüdyosu alacak mı?',
    slug: 'yilin-oyunu-odulu',
    hours: 72,
    outcomes: [
      { key: 'YES', label: 'Evet' },
      { key: 'NO', label: 'Hayır' },
    ],
  },
  {
    categorySlug: 'sinema',
    title: 'Hafta sonu gişe lideri',
    question: 'Bu hafta sonu gişe lideri yerli bir yapım mı olacak?',
    slug: 'hafta-sonu-gise-lideri',
    hours: 60,
    outcomes: [
      { key: 'LOCAL', label: 'Yerli yapım' },
      { key: 'FOREIGN', label: 'Yabancı yapım' },
    ],
  },
  {
    categorySlug: 'muzik',
    title: 'Haftanın en çok dinlenen şarkısı',
    question: 'Listenin zirvesi bu hafta değişecek mi?',
    slug: 'haftanin-zirve-sarkisi',
    hours: 60,
    outcomes: [
      { key: 'CHANGE', label: 'Zirve değişir' },
      { key: 'SAME', label: 'Zirve değişmez' },
    ],
  },
  {
    categorySlug: 'dunya',
    title: 'Uluslararası zirve sonucu',
    question: 'Zirveden ortak bir bildiri çıkacak mı?',
    slug: 'uluslararasi-zirve-bildiri',
    hours: 72,
    outcomes: [
      { key: 'YES', label: 'Ortak bildiri çıkar' },
      { key: 'NO', label: 'Ortak bildiri çıkmaz' },
    ],
  },
  {
    categorySlug: 'finans',
    title: 'BIST 100 haftalık kapanış',
    question: 'BIST 100 bu haftayı yükselişle mi kapatacak?',
    slug: 'bist100-haftalik-kapanis',
    hours: 72,
    outcomes: [
      { key: 'UP', label: 'Yükseliş' },
      { key: 'DOWN', label: 'Düşüş' },
    ],
  },
];

// ── Tohumlama adımları — hepsi İDEMPOTENT ──────────────────────────────────

export async function seedCategories(): Promise<number> {
  for (const c of CATEGORIES) {
    await db.insert(categories).values(c).onConflictDoNothing();
  }
  return CATEGORIES.length;
}

export async function seedBadges(): Promise<number> {
  for (const b of BADGES) {
    await db.insert(badges).values(b).onConflictDoNothing();
  }
  return BADGES.length;
}

export async function seedSeason(): Promise<boolean> {
  const existing = await db.select({ id: seasons.id }).from(seasons).limit(1);
  if (existing[0]) return false;

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 90 * 24 * 3600_000);

  await db.insert(seasons).values({
    name: 'MEYDAN Sezon 1',
    slug: 'sezon-1',
    startAt: start,
    endAt: end,
    status: 'ACTIVE',
  });
  return true;
}

/**
 * TEKRARLAYAN ETKİNLİK ŞABLONU — Faz 7'de DEVRE DIŞI BIRAKILDI.
 *
 * ── NEDEN KALDIRILDI ───────────────────────────────────────────────────────
 * Buradaki şablon her gün otomatik olarak şu soruyu üretiyordu:
 *
 *     "2026-09-08 tarihli günün maçını ev sahibi mi kazanacak?"
 *
 * HANGİ MAÇ? Takım adı yok. Soru CEVAPLANAMAZ: kullanıcı neye tahmin
 * ettiğini bilmiyor, yönetici de sonucu belirleyemiyor. Faz 3'te tekrarlama
 * motorunu sınamak için konmuş bir yer tutucuydu; gerçek içerik olarak
 * tasarlanmamıştı ve canlıya bu hâliyle çıktı.
 *
 * Otomatik etkinlik üretimi, arkasında GERÇEK BİR VERİ KAYNAĞI olmadan
 * anlamsız soru üretir. Fikstür verisi bağlanana kadar doğru davranış,
 * etkinlikleri yöneticinin bilerek açmasıdır.
 *
 * ── İKİNCİ SEBEP: DENETİM ─────────────────────────────────────────────────
 * Kendi kendine içerik üreten bir sistemde yönetici, sitesinde hangi
 * soruların sorulduğunu kontrol edemez. Etkinlikler bilerek açıldığında
 * hem içerik doğru olur hem de sorumluluk açıkça yöneticide kalır.
 *
 * ── GERİ ALMAK ────────────────────────────────────────────────────────────
 * Şema, tekrarlama motoru ve `event_template` tablosu YERİNDE DURUYOR.
 * Gerçek fikstür verisi bağlandığında (ve hukuki cevap geldiğinde) buraya
 * takım adlarını içeren bir şablon eklemek yeterlidir. Hiçbir yetenek
 * kaybedilmedi; yalnızca boş içerik üreten tek şablon kapatıldı.
 */
export async function seedTemplate(): Promise<boolean> {
  return false;
}

/** Verilen etkinlik zaten varsa hiçbir şey yapmaz; yoksa açar. */
export async function seedEvent(input: StarterEvent, createdById: string): Promise<boolean> {
  const existing = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.slug, input.slug));
  if (existing[0]) return false;

  const closesAt = new Date(Date.now() + input.hours * 3600_000);
  await catalogService.createEvent({
    categorySlug: input.categorySlug,
    title: input.title,
    question: input.question,
    slug: input.slug,
    closesAt,
    resolvesAt: new Date(closesAt.getTime() + 2 * 3600_000),
    outcomes: [...input.outcomes],
    createdById,
    status: 'OPEN',
  });
  return true;
}

/** Kategori + rozet + sezon + şablon. Kullanıcı ÜRETMEZ. */
export async function seedBaseContent(): Promise<void> {
  await seedCategories();
  await seedBadges();
  await seedSeason();
  await seedTemplate();
}
