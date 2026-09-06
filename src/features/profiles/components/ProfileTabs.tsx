'use client';

import { useState } from 'react';

const TABS = ['GENEL', 'TAHMİNLER', 'MEYDAN OKUMALAR', 'BAŞARILAR', 'UZMANLIK'] as const;
type Tab = (typeof TABS)[number];

/** Profil sekmeleri — mobilde yatay kaydırılabilir. */
export function ProfileTabs({
  general,
  predictions,
  challenges,
  badges,
  expertise,
}: Record<'general' | 'predictions' | 'challenges' | 'badges' | 'expertise', React.ReactNode>) {
  const [active, setActive] = useState<Tab>('GENEL');

  const content: Record<Tab, React.ReactNode> = {
    GENEL: general,
    TAHMİNLER: predictions,
    'MEYDAN OKUMALAR': challenges,
    BAŞARILAR: badges,
    UZMANLIK: expertise,
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Profil bölümleri"
        className="border-border -mx-4 flex gap-1 overflow-x-auto border-b px-4"
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={active === tab}
            onClick={() => setActive(tab)}
            className={[
              'min-h-12 shrink-0 border-b-2 px-3 text-sm font-semibold whitespace-nowrap',
              active === tab ? 'border-brand text-brand' : 'text-muted border-transparent',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-4">
        {content[active]}
      </div>
    </div>
  );
}
