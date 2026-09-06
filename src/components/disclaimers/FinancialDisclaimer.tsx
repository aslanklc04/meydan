import { financialDisclaimer } from '@/config';
import { cn } from '@/lib/utils';

/**
 * Finans ve kripto içeriklerinde ZORUNLU uyarı — Spesifikasyon Bölüm 9.6.
 *
 * Uyarı metninin tek kaynağı burasıdır. Geliştiricinin hatırlamasına bırakılmaz:
 * `Category.kind === 'FINANCIAL'` olan her yüzeyde bu bileşen render edilir.
 *
 * Yüzeyler:
 *   - Event kartı (akış, gündem, liste) ....... variant="inline"
 *   - Event detay sayfası (outcome'lardan ÖNCE) variant="full"
 *   - Tahmin oluşturma ekranı (butonun üstünde)  variant="inline"
 *   - Profilde finansal tahmin sekmesi ......... variant="inline"
 *   - Premium finansal içerik (açılmadan önce) . variant="full"
 */
type Props = {
  readonly variant?: 'inline' | 'full';
  readonly className?: string;
};

export function FinancialDisclaimer({ variant = 'inline', className }: Props) {
  if (variant === 'inline') {
    return (
      <p className={cn('text-muted text-xs leading-relaxed', className)}>
        <span aria-hidden="true">⚠️ </span>
        {financialDisclaimer.short}
      </p>
    );
  }

  return (
    <aside
      role="note"
      aria-label={financialDisclaimer.title}
      className={cn('bg-warning-bg border-brand rounded-md border-l-4 px-4 py-3', className)}
    >
      <p className="text-brand text-sm font-semibold">
        <span aria-hidden="true">⚠️ </span>
        {financialDisclaimer.title}
      </p>
      <p className="text-foreground mt-1 text-sm leading-relaxed">{financialDisclaimer.full}</p>
    </aside>
  );
}
