import { headers } from 'next/headers';
import { hashIp } from './hash';

/**
 * İstek kimliği — oran sınırlama için (Faz 6).
 *
 * HAM IP HİÇBİR YERDE saklanmaz veya günlüğe yazılmaz; yalnızca HMAC'i
 * kullanılır (`IP_PEPPER`). Böylece "aynı kaynaktan mı geliyor?" sorusu
 * yanıtlanabilir ama kaynağın kendisi kayıt altına alınmaz.
 *
 * BAŞLIK GÜVENİ: `x-forwarded-for` istemci tarafından uydurulabilir. Değeri
 * yalnızca uygulamanın ÖNÜNDEKİ ters vekil (Vercel, Cloudflare, nginx) doğru
 * yazdığında anlamlıdır. Bu yüzden ilk değil, vekilin eklediği İLK atlama
 * alınır ve bu sınır dokümante edilir: IP tabanlı sınırlama tek başına yeterli
 * bir savunma DEĞİLDİR; kullanıcı tabanlı sınırlarla birlikte çalışır.
 */
export async function currentIpHash(): Promise<string | undefined> {
  const headerList = await headers();

  const forwarded = headerList.get('x-forwarded-for');
  const real = headerList.get('x-real-ip');
  const vercel = headerList.get('x-vercel-forwarded-for');

  const raw = (vercel ?? forwarded ?? real ?? '').split(',')[0]?.trim();
  if (!raw) return undefined;

  return hashIp(raw);
}
