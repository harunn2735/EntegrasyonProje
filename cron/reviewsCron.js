// cron/reviewsCron.js
'use strict';

const cron = require('node-cron');
const db   = require('../database');
const { fetchAndSaveReviews } = require('../routes/reviews');
const { generate } = require('../services/geminiClient');

function startReviewsCron() {
  cron.schedule('30 * * * *', async () => {
    console.log('[Yorumlar Cron] Başladı');

    const dealers = db.prepare(`
      SELECT d.id, d.name,
             COALESCE(s.supplier_id, d.supplier_id) AS supplier_id,
             COALESCE(s.api_key,    d.api_key)       AS api_key,
             COALESCE(s.api_secret, d.api_secret)    AS api_secret
      FROM dealers d
      LEFT JOIN stores s ON s.dealer_id = d.id AND s.status = 'active'
                         AND s.supplier_id IS NOT NULL AND s.supplier_id != ''
      WHERE d.status = 'active'
        AND COALESCE(s.supplier_id, d.supplier_id) IS NOT NULL
        AND COALESCE(s.supplier_id, d.supplier_id) != ''
        AND COALESCE(s.api_key, d.api_key) IS NOT NULL
        AND COALESCE(s.api_key, d.api_key) != ''
      GROUP BY d.id
    `).all();

    for (const dealer of dealers) {
      try {
        const { fetched, saved } = await fetchAndSaveReviews(dealer.id, dealer);
        if (saved > 0) {
          console.log(`[Yorumlar Cron] Dealer ${dealer.id} (${dealer.name}): ${saved}/${fetched} yeni yorum`);
          await analyzeNewReviews(dealer.id);
        }
      } catch (e) {
        console.error(`[Yorumlar Cron] Dealer ${dealer.id} hatası:`, e.message);
      }
    }
  });

  console.log("✅ Yorumlar cron job başlatıldı (her saatin :30'unda).");
}

async function analyzeNewReviews(dealerId) {
  const pending = db.prepare(
    "SELECT * FROM customer_reviews WHERE dealer_id = ? AND sentiment IS NULL LIMIT 20"
  ).all(dealerId);

  const updateStmt = db.prepare(`
    UPDATE customer_reviews
    SET sentiment = ?, category = ?, urgency = ?, ai_response = ?,
        processed_at = datetime('now')
    WHERE id = ?
  `);

  for (const review of pending) {
    try {
      const prompt = `Aşağıdaki müşteri yorumunu analiz et:
Ürün: ${review.product_name || '(belirtilmemiş)'}
Puan: ${review.rating}/5
Yorum: ${review.review_text}

Şu JSON formatında cevap ver (başka hiçbir şey ekleme):
{
  "sentiment": "pozitif",
  "category": "Kalite",
  "urgency": "orta",
  "suggested_response": "Müşteriye verilecek empati dolu, profesyonel Türkçe yanıt."
}

Kurallar:
- sentiment: "pozitif", "negatif" veya "nötr"
- category: "Kalite", "Kargo", "Fiyat", "Beklenti" veya "Diğer"
- urgency: rating<=2 ise "yüksek"; rating==3 ise "orta"; rating>=4 ise "düşük"
- suggested_response: 1-3 cümle, Türkçe, profesyonel`;

      const text = await generate(prompt, { maxOutputTokens: 512, noThinking: true });
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const p = JSON.parse(jsonMatch[0]);
      const SENTIMENTS = ['pozitif', 'negatif', 'nötr'];
      const CATEGORIES = ['Kalite', 'Kargo', 'Fiyat', 'Beklenti', 'Diğer'];
      const URGENCIES  = ['yüksek', 'orta', 'düşük'];

      updateStmt.run(
        SENTIMENTS.includes(p.sentiment) ? p.sentiment : 'nötr',
        CATEGORIES.includes(p.category)  ? p.category  : 'Diğer',
        URGENCIES.includes(p.urgency)    ? p.urgency   : 'orta',
        typeof p.suggested_response === 'string' ? p.suggested_response.trim() : '',
        review.id
      );
    } catch (e) {
      console.error(`[Yorumlar Cron] Analiz hatası id=${review.id}:`, e.message);
    }
  }
}

module.exports = startReviewsCron;
