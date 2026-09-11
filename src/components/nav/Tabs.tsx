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
  readonly panels: readonly {
    readonly key: string;
    /** Sekmedeki öğe sayısı — verilirse rozette gösterilir. */
    readonly count?: number;
    readonly content: React.ReactNode;
  }[];
}) {
  /*
   * ── AÇILIŞTA DOLU SEKME SEÇİLİR ───────────────────────────────────────
   *
   * Ekran her zaman ilk sekmeyle açılıyordu. Canlıda şu görüldü: kullanıcının
   * gönderdiği bir Meydan Okuma ve süren bir tanesi varken ekran "Sana gelen
   * bir Meydan Okuma yok." diyerek açılıyordu. Doğru bilgi, yanlış izlenim:
   * kullanıcı hiçbir şeyi olmadığını sanıyor ve diğer sekmelere bakmıyor.
   *
   * Sayılar da sekmenin üstünde yazıyor; hangi sekmede ne olduğu tek bakışta
   * görülüyor ve kullanıcı aramak zorunda kalmıyor.
   */
  const ilkDolu = panels.find((p) => (p.count ?? 0) > 0)?.key;
  const [active, setActive] = useState(ilkDolu ?? panels[0]?.key ?? '');
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
            {(p.count ?? 0) > 0 && (
              <span
                className={[
                  'ml-1.5 inline-block rounded-full px-1.5 text-xs font-bold',
                  active === p.key ? 'bg-brand text-brand-fg' : 'bg-surface text-muted',
                ].join(' ')}
              >
                {p.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-4">
        {current?.content}
      </div>
    </div>
  );
}
