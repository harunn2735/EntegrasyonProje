// cron/autoAnswerCron.js
'use strict';

const cron = require('node-cron');
const axios = require('axios');
const db = require('../database');
const { fetchAndSaveQuestions } = require('../routes/questions');

function trendyolHeaders(dealer) {
  const auth = Buffer.from(`${dealer.api_key}:${dealer.api_secret}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'User-Agent': `${dealer.supplier_id} - SelfIntegration`,
    'Content-Type': 'application/json',
  };
}

function startAutoAnswerCron() {
  cron.schedule('0 * * * *', async () => {
    console.log('[OtomatikCevap Cron] Çalışıyor...');

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
        // 1. Bekleyen soruları Trendyol'dan çek ve DB'ye kaydet
        const fetchResult = await fetchAndSaveQuestions(dealer);
        if (fetchResult.saved > 0) {
          console.log(`[OtomatikCevap Cron] Dealer ${dealer.id} (${dealer.name}): ${fetchResult.saved} yeni soru kaydedildi`);
        }

        // 2. DB'deki pending soruları Trendyol'a gönder
        const pendingQuestions = db
          .prepare(
            `SELECT * FROM questions
             WHERE dealer_id = ? AND status = 'pending'
               AND ai_answer IS NOT NULL AND TRIM(ai_answer) != ''`
          )
          .all(dealer.id);

        let sent = 0;
        for (const question of pendingQuestions) {
          try {
            await axios.post(
              `https://apigw.trendyol.com/integration/qna/sellers/${dealer.supplier_id}/questions/${question.question_id}/answers`,
              { text: question.ai_answer.trim() },
              { headers: trendyolHeaders(dealer), timeout: 8000 }
            );
            db.prepare("UPDATE questions SET status = 'sent', sent_at = datetime('now') WHERE id = ?")
              .run(question.id);
            sent++;
          } catch (e) {
            const errorKey = e.response?.data?.errors?.[0]?.key || '';
            if (errorKey === 'business.rule.question.has.already.answered') {
              db.prepare("UPDATE questions SET status = 'sent', sent_at = datetime('now') WHERE id = ?")
                .run(question.id);
              sent++;
            } else {
              console.error(`[OtomatikCevap Cron] Soru ${question.id} gönderilemedi:`, e.message);
            }
          }
        }

        if (sent > 0) {
          console.log(`[OtomatikCevap Cron] Dealer ${dealer.id} (${dealer.name}): ${sent} soru Trendyol'a gönderildi`);
        }
      } catch (e) {
        console.error(`[OtomatikCevap Cron] Dealer ${dealer.id} hatası:`, e.message);
      }
    }
  });

  console.log('✅ Otomatik cevap cron job başlatıldı (saatte bir).');
}

module.exports = startAutoAnswerCron;
