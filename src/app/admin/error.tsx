'use client';

import { useEffect } from 'react';
import { ErrorScreen } from '@/components/feedback/ErrorScreen';

export default function AdminError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error('[admin] beklenmeyen hata', error.digest ?? error.message);
  }, [error]);

  return (
    <ErrorScreen
      reset={reset}
      title="Yönetim ekranı yüklenemedi."
      hint="Tekrar dene. Sorun sürerse veritabanı bağlantısını kontrol et."
    />
  );
}
