import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * E2E kurulumunun üretim veritabanını silmesini engelleyen kilidin
 * yerinde olduğunu doğrular ve kararı örneklerle sabitler.
 */
const SOURCE = readFileSync(join(process.cwd(), 'tests/e2e/global-setup.ts'), 'utf8');

/** global-setup.ts içindeki kuralın birebir kopyası (davranış sözleşmesi). */
function safe(raw: string): boolean {
  const parsed = new URL(raw);
  const host = parsed.hostname.toLowerCase();
  const name = parsed.pathname.replace(/^\//, '').toLowerCase();
  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return localHost || name.endsWith('_test') || name.endsWith('_e2e');
}

describe('E2E emniyet kilidi', () => {
  it('kilit global-setup içinde çağrılıyor', () => {
    expect(SOURCE).toContain('assertSafeToTruncate(url)');
    expect(SOURCE).toContain('TRUNCATE');
  });

  it('yerel veritabanına İZİN verir', () => {
    expect(safe('postgresql://meydan:x@127.0.0.1:5432/meydan')).toBe(true);
    expect(safe('postgresql://meydan:x@localhost:5432/meydan_test')).toBe(true);
  });

  it('adı test olan uzak veritabanına İZİN verir', () => {
    expect(safe('postgresql://u:p@ep-abc.eu-central-1.aws.neon.tech/meydan_test')).toBe(true);
  });

  it('ÜRETİM veritabanını REDDEDER — asıl mesele bu', () => {
    expect(safe('postgresql://u:p@ep-abc.eu-central-1.aws.neon.tech/neondb')).toBe(false);
    expect(safe('postgresql://u:p@ep-abc.eu-central-1.aws.neon.tech/meydan')).toBe(false);
    expect(safe('postgresql://u:p@db.ornek.com:5432/production')).toBe(false);
  });
});
