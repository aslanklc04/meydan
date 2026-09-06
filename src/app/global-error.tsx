'use client';

/**
 * Kök hata sınırı — kendi <html> gövdesini basar.
 * Buraya düşen hata layout'un kendisinde oluşmuştur; bu yüzden tasarım
 * sistemine değil, satır içi stile güvenilir.
 */
export default function GlobalError({ reset }: { readonly reset: () => void }) {
  return (
    <html lang="tr">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          padding: '3rem 1rem',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '1.25rem' }}>Bir sorun oluştu.</h1>
        <p style={{ color: '#666', fontSize: '0.875rem' }}>
          Sayfayı yenilemek genelde yeterli oluyor.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: '1.5rem',
            minHeight: '3rem',
            padding: '0 1.5rem',
            borderRadius: '0.5rem',
            border: '1px solid #ccc',
            background: '#111',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: 600,
          }}
        >
          Tekrar dene
        </button>
      </body>
    </html>
  );
}
