'use client';

import { useState } from 'react';

/**
 * Genel amaçlı sekme bileşeni — mobilde yatay kaydırılabilir.
 *
 * İçerik sunucuda üretilip `panels` içinde hazır gelir; sekme değişimi ağ
 * isteği yapmaz. Böylece kullanıcı sekmeler arasında anında geçer.
 */
export function Tabs({
  label,
  panels,
}: {
  readonly label: string;
  readonly panels: readonly { readonly key: string; readonly content: React.ReactNode }[];
}) {
  const first = panels[0]?.key ?? '';
  const [active, setActive] = useState(first);
  const current = panels.find((p) => p.key === active) ?? panels[0];

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="border-border -mx-4 flex gap-1 overflow-x-auto border-b px-4"
      >
        {panels.map((p) => (
          <button
            key={p.key}
            role="tab"
            type="button"
            aria-selected={active === p.key}
            onClick={() => setActive(p.key)}
            className={[
              'min-h-12 shrink-0 border-b-2 px-3 text-sm font-semibold whitespace-nowrap',
              active === p.key ? 'border-brand text-brand' : 'text-muted border-transparent',
            ].join(' ')}
          >
            {p.key}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-4">
        {current?.content}
      </div>
    </div>
  );
}
