// cron/questionsCron.js
'use strict';

const cron = require('node-cron');
const db = require('../database');
const { fetchAndSaveQuestions } = require('../routes/questions');

function startQuestionsCron() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY tanımlı değil — sorular cron job başlatılmadı.');
    return;
  }

  cron.schedule('*/15 * * * *', async () => {
    console.log('[Sorular Cron] Çalışıyor...');

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
        const result = await fetchAndSaveQuestions(dealer);
        if (result.saved > 0) {
          console.log(`[Sorular Cron] Dealer ${dealer.id} (${dealer.name}): ${result.saved} yeni soru kaydedildi`);
        }
      } catch (e) {
        console.error(`[Sorular Cron] Dealer ${dealer.id} hatası:`, e.message);
      }
    }
  });

  console.log('✅ Sorular cron job başlatıldı (her 15 dakika).');
}

module.exports = startQuestionsCron;
