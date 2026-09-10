import { ImageResponse } from 'next/og';
import { gazetteService } from '@/server/modules/gazette/service';
import { brand } from '@/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PAYLAŞIM GÖRSELİ — WhatsApp, X ve Telegram önizlemesinde çıkan kapak.
 *
 * ── NEDEN AYRI BİR ÇİZİM ───────────────────────────────────────────────────
 * Paylaşılan bağlantının önizlemesi yoksa mesajda çıplak bir adres görünür ve
 * tıklanma oranı düşer. Ama asıl mesele estetik değil: önizleme, tıklamadan
 * ÖNCE "burada bir iddia var ve sonucu belli değil" bilgisini taşır. Merakı
 * yaratan yer burasıdır; sayfa ikinci adımdır.
 *
 * ── SATORI SINIRI ──────────────────────────────────────────────────────────
 * Bu çizim tarayıcıda değil, Satori ile yapılır: `grid` yoktur, yalnızca
 * flexbox çalışır ve her düğümün `display` değeri açıkça verilmelidir. Tailwind
 * sınıfları da geçmez — bu yüzden stiller satır içidir. Dış görsel (takım
 * arması) BİLEREK kullanılmaz: dış bir adres yavaşlarsa ya da düşerse
 * paylaşımın önizlemesi hiç oluşmaz.
 *
 * ── UYARI GÖRSELİN İÇİNDE ──────────────────────────────────────────────────
 * "TAHMİN" ibaresi görselin kendisine basılır. Önizleme sayfadan KOPARAK
 * dolaşır: birisi ekran görüntüsünü alıp paylaşabilir ve o görüntüde sayfanın
 * uyarısı yoktur. Uyarı görselin üstündeyse kopya da uyarıyı taşır.
 */

const BG = '#0f1115';
const INK = '#f5f7fa';
const MUTED = '#9aa3ad';
const BRAND = '#4ade80';

export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const gazette = await gazetteService.byToken(token);

  if (!gazette) {
    // Bilinmeyen jetonda da BİR GÖRSEL döner. Hata döndürseydik paylaşılan
    // bağlantı önizlemesiz kalırdı ve bu, silinmiş bir kapağı bozuk bir
    // bağlantı gibi gösterirdi.
    return new ImageResponse(
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          background: BG,
          color: MUTED,
          fontSize: 48,
        }}
      >
        {brand.appName}
      </div>,
      { width: 1200, height: 630 },
    );
  }

  const settledLine =
    gazette.settled === 0
      ? `${gazette.headlines.length} iddia · sonuç bekleniyor`
      : `Sonuçlanan ${gazette.settled} manşetten ${gazette.hits} tanesi tuttu`;

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: BG,
        color: INK,
        padding: 64,
        fontFamily: 'sans-serif',
      }}
    >
      {/* Künye */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `4px solid ${INK}`,
          paddingBottom: 20,
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, fontWeight: 800, letterSpacing: 6 }}>
          {brand.appName.toUpperCase()} · GELECEK GAZETESİ
        </div>
        <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>{gazette.publishedDay}</div>
      </div>

      {/* Başlık */}
      <div
        style={{
          display: 'flex',
          fontSize: gazette.title.length > 40 ? 60 : 76,
          fontWeight: 900,
          lineHeight: 1.1,
          marginTop: 28,
        }}
      >
        {gazette.title}
      </div>

      <div style={{ display: 'flex', fontSize: 26, color: MUTED, marginTop: 12 }}>
        @{gazette.ownerUsername} yazdı
      </div>

      {/* Manşetler — en çok üç satır, taşarsa kısaltılır */}
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 28, gap: 14 }}>
        {gazette.headlines.slice(0, 3).map((h, i) => (
          <div key={h.slot} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', fontSize: 34, fontWeight: 900, color: MUTED }}>
              {i + 1}
            </div>
            <div style={{ display: 'flex', fontSize: 34, fontWeight: 700 }}>
              {h.outcomeLabel.length > 42 ? `${h.outcomeLabel.slice(0, 40)}…` : h.outcomeLabel}
            </div>
          </div>
        ))}
      </div>

      {/* Alt şerit: karne + TAHMİN uyarısı */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'auto',
          borderTop: `2px solid ${MUTED}`,
          paddingTop: 20,
        }}
      >
        <div style={{ display: 'flex', fontSize: 26, color: BRAND, fontWeight: 700 }}>
          {settledLine}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 3,
            color: BG,
            background: MUTED,
            padding: '8px 18px',
            borderRadius: 8,
          }}
        >
          TAHMİN — HABER DEĞİL
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: {
        // Kısa önbellek: sonuç geldiğinde önizleme çok gecikmeden güncellensin,
        // ama her paylaşım tıklaması yeniden çizim tetiklemesin.
        'cache-control': 'public, max-age=300, s-maxage=300',
      },
    },
  );
}
