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
import { looksLikeEmail } from '../src/config/env';
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
 * KURUCU HESABI — son çare.
 *
 * NEDEN VAR: yönetici kurulumu ADMIN_EMAIL ortam değişkenine bağlıydı ve bu,
 * teknik olmayan kurucu için pratikte AŞILAMAZ bir engel çıktı — değişken
 * dört ayrı denemede panele kaydedilemedi ve site yöneticisiz kaldı.
 * Yöneticisiz site demek, hiç etkinlik açılamaması, yani BOŞ BİR ÜRÜN demek.
 *
 * E-POSTA DEĞİL KULLANICI ADI: kurucunun hangi adresle kayıt olduğu belirsiz
 * (kayıt sırasında ikinci bir adres kullanılmış). Kullanıcı adı ise ekranda
 * görünür ve doğrulanmıştır. Yanlış bir sabit, sessizce hiçbir şey yapmaz.
 *
 * GÜVENLİK GEREKÇESİ — bu, rol atamasını zayıflatmaz:
 *   • Rol hâlâ İSTEMCİDEN GELEN BİR ALANLA atanmıyor; kayıt formunda "role"
 *     alanı yok ve olmayacak. Saldırı yüzeyi değişmedi.
 *   • Kullanıcı adı EŞSİZDİR (user_username_lower_key) ve bu ad kurucunun
 *     elinde. Başkası aynı adı alıp yükseltilemez.
 *   • Bu sabiti değiştirebilen kişinin zaten depoya yazma ve dağıtım yetkisi
 *     vardır; o kişi bu satır olmadan da her şeyi yapabilir. Yeni bir tehdit
 *     doğmuyor.
 *   • Parola hâlâ hiçbir yerde yazmıyor. Kurucu parolasını kendi belirler.
 *
 * ADMIN_EMAIL / ADMIN_USERNAME tanımlıysa ONLAR KAZANIR; bu sabit yalnızca
 * ikisi de yokken devreye girer. Yönetici devri gerektiğinde ortam değişkeni
 * yazmak yeterlidir, bu satıra dokunmak gerekmez.
 */
const FOUNDER_USERNAME = 'asklc0404';

/**
 * Kurucunun e-postası. Kullanıcı adı sabitinin YEDEĞİDİR, alternatifi değil:
 * ikisi de denenir, hangisi tutarsa o hesap yükseltilir.
 *
 * İkisinin birden olmasının sebebi, hangisinin doğru olduğunu kesin
 * bilmememizdir: kurucu siteye kaydolurken bundan farklı bir adres kullanmış
 * olabilir. Kullanıcı adı ekranda görüldüğü için daha güvenilirdir; adres ise
 * kullanıcı adı bir gün değişirse çalışmaya devam eder. Yanlış olan sessizce
 * eşleşmez, zarar vermez.
 */
const FOUNDER_EMAIL = 'aslanklc04@gmail.com';

type AdminTarget = { id: string; role: string; username: string };

/**
 * YÖNETİCİ KURULUMU.
 *
 * Rol İSTEMCİDEN GELEN BİR DEĞERLE atanmaz; kayıt formunda "role" diye bir
 * alan yoktur ve olmayacaktır. Yükseltme yalnızca dağıtım ortamının
 * söylediği hesaba uygulanır — sırasıyla:
 *
 *   1. ADMIN_EMAIL      panelde yazan adres
 *   2. ADMIN_USERNAME   panelde yazan kullanıcı adı
 *   3. FOUNDER_USERNAME koddaki kurucu sabiti (son çare, yukarıya bakınız)
 *
 * Parola hiçbir yolda saklanmaz: kurucu parolasını kendi belirler, bu betik
 * dâhil kimse bilmez.
 *
 * Hesap henüz yoksa sessizce atlanır: kurucu siteye kaydolduktan sonraki ilk
 * dağıtımda yükseltme kendiliğinden gerçekleşir.
 */
async function findAdminTarget(): Promise<AdminTarget | null> {
  const columns = { id: users.id, role: users.role, username: users.username };

  const rawEmail = process.env.ADMIN_EMAIL?.trim();
  if (rawEmail) {
    // Biçim burada denetlenir: bozuk bir ADMIN_EMAIL yükseltmeyi atlatmalı,
    // dağıtımı düşürmemeli (bkz. src/config/env.ts — hoşgörülü alan).
    if (!looksLikeEmail(rawEmail)) {
      say('yönetici', 'ADMIN_EMAIL geçerli bir e-posta adresine benzemiyor, atlandı');
    } else {
      // Karşılaştırma büyük/küçük harften bağımsız: panele "Ad@Site.com"
      // yazılsa da eşleşmelidir.
      const byEmail = await db
        .select(columns)
        .from(users)
        .where(sql`lower(${users.email}) = ${rawEmail.toLowerCase()}`)
        .limit(1);
      if (byEmail[0]) return byEmail[0];
      // Adres GÜNLÜĞE YAZILMAZ; yalnızca sonucun kendisi.
      say('yönetici', 'ADMIN_EMAIL ile eşleşen kayıt yok, kullanıcı adına bakılıyor');
    }
  }

  const configured = process.env.ADMIN_USERNAME?.trim();
  const wanted = (configured || FOUNDER_USERNAME).toLowerCase();
  const source = configured ? 'ADMIN_USERNAME' : 'kurucu sabiti';

  const byUsername = await db
    .select(columns)
    .from(users)
    .where(eq(users.usernameLower, wanted))
    .limit(1);
  if (byUsername[0]) return byUsername[0];

  // Son deneme: koddaki kurucu adresi. Kullanıcı adı bir gün değişirse
  // yükseltme buradan yürür.
  if (!configured) {
    const byFounderEmail = await db
      .select(columns)
      .from(users)
      .where(sql`lower(${users.email}) = ${FOUNDER_EMAIL.toLowerCase()}`)
      .limit(1);
    if (byFounderEmail[0]) return byFounderEmail[0];
  }

  say('yönetici', `${source} ile eşleşen kayıt yok — kayıt olduktan sonra tekrar dağıtın`);
  return null;
}

async function bootstrapAdmin(): Promise<string | null> {
  const user = await findAdminTarget();
  if (!user) return null;

  if (user.role === 'ADMIN') {
    say('yönetici', `@${user.username} zaten yönetici`);
    return user.id;
  }

  // Yükseltme aynı zamanda e-postayı doğrulanmış sayar: kurucu, e-posta
  // sağlayıcısı bağlanmadan önce kaydolduğu için doğrulama kodu asla
  // gelmedi ve hesabı doğrulanmamış durumda kaldı.
  await db
    .update(users)
    .set({ role: 'ADMIN', emailVerified: new Date() })
    .where(eq(users.id, user.id));
  say('yönetici', `@${user.username} yönetici yapıldı`);
  return user.id;
}

/**
 * BOŞ İÇERİK ÜRETEN ŞABLONU DURDUR — Faz 7.
 *
 * Kodda şablonu kaldırmak YETMEZ: şablon satırı zaten veritabanındadır ve
 * bakım işi ondan her gün yeni etkinlik üretmeye devam eder. Bu yüzden
 * kurulum, mevcut satırı etkin olmaktan çıkarır.
 *
 * Üretilen sorular cevaplanamazdı:
 *   "2026-09-08 tarihli günün maçını ev sahibi mi kazanacak?" — HANGİ MAÇ?
 * Takım adı yoktu; kullanıcı neye tahmin ettiğini, yönetici de sonucu
 * bilemezdi.
 *
 * SİLİNMİYOR, PASİFLEŞTİRİLİYOR: satır dururken üretim durur. Gerçek fikstür
 * verisi bağlandığında `active = true` yapmak yeterlidir — geçmiş kaybolmaz.
 *
 * Zaten üretilmiş, HİÇ TAHMİN ALMAMIŞ gelecek tarihli etkinlikler de iptal
 * edilir. Tahmin almış olanlara DOKUNULMAZ: bir kullanıcının çipini
 * bağladığı etkinliği sessizce iptal etmek, düzeltmesi gereken sorundan
 * daha kötü bir davranıştır.
 */
async function stopPlaceholderTemplate(): Promise<void> {
  const deactivated = (await db.execute(sql`
    UPDATE event_template SET active = false
     WHERE slug = 'gunun-super-lig-maci' AND active = true
    RETURNING id
  `)) as unknown as { id: string }[];

  const cancelled = (await db.execute(sql`
    UPDATE event SET status = 'CANCELLED'
     WHERE slug LIKE 'gunun-super-lig-maci-%'
       AND status IN ('DRAFT', 'OPEN')
       AND NOT EXISTS (SELECT 1 FROM prediction p WHERE p.event_id = event.id)
    RETURNING id
  `)) as unknown as { id: string }[];

  if (deactivated.length > 0 || cancelled.length > 0) {
    say(
      'yer tutucu şablon',
      `${deactivated.length > 0 ? 'durduruldu' : 'zaten duruyordu'}` +
        `, ${cancelled.length} boş etkinlik iptal edildi`,
    );
  }
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
  say('başlangıç içeriği', 'kategoriler, rozetler ve sezon hazır');

  await stopPlaceholderTemplate();

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
