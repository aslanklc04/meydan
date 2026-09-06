'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markNotificationsReadAction } from '../actions';

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markNotificationsReadAction();
          router.refresh();
        })
      }
      className="border-border text-muted min-h-10 rounded-lg border px-3 text-xs disabled:opacity-60"
    >
      Tümünü okundu say
    </button>
  );
}
