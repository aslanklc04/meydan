'use client';

import { useActionState, useState } from 'react';
import { createGazetteAction, type GazetteState } from '../actions';

export type ComposerItem = {
  readonly predictionId: string;
  readonly eventTitle: string;
  readonly question: string;
  readonly outcomeLabel: string;
  readonly outcomeImageUrl: string | null;
  readonly closesLabel: string;
};

const MAX = 3;
const initialState: GazetteState = { status: 'idle' };

/**
 * GAZETE KURMA EKRANI.
 *
 * ── SEÇİM İSTEMCİDE, KURAL SUNUCUDA ────────────────────────────────────────
 * Buradaki "en çok üç" sınırı bir KOLAYLIKTIR: kullanıcı dördüncüyü seçip
 * gönderdikten sonra reddedilmesin diye. Kuralın kendisi sunucuda ve
 * veritabanında durur. İstemcideki sayaç kapatılabilir, atlanabilir, tarayıcı
 * eklentisiyle değiştirilebilir; oradaki kısıt bir güvenlik önlemi değildir
 * ve öyleymiş gibi davranılmaz.
 *
 * ── NEDEN GERİ ALINAMAZ UYARISI VAR ────────────────────────────────────────
 * Kullanıcı burada verdiği kararı sonradan değiştiremeyecek. Bunu gönderdikten
 * SONRA öğrenmesi, ürünün ona tuzak kurması olurdu. Kilit anlamlı olsun diye
 * kilidin ne olduğu önceden ve açıkça yazılır.
 */
export function GazetteComposer({ items }: { readonly items: readonly ComposerItem[] }) {
  const [state, formAction, pending] = useActionState(createGazetteAction, initialState);
  const [picked, setPicked] = useState<readonly string[]>([]);

  function toggle(id: string) {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length >= MAX
          ? current
          : [...current, id],
    );
  }

  const full = picked.length >= MAX;

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <label htmlFor="gazette-title" className="text-ink block text-sm font-semibold">
          Kapak başlığı
        </label>
        <input
          id="gazette-title"
          name="title"
          type="text"
          maxLength={70}
          required
          placeholder="Bu hafta böyle biteceğini düşünüyorum"
          className="border-border bg-background text-ink focus-visible:outline-ink mt-1.5 w-full rounded-lg border px-3 py-2.5 text-base focus-visible:outline-2"
        />
        <p className="text-muted mt-1 text-xs">En çok 70 karakter.</p>
      </div>

      <fieldset>
        <legend className="text-ink text-sm font-semibold">
          Manşetlerini seç ({picked.length}/{MAX})
        </legend>
        <p className="text-muted mt-1 mb-3 text-xs">
          Yalnızca kapanmamış tahminlerini koyabilirsin. Sonucu belli olan bir tahmin gazeteye
          giremez — gazete geleceği anlatır.
        </p>

        <ul className="space-y-2">
          {items.map((item) => {
            const checked = picked.includes(item.predictionId);
            const disabled = !checked && full;
            return (
              <li key={item.predictionId}>
                <label
                  className={`border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    checked ? 'border-brand bg-surface' : ''
                  } ${disabled ? 'opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    name="predictionIds"
                    value={item.predictionId}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(item.predictionId)}
                    className="mt-1.5"
                  />
                  {item.outcomeImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.outcomeImageUrl}
                      alt=""
                      aria-hidden="true"
                      width={32}
                      height={32}
                      loading="lazy"
                      className="mt-0.5 h-8 w-8 shrink-0 object-contain"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="text-muted block text-xs">{item.eventTitle}</span>
                    <span className="text-ink block text-sm font-bold">
                      &laquo;{item.outcomeLabel}&raquo;
                    </span>
                    <span className="text-muted block text-xs">{item.closesLabel}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {/*
        GÖRÜNÜRLÜK TERCİHİ — kutu BOŞ başlar.
        Serbest yazılmış bir başlığı kullanıcının açık tercihi olmadan
        herkesin ana sayfasına koymak, ona sormadan adına karar vermektir.
        Önceden işaretlenmiş bir kutu, sorulmuş sayılmaz.
      */}
      <div className="border-border rounded-lg border p-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" name="isPublic" value="true" className="mt-1" />
          <span className="min-w-0">
            <span className="text-ink block text-sm font-semibold">
              Ana sayfadaki raflarda da görünsün
            </span>
            <span className="text-muted mt-0.5 block text-xs">
              İşaretlemezsen kapağın yine kurulur ve bağlantısını istediğine gönderebilirsin —
              sadece sitede listelenmez. İşaretlersen başlığın ve manşetlerin MEYDAN&apos;a giren
              herkese görünür.
            </span>
            <span className="text-muted mt-1 block text-xs">
              Raftan sonradan çekebilirsin, ama geri koyamazsın.
            </span>
          </span>
        </label>
      </div>

      {/* Kilit uyarısı GÖNDERMEDEN ÖNCE. */}
      <p className="border-border text-muted rounded-lg border border-dashed px-3 py-2 text-xs">
        <span aria-hidden="true">🔒 </span>
        Manşetler birlikte kilitlenir. Kapak kurulduktan sonra hiçbir manşet çıkarılamaz ve aynı
        tahmin ikinci bir kapağa konamaz — tutmayan manşet de kapakta kalır. Gazetenin
        inandırıcılığı buna dayanır.
      </p>

      {state.status === 'error' && (
        <p role="alert" className="text-incorrect text-sm">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || picked.length === 0}
        className="bg-brand text-brand-fg focus-visible:outline-ink min-h-11 w-full rounded-lg px-4 font-bold disabled:opacity-50"
      >
        {pending ? 'Kuruluyor…' : 'Gazeteyi kur ve kilitle'}
      </button>
    </form>
  );
}
