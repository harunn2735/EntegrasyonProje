# Müşteri Yorumları Modülü Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trendyol'dan müşteri yorumlarını saatte bir çeken, Gemini AI ile sentiment + yanıt analizi yapan, kullanıcı onayıyla Trendyol'a yanıt gönderen tam modül.

**Architecture:** `routes/reviews.js` tüm API endpoint'lerini barındırır; `cron/reviewsCron.js` saatte bir sync+analyze yapar; `public/js/musteriYorumlariPage.js` SPA frontend sayfasıdır. Migration + server.js + index.html entegrasyonları mevcut pattern'lere (questions, pricing) birebir uyar.

**Tech Stack:** better-sqlite3 (sync), node-cron, axios, geminiClient.generate(), Express Router, vanilla JS IIFE frontend

---

## Task 1: DB Migration

**Files:**
- Create: `migrations/005_add_customer_reviews.sql`

- [ ] **Step 1: Migration dosyasını oluştur**

```sql
-- migrations/005_add_customer_reviews.sql
CREATE TABLE IF NOT EXISTS customer_reviews (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id           INTEGER NOT NULL,
  product_id          TEXT,
  barcode             TEXT,
  product_name        TEXT,
  trendyol_review_id  TEXT NOT NULL,
  customer_name       TEXT,
  rating              INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  review_text         TEXT NOT NULL DEFAULT '',
  review_date         DATETIME,
  sentiment           TEXT CHECK(sentiment IN ('pozitif', 'negatif', 'nötr')),
  category            TEXT CHECK(category IN ('Kalite', 'Kargo', 'Fiyat', 'Beklenti', 'Diğer')),
  urgency             TEXT CHECK(urgency IN ('yüksek', 'orta', 'düşük')),
  ai_response         TEXT,
  approved_response   TEXT,
  status              TEXT NOT NULL DEFAULT 'Bekliyor'
                        CHECK(status IN ('Bekliyor', 'Onaylandı', 'Gönderildi', 'Reddedildi')),
  created_at          DATETIME DEFAULT (datetime('now')),
  processed_at        DATETIME,
  UNIQUE(dealer_id, trendyol_review_id),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reviews_dealer_status    ON customer_reviews(dealer_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_dealer_sentiment ON customer_reviews(dealer_id, sentiment);
CREATE INDEX IF NOT EXISTS idx_reviews_rating           ON customer_reviews(dealer_id, rating);
CREATE INDEX IF NOT EXISTS idx_reviews_created          ON customer_reviews(dealer_id, created_at DESC);
```

- [ ] **Step 2: Migration'ın çalıştığını doğrula**

```bash
node -e "const db = require('./database'); console.log(db.prepare('SELECT COUNT(*) as c FROM customer_reviews').get());"
```

Beklenen çıktı: `{ c: 0 }` — tablo oluştu, hata yok.

- [ ] **Step 3: Commit**

```bash
git add migrations/005_add_customer_reviews.sql
git commit -m "feat: add customer_reviews migration"
```

---

## Task 2: Backend Route

**Files:**
- Create: `routes/reviews.js`

- [ ] **Step 1: `routes/reviews.js` dosyasını oluştur**

```javascript
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

    const stats = db.prepare(`
      SELECT
        COUNT(*)                                            AS total,
        SUM(sentiment = 'pozitif')                         AS positive,
        SUM(sentiment = 'negatif')                         AS negative,
        SUM(status = 'Bekliyor' AND ai_response IS NOT NULL) AS pending_response
      FROM customer_reviews WHERE dealer_id = ?
    `).get(dealerId);

    res.json({
      reviews: rows,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      stats,
    });
  } catch (e) {
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
        COUNT(*)                                                       AS total,
        SUM(sentiment = 'pozitif')                                     AS positive,
        SUM(sentiment = 'negatif')                                     AS negative,
        SUM(status = 'Bekliyor' AND ai_response IS NOT NULL)           AS pending_response,
        ROUND(100.0 * SUM(sentiment='pozitif') / MAX(COUNT(*), 1), 1) AS satisfaction_pct
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
    res.status(500).json({ error: e.message });
  }
});

// ── Paylaşılan fetch helper (cron + route her ikisi kullanır) ──
async function fetchAndSaveReviews(dealerId, creds) {
  const response = await axios.get(
    `https://apigw.trendyol.com/integration/product/sellers/${creds.supplier_id}/reviews?page=0&size=100`,
    { headers: trendyolHeaders(creds), timeout: 15000 }
  );

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

module.exports = { router, fetchAndSaveReviews };
```

- [ ] **Step 2: Syntax kontrolü**

```bash
node -e "require('./routes/reviews')" && echo "OK"
```

Beklenen: `OK`

- [ ] **Step 3: Commit**

```bash
git add routes/reviews.js
git commit -m "feat: add reviews route (sync, analyze, send, list)"
```

---

## Task 3: Cron Job

**Files:**
- Create: `cron/reviewsCron.js`

- [ ] **Step 1: Cron dosyasını oluştur**

```javascript
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
          // Yeni yorumları analiz et
          await analyzeNewReviews(dealer.id);
        }
      } catch (e) {
        console.error(`[Yorumlar Cron] Dealer ${dealer.id} hatası:`, e.message);
      }
    }
  });

  console.log('✅ Yorumlar cron job başlatıldı (her saatin :30\'unda).');
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
```

- [ ] **Step 2: Syntax kontrolü**

```bash
node -e "require('./cron/reviewsCron')" && echo "OK"
```

Beklenen: `OK`

- [ ] **Step 3: Commit**

```bash
git add cron/reviewsCron.js
git commit -m "feat: add reviews cron (hourly sync + AI analyze)"
```

---

## Task 4: server.js Integration

**Files:**
- Modify: `server.js` (import + mount + cron start)

- [ ] **Step 1: Import satırlarını ekle**

`server.js` dosyasının en üstündeki `require` bloğuna (diğer route/cron import'larının yanına) ekle:

```javascript
// Bu satırları mevcut import'ların yanına ekle (satır ~11-20 civarı):
const { router: reviewsRouter } = require('./routes/reviews');
const startReviewsCron          = require('./cron/reviewsCron');
```

- [ ] **Step 2: Router'ı mount et**

`server.js`'te `app.use('/api/questions', ...)` satırının hemen altına:

```javascript
app.use('/api/dealer/reviews', authMiddleware, reviewsRouter);
```

- [ ] **Step 3: Cron job'ı başlat**

`server.js` sonundaki cron başlatma bloğuna (startQuestionsCron() vb. ile birlikte):

```javascript
startReviewsCron();
```

- [ ] **Step 4: Sunucuyu başlat ve mount doğrula**

```bash
node server.js &
sleep 3
curl -s http://localhost:3000/api/dealer/reviews 2>&1 | head -5
kill %1
```

Beklenen: JSON yanıt (401 Unauthorized da kabul edilir — auth çalışıyor demek).

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: mount reviews router and start reviews cron"
```

---

## Task 5: Dashboard Widget

**Files:**
- Modify: `server.js` (dashboard endpoint güncelleme)
- Modify: `index.html` (loadDashboard fonksiyonu + HTML widget)

- [ ] **Step 1: Dashboard endpoint'ine review stats ekle**

`server.js`'te `GET /api/dealer/dashboard` handler'ında `res.json(...)` satırından hemen önce ekle:

```javascript
// Yorum istatistikleri (bu hafta + bekleyen yanıt)
const reviewStats = db.prepare(`
  SELECT
    SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS this_week,
    SUM(CASE WHEN status='Bekliyor' AND ai_response IS NOT NULL THEN 1 ELSE 0 END) AS pending_response,
    ROUND(100.0 * SUM(CASE WHEN sentiment='pozitif' THEN 1 ELSE 0 END) / MAX(COUNT(*),1), 1) AS satisfaction_pct,
    (SELECT category FROM customer_reviews cr2
     WHERE cr2.dealer_id = ? AND cr2.sentiment = 'negatif' AND cr2.category IS NOT NULL
     GROUP BY category ORDER BY COUNT(*) DESC LIMIT 1) AS top_complaint
  FROM customer_reviews WHERE dealer_id = ?
`).get(dealerId, dealerId);
```

Ve `res.json(...)` içine ekle:

```javascript
res.json({
  totalOrders, totalRefunds, netRevenue, storeCount, productCount, xmlCount, trend,
  reviewStats: reviewStats || { this_week: 0, pending_response: 0, satisfaction_pct: 0, top_complaint: null }
});
```

- [ ] **Step 2: `index.html`'de dashboard widget HTML ekle**

`index.html`'de fiyat önerileri widget div'inin (`id="dash-pricing-widget"`) hemen altına:

```html
<!-- Yorumlar widget -->
<div id="dash-reviews-widget" style="display:none;margin-top:12px;padding:12px 16px;background:var(--bg3);border:1px solid var(--border);border-radius:12px">
  <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">⭐ Müşteri Yorumları</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
    <div>Bu hafta: <strong id="dash-rv-week">—</strong></div>
    <div>Memnuniyet: <strong id="dash-rv-score">—</strong></div>
    <div>Bekleyen yanıt: <strong id="dash-rv-pending">—</strong></div>
    <div>Şikayet konusu: <strong id="dash-rv-complaint">—</strong></div>
  </div>
  <button class="btn btn-ghost btn-sm" style="margin-top:8px;font-size:12px" onclick="navigate('reviews')">Yorumları Yönet →</button>
</div>
```

- [ ] **Step 3: `index.html`'de `loadDashboard()` fonksiyonuna reviews widget kodu ekle**

`loadDashboard()` içindeki pricing widget bloğunun hemen altına (satır ~1885 civarı):

```javascript
// Yorumlar widget
try {
  const d2 = await api('/api/dealer/dashboard');
  const rv = d2?.reviewStats;
  if (rv) {
    const rvWidget = document.getElementById('dash-reviews-widget');
    if (rvWidget) {
      document.getElementById('dash-rv-week').textContent      = rv.this_week ?? 0;
      document.getElementById('dash-rv-score').textContent     = `%${rv.satisfaction_pct ?? 0}`;
      document.getElementById('dash-rv-pending').textContent   = rv.pending_response ?? 0;
      document.getElementById('dash-rv-complaint').textContent = rv.top_complaint ?? '—';
      rvWidget.style.display = (rv.this_week > 0 || rv.pending_response > 0) ? 'block' : 'none';
    }
  }
} catch (e) { /* widget yüklenemezse sessizce geç */ }
```

> **Not:** Bu ikinci `api('/api/dealer/dashboard')` çağrısını, mevcut ilk `const d = await api(...)` çağrısından gelen `d.reviewStats` ile değiştirmek daha verimli olur. Ama şimdilik çalışır; ilerleyen adımlarda optimize edilebilir.

- [ ] **Step 4: Commit**

```bash
git add server.js index.html
git commit -m "feat: add review stats to dashboard widget"
```

---

## Task 6: Frontend Page

**Files:**
- Create: `public/js/musteriYorumlariPage.js`

- [ ] **Step 1: Frontend page dosyasını oluştur**

```javascript
// public/js/musteriYorumlariPage.js
(function () {
  'use strict';

  const STYLE = `
    #page-reviews { padding: 8px 0 0; width: 100%; max-width: 100%; box-sizing: border-box; }
    .rv-shell { display: flex; flex-direction: column; gap: 16px; max-width: 1180px; margin: 0 auto; }
    .rv-toolbar { background: linear-gradient(180deg,rgba(255,255,255,.98),rgba(255,255,255,.92)); border: 1px solid var(--border); border-radius: 16px; padding: 18px 20px; box-shadow: var(--shadow); }
    .rv-toolbar-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .rv-title { font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
    .rv-sub { font-size: 13px; color: var(--muted); }
    .rv-kpi-row { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; }
    .rv-kpi { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; }
    .rv-kpi-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
    .rv-kpi-val { font-size: 24px; font-weight: 700; }
    .rv-filter-bar { display: inline-flex; gap: 4px; padding: 4px; background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; }
    .rv-filter-btn { padding: 7px 14px; border-radius: 8px; border: none; background: transparent; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--muted); font-family: inherit; transition: .15s; }
    .rv-filter-btn:hover { color: var(--text); }
    .rv-filter-btn.active { background: var(--accent); color: #fff; }
    .rv-table { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    .rv-table table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .rv-table th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border); background: var(--bg3); }
    .rv-table td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
    .rv-table tr:last-child td { border-bottom: none; }
    .rv-table tr:hover td { background: var(--bg3); }
    .rv-badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
    .rv-badge.pozitif { background: rgba(22,163,74,.1); color: var(--green); }
    .rv-badge.negatif { background: rgba(220,38,38,.1); color: var(--red); }
    .rv-badge.nötr { background: var(--bg3); color: var(--muted); }
    .rv-stars { color: #f59e0b; }
    .rv-response-area { width: 100%; padding: 6px 8px; font-family: inherit; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg2); color: var(--text); resize: vertical; min-height: 60px; }
    .rv-response-area:focus { outline: none; border-color: var(--accent); }
    .rv-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
    .rv-empty { text-align: center; padding: 56px 20px; color: var(--muted); }
    .rv-empty .emoji { font-size: 44px; margin-bottom: 12px; }
    @media (max-width: 640px) { .rv-kpi-row { grid-template-columns: 1fr 1fr; } }
  `;

  let currentFilter = '';

  function stars(n) {
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  }

  function sentimentBadge(s) {
    if (!s) return '<span class="rv-badge nötr">—</span>';
    const labels = { pozitif: 'Pozitif ✓', negatif: 'Negatif ✗', 'nötr': 'Nötr' };
    return `<span class="rv-badge ${s}">${labels[s] || s}</span>`;
  }

  function statusBadge(s) {
    const map = { Bekliyor: '#f59e0b', Onaylandı: 'var(--accent)', Gönderildi: 'var(--green)', Reddedildi: 'var(--red)' };
    return `<span style="font-size:11px;font-weight:600;color:${map[s]||'var(--muted)'}">${s}</span>`;
  }

  function renderKPIs(stats) {
    const s = stats || {};
    return `
      <div class="rv-kpi-row">
        <div class="rv-kpi">
          <div class="rv-kpi-label">Toplam Yorum</div>
          <div class="rv-kpi-val" id="rv-kpi-total">${s.total ?? '—'}</div>
        </div>
        <div class="rv-kpi">
          <div class="rv-kpi-label">Pozitif</div>
          <div class="rv-kpi-val" style="color:var(--green)" id="rv-kpi-pos">${s.positive ?? '—'}</div>
        </div>
        <div class="rv-kpi">
          <div class="rv-kpi-label">Negatif</div>
          <div class="rv-kpi-val" style="color:var(--red)" id="rv-kpi-neg">${s.negative ?? '—'}</div>
        </div>
        <div class="rv-kpi">
          <div class="rv-kpi-label">Bekleyen Yanıt</div>
          <div class="rv-kpi-val" style="color:var(--accent)" id="rv-kpi-pend">${s.pending_response ?? '—'}</div>
        </div>
      </div>`;
  }

  function renderRow(r) {
    const canApprove = r.status === 'Bekliyor';
    const canSend    = r.status === 'Onaylandı';
    const responseText = r.approved_response || r.ai_response || '';

    return `
      <tr id="rv-row-${r.id}">
        <td style="max-width:180px">
          <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(r.product_name || '—')}</div>
          <div style="font-size:11px;color:var(--muted)">${r.barcode || ''}</div>
        </td>
        <td style="max-width:260px">
          <div class="rv-stars">${stars(r.rating)}</div>
          <div style="font-size:12px;margin-top:2px">${escHtml(r.review_text.slice(0, 150))}${r.review_text.length > 150 ? '…' : ''}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${r.customer_name || ''}</div>
        </td>
        <td>${sentimentBadge(r.sentiment)}<br><span style="font-size:11px;color:var(--muted)">${r.category || '—'}</span></td>
        <td>
          ${r.ai_response
            ? `<textarea class="rv-response-area" id="rv-txt-${r.id}">${escHtml(responseText)}</textarea>
               <div class="rv-actions">
                 ${canApprove ? `<button class="btn btn-success btn-sm" onclick="window.rvApprove(${r.id})">✓ Onayla</button>` : ''}
                 ${canSend    ? `<button class="btn btn-primary btn-sm" onclick="window.rvSend(${r.id})">📤 Gönder</button>` : ''}
                 ${canApprove ? `<button class="btn btn-danger btn-sm"  onclick="window.rvReject(${r.id})">✗ Reddet</button>` : ''}
               </div>`
            : `<span style="font-size:12px;color:var(--muted)">AI analizi bekleniyor…</span>
               <div><button class="btn btn-ghost btn-sm" style="margin-top:4px" onclick="window.rvAnalyze(${r.id})">▶ Analiz Et</button></div>`
          }
        </td>
        <td>${statusBadge(r.status)}</td>
      </tr>`;
  }

  async function load(filter) {
    currentFilter = filter ?? currentFilter;
    const tbody = document.getElementById('rv-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted)">Yükleniyor…</td></tr>';

    try {
      const params = new URLSearchParams({ limit: 50, page: 1 });
      if (currentFilter === 'pending')  params.set('status', 'Bekliyor');
      if (currentFilter === 'negative') params.set('rating_max', '2');
      if (currentFilter === 'approved') params.set('status', 'Onaylandı');

      const data = await window.api('/api/dealer/reviews?' + params);
      if (!data) return;

      // KPI güncelle
      const s = data.stats || {};
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };
      set('rv-kpi-total', s.total);
      set('rv-kpi-pos',   s.positive);
      set('rv-kpi-neg',   s.negative);
      set('rv-kpi-pend',  s.pending_response);

      if (!tbody) return;
      if (!data.reviews?.length) {
        tbody.innerHTML = '<tr><td colspan="5"><div class="rv-empty"><div class="emoji">⭐</div><p>Yorum bulunamadı. "Yorumları Çek" butonuna tıklayın.</p></div></td></tr>';
        return;
      }
      tbody.innerHTML = data.reviews.map(renderRow).join('');
    } catch (e) {
      const tbody = document.getElementById('rv-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="5"><div class="rv-empty"><div class="emoji">⚠️</div><p>${escHtml(e.message)}</p></div></td></tr>`;
    }
  }

  function setFilter(f) {
    currentFilter = f;
    document.querySelectorAll('.rv-filter-btn').forEach(b => b.classList.remove('active'));
    const ids = { '': 'rv-fb-all', pending: 'rv-fb-pending', negative: 'rv-fb-negative', approved: 'rv-fb-approved' };
    const btn = document.getElementById(ids[f] ?? 'rv-fb-all');
    if (btn) btn.classList.add('active');
  }

  window.rvFilter = function (f) { setFilter(f); load(f); };

  window.rvSync = async function () {
    const btn = document.getElementById('rv-sync-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Çekiliyor…'; }
    try {
      const r = await window.api('/api/dealer/reviews/sync');
      if (r) window.toast(`✅ ${r.fetched} yorum kontrol edildi, ${r.saved} yeni kaydedildi`, 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Yorumları Çek'; }
    }
  };

  window.rvAnalyzeAll = async function () {
    const btn = document.getElementById('rv-analyze-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Analiz ediliyor…'; }
    try {
      const r = await window.api('/api/dealer/reviews/analyze-all', { method: 'POST' });
      if (r) window.toast(`✅ ${r.analyzed} yorum analiz edildi`, 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🤖 Tümünü Analiz Et'; }
    }
  };

  window.rvBulkPositive = async function () {
    try {
      const r = await window.api('/api/dealer/reviews/bulk-approve-positive', { method: 'POST' });
      if (r) window.toast(`✅ ${r.approved} pozitif yorum otomatik onaylandı`, 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    }
  };

  window.rvAnalyze = async function (id) {
    try {
      await window.api(`/api/dealer/reviews/analyze/${id}`, { method: 'POST' });
      window.toast('✅ Analiz tamamlandı', 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    }
  };

  window.rvApprove = async function (id) {
    const txt = document.getElementById(`rv-txt-${id}`)?.value?.trim();
    if (!txt) return window.toast('Yanıt metni boş olamaz', 'error');
    try {
      await window.api(`/api/dealer/reviews/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ response_text: txt }),
      });
      window.toast('✅ Onaylandı — "Gönder" ile Trendyol\'a iletin', 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    }
  };

  window.rvSend = async function (id) {
    const txt = document.getElementById(`rv-txt-${id}`)?.value?.trim();
    // Gönderimden önce metni güncelle
    if (txt) {
      try {
        await window.api(`/api/dealer/reviews/${id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ response_text: txt }),
        });
      } catch (_) {}
    }
    try {
      await window.api(`/api/dealer/reviews/${id}/send`, { method: 'POST' });
      window.toast('✅ Yanıt Trendyol\'a gönderildi', 'success');
      const row = document.getElementById(`rv-row-${id}`);
      if (row) { row.style.opacity = '0.5'; setTimeout(() => load(), 1000); }
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    }
  };

  window.rvReject = async function (id) {
    try {
      await window.api(`/api/dealer/reviews/${id}/reject`, { method: 'POST' });
      window.toast('Reddedildi', 'success');
      await load();
    } catch (e) {
      window.toast('❌ ' + e.message, 'error');
    }
  };

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function init() {
    const container = document.getElementById('page-reviews');
    if (!container) return;

    container.innerHTML = `
      <div class="rv-shell">
        <div class="rv-toolbar">
          <div class="rv-toolbar-head">
            <div>
              <h2 class="rv-title">⭐ Müşteri Yorumları</h2>
              <p class="rv-sub">Trendyol yorumları — AI analizi ve yanıt yönetimi</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-ghost"    id="rv-analyze-btn"  onclick="window.rvAnalyzeAll()">🤖 Tümünü Analiz Et</button>
              <button class="btn btn-ghost"                         onclick="window.rvBulkPositive()">✅ Pozitiflere Otomatik Yanıt</button>
              <button class="btn btn-primary"  id="rv-sync-btn"     onclick="window.rvSync()">🔄 Yorumları Çek</button>
            </div>
          </div>
        </div>

        <div class="rv-kpi-row" id="rv-kpis">
          <div class="rv-kpi"><div class="rv-kpi-label">Toplam Yorum</div><div class="rv-kpi-val" id="rv-kpi-total">—</div></div>
          <div class="rv-kpi"><div class="rv-kpi-label">Pozitif</div><div class="rv-kpi-val" style="color:var(--green)" id="rv-kpi-pos">—</div></div>
          <div class="rv-kpi"><div class="rv-kpi-label">Negatif</div><div class="rv-kpi-val" style="color:var(--red)" id="rv-kpi-neg">—</div></div>
          <div class="rv-kpi"><div class="rv-kpi-label">Bekleyen Yanıt</div><div class="rv-kpi-val" style="color:var(--accent)" id="rv-kpi-pend">—</div></div>
        </div>

        <div>
          <div class="rv-filter-bar">
            <button class="rv-filter-btn active" id="rv-fb-all"      onclick="window.rvFilter('')">Tümü</button>
            <button class="rv-filter-btn"         id="rv-fb-pending"  onclick="window.rvFilter('pending')">Bekleyen</button>
            <button class="rv-filter-btn"         id="rv-fb-negative" onclick="window.rvFilter('negative')">Negatif (1-2★)</button>
            <button class="rv-filter-btn"         id="rv-fb-approved" onclick="window.rvFilter('approved')">Onaylandı</button>
          </div>
        </div>

        <div class="rv-table">
          <table>
            <thead>
              <tr>
                <th>Ürün</th>
                <th>Yorum</th>
                <th>Analiz</th>
                <th>AI Yanıt Önerisi</th>
                <th>Durum</th>
              </tr>
            </thead>
            <tbody id="rv-tbody">
              <tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted)">Yükleniyor…</td></tr>
            </tbody>
          </table>
        </div>
      </div>`;

    load('');
  }

  // Stil enjeksiyonu
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  window.loadReviewsPage = init;
})();
```

- [ ] **Step 2: Commit**

```bash
git add public/js/musteriYorumlariPage.js
git commit -m "feat: add musteriYorumlariPage frontend"
```

---

## Task 7: index.html Navigation

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Sidebar nav item ekle**

`index.html`'de `id="nav-questions"` satırının hemen altına ekle:

```html
<div class="nav-item" onclick="navigate('reviews')" id="nav-reviews"><span class="icon">⭐</span>Müşteri Yorumları</div>
```

- [ ] **Step 2: Page div ekle**

`id="page-questions"` olan `<div>` satırının hemen altına:

```html
<div class="page" id="page-reviews"></div>
```

- [ ] **Step 3: navigate() fonksiyonunu güncelle**

`navigate()` içindeki `titles` objesine ekle:

```javascript
reviews: 'Müşteri Yorumları',
```

`navigate()` içindeki if blokları sonuna ekle:

```javascript
if (page === 'reviews') loadReviewsPage();
```

- [ ] **Step 4: Script tag ekle**

`</body>` öncesindeki script tag'ler bloğuna (örn. `questionsPage.js` satırının hemen altına):

```html
<script src="/js/musteriYorumlariPage.js"></script>
```

- [ ] **Step 5: Sunucuyu başlat ve sayfayı test et**

```bash
node server.js
```

Tarayıcıda aç: `http://localhost:3000`
Oturum aç → Sol menüde "⭐ Müşteri Yorumları" görünmeli.
Tıkla → Sayfa açılmalı, "Yorumları Çek" butonuna bas → sync çalışmalı.

- [ ] **Step 6: Final commit**

```bash
git add index.html
git commit -m "feat: wire reviews page into navigation and dashboard"
```

---

## Kapsam Dışı (İleride Eklenebilir)

- Trendyol review yanıt API endpoint'i (`/review-comments`) gerçek API'ye göre ayarlanması gerekebilir — yanıt gönderilemezse endpoint'i Trendyol belgelerinden doğrulayın.
- Yorum filtreleme: tarih aralığı, ürün bazlı
- Sayfalama: 50'den fazla yorum için next page
- E-posta bildirimi: urgency='yüksek' yorumlar için

---

## Spec Coverage Check

| Gereksinim | Task |
|---|---|
| customer_reviews DB tablosu | Task 1 |
| GET sync endpoint | Task 2 |
| POST analyze/:id | Task 2 |
| POST analyze-all | Task 2 |
| POST /:id/send | Task 2 |
| GET reviews (filtreli) | Task 2 |
| Cron job (saatte bir) | Task 3 |
| AI sentiment + kategori + yanıt | Task 2 + 3 |
| Sol menü nav item | Task 7 |
| 4 KPI kart | Task 6 |
| Filtre tabları | Task 6 |
| Tablo + AI yanıt düzenleme | Task 6 |
| Onayla ve Gönder butonu | Task 6 |
| Tüm Pozitiflere Otomatik Yanıt | Task 2 + 6 |
| Dashboard widget | Task 5 |
