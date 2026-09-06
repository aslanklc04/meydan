import type { Metadata } from 'next';
import Link from 'next/link';
import { loginAction } from '@/features/auth/actions';
import { AuthForm, Field } from '@/features/auth/components/AuthForm';

export const metadata: Metadata = { title: 'Giriş Yap', robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-ink text-xl font-semibold">Giriş Yap</h1>
      <p className="text-muted mt-1 mb-5 text-sm">Meydana geri dön.</p>

      <AuthForm action={loginAction} submitLabel="Giriş Yap">
        <Field label="E-posta" name="email" type="email" autoComplete="email" />
        <Field label="Parola" name="password" type="password" autoComplete="current-password" />
      </AuthForm>

      <div className="text-muted mt-5 space-y-1 text-sm">
        <p>
          <Link href="/forgot-password" className="text-brand underline">
            Parolamı unuttum
          </Link>
        </p>
        <p>
          Hesabın yok mu?{' '}
          <Link href="/register" className="text-brand underline">
            Meydana katıl
          </Link>
        </p>
      </div>
    </>
  );
}
