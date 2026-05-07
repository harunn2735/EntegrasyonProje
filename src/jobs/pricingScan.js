// src/jobs/pricingScan.js
// Saatte bir tüm bayilerin ürünlerini tarayarak fiyat önerileri üretir.
// Cron format: '0 * * * *' → her saatin başında çalışır.
// Hata durumunda sadece loglama yapar; süreç hiçbir zaman çökmez.
'use strict';

const cron          = require('node-cron');
const PricingEngine = require('../services/pricing/PricingEngine');

/**
 * Pricing cron job'ını başlatır.
 * @param {import('better-sqlite3').Database} db - Mevcut DB bağlantısı
 */
function startPricingCron(db) {
  const engine = new PricingEngine(db);

  // Her saatin başında çalış (0 * * * *)
  cron.schedule('0 * * * *', async () => {
    const startedAt = new Date().toISOString();
    console.log(`[Fiyatlandırma Cron] Tarama başladı — ${startedAt}`);

    try {
      // dealerId = null → tüm bayilerin aktif ürünleri taranır
      const { total, created, skipped, errors } = await engine.evaluateAllProducts(null);

      if (created > 0 || errors > 0) {
        console.log(
          `[Fiyatlandırma Cron] Tamamlandı — ` +
          `toplam: ${total}, yeni öneri: ${created}, atlandı: ${skipped}, hata: ${errors}`
        );
      }
    } catch (err) {
      // Beklenmedik kritik hata — sadece logla, cron durmasın
      console.error('[Fiyatlandırma Cron] Kritik hata:', err.message);
    }
  });

  console.log('✅ Fiyatlandırma cron job başlatıldı (saatte bir, 0 * * * *).');
}

module.exports = { startPricingCron };
