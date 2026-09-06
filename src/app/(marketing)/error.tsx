'use client';

import { useEffect } from 'react';
import { ErrorScreen } from '@/components/feedback/ErrorScreen';

export default function MarketingError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error('[public] beklenmeyen hata', error.digest ?? error.message);
  }, [error]);

  return <ErrorScreen reset={reset} />;
}
