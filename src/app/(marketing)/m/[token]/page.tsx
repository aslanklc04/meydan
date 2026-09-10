import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import { currentActor } from '@/server/auth';
import { shareService } from '@/server/modules/share/service';
import { log } from '@/server/observability/logger';
import { ChallengeAnswer } from '@/features/share/components/ChallengeAnswer';
import { timeRemaining } from '@/features/predictions/labels';
import { brand } from '@/config';

export const dynamic = 'force-dynamic';

/**
 * TEK SORULUK MEYDAN OKUMA — herkese açık.
 *
 * ── BU SAYFANIN TEK İŞİ ────────────────────────────────────────────────────
 * Bağlantıya tıklayan kişi MEYDAN'ı bilmiyor ve bir şey okumaya gelmedi.
 * Ona verilecek şey tek bir soru ve üç düğmedir. Tanıtım yok, özellik listesi
 * yok, kayıt duvarı en başta yok.
 *
 * Gazete sayfası ANLATIR; bu sayfa DAVET EDER. İkisi farklı işler görür.
 *
 * ── GÖNDERENİN CEVABI SUNUCUDA TUTULUR ─────────────────────────────────────
 * Alıcı kendi tahminini yapmadan gönderenin ne dediği bu sayfaya HİÇ GELMEZ.
 * İstemciye gönderip CSS ile gizlemek gizlemek değildir: veri sayfa
 * kaynağında durur. Daha önemlisi, önce görünseydi alıcının cevabı kendi
 * görüşü olmaktan çıkar, arkadaşına uyma ya da inat etme kararına dönüşürdü.
 */

type Params = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const view = await shareService.byToken(token, null);
  if (!view) return { title: 'Meydan okuma bulunamadı', robots: { index: false } };

  const title = `@${view.senderUsername} sordu: ${view.question}`;
  const description = `${view.eventTitle} · Sen ne diyorsun? Cevabını verince arkadaşının ne dediğini göreceksin.`;

  return {
    title,
    description,
    // Bağlantı tahmin edilemez ama gizli değildir; dizine girerse paylaşım
    // kararı kullanıcının elinden çıkar.
    robots: { index: false, follow: false },
    openGraph: {
      type: 'article',
      title,
      description,
      siteName: brand.appName,
      locale: 'tr_TR',
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function ChallengePage({ params }: Params) {
  const { token } = await params;
  const actor = await currentActor();
  const view = await shareService.byToken(token, actor?.id ?? null);
  if (!view) notFound();

  const isSender = actor !== null && actor.username === view.senderUsername;

  /*
   * Sayaç YANITTAN SONRA. Sayfanın açılması bir veritabanı yazmasını
   * beklememeli. Gönderenin kendi ziyareti sayılmaz: sayılsaydı "8 kişi
   * baktı" aslında "8 kez sen baktın" olurdu.
   */
  if (!isSender) {
    after(async () => {
      try {
        await shareService.countView(token);
      } catch (error) {
        log.warn('share.view_count_failed', { operation: 'share.countView', error });
      }
    });
  }

  const senderLabel = view.outcomes.find((o) => o.id === view.senderOutcomeId)?.label ?? null;
  const viewerLabel = view.outcomes.find((o) => o.id === view.viewerOutcomeId)?.label ?? null;
  const agree =
    view.senderOutcomeId !== null &&
    view.viewerOutcomeId !== null &&
    view.senderOutcomeId === view.viewerOutcomeId;

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <p className="text-muted text-sm">
        <strong className="text-ink">@{view.senderUsername}</strong> sana bir soru gönderdi
      </p>

      <h1 className="text-ink mt-2 text-2xl font-bold text-balance">{view.question}</h1>
      <p className="text-muted mt-1 text-sm">{view.eventTitle}</p>
      <p className="text-muted mt-2 text-xs">
        {view.resolvedOutcomeLabel !== null
          ? `Sonuçlandı · ${view.resolvedOutcomeLabel}`
          : view.isOpen
            ? `Kapanışa ${timeRemaining(view.closesAt)}`
            : 'Tahminler kapandı, sonuç bekleniyor.'}
      </p>

      {/* ── Cevap alanı ── */}
      <section className="mt-6">
        <ChallengeAnswer
          publicToken={token}
          outcomes={view.outcomes}
          isOpen={view.isOpen}
          isLoggedIn={actor !== null}
          viewerOutcomeId={view.viewerOutcomeId}
          returnTo={`/m/${token}`}
        />
      </section>

      {/* ── Karşılaştırma — ancak cevaptan sonra ── */}
      {view.senderOutcomeId !== null ? (
        <section className="border-border mt-6 rounded-xl border p-4">
          <h2 className="text-ink text-base font-bold">Karşılaştırma</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">@{view.senderUsername}</dt>
              <dd className="text-ink font-semibold">{senderLabel}</dd>
            </div>
            {viewerLabel && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-muted">Sen</dt>
                <dd className="text-ink font-semibold">{viewerLabel}</dd>
              </div>
            )}
          </dl>

          {viewerLabel && (
            <p className="text-ink mt-3 text-sm font-semibold">
              {agree ? (
                <>
                  <span aria-hidden="true">🤝 </span>Aynı taraftasınız.
                </>
              ) : (
                <>
                  <span aria-hidden="true">⚔️ </span>Ayrı taraftasınız. Sonuç söyleyecek.
                </>
              )}
            </p>
          )}

          {view.resolvedOutcomeLabel !== null && (
            <p className="text-muted mt-2 text-sm">
              Sonuç: <strong className="text-ink">{view.resolvedOutcomeLabel}</strong>
            </p>
          )}
        </section>
      ) : (
        /* Merakı ADIYLA söylemek gerekiyor: alıcı neden cevap vereceğini
           bilmeli. "Cevabını ver, sonra göreceksin" bir vaattir ve tutulur. */
        <p className="border-border text-muted mt-6 rounded-xl border border-dashed p-4 text-center text-sm">
          <span aria-hidden="true">🔒 </span>@{view.senderUsername} kişisinin ne dediğini, sen kendi
          tahminini yaptıktan sonra göreceksin.
        </p>
      )}

      <p className="mt-6 text-center">
        <Link href={`/event/${view.eventSlug}`} className="text-brand text-sm font-semibold">
          Bu etkinliğin sayfasına git →
        </Link>
      </p>
    </main>
  );
}
