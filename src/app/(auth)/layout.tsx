import Link from 'next/link';
import { brand } from '@/config';

export default function AuthLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <Link href="/" className="text-ink text-2xl font-bold tracking-tight">
        {brand.appName}
      </Link>
      <div className="bg-surface border-border mt-6 rounded-lg border p-6">{children}</div>
    </main>
  );
}
