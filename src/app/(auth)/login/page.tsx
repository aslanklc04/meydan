import type { Metadata } from 'next';
import Link from 'next/link';
import { loginAction } from '@/features/auth/actions';
import { AuthForm, Field } from '@/features/auth/components/AuthForm';
import { safeNext } from '@/features/auth/safe-next';

export const metadata: Metadata = { title: 'Giriş Yap', robots: { index: false, follow: false } };

/**
 * `next`: kullanıcının GELDİĞİ yer. Gizli alanla forma taşınır ve giriş
 * başarılı olunca oraya dönülür. Değer `safeNext` ile süzülür — süzülmeseydi
 * bu parametre açık yönlendirme açığı olurdu.
 */
export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeNext(next);

  return (
    <>
      <h1 className="text-ink text-xl font-semibold">Giriş Yap</h1>
      <p className="text-muted mt-1 mb-5 text-sm">Meydana geri dön.</p>

      <AuthForm action={loginAction} submitLabel="Giriş Yap">
        <input type="hidden" name="next" value={target} />
        <Field label="E-posta" name="email" type="email" autoComplete="email" />
        <Field label="Parola" name="password" type="password" autoComplete="current-password" />

        {/*
          BENİ HATIRLA — işaretsiz başlar.
          İşaretlenmezse oturum bir iş günü kadar sürer; ortak kullanılan bir
          bilgisayarda bir sonraki kişi hazır açılmış bir hesap bulmamalı.
          Kutunun ne yaptığı yanında yazılı: "beni hatırla" tek başına ne
          kadar süre olduğunu söylemez.
        */}
        <div className="flex items-start gap-2">
          <input id="field-remember" name="remember" type="checkbox" className="mt-1" />
          <label htmlFor="field-remember" className="text-muted text-sm">
            Beni hatırla
            <span className="block text-xs">
              İşaretlemezsen 12 saat sonra tekrar giriş istenir. Ortak bir bilgisayardaysan
              işaretleme.
            </span>
          </label>
        </div>
      </AuthForm>

      <div className="text-muted mt-5 space-y-1 text-sm">
        <p>
          <Link href="/forgot-password" className="text-brand underline">
            Parolamı unuttum
          </Link>
        </p>
        <p>
          Hesabın yok mu?{' '}
          <Link
            href={`/register?next=${encodeURIComponent(target)}`}
            className="text-brand underline"
          >
            Meydana katıl
          </Link>
        </p>
      </div>
    </>
  );
}
