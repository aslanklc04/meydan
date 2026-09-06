'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleFollowAction } from '@/features/social/actions';

/** Takip Et / Takibi Bırak — tek dokunuş, iyimser geri bildirim. */
export function FollowButton({
  username,
  initiallyFollowing,
}: {
  readonly username: string;
  readonly initiallyFollowing: boolean;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initiallyFollowing);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await toggleFollowAction(username, following);
            if (result.ok) {
              setFollowing(!following);
              router.refresh();
            } else {
              setError(result.message);
            }
          });
        }}
        className={[
          'min-h-12 w-full rounded-lg px-4 text-base font-semibold disabled:opacity-60',
          following ? 'border-border text-ink border' : 'bg-brand text-brand-fg',
        ].join(' ')}
      >
        {following ? 'Takibi Bırak' : 'Takip Et'}
      </button>
      {error && (
        <p role="alert" className="text-incorrect mt-2 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
