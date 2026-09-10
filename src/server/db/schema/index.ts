/**
 * Şema barrel. Her bounded context kendi dosyasında tanımlanır.
 *
 * Faz 2: identity
 * Faz 3: catalog · prediction · challenge · economy · reputation
 * Faz 4: social (takip, bildirim, akış, moderasyon) · ranking (sezon, liderlik, rozet)
 * Faz 5: governance (ilgi alanları, denetim kaydı)
 * Faz 8: gazette (Gelecek Gazetesi — paylaşılabilir tahmin kapağı)
 */
export * from './identity';
export * from './catalog';
export * from './prediction';
export * from './challenge';
export * from './economy';
export * from './reputation';
export * from './social';
export * from './ranking';
export * from './governance';
export * from './gazette';
