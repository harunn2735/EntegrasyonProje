// cron/xmlSyncCron.js
'use strict';

const cron = require('node-cron');
const db = require('../database');

function startXmlSyncCron(importXmlFeedById) {
  // Her 15 dakikada bir kontrol et; asıl import sıklığı dealer ayarına göre belirlenir
  cron.schedule('*/15 * * * *', async () => {
    const dealers = db
      .prepare(`SELECT id, name FROM dealers WHERE status = 'active'`)
      .all();

    for (const dealer of dealers) {
      // Bu bayi için ayarları oku
      const rows = db
        .prepare('SELECT key, value FROM dealer_settings WHERE dealer_id = ?')
        .all(dealer.id);
      const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));

      const enabled = settings.xml_sync_enabled !== '0';
      if (!enabled) continue;

      const intervalHours = Math.max(1, parseInt(settings.xml_sync_interval_hours || '6', 10));
      const intervalMs = intervalHours * 60 * 60 * 1000;

      // Bu bayinin aktif feed'lerini al
      const feeds = db
        .prepare(`SELECT id, name, last_imported FROM xml_feeds WHERE dealer_id = ? AND status = 'active'`)
        .all(dealer.id);

      for (const feed of feeds) {
        const lastImported = feed.last_imported ? new Date(feed.last_imported).getTime() : 0;
        const now = Date.now();

        if (now - lastImported < intervalMs) continue; // Henüz erken

        try {
          const result = await importXmlFeedById(dealer.id, feed.id);
          console.log(`[XML Sync Cron] Dealer ${dealer.id} (${dealer.name}), Feed "${feed.name}": ${result.count} ürün güncellendi`);
        } catch (e) {
          console.error(`[XML Sync Cron] Dealer ${dealer.id}, Feed ${feed.id} hatası:`, e.message);
        }
      }
    }
  });

  console.log('✅ XML Sync cron job başlatıldı (her 15 dakikada kontrol eder).');
}

module.exports = startXmlSyncCron;
