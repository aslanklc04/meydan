import type { Metadata } from 'next';
import { resetPasswordAction } from '@/features/auth/actions';
import { AuthForm, Field } from '@/features/auth/components/AuthForm';

export const metadata: Metadata = {
  title: 'Yeni Parola',
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <p className="text-incorrect text-sm">Sıfırlama bağlantısı geçersiz.</p>;
  }

  return (
    <>
      <h1 className="text-ink text-xl font-semibold">Yeni Parola</h1>
      <p className="text-muted mt-1 mb-5 text-sm">
        Parolan değişince tüm cihazlardaki oturumların kapatılır.
      </p>
      <AuthForm action={resetPasswordAction} submitLabel="Parolayı Güncelle">
        <input type="hidden" name="token" value={token} />
        <Field label="Yeni parola" name="password" type="password" autoComplete="new-password" />
      </AuthForm>
    </>
  );
}
