// cron/ordersCron.js
'use strict';

const cron = require('node-cron');
const db = require('../database');

function startOrdersCron(syncDealerOrders) {
  cron.schedule('*/30 * * * *', async () => {
    console.log('[Siparişler Cron] Çalışıyor...');

    const dealers = db
      .prepare(
        `SELECT id, name, supplier_id, api_key, api_secret
         FROM dealers
         WHERE status = 'active'
           AND supplier_id IS NOT NULL AND supplier_id != ''
           AND api_key IS NOT NULL AND api_key != ''
           AND api_secret IS NOT NULL AND api_secret != ''`
      )
      .all();

    for (const dealer of dealers) {
      try {
        const result = await syncDealerOrders(dealer);
        if (result.synced > 0) {
          console.log(`[Siparişler Cron] Dealer ${dealer.id} (${dealer.name}): ${result.synced} sipariş sync edildi`);
        }
      } catch (e) {
        console.error(`[Siparişler Cron] Dealer ${dealer.id} hatası:`, e.message);
      }
    }
  });

  console.log('✅ Siparişler cron job başlatıldı (her 30 dakika).');
}

module.exports = startOrdersCron;
