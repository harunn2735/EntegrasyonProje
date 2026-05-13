// routes/reviews.js
'use strict';

const express = require('express');
const axios   = require('axios');
const db      = require('../database');
const { generate } = require('../services/geminiClient');

const router = express.Router();

// ── Trendyol kimlik bilgilerini çöz: önce store, sonra dealer ──
function getTrendyolCreds(dealerId) {
  const store = db.prepare(`
    SELECT supplier_id, api_key, api_secret
    FROM stores
    WHERE dealer_id = ? AND status = 'active'
      AND supplier_id IS NOT NULL AND supplier_id != ''
    LIMIT 1
  `).get(dealerId);
  if (store?.supplier_id) return store;
  return db.prepare(
    'SELECT supplier_id, api_key, api_secret FROM dealers WHERE id = ?'
  ).get(dealerId) ?? null;
}

function trendyolHeaders(creds) {
  const auth = Buffer.from(`${creds.api_key}:${creds.api_secret}`).toString('base64');
  return {
    Authorization:  `Basic ${auth}`,
    'Content-Type': 'application/json',
    'User-Agent':   `${creds.supplier_id} - SelfIntegration`,
  };
}

// ── AI analizi: tek yorum için sentiment + yanıt üret ──────────
async function analyzeReview(review) {
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
- suggested_response: Negatif yoruma çözüm öner ve özür dile, pozitife teşekkür et. Mağaza adı kullanma. 1-3 cümle.`;

  const text = await generate(prompt, { maxOutputTokens: 512, noThinking: true });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`AI geçerli JSON dönmedi: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(jsonMatch[0]);

  const VALID_SENTIMENTS = ['pozitif', 'negatif', 'nötr'];
  const VALID_CATEGORIES = ['Kalite', 'Kargo', 'Fiyat', 'Beklenti', 'Diğer'];
  const VALID_URGENCIES  = ['yüksek', 'orta', 'düşük'];

  return {
    sentiment:        VALID_SENTIMENTS.includes(parsed.sentiment) ? parsed.sentiment : 'nötr',
    category:         VALID_CATEGORIES.includes(parsed.category)  ? parsed.category  : 'Diğer',
    urgency:          VALID_URGENCIES.includes(parsed.urgency)    ? parsed.urgency   : 'orta',
    suggested_response: typeof parsed.suggested_response === 'string'
                         ? parsed.suggested_response.trim()
                         : '',
  };
}

// ── GET /api/dealer/reviews ─────────────────────────────────────
// Query: status, sentiment, rating_max, page, limit
router.get('/', (req, res) => {
  try {
    const dealerId  = req.dealer.id;
    const pageNum   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limitNum  = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset    = (pageNum - 1) * limitNum;

    const VALID_STATUSES   = ['Bekliyor', 'Onaylandı', 'Gönderildi', 'Reddedildi'];
    const VALID_SENTIMENTS = ['pozitif', 'negatif', 'nötr'];

    const conditions = ['dealer_id = ?'];
    const args       = [dealerId];

    if (req.query.status && VALID_STATUSES.includes(req.query.status)) {
      conditions.push('status = ?');
      args.push(req.query.status);
    }
    if (req.query.sentiment && VALID_SENTIMENTS.includes(req.query.sentiment)) {
      conditions.push('sentiment = ?');
      args.push(req.query.sentiment);
    }
    if (req.query.rating_max) {
      const max = parseInt(req.query.rating_max, 10);
      if (max >= 1 && max <= 5) { conditions.push('rating <= ?'); args.push(max); }
    }

    const where = conditions.join(' AND ');

    const rows = db.prepare(
      `SELECT * FROM customer_reviews WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...args, limitNum, offset);

    const { total } = db.prepare(
      `SELECT COUNT(*) as total FROM customer_reviews WHERE ${where}`
    ).get(...args);

    const rawStats = db.prepare(`
      SELECT
        COUNT(*)                                                        AS total,
        COALESCE(SUM(sentiment = 'pozitif'), 0)                        AS positive,
        COALESCE(SUM(sentiment = 'negatif'), 0)                        AS negative,
        COALESCE(SUM(status = 'Bekliyor' AND ai_response IS NOT NULL), 0) AS pending_response
      FROM customer_reviews WHERE dealer_id = ?
    `).get(dealerId);

    res.json({
      reviews: rows,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      stats: rawStats,
    });
  } catch (e) {
    console.error('[reviews GET /] HATA dealer=%s: %s', req.dealer?.id, e.message, e.stack);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/dealer/reviews/sync ────────────────────────────────
// Trendyol'dan son yorumları çek, yenileri kaydet, AI analizi başlat
router.get('/sync', async (req, res) => {
  const dealerId = req.dealer.id;
  try {
    const creds = getTrendyolCreds(dealerId);
    if (!creds?.supplier_id) {
      return res.status(400).json({ error: 'Trendyol API bilgileri eksik.' });
    }

    const { fetched, saved } = await fetchAndSaveReviews(dealerId, creds);
    res.json({ fetched, saved });
  } catch (e) {
    console.error('[reviews GET /sync] HATA dealer=%s: %s', dealerId, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/dealer/reviews/analyze/:id ───────────────────────
router.post('/analyze/:id', async (req, res) => {
  const dealerId = req.dealer.id;
  const id       = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz ID' });

  const review = db.prepare(
    'SELECT * FROM customer_reviews WHERE id = ? AND dealer_id = ?'
  ).get(id, dealerId);
  if (!review) return res.status(404).json({ error: 'Yorum bulunamadı' });

  try {
    const result = await analyzeReview(review);
    db.prepare(`
      UPDATE customer_reviews
      SET sentiment = ?, category = ?, urgency = ?, ai_response = ?,
          processed_at = datetime('now')
      WHERE id = ? AND dealer_id = ?
    `).run(result.sentiment, result.category, result.urgency, result.suggested_response, id, dealerId);

    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[reviews POST /analyze/:id] HATA id=%s dealer=%s: %s', id, dealerId, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/dealer/reviews/analyze-all ──────────────────────
// sentiment NULL olan tüm yorumları sırayla analiz et
router.post('/analyze-all', async (req, res) => {
  const dealerId = req.dealer.id;
  try {
    const pending = db.prepare(
      "SELECT * FROM customer_reviews WHERE dealer_id = ? AND sentiment IS NULL ORDER BY created_at DESC LIMIT 50"
    ).all(dealerId);

    if (pending.length === 0) return res.json({ analyzed: 0, errors: 0 });

    let analyzed = 0, errors = 0;
    const updateStmt = db.prepare(`
      UPDATE customer_reviews
      SET sentiment = ?, category = ?, urgency = ?, ai_response = ?,
          processed_at = datetime('now')
      WHERE id = ?
    `);

    for (const review of pending) {
      try {
        const result = await analyzeReview(review);
        updateStmt.run(result.sentiment, result.category, result.urgency, result.suggested_response, review.id);
        analyzed++;
      } catch (e) {
        console.error(`[reviews] analyze-all hata id=${review.id}:`, e.message);
        errors++;
      }
    }

    res.json({ analyzed, errors, total: pending.length });
  } catch (e) {
    console.error('[reviews POST /analyze-all] HATA dealer=%s: %s', dealerId, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/dealer/reviews/:id/approve ───────────────────────
// approved_response'u kaydet (düzenlenmiş metin), status → Onaylandı
router.post('/:id/approve', (req, res) => {
  const dealerId = req.dealer.id;
  const id       = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz ID' });

  const { response_text } = req.body;
  if (!response_text?.trim()) return res.status(400).json({ error: 'response_text boş olamaz' });

  const review = db.prepare(
    "SELECT * FROM customer_reviews WHERE id = ? AND dealer_id = ? AND status = 'Bekliyor'"
  ).get(id, dealerId);
  if (!review) return res.status(404).json({ error: 'Yorum bulunamadı veya zaten işlendi' });

  db.prepare(`
    UPDATE customer_reviews SET approved_response = ?, status = 'Onaylandı' WHERE id = ?
  `).run(response_text.trim(), id);

  res.json({ ok: true });
});

// ── POST /api/dealer/reviews/:id/send ─────────────────────────
// Onaylanan yanıtı Trendyol'a gönder
router.post('/:id/send', async (req, res) => {
  const dealerId = req.dealer.id;
  const id       = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz ID' });

  const review = db.prepare(
    "SELECT * FROM customer_reviews WHERE id = ? AND dealer_id = ? AND status = 'Onaylandı'"
  ).get(id, dealerId);
  if (!review) return res.status(404).json({ error: 'Onaylanmış yorum bulunamadı' });
  if (!review.approved_response) return res.status(400).json({ error: 'Onaylı yanıt metni yok' });

  const creds = getTrendyolCreds(dealerId);
  if (!creds?.supplier_id) return res.status(400).json({ error: 'Trendyol API bilgileri eksik.' });

  try {
    await axios.post(
      `https://apigw.trendyol.com/integration/product/sellers/${creds.supplier_id}/review-comments`,
      { reviewId: review.trendyol_review_id, content: review.approved_response },
      { headers: trendyolHeaders(creds), timeout: 15000 }
    );

    db.prepare("UPDATE customer_reviews SET status = 'Gönderildi' WHERE id = ?").run(id);
    res.json({ ok: true });
  } catch (e) {
    const detail = e.response?.data?.message || e.message;
    console.error('[reviews POST /:id/send] HATA id=%s dealer=%s: %s', id, dealerId, detail);
    res.status(500).json({ error: `Trendyol gönderim hatası: ${detail}` });
  }
});

// ── POST /api/dealer/reviews/:id/reject ───────────────────────
router.post('/:id/reject', (req, res) => {
  const dealerId = req.dealer.id;
  const id       = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz ID' });

  const info = db.prepare(
    "UPDATE customer_reviews SET status = 'Reddedildi' WHERE id = ? AND dealer_id = ? AND status IN ('Bekliyor','Onaylandı')"
  ).run(id, dealerId);

  if (info.changes === 0) return res.status(404).json({ error: 'Yorum bulunamadı veya zaten işlendi' });
  res.json({ ok: true });
});

// ── POST /api/dealer/reviews/bulk-approve-positive ────────────
// Tüm pozitif, analiz edilmiş, Bekliyor yorumları toplu onayla
router.post('/bulk-approve-positive', (req, res) => {
  const dealerId = req.dealer.id;
  const info = db.prepare(`
    UPDATE customer_reviews
    SET approved_response = ai_response, status = 'Onaylandı'
    WHERE dealer_id = ? AND sentiment = 'pozitif'
      AND status = 'Bekliyor' AND ai_response IS NOT NULL
  `).run(dealerId);
  res.json({ approved: info.changes });
});

// ── GET /api/dealer/reviews/stats ────────────────────────────
// Dashboard widget için
router.get('/stats', (req, res) => {
  const dealerId = req.dealer.id;
  try {
    const stats = db.prepare(`
      SELECT
        COUNT(*)                                                            AS total,
        COALESCE(SUM(sentiment = 'pozitif'), 0)                            AS positive,
        COALESCE(SUM(sentiment = 'negatif'), 0)                            AS negative,
        COALESCE(SUM(status = 'Bekliyor' AND ai_response IS NOT NULL), 0)  AS pending_response,
        CASE WHEN COUNT(*) = 0 THEN 0
             ELSE ROUND(100.0 * SUM(sentiment = 'pozitif') / COUNT(*), 1)
        END AS satisfaction_pct
      FROM customer_reviews WHERE dealer_id = ?
    `).get(dealerId);

    const thisWeek = db.prepare(`
      SELECT COUNT(*) as c FROM customer_reviews
      WHERE dealer_id = ? AND created_at >= datetime('now', '-7 days')
    `).get(dealerId).c;

    const topCategory = db.prepare(`
      SELECT category, COUNT(*) as cnt FROM customer_reviews
      WHERE dealer_id = ? AND sentiment = 'negatif' AND category IS NOT NULL
      GROUP BY category ORDER BY cnt DESC LIMIT 1
    `).get(dealerId);

    res.json({
      ...stats,
      this_week: thisWeek,
      top_complaint: topCategory?.category ?? null,
    });
  } catch (e) {
    console.error('[reviews GET /stats] HATA dealer=%s: %s', dealerId, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Paylaşılan fetch helper (cron + route her ikisi kullanır) ──
async function fetchAndSaveReviews(dealerId, creds) {
  let response;
  try {
    response = await axios.get(
      `https://apigw.trendyol.com/integration/product/sellers/${creds.supplier_id}/reviews?page=0&size=100`,
      { headers: trendyolHeaders(creds), timeout: 15000 }
    );
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) {
      throw new Error('Trendyol satıcı yorum API\'si bu hesap için mevcut değil (404). Demo veri eklemek için "Demo Veri Ekle" butonunu kullanın.');
    }
    if (status === 403) {
      throw new Error('Trendyol yorum API\'sine erişim yetkiniz yok (403). Trendyol destek ekibiyle iletişime geçin.');
    }
    throw err;
  }

  const reviews = response.data?.content || response.data?.reviews || [];
  let saved = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO customer_reviews
      (dealer_id, product_id, barcode, product_name, trendyol_review_id,
       customer_name, rating, review_text, review_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const r of reviews) {
    const reviewId = String(r.id || r.reviewId || '');
    if (!reviewId) continue;

    const text = (r.comment || r.reviewText || r.text || '').trim();
    if (!text) continue;

    const info = insertStmt.run(
      dealerId,
      String(r.productId || r.contentId || ''),
      String(r.barcode || ''),
      String(r.productDisplayName || r.productName || ''),
      reviewId,
      String(r.userDisplayName || r.reviewerNickName || ''),
      parseInt(r.star ?? r.rate ?? r.rating, 10) || 3,
      text,
      r.commentDateISOtype || r.reviewDate
        ? new Date(r.commentDateISOtype || r.reviewDate).toISOString()
        : new Date().toISOString()
    );
    if (info.changes > 0) saved++;
  }

  return { fetched: reviews.length, saved };
}

// ── POST /api/dealer/reviews/seed-demo ───────────────────────
// Trendyol review API mevcut olmadığından demo veri oluşturur
router.post('/seed-demo', (req, res) => {
  const dealerId = req.dealer.id;

  const demoReviews = [
    { reviewId: 'demo-001', name: 'Ahmet Y.', rating: 5, text: 'Ürün tam olarak tanımlandığı gibi geldi. Kalitesi çok iyi, kesinlikle tavsiye ederim.', product: 'Akıllı Saat Pro', barcode: 'DEMO001' },
    { reviewId: 'demo-002', name: 'Ayşe K.', rating: 1, text: 'Ürün 3 gün gecikmeli geldi ve hasarlıydı. Kargo çok özensizdi, paketi ezilmiş halde teslim aldım.', product: 'Bluetooth Kulaklık', barcode: 'DEMO002' },
    { reviewId: 'demo-003', name: 'Mehmet D.', rating: 4, text: 'Genel olarak memnunum ancak renk resimden biraz farklı çıktı. Kalitesi iyi.', product: 'Spor Ayakkabı', barcode: 'DEMO003' },
    { reviewId: 'demo-004', name: 'Fatma S.', rating: 2, text: 'Fiyatına göre kalitesi düşük. Beklediğimden çok daha ince ve hafif bir malzeme kullanılmış.', product: 'Günlük Çanta', barcode: 'DEMO004' },
    { reviewId: 'demo-005', name: 'Ali R.',   rating: 5, text: 'Mükemmel ürün! Hızlı kargo, sağlam paket, tam istediğim gibi. Çok teşekkürler.', product: 'Akıllı Saat Pro', barcode: 'DEMO001' },
    { reviewId: 'demo-006', name: 'Zeynep A.', rating: 3, text: 'İdare eder. Ne çok iyi ne çok kötü. Fiyatı bu kaliteye uygun.', product: 'Bluetooth Kulaklık', barcode: 'DEMO002' },
    { reviewId: 'demo-007', name: 'Hasan B.', rating: 1, text: 'Ürün bozuk geldi. İade sürecini başlatmak istiyorum. Satıcıyla iletişime geçemiyorum.', product: 'Şarj Aleti', barcode: 'DEMO005' },
    { reviewId: 'demo-008', name: 'Elif M.',  rating: 5, text: 'Çok güzel bir ürün, kızım bayıldı. Paket çok özenli hazırlanmış, teşekkürler!', product: 'Günlük Çanta', barcode: 'DEMO004' },
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO customer_reviews
      (dealer_id, product_id, barcode, product_name, trendyol_review_id,
       customer_name, rating, review_text, review_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;
  for (const r of demoReviews) {
    const info = stmt.run(
      dealerId, '', r.barcode, r.product,
      r.reviewId, r.name, r.rating, r.text,
      new Date(Date.now() - Math.random() * 7 * 24 * 3600 * 1000).toISOString()
    );
    if (info.changes > 0) added++;
  }

  res.json({ added, total: demoReviews.length, message: `${added} demo yorum eklendi.` });
});

module.exports = { router, fetchAndSaveReviews };
