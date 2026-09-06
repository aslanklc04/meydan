/**
 * GELİŞTİRME VE TEST VERİSİ — İDEMPOTENT.
 *
 * Tekrar çalıştırıldığında yeni kayıt üretmez; var olanı korur.
 * Gerçek servisleri kullanır, veritabanına doğrudan kısayol yazmaz.
 *
 * Çalıştırma:  npm run db:seed
 *
 * ⚠️ BU BETİK ÜRETİMDE ÇALIŞTIRILMAZ. Demo kullanıcı (@emir, @mert, @ayse) ve
 * parolası kaynak kodda yazan bir yönetici hesabı üretir. Üretim kurulumu
 * `scripts/deploy.ts` ile yapılır: orada sahte kullanıcı yoktur ve yönetici
 * hesabı gerçek bir kayıttan yükseltilir.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../src/server/db';
import { users } from '../src/server/db/schema';
import { identityService } from '../src/server/modules/identity/service';
import { STARTER_EVENTS, seedBaseContent, seedEvent } from './catalog';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED !== '1') {
  console.error(
    '[seed] Bu betik geliştirme içindir ve demo kullanıcı üretir.\n' +
      '       Üretim kurulumu için: npm run deploy:setup',
  );
  process.exit(1);
}

const DEMO_PASSWORD = 'meydan-tahmin-2026';

async function seedUser(username: string, role: 'USER' | 'ADMIN' = 'USER'): Promise<string> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.usernameLower, username.toLowerCase()))
    .limit(1);

  if (existing[0]) return existing[0].id;

  const { userId } = await identityService.register({
    username,
    email: `${username.toLowerCase()}@meydan.local`,
    password: DEMO_PASSWORD,
    acceptTerms: true,
  });

  await db.update(users).set({ role, emailVerified: new Date() }).where(eq(users.id, userId));

  console.warn(`[seed] @${username} (${role}) oluşturuldu`);
  return userId;
}

async function main(): Promise<void> {
  await seedBaseContent();
  console.warn('[seed] kategoriler, rozetler, sezon ve şablon hazır');

  const adminId = await seedUser('yonetici', 'ADMIN');
  await seedUser('emir');
  await seedUser('mert');
  await seedUser('ayse');

  for (const event of STARTER_EVENTS) {
    if (await seedEvent(event, adminId)) console.warn(`[seed] etkinlik: ${event.title}`);
  }

  const rows = (await db.execute(
    sql`SELECT count(*)::int AS count FROM event WHERE status = 'OPEN'`,
  )) as unknown as { count: number }[];

  console.warn(`[seed] tamamlandı — ${rows[0]?.count ?? 0} açık etkinlik`);
  process.exit(0);
}

main().catch((error) => {
  console.error('[seed] hata', error);
  process.exit(1);
});
