import type { Metadata } from 'next';
import Link from 'next/link';
import { verifyEmailAction } from '@/features/auth/actions';

export const metadata: Metadata = {
  title: 'E-posta Doğrulama',
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = token ? await verifyEmailAction(token) : null;

  return (
    <>
      <h1 className="text-ink text-xl font-semibold">E-posta Doğrulama</h1>
      {result?.status === 'success' ? (
        <p role="status" className="text-correct mt-3 text-sm">
          {result.message}
        </p>
      ) : (
        <p role="alert" className="text-incorrect mt-3 text-sm">
          {result && result.status === 'error' ? result.message : 'Doğrulama bağlantısı geçersiz.'}
        </p>
      )}
      <p className="mt-5 text-sm">
        <Link href="/login" className="text-brand underline">
          Giriş yap
        </Link>
      </p>
    </>
  );
}
