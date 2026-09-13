'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DedektifVaka } from '@/server/modules/detective/service';
import { formatCount } from '@/lib/utils';
import { sayiIyelik } from '@/lib/turkce';
import { socialProof } from '@/config/social-proof';
import { vakaCevaplaAction } from '../actions';

/**
 * VAKA KARTI — Kısa Dedektif'in oynandığı ekran.
 *
 * ── NEDEN ANINDA CEVAP ─────────────────────────────────────────────────────
 * MEYDAN'ın bütün mekaniği üç gün bekletiyordu: tahminini yap, maçı bekle,
 * sonucu gör. Alışkanlık kurmak için çok yavaş bir döngü. Burada cevap zaten
 * belli ve saklı; kullanıcı seçer seçmez öğreniyor. Ürünün ilk kez saniyeler
 * içinde karşılık verdiği yer burası.
 *
 * ── ASIL DEĞER ÇÖZÜM METNİ ─────────────────────────────────────────────────
 * "Doğru/yanlış" tek başına bir oyun değil; bilgi yarışması uygulamalarının
 * sıkıcı olma sebebi bu. Kullanıcı YANILDIĞINDA bile bir şey öğrenerek
 * çıkmalı — bu yüzden çözüm metni, doğru bilenlere de bilemeyenlere de aynı
 * şekilde gösteriliyor ve karttaki en uzun bölüm o.
 */
export function VakaKarti({ vaka }: { readonly vaka: DedektifVaka }) {
  const router = useRouter();
  const [secili, setSecili] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cevaplandi = vaka.sonuc !== null;

  function gonder() {
    if (!secili) return;
    setHata(null);
    startTransition(async () => {
      const sonuc = await vakaCevaplaAction(vaka.id, secili);
      if (!sonuc.ok) setHata(sonuc.message);
      else router.refresh();
    });
  }

  return (
    <article className="border-border bg-background rounded-xl border p-5">
      <p className="text-muted text-xs">
        <span aria-hidden="true">🔍 </span>
        Kısa Dedektif
        <span aria-hidden="true"> · </span>
        {'★'.repeat(vaka.difficulty)}
        {vaka.attemptCount > 0 && (
          <>
            <span aria-hidden="true"> · </span>
            {/*
              Kaç kişinin bildiği KÜÇÜK SAYIDA YÜZDE OLARAK yazılmaz — üründeki
              her yerde olduğu gibi. Ayrıca bu bilgi cevap vermeden de görünür:
              zorluk hakkında fikir verir ama cevabı ele vermez.
            */}
            {vaka.attemptCount >= socialProof.minSampleForPercentage
              ? `%${Math.round((vaka.correctCount / vaka.attemptCount) * 100)} çözdü`
              : `${formatCount(vaka.attemptCount)} kişiden ${sayiIyelik(vaka.correctCount, formatCount(vaka.correctCount))} çözdü`}
          </>
        )}
      </p>

      <h1 className="text-ink mt-2 text-xl font-bold text-balance">{vaka.title}</h1>

      <div className="text-foreground mt-4 leading-relaxed whitespace-pre-line">
        {vaka.scenario}
      </div>

      <p className="text-ink mt-5 text-base font-semibold">{vaka.question}</p>

      <div className="mt-3 grid gap-2">
        {vaka.options.map((o) => {
          const benimki = vaka.sonuc?.secilenId === o.id;
          const dogru = vaka.sonuc?.dogruId === o.id;

          const stil = !cevaplandi
            ? secili === o.id
              ? 'border-brand bg-brand text-brand-fg'
              : 'border-border bg-background text-ink'
            : dogru
              ? 'border-correct bg-surface text-ink'
              : benimki
                ? 'border-incorrect bg-surface text-muted'
                : 'border-border bg-background text-muted';

          return (
            <button
              key={o.id}
              type="button"
              disabled={cevaplandi || pending}
              aria-pressed={!cevaplandi && secili === o.id}
              onClick={() => setSecili(secili === o.id ? null : o.id)}
              className={`focus-visible:outline-ink min-h-13 w-full rounded-lg border px-4 py-3 text-left text-base transition focus-visible:outline-2 ${stil}`}
            >
              {/* Renk tek başına anlam taşımaz — işaretle de belli edilir. */}
              <span aria-hidden="true">
                {cevaplandi ? (dogru ? '✓ ' : benimki ? '✕ ' : '　') : secili === o.id ? '✓ ' : ''}
              </span>
              {o.label}
              {cevaplandi && benimki && (
                <span className="text-muted ml-2 text-xs">senin cevabın</span>
              )}
            </button>
          );
        })}
      </div>

      {!cevaplandi && (
        <>
          <button
            type="button"
            onClick={gonder}
            disabled={!secili || pending}
            className="bg-brand text-brand-fg focus-visible:outline-ink mt-4 min-h-13 w-full rounded-lg text-base font-bold focus-visible:outline-2 disabled:opacity-50"
          >
            {pending ? 'Gönderiliyor…' : 'Cevabım bu'}
          </button>
          <p className="text-muted mt-2 text-center text-xs">
            Cevap bir kez verilir ve sonradan değiştirilemez.
          </p>
        </>
      )}

      {hata && (
        <p role="alert" className="text-incorrect mt-3 text-sm">
          {hata}
        </p>
      )}

      {vaka.sonuc && (
        <div className="border-border mt-5 border-t pt-5">
          <p className="text-lg font-bold">
            {vaka.sonuc.dogruMu ? (
              <span className="text-correct">
                <span aria-hidden="true">✅ </span>Çözdün.
              </span>
            ) : (
              <span className="text-muted">
                <span aria-hidden="true">❌ </span>Bu sefer olmadı.
              </span>
            )}
          </p>

          <h2 className="text-ink mt-4 text-base font-bold">Çözüm</h2>
          <div className="text-foreground mt-2 leading-relaxed whitespace-pre-line">
            {vaka.sonuc.explanation}
          </div>

          <p className="mt-5 text-center">
            <Link
              href="/dedektif"
              className="text-brand focus-visible:outline-ink text-sm font-semibold underline underline-offset-4 focus-visible:outline-2"
            >
              Başka bir vaka →
            </Link>
          </p>
        </div>
      )}
    </article>
  );
}
