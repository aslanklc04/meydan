import type { Metadata } from 'next';
import Link from 'next/link';
import { currentActor } from '@/server/auth';
import { detectiveService } from '@/server/modules/detective/service';
import { formatCount } from '@/lib/utils';
import { sayiIyelik } from '@/lib/turkce';
import { socialProof } from '@/config/social-proof';
import { brand } from '@/config';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Kısa Dedektif',
  description:
    'Cevabı belli ama saklı vakalar. İpuçlarından çıkarım yap, cevabını ver, çözümü anında öğren.',
  alternates: { canonical: '/dedektif' },
};

/**
 * KISA DEDEKTİF LİSTESİ.
 *
 * ── NEDEN HERKESE AÇIK ─────────────────────────────────────────────────────
 * Vaka metinleri kayıt istemeden okunabilir. Sebep: bu, ürünün kayıt olmadan
 * DEĞERİNİ gösterebildiği ilk yer. Tahmin ekranı boş bir maç listesi
 * gösteriyordu; burada ziyaretçi ilk saniyede okunacak bir şey buluyor.
 *
 * Cevap vermek için hesap gerekir — çünkü cevabın bir karneye yazılması
 * gerekiyor ve karnesi olmayan bir cevabın anlamı yok.
 */
export default async function DedektifPage() {
  const actor = await currentActor();
  const vakalar = await detectiveService.list(actor?.id ?? null, 30);
  const karne = actor ? await detectiveService.karne(actor.id) : null;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-ink text-2xl font-bold">
        <span aria-hidden="true">🔍 </span>Kısa Dedektif
      </h1>
      <p className="text-muted mt-2 text-sm leading-relaxed">
        Cevabı zaten belli ama saklı. İpuçlarını oku, çıkarımını yap, cevabını ver — çözümü
        beklemeden öğren.
      </p>

      {karne && karne.cozulen > 0 && (
        <section className="border-border bg-surface mt-5 rounded-xl border p-4">
          <p className="text-muted text-xs font-semibold tracking-wide uppercase">
            Dedektif karnen
          </p>
          <p className="text-ink mt-1 text-2xl font-bold tabular-nums">
            {karne.cozulen >= socialProof.minSampleForPercentage
              ? `%${Math.round((karne.dogru / karne.cozulen) * 100)}`
              : `${formatCount(karne.cozulen)} vakanın ${sayiIyelik(karne.dogru, formatCount(karne.dogru))}`}
          </p>
          <p className="text-muted mt-1 text-xs">
            {/*
              Dedektif karnesi TAHMİN GÜCÜNDEN AYRI. İkisi karışsaydı "geleceği
              iyi biliyor" ile "geçmişi iyi çözüyor" aynı sayıya girer ve
              Tahmin Gücü ölçtüğü şeyi ölçmez olurdu.
            */}
            Bu sayı {brand.ratingName}&apos;nden ayrıdır — farklı bir yetenek ölçer.
          </p>
        </section>
      )}

      {vakalar.length === 0 ? (
        <div className="border-border mt-6 rounded-xl border border-dashed p-6 text-center">
          <p className="text-ink text-base font-semibold">Henüz yayınlanmış vaka yok.</p>
          <p className="text-muted mt-2 text-sm">Yakında burada olacaklar.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {vakalar.map((v) => (
            <li key={v.id}>
              <Link
                href={`/dedektif/${v.slug}`}
                className="border-border hover:border-brand focus-visible:outline-ink block rounded-xl border px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <p className="text-ink text-sm font-bold text-balance">
                  {/*
                    Çözülmüş vakada sonucu değil yalnızca "çözüldü" işareti
                    var: listede cevabın kendisi işe yaramaz, üstelik omuz
                    üstünden bakan birine ipucu verirdi.
                  */}
                  {v.cozdumMu !== null && (
                    <span aria-hidden="true">{v.cozdumMu ? '✅ ' : '✔️ '}</span>
                  )}
                  {v.title}
                </p>
                <p className="text-muted mt-1 text-xs">
                  {'★'.repeat(v.difficulty)}
                  {v.attemptCount > 0 && (
                    <>
                      <span aria-hidden="true"> · </span>
                      {formatCount(v.attemptCount)} kişi denedi
                    </>
                  )}
                  {v.cozdumMu !== null && (
                    <>
                      <span aria-hidden="true"> · </span>
                      cevapladın
                    </>
                  )}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!actor && vakalar.length > 0 && (
        <div className="border-border mt-8 border-t pt-6">
          <p className="text-ink text-base font-semibold">Cevabını kaydetmek için hesap gerekir.</p>
          <p className="text-muted mt-1 text-sm">
            Vakaları okumak serbest. Ama cevabın bir karneye yazılmıyorsa doğru bilmenin kanıtı da
            olmaz.
          </p>
          <Link
            href="/register"
            className="bg-brand text-brand-fg focus-visible:outline-ink mt-4 inline-flex min-h-12 items-center rounded-lg px-4 text-base font-bold focus-visible:outline-2"
          >
            Hesap oluştur
          </Link>
        </div>
      )}
    </main>
  );
}
