/**
 * ÜRETİM KURULUMU — dağıtımdan önce BİR KEZ, her dağıtımda güvenle.
 *
 * Çalıştırma:  npm run deploy:setup
 * Vercel:      build komutunun ilk adımı (bkz. docs/deployment.md §3)
 *
 * Yaptığı dört iş de İDEMPOTENTTİR — yüz kez çalıştırılabilir, ikinci
 * çalıştırma hiçbir yan etki üretmez:
 *
 *   1. MIGRATION      şema eksikse tamamlar; uygulanmış olanı atlar
 *   2. BAŞLANGIÇ      kategori, rozet, sezon, tekrarlayan şablon
 *   3. YÖNETİCİ       ADMIN_EMAIL sahibi hesabı ADMIN'e yükseltir
 *   4. AÇILIŞ İÇERİĞİ yönetici varsa kategori başına bir etkinlik açar
 *
 * ── NEDEN MIGRATION İSTEK BAŞINA DEĞİL BURADA ──────────────────────────────
 * Migration'ı uygulama isteği içinde çalıştırmak üç şeyi bozar: (a) her soğuk
 * başlangıç şema kilidi almaya çalışır, (b) eşzamanlı iki örnek aynı anda
 * migrate etmeye kalkar, (c) migration hatası kullanıcıya 500 olarak sızar.
 * Burada çalıştırıldığında BAŞARISIZ MIGRATION = BAŞARISIZ DAĞITIM olur:
 * bozuk şema ile yeni kod asla aynı anda canlıya çıkmaz.
 *
 * ── NEDEN ADVISORY LOCK ────────────────────────────────────────────────────
 * Aynı anda iki dağıtım tetiklenirse (art arda iki "push") iki build aynı
 * veritabanına migrate etmeye kalkar. Kilit, ikincisini birincinin bitmesini
 * beklemeye zorlar; sonra ikinci build uygulanacak migration bulamaz ve
 * sorunsuz geçer.
 *
 * ── ÖNİZLEME DAĞITIMLARI ───────────────────────────────────────────────────
 * Vercel'de "preview" ortamı üretim veritabanını PAYLAŞABİLİR. Bir önizleme
 * build'inin üretim şemasını değiştirmesi istenmez; bu yüzden yalnızca
 * VERCEL_ENV=production (ya da Vercel dışı ortam) çalıştırılır.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { db } from '../src/server/db';
import { normalizeDatabaseUrl } from '../src/server/db/url';
import { users } from '../src/server/db/schema';
import { STARTER_EVENTS, seedBaseContent, seedEvent } from './catalog';

/** Migration ve kurulum için tek, kısa ömürlü bağlantı. */
const LOCK_KEY = 918_273_645;

function say(step: string, detail = ''): void {
  console.warn(`[kurulum] ${step}${detail ? ` — ${detail}` : ''}`);
}

async function runMigrations(rawUrl: string): Promise<void> {
  const { url: databaseUrl, dropped } = normalizeDatabaseUrl(rawUrl);
  if (dropped.length > 0) {
    say('bağlantı', `desteklenmeyen parametreler yok sayıldı: ${dropped.join(', ')}`);
  }
  // max:1 — migration tek bağlantıda, sırayla çalışır.
  const client = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 30,
    // "schema already exists, skipping" gibi NOTICE'ler dağıtım günlüğünü
    // gürültüye boğar ve gerçek hatayı gizler. Sessize alınır.
    onnotice: () => undefined,
  });
  try {
    await client`SELECT pg_advisory_lock(${LOCK_KEY})`;
    say('migration başlıyor');
    await migrate(drizzle(client), {
      migrationsFolder: './drizzle',
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });
    const applied = await client<{ n: number }[]>`
      SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
    say('migration tamam', `${applied[0]?.n ?? 0} migration uygulanmış durumda`);
  } finally {
    // Bağlantı kapanınca advisory lock zaten düşer; yine de açıkça bırakılır.
    await client`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => undefined);
    await client.end({ timeout: 5 });
  }
}

/**
 * YÖNETİCİ KURULUMU — güvenli yol.
 *
 * Rol İSTEMCİDEN GELEN BİR DEĞERLE atanmaz; kayıt formunda "role" diye bir
 * alan yoktur ve olmayacaktır. Yükseltmenin tek yolu budur: dağıtım
 * ortamındaki ADMIN_EMAIL değişkeninde yazan adres, o adresle GERÇEKTEN
 * kayıt olmuş bir hesaba denk geliyorsa yükseltilir.
 *
 * Bu üç şeyi birden sağlar:
 *   • parola kaynak kodda ya da ortam değişkeninde yazmaz — kurucu parolasını
 *     kendi belirler, kimse (bu betik dâhil) bilmez;
 *   • yükseltme için SQL yazmak gerekmez;
 *   • ADMIN_EMAIL'i yalnızca dağıtım panelinde yazabilen kişi değiştirebilir.
 *
 * Hesap henüz yoksa sessizce atlanır: kurucu siteye kaydolduktan sonraki ilk
 * dağıtımda yükseltme kendiliğinden gerçekleşir.
 */
async function bootstrapAdmin(): Promise<string | null> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    say('yönetici', 'ADMIN_EMAIL tanımlı değil, atlandı');
    return null;
  }

  // E-posta karşılaştırması büyük/küçük harften bağımsızdır: kurucu adresini
  // panele "Ad@Site.com" diye yazarsa da eşleşmelidir.
  const found = await db
    .select({ id: users.id, role: users.role, username: users.username })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  const user = found[0];
  if (!user) {
    // Adres GÜNLÜĞE YAZILMAZ; yalnızca sonucun kendisi.
    say('yönetici', 'ADMIN_EMAIL ile eşleşen kayıt yok — kayıt olduktan sonra tekrar dağıtın');
    return null;
  }

  if (user.role === 'ADMIN') {
    say('yönetici', `@${user.username} zaten yönetici`);
    return user.id;
  }

  await db
    .update(users)
    .set({ role: 'ADMIN', emailVerified: new Date() })
    .where(eq(users.id, user.id));
  say('yönetici', `@${user.username} yönetici yapıldı`);
  return user.id;
}

/** Açılış etkinlikleri için bir yönetici gerekir (etkinliğin sahibi olur). */
async function anyAdminId(): Promise<string | null> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'ADMIN'))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function main(): Promise<void> {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== 'production') {
    say('atlandı', `VERCEL_ENV=${vercelEnv} — üretim veritabanına dokunulmaz`);
    process.exit(0);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[kurulum] DATABASE_URL tanımlı değil. Kurulum yapılamaz.');
    process.exit(1);
  }

  await runMigrations(databaseUrl);

  await seedBaseContent();
  say('başlangıç içeriği', 'kategoriler, rozetler, sezon ve şablon hazır');

  const adminId = (await bootstrapAdmin()) ?? (await anyAdminId());

  if (adminId) {
    let opened = 0;
    for (const event of STARTER_EVENTS) {
      if (await seedEvent(event, adminId)) opened += 1;
    }
    say('açılış etkinlikleri', opened === 0 ? 'zaten mevcut' : `${opened} etkinlik açıldı`);
  } else {
    say('açılış etkinlikleri', 'yönetici yok, atlandı');
  }

  const open = (await db.execute(
    sql`SELECT count(*)::int AS count FROM event WHERE status = 'OPEN'`,
  )) as unknown as { count: number }[];
  const balance = (await db.execute(
    sql`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM coin_ledger`,
  )) as unknown as { total: string }[];

  say(
    'durum',
    `${open[0]?.count ?? 0} açık etkinlik, çip defteri toplamı ${balance[0]?.total ?? 0}`,
  );

  if (Number(balance[0]?.total ?? 0) !== 0) {
    console.error('[kurulum] ÇİP DEFTERİ DENGESİZ — dağıtımı durdurun (operations.md §7).');
    process.exit(1);
  }

  say('tamamlandı');
  process.exit(0);
}

main().catch((error) => {
  console.error('[kurulum] BAŞARISIZ:', error instanceof Error ? error.message : error);
  process.exit(1);
});
