'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Kısa bildirim katmanı — ürün kuralı 32.
 *
 * NEDEN GEREKLİ (E2E'de yakalandı): başarı mesajını işlemi tetikleyen kartın
 * İÇİNDE göstermek işe yaramıyor. Server Action sonrası sayfa yeniden render
 * ediliyor; kabul edilen Meydan Okuma listeden düştüğü için kart tamamen
 * kayboluyor ve kullanıcı ne olduğunu HİÇ göremiyor.
 *
 * Bu sağlayıcı LAYOUT içinde durur. Layout, sayfa içeriği tazelenirken yerinde
 * kaldığından mesaj hayatta kalır. Hata mesajları ise kartın içinde kalır —
 * hata durumunda kart zaten kaybolmaz.
 */

type Tone = 'success' | 'error';
type ToastState = { readonly message: string; readonly tone: Tone } | null;

type ToastApi = {
  readonly show: (message: string, tone?: Tone) => void;
  readonly dismiss: () => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast, ToastProvider içinde kullanılmalı.');
  return api;
}

export function ToastProvider({ children }: { readonly children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);

  const show = useCallback((message: string, tone: Tone = 'success') => {
    setToast({ message, tone });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-20 flex justify-center px-4">
          <div
            role={toast.tone === 'success' ? 'status' : 'alert'}
            className={[
              'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl px-4 py-3 shadow-lg',
              toast.tone === 'success' ? 'bg-correct text-brand-fg' : 'bg-incorrect text-brand-fg',
            ].join(' ')}
          >
            <p className="flex-1 text-sm font-medium">{toast.message}</p>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Kapat"
              className="text-brand-fg shrink-0 text-sm font-bold underline"
            >
              Tamam
            </button>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
