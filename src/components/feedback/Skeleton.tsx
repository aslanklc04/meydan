/**
 * Yükleme iskeleti.
 *
 * Neden dönen bir çark değil: iskelet, gelecek içeriğin ŞEKLİNİ gösterir;
 * kullanıcı bekleme süresini daha kısa algılar ve sayfa yerleşimi içerik
 * gelince zıplamaz.
 *
 * `aria-hidden`: ekran okuyucu için anlamsız kutular okunmaz; durumu
 * kapsayıcıdaki `role="status"` duyurur.
 */
export function SkeletonCard() {
  return (
    <div aria-hidden="true" className="border-border animate-pulse rounded-xl border p-4">
      <div className="bg-surface h-3 w-24 rounded" />
      <div className="bg-surface mt-3 h-5 w-3/4 rounded" />
      <div className="bg-surface mt-2 h-4 w-1/2 rounded" />
      <div className="mt-4 space-y-2">
        <div className="bg-surface h-12 w-full rounded-lg" />
        <div className="bg-surface h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div aria-hidden="true" className="border-border animate-pulse rounded-lg border px-3 py-4">
      <div className="bg-surface h-4 w-2/3 rounded" />
      <div className="bg-surface mt-2 h-3 w-1/3 rounded" />
    </div>
  );
}

/** Sayfa düzeyinde yükleme — birkaç kart iskeleti. */
export function PageLoading({ label = 'Yükleniyor…' }: { readonly label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonRow />
    </div>
  );
}
