import type { Metadata } from 'next';
import Link from 'next/link';
import { adminService } from '@/server/modules/governance/admin.service';
import { DataTable } from '@/features/admin/components/DataTable';
import { ActionButton } from '@/features/admin/components/ActionButton';
import { setUserStatusAction } from '@/features/admin/actions';

export const metadata: Metadata = {
  title: 'Kullanıcılar',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const statusLabel: Record<string, string> = {
  ACTIVE: 'Etkin',
  SUSPENDED: 'Askıda',
  PENDING_VERIFICATION: 'Doğrulama bekliyor',
  DELETED: 'Silinmiş',
};

export default async function AdminUsersPage() {
  const users = await adminService.listUsers();

  return (
    <main className="space-y-4">
      <h1 className="text-ink text-xl font-bold">Kullanıcılar</h1>

      {/*
        E-POSTA SÜTUNU — neden var.

        Kurucu kendi hesabının hangi adresle açıldığını hatırlayamadı ve
        arayüzde bunu gösteren hiçbir yer yoktu; iki farklı adres arasında
        tahmin yürütmek zorunda kaldık. Oysa değer veritabanında duruyordu
        ve zaten bu sorguyla okunuyordu — sadece ekrana basılmıyordu.

        Destek işinin de temel ihtiyacı budur: "giriş yapamıyorum" diyen bir
        kullanıcının hangi adresle kayıtlı olduğunu görebilmek.
      */}
      <DataTable
        headers={['Kullanıcı', 'E-posta', 'Rol', 'Durum', 'Katılım', 'Eylem']}
        empty="Kullanıcı yok."
        rows={users.map((u) => [
          <Link key="u" href={`/u/${u.username}`} className="text-brand underline">
            @{u.username}
          </Link>,
          <span key="e" className="text-muted break-all">
            {u.email}
          </span>,
          u.role,
          statusLabel[u.status] ?? u.status,
          u.createdAt.toLocaleDateString('tr-TR'),
          u.status === 'DELETED' ? (
            '—'
          ) : u.status === 'SUSPENDED' ? (
            <ActionButton
              key="a"
              label="Askıyı kaldır"
              action={setUserStatusAction.bind(null, u.id, 'ACTIVE')}
            />
          ) : (
            <ActionButton
              key="a"
              label="Askıya al"
              tone="danger"
              confirm={`@${u.username} askıya alınacak. Onaylıyor musun?`}
              action={setUserStatusAction.bind(null, u.id, 'SUSPENDED')}
            />
          ),
        ])}
      />
    </main>
  );
}
