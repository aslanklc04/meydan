import Link from 'next/link';

/**
 * Boş durum — Faz 5.
 *
 * KURAL: hiçbir boş bölüm yalnızca "yok" demez. Her boş durum üç şey söyler:
 *   1. ne olmadığını,
 *   2. neden olmadığını ya da nasıl dolacağını,
 *   3. şimdi ne yapılabileceğini (tek bir eylem).
 *
 * Boş ekran, yeni kullanıcının ürünü terk etmesinin en yaygın sebebidir; bu
 * yüzden boş durum tasarımı bir "detay" değil, ürünün kendisidir.
 */
export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  readonly title: string;
  readonly hint: string;
  readonly action?: { readonly href: string; readonly label: string };
  readonly icon?: string;
}) {
  return (
    <div className="border-border rounded-xl border border-dashed p-6 text-center">
      {icon && (
        <p aria-hidden="true" className="text-3xl">
          {icon}
        </p>
      )}
      <p className="text-ink mt-1 text-base font-semibold">{title}</p>
      <p className="text-muted mt-1 text-sm">{hint}</p>
      {action && (
        <Link
          href={action.href}
          className="bg-brand text-brand-fg focus-visible:outline-ink mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-lg px-4 text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-auto"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
