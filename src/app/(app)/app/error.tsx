'use client';

import { useEffect } from 'react';
import { ErrorScreen } from '@/components/feedback/ErrorScreen';

/**
 * Oturum içi hata sınırı. Teknik detay KULLANICIYA gösterilmez; yalnızca
 * tarayıcı konsoluna (ve sunucu tarafında yapılandırılmış günlüğe) düşer.
 */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] beklenmeyen hata', error.digest ?? error.message);
  }, [error]);

  return <ErrorScreen reset={reset} />;
}
