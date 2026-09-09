import type { Metadata } from 'next';
import Link from 'next/link';
import { registerAction } from '@/features/auth/actions';
import { AuthForm, Field } from '@/features/auth/components/AuthForm';
import { brand } from '@/config';
import { safeNext } from '@/features/auth/safe-next';

export const metadata: Metadata = {
  title: 'Meydana Katıl',
  robots: { index: false, follow: false },
};

/**
 * Kayıt, kullanıcıyı oturum açmış hâle GETİRMEZ; kaydolan kişi ardından giriş
 * yapar. Bu yüzden `next` burada tüketilmez, GİRİŞ SAYFASINA taşınır —
 * niyet zincirin sonuna kadar korunmalı, yoksa iki adım sonra kaybolur.
 */
export default async function RegisterPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeNext(next);

  return (
    <>
      <h1 className="text-ink text-xl font-semibold">Meydana Katıl</h1>
      <p className="text-muted mt-1 mb-5 text-sm">{brand.tagline}</p>

      <AuthForm action={registerAction} submitLabel="Meydana Katıl">
        <Field
          label="Kullanıcı adı"
          name="username"
          autoComplete="username"
          hint="3-20 karakter; harf, rakam ve alt çizgi."
        />
        <Field label="E-posta" name="email" type="email" autoComplete="email" />
        <Field
          label="Parola"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="En az 10 karakter. Uzunluk, karmaşıklıktan daha güvenli."
        />
        <div className="flex items-start gap-2">
          <input
            id="field-acceptTerms"
            name="acceptTerms"
            type="checkbox"
            required
            className="mt-1"
          />
          <label htmlFor="field-acceptTerms" className="text-muted text-sm">
            <Link href="/legal/terms" className="text-brand underline">
              Kullanım koşullarını
            </Link>{' '}
            ve{' '}
            <Link href="/legal/privacy" className="text-brand underline">
              gizlilik politikasını
            </Link>{' '}
            kabul ediyorum.
          </label>
        </div>
      </AuthForm>

      <p className="text-muted mt-5 text-sm">
        Zaten hesabın var mı?{' '}
        <Link href={`/login?next=${encodeURIComponent(target)}`} className="text-brand underline">
          Giriş yap
        </Link>
      </p>
    </>
  );
}
