/**
 * Yönetim tablosu — sunucu bileşeni.
 *
 * Mobilde yatay kaydırılır; sayfa gövdesi asla yatay kaymaz.
 */
export function DataTable({
  headers,
  rows,
  empty,
}: {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly React.ReactNode[])[];
  readonly empty: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="border-border rounded-xl border border-dashed p-6 text-center text-sm">
        {empty}
      </p>
    );
  }

  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="text-muted px-3 py-2 text-xs whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-border border-t">
              {row.map((cell, j) => (
                <td key={j} className="text-ink px-3 py-2 align-middle">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
