import type { Metadata } from 'next';
import { requestPasswordResetAction } from '@/features/auth/actions';
import { AuthForm, Field } from '@/features/auth/components/AuthForm';

export const metadata: Metadata = {
  title: 'Parolamı Unuttum',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-ink text-xl font-semibold">Parolamı Unuttum</h1>
      <p className="text-muted mt-1 mb-5 text-sm">
        E-posta adresini gir; kayıtlıysa sıfırlama bağlantısı gönderelim.
      </p>
      <AuthForm action={requestPasswordResetAction} submitLabel="Bağlantı Gönder">
        <Field label="E-posta" name="email" type="email" autoComplete="email" />
      </AuthForm>
    </>
  );
}
