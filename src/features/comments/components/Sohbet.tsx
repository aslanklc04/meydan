'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import type { CommentView, SohbetView } from '@/server/modules/comment/service';
import { contentLimits } from '@/config';
import { timeAgo } from '@/features/predictions/labels';
import { formatCount } from '@/lib/utils';
import { yorumBildirAction, yorumSilAction, yorumYazAction, type SohbetState } from '../actions';

/**
 * MEYDAN SOHBETİ.
 *
 * ── KİLİTLİ HÂL BİR CEZA DEĞİL, DAVETTİR ───────────────────────────────────
 * Tahmin yapmadan sohbet okunamıyor. Bunu "erişimin yok" diye sunmak
 * kullanıcıyı dışarıda bırakır; doğru sunum, orada bir şey olduğunu gösterip
 * içeri girmenin yolunu söylemektir. Bu yüzden kilitli hâlde YORUM SAYISI
 * görünür: "12 kişi konuşuyor" bir sebeptir, boş bir kilit değildir.
 *
 * Sayı bir sızıntı değil — kimin ne dediğini söylemez.
 *
 * ── NEDEN "ÖNCE SEN SÖYLE" ─────────────────────────────────────────────────
 * Ürün, tarafını seçmeden kalabalığın dağılımını göstermiyor. Sohbet serbest
 * okunsaydı aynı bilgi yorumlardan sızardı ve bütün mekanizma delinirdi.
 */
export function Sohbet({
  eventId,
  eventSlug,
  view,
  canWrite,
}: {
  readonly eventId: string;
  readonly eventSlug: string;
  readonly view: SohbetView;
  /** Tahmin yapmış VE etkinlik hâlâ konuşmaya açık. */
  readonly canWrite: boolean;
}) {
  if (view.locked) {
    return (
      <section id="sohbet" aria-labelledby="sohbet-baslik" className="mt-8">
        <h2 id="sohbet-baslik" className="text-ink text-lg font-bold">
          <span aria-hidden="true">💬 </span>Meydan Sohbeti
        </h2>
        <div className="border-border mt-3 rounded-xl border border-dashed p-5 text-center">
          <p aria-hidden="true" className="text-2xl">
            🔒
          </p>
          <p className="text-ink mt-2 text-base font-semibold">
            {view.total > 0
              ? `Burada ${formatCount(view.total)} yorum var.`
              : 'Sohbet tahminini yapınca açılır.'}
          </p>
          <p className="text-muted mt-2 text-sm leading-relaxed">
            Önce sen söyle. Başkalarının ne dediğini okuyup ona göre tahmin yapmak, tahmin değil
            takip etmek olurdu — MEYDAN dağılımı da aynı sebeple tahminden önce göstermiyor.
          </p>
          <Link
            href={`/event/${eventSlug}#tahmin`}
            className="bg-brand text-brand-fg focus-visible:outline-ink mt-4 inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Tahminimi yap
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section id="sohbet" aria-labelledby="sohbet-baslik" className="mt-8">
      <h2 id="sohbet-baslik" className="text-ink text-lg font-bold">
        <span aria-hidden="true">💬 </span>Meydan Sohbeti
        {view.total > 0 && (
          <span className="text-muted ml-2 text-sm font-normal">{view.total}</span>
        )}
      </h2>

      {canWrite ? (
        <YorumFormu eventId={eventId} />
      ) : (
        <p className="text-muted mt-2 text-sm">
          Bu meydan kapandı. Yazılanlar burada kalıyor, yeni yorum eklenmiyor.
        </p>
      )}

      {view.items.length === 0 ? (
        <p className="text-muted mt-4 text-sm">
          Henüz kimse yazmadı. İlk sözü sen söyle — neden o tarafı seçtin?
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {view.items.map((c) => (
            <li key={c.id}>
              <Yorum yorum={c} eventId={eventId} canWrite={canWrite} />
              {c.replies.length > 0 && (
                <ul className="border-border mt-2 ml-4 space-y-2 border-l pl-3">
                  {c.replies.map((r) => (
                    <li key={r.id}>
                      {/* Cevabın cevabı yok: derin ağaç telefonda okunmaz. */}
                      <Yorum yorum={r} eventId={eventId} canWrite={false} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function YorumFormu({
  eventId,
  parentId,
}: {
  readonly eventId: string;
  readonly parentId?: string;
}) {
  const [state, formAction, pending] = useActionState<SohbetState, FormData>(yorumYazAction, {
    status: 'idle',
  });
  const [uzunluk, setUzunluk] = useState(0);
  const kalan = contentLimits.commentMaxLength - uzunluk;

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="eventId" value={eventId} />
      {parentId && <input type="hidden" name="parentId" value={parentId} />}
      <label htmlFor={`yorum-${parentId ?? 'kok'}`} className="sr-only">
        {parentId ? 'Cevabın' : 'Yorumun'}
      </label>
      <textarea
        id={`yorum-${parentId ?? 'kok'}`}
        name="body"
        rows={parentId ? 2 : 3}
        maxLength={contentLimits.commentMaxLength}
        onChange={(e) => setUzunluk(e.currentTarget.value.length)}
        placeholder={parentId ? 'Cevabını yaz…' : 'Neden o tarafı seçtin?'}
        className="border-border bg-background text-ink focus-visible:outline-ink w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline-2"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className={kalan < 40 ? 'text-incorrect text-xs' : 'text-muted text-xs'}>
          {kalan < 80 ? `${kalan} karakter kaldı` : ''}
        </span>
        <button
          type="submit"
          disabled={pending}
          className="bg-brand text-brand-fg focus-visible:outline-ink min-h-11 rounded-lg px-4 text-sm font-bold focus-visible:outline-2 disabled:opacity-60"
        >
          {/*
            Cevap formunun düğmesi "Cevabı gönder" — "Cevapla" DEĞİL.
            Yoruma cevap yazmayı AÇAN düğme de "Cevapla" diyordu; ikisi aynı
            adı taşıyınca hem ekran okuyucuda hem gözle ayırt edilemiyordu.
            Denemede otomasyon da ikisini karıştırdı.
          */}
          {pending ? 'Gönderiliyor…' : parentId ? 'Cevabı gönder' : 'Gönder'}
        </button>
      </div>
      {state.status === 'error' && (
        <p role="alert" className="text-incorrect mt-2 text-sm">
          {state.message}
        </p>
      )}
      {state.status === 'ok' && (
        <p className="text-muted mt-2 text-sm">Yazın eklendi. Sayfayı yenileyince görünür.</p>
      )}
    </form>
  );
}

function Yorum({
  yorum,
  eventId,
  canWrite,
}: {
  readonly yorum: CommentView;
  readonly eventId: string;
  readonly canWrite: boolean;
}) {
  const [cevapAcik, setCevapAcik] = useState(false);
  const [mesaj, setMesaj] = useState<string | null>(null);

  /*
   * SİLİNMİŞ VE GİZLENMİŞ AYRI ANLATILIR. İkisini "bu yorum yok" diye
   * birleştirmek, kullanıcının kendi silmesiyle bizim moderasyon kararımızı
   * aynı şey gibi gösterir — ve moderasyonu görünmez kılar.
   */
  if (yorum.deleted || yorum.hidden) {
    return (
      <div className="border-border text-muted rounded-lg border border-dashed px-3 py-2 text-sm">
        {yorum.deleted ? 'Bu yorum yazarı tarafından silindi.' : 'Bu yorum kurallara aykırıydı.'}
      </div>
    );
  }

  return (
    <div className="border-border rounded-lg border px-3 py-3">
      <p className="text-muted text-xs">
        <Link href={`/u/${yorum.authorUsername}`} className="text-ink font-semibold">
          @{yorum.authorUsername}
        </Link>
        <span aria-hidden="true"> · </span>
        {timeAgo(yorum.createdAt)}
      </p>
      <p className="text-foreground mt-1 text-sm whitespace-pre-wrap">{yorum.body}</p>

      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {canWrite && !cevapAcik && (
          <button
            type="button"
            onClick={() => setCevapAcik(true)}
            className="text-brand min-h-11 font-semibold"
          >
            Cevapla
          </button>
        )}
        {yorum.mine ? (
          <button
            type="button"
            onClick={async () => setMesaj((await yorumSilAction(yorum.id)).message)}
            className="text-muted min-h-11"
          >
            Sil
          </button>
        ) : (
          <button
            type="button"
            onClick={async () => setMesaj((await yorumBildirAction(yorum.id)).message)}
            className="text-muted min-h-11"
          >
            Bildir
          </button>
        )}
      </div>

      {mesaj && <p className="text-muted mt-1 text-xs">{mesaj}</p>}
      {cevapAcik && <YorumFormu eventId={eventId} parentId={yorum.id} />}
    </div>
  );
}
