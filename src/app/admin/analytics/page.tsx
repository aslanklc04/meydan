import type { Metadata } from 'next';
import { funnelService, type FunnelRatio } from '@/server/modules/governance/funnel.service';
import { formatCount } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ölçüm', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * ÖLÇÜM HUNİSİ EKRANI.
 *
 * ── KENDİ KURALIMIZI KENDİMİZE DE UYGULUYORUZ ──────────────────────────────
 * Kullanıcıya "3 kişiden 2'si" derken yüzde göstermeyi reddettik; kendi
 * karnemizde de aynısını yapıyoruz. İki kişilik bir paydada "%50 Y7" yazmak,
 * kurucunun kendi kendini kandırmasının en kolay yoludur — ve bir ürünü en
 * hızlı öldüren şey, sahibinin sahte bir sayıya inanmasıdır.
 *
 * Eşiğin altında oran gösterilmez; sayının kendisi yazılır.
 *
 * ── "HENÜZ ÖLÇÜLEMEZ" BİR CEVAPTIR ─────────────────────────────────────────
 * Payda sıfırsa ekran boş bir yüzde ya da "0%" göstermez: ölçülecek kimse
 * olmadığını söyler. Sıfır, "kimse dönmedi" demek değildir; "henüz kimsenin
 * dönme zamanı gelmedi" demektir ve ikisi bambaşka şeylerdir.
 */

/** Oranın anlamlı sayılabilmesi için gereken en az payda. */
const MIN_FOR_RATE = 20;

function Ratio({ label, hint, value }: { label: string; hint: string; value: FunnelRatio }) {
  const { hit, eligible } = value;

  return (
    <div className="border-border rounded-xl border p-4">
      <p className="text-ink text-sm font-bold">{label}</p>
      <p className="text-muted mt-0.5 text-xs">{hint}</p>

      <p className="mt-3 text-2xl font-bold">
        {eligible === 0 ? (
          <span className="text-muted text-base font-semibold">Henüz ölçülemez</span>
        ) : eligible < MIN_FOR_RATE ? (
          /* Eşik altında ORAN DEĞİL KESİR: "%50" arkasında iki kişi varken
             teknik olarak doğru, iletişim olarak sahtedir. */
          <span className="text-ink">
            {formatCount(eligible)} kişiden {formatCount(hit)}
            <span className="text-muted">&apos;i</span>
          </span>
        ) : (
          <span className="text-ink">
            %{Math.round((hit / eligible) * 100)}
            <span className="text-muted ml-2 text-sm font-normal">
              ({formatCount(hit)}/{formatCount(eligible)})
            </span>
          </span>
        )}
      </p>

      {eligible === 0 && (
        <p className="text-muted mt-2 text-xs">
          Pencereyi tamamlamış kimse yok. Sıfır &quot;kimse dönmedi&quot; demek değil, &quot;henüz
          dönme zamanı gelmedi&quot; demek.
        </p>
      )}
      {eligible > 0 && eligible < MIN_FOR_RATE && (
        <p className="text-muted mt-2 text-xs">
          Yüzde, payda {MIN_FOR_RATE}&apos;ye ulaşınca gösterilir. Küçük sayıda yüzde yanıltır.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="border-border rounded-lg border px-3 py-3">
      <p className="text-muted text-xs">{label}</p>
      <p className="text-ink mt-1 text-xl font-bold tabular-nums">{formatCount(value)}</p>
      {hint && <p className="text-muted mt-0.5 text-xs">{hint}</p>}
    </div>
  );
}

export default async function AdminAnalyticsPage() {
  const s = await funnelService.snapshot();

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-ink text-xl font-bold">Ölçüm</h1>
        <p className="text-muted mt-1 text-sm">
          Tanımlar sabittir ve sonradan değiştirilmez. Hedef oran baştan yazılmaz: ilk pilot taban
          oranı ölçer.
        </p>
      </div>

      {/* ── Ana davranış ── */}
      <section aria-labelledby="donus-baslik" className="space-y-3">
        <h2 id="donus-baslik" className="text-ink text-base font-bold">
          Dönüş
        </h2>
        <p className="text-muted text-sm">
          Ölçülen tek davranış: <strong>sonucu görüp yeni bir gerçek tahmin yapmak.</strong>{' '}
          Antrenman, sayfa açılışı ve bildirim tıklaması bunun yerine geçmez.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <Ratio
            label="Y7"
            hint="İlk tahminden 24-192 saat sonra en az bir yeni tahmin"
            value={s.y7}
          />
          <Ratio
            label="Y28"
            hint="İlk tahminden 24-696 saat sonra en az bir yeni tahmin"
            value={s.y28}
          />
          <Ratio
            label="Sonuç döngüsü"
            hint="Sonuç geldikten sonraki 72 saatte yeni tahmin"
            value={s.resultCycle}
          />
        </div>

        <p className="text-muted text-xs">
          Payda, <strong>pencereyi tamamlamış</strong> kullanıcılardır. Dün kaydolan biri Y7
          paydasına girmez; yaşanmamış bir şey &quot;olmadı&quot; diye sayılamaz.
        </p>
      </section>

      {/* ── Temel sayılar ── */}
      <section aria-labelledby="temel-baslik" className="space-y-3">
        <h2 id="temel-baslik" className="text-ink text-base font-bold">
          Temel
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Kayıtlı kullanıcı" value={s.users} />
          <Stat label="E-postası doğrulanmış" value={s.verifiedUsers} />
          <Stat label="Tahmin yapmış kişi" value={s.predictors} hint="En az bir tahmin" />
          <Stat label="Toplam tahmin" value={s.predictions} />
          <Stat label="Sonuçlanmış tahmin" value={s.resolvedPredictions} />
        </div>
      </section>

      {/* ── Paylaşım ── */}
      <section aria-labelledby="paylasim-baslik" className="space-y-3">
        <h2 id="paylasim-baslik" className="text-ink text-base font-bold">
          Paylaşım
        </h2>
        <p className="text-muted text-sm">
          Asıl ölçü <strong>cevap</strong>. Bağlantıya bakıp kapatan biri hiçbir şey yapmamıştır;
          yalnız görüntülenmeye bakmak, paylaşımın işe yaradığı yanılgısını verir.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Meydan okuma bağlantısı" value={s.shares.links} />
          <Stat label="Görüntülenme" value={s.shares.views} />
          <Stat label="Cevap" value={s.shares.answers} hint="Asıl ölçü" />
          <Stat label="Kayıt" value={s.shares.signups} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Gazete kapağı" value={s.gazettes.total} />
          <Stat label="Rafta yayında" value={s.gazettes.published} />
          <Stat label="Kapak görüntülenme" value={s.gazettes.views} />
          <Stat label="Kapaktan kayıt" value={s.gazettes.signups} />
        </div>
      </section>

      <p className="text-muted border-border border-t pt-4 text-xs">
        Bu sayılar ayrı bir izleme tablosundan değil, gerçek kayıtlardan türetilir. Kim geldiği
        değil, kaç kişi geldiği tutulur.
      </p>
    </main>
  );
}
