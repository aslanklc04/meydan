'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/feedback/Toast';
import type { FlowResult } from '@/features/events/actions';

/**
 * Yönetim eylemi düğmesi.
 *
 * Onay mesajı layout'taki bildirim katmanında gösterilir (ADR-20); ardından
 * `router.refresh()` ile liste tazelenir. Server Action içinde
 * `revalidatePath` ÇAĞRILMAZ — mesaj görülmeden kaybolurdu.
 */
export function ActionButton({
  label,
  action,
  confirm,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly action: () => Promise<FlowResult>;
  readonly confirm?: string;
  readonly tone?: 'neutral' | 'danger';
}) {
  const [pending, startTransition] = useTransition();
  const { show } = useToast();
  const router = useRouter();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        startTransition(async () => {
          const result = await action();
          show(result.message, result.ok ? 'success' : 'error');
          if (result.ok) router.refresh();
        });
      }}
      className={[
        'min-h-11 rounded-lg border px-3 text-sm font-semibold disabled:opacity-50',
        tone === 'danger' ? 'border-incorrect text-incorrect' : 'border-border text-ink',
      ].join(' ')}
    >
      {pending ? '…' : label}
    </button>
  );
}
