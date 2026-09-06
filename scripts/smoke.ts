/**
 * ÜRETİM DUMAN TESTİ — `npm run smoke -- --url https://…`
 *
 * Dağıtımdan hemen sonra "ayakta mı?" sorusunu gerçek HTTP ile yanıtlar.
 * Tarayıcı gerekmez, veri YAZMAZ; bu yüzden production'da güvenle
 * çalıştırılabilir. Tam çekirdek döngü (kayıt → tahmin → Meydan Okuma →
 * kabul → sonuç) Playwright ile ayrıca koşulur — bkz. docs/deployment.md §5.
 *
 * ÇIKIŞ KODU: herhangi bir kontrol düşerse 1. CI/dağıtım hattı bunu görür.
 */

type Check = {
  readonly name: string;
  readonly run: () => Promise<void>;
};

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const baseUrl = (
  urlIndex >= 0 ? args[urlIndex + 1] : (process.env.APP_URL ?? 'http://127.0.0.1:3000')
)?.replace(/\/$/, '');

if (!baseUrl) {
  console.error('Kullanım: npm run smoke -- --url https://meydan.example');
  process.exit(1);
}

const TIMEOUT_MS = 15_000;

async function get(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'meydan-smoke/1.0', ...(init.headers ?? {}) },
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectOk(path: string, mustContain?: string): Promise<string> {
  const response = await get(path);
  assert(response.ok, `${path} → HTTP ${response.status}`);
  const body = await response.text();
  if (mustContain) {
    assert(body.includes(mustContain), `${path} içinde "${mustContain}" bulunamadı`);
  }
  return body;
}

const checks: Check[] = [
  {
    name: 'ana sayfa açılıyor',
    run: async () => {
      const body = await expectOk('/');
      assert(body.includes('<html'), 'ana sayfa HTML döndürmedi');
    },
  },
  {
    name: 'sayfa dili Türkçe',
    run: async () => {
      const body = await expectOk('/');
      assert(/<html[^>]+lang="tr"/.test(body), 'lang="tr" yok');
    },
  },
  {
    name: 'giriş ve kayıt sayfaları açılıyor',
    run: async () => {
      await expectOk('/login');
      await expectOk('/register');
    },
  },
  {
    name: 'Tahmin Gücü açıklaması herkese açık',
    run: async () => {
      await expectOk('/tahmin-gucu', 'Tahmin Gücü');
    },
  },
  {
    name: 'robots.txt üretiliyor ve /app kapalı',
    run: async () => {
      const body = await expectOk('/robots.txt');
      assert(body.includes('Disallow'), 'robots.txt Disallow içermiyor');
      assert(body.includes('/app/'), 'oturum içi rotalar indekslemeye kapatılmamış');
    },
  },
  {
    name: 'sitemap.xml üretiliyor',
    run: async () => {
      const body = await expectOk('/sitemap.xml');
      assert(body.includes('<urlset'), 'sitemap geçerli değil');
      assert(body.includes(baseUrl), `sitemap ${baseUrl} adresini içermiyor (APP_URL yanlış?)`);
    },
  },
  {
    name: 'KORUMALI rota giriş istiyor',
    run: async () => {
      const response = await get('/app/feed');
      // Middleware oturumsuz isteği /login'e yönlendirir.
      assert(
        response.status === 307 || response.status === 302,
        `/app/feed korunmuyor → HTTP ${response.status}`,
      );
      const location = response.headers.get('location') ?? '';
      assert(location.includes('/login'), `beklenmeyen yönlendirme: ${location}`);
    },
  },
  {
    name: 'YÖNETİM rotası giriş istiyor',
    run: async () => {
      const response = await get('/admin');
      assert(
        response.status === 307 || response.status === 302,
        `/admin korunmuyor → HTTP ${response.status}`,
      );
    },
  },
  {
    name: 'bakım ucu YETKİSİZ isteği reddediyor',
    run: async () => {
      const response = await get('/api/cron/jobs', {
        method: 'POST',
        headers: { authorization: 'Bearer yanlis-sir' },
      });
      assert(response.status === 401, `cron ucu korunmuyor → HTTP ${response.status}`);
    },
  },
  {
    name: 'bilinmeyen adres 404 veriyor (teknik hata sızmıyor)',
    run: async () => {
      const response = await get('/boyle-bir-sayfa-yok');
      assert(response.status === 404, `beklenen 404, gelen ${response.status}`);
      const body = await response.text();
      for (const leak of ['DrizzleError', 'PostgresError', 'at Object.', 'node_modules']) {
        assert(!body.includes(leak), `404 sayfasında teknik detay sızıyor: ${leak}`);
      }
    },
  },
];

async function main() {
  console.log(`MEYDAN duman testi → ${baseUrl}\n`);

  let failed = 0;
  for (const check of checks) {
    const startedAt = Date.now();
    try {
      await check.run();
      console.log(`  ✓ ${check.name} (${Date.now() - startedAt} ms)`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${check.name} — ${message}`);
    }
  }

  console.log(`\n${checks.length - failed}/${checks.length} kontrol geçti.`);
  if (failed > 0) {
    console.error('DUMAN TESTİ BAŞARISIZ — dağıtımı geri almayı değerlendir.');
    process.exit(1);
  }
  console.log('Duman testi geçti.');
}

main().catch((error) => {
  console.error('Duman testi çalıştırılamadı:', error);
  process.exit(1);
});
