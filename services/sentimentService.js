'use strict';

const { categorizeQuestion } = require('./aiService');

const VALID_CATEGORIES = [
  'urun_ozellikleri',
  'kargo_teslimat',
  'iade_talebi',
  'fiyat_kampanya',
  'stok_durumu',
];

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function parseLines(json) {
  try { return JSON.parse(json || '[]'); } catch { return []; }
}

function salesScore(count) {
  if (count >= 20) return 100;
  if (count >= 10) return 80;
  if (count >=  5) return 60;
  if (count >=  1) return 40;
  return 20;
}

function refundScore(ratePct) {
  if (ratePct <  5) return 100;
  if (ratePct < 10) return 80;
  if (ratePct < 15) return 60;
  if (ratePct < 20) return 40;
  return 20;
}

function questionScore(iadeRatePct) {
  if (iadeRatePct < 10) return 100;
  if (iadeRatePct < 20) return 80;
  if (iadeRatePct < 30) return 60;
  if (iadeRatePct < 40) return 40;
  return 20;
}

// ── 1. analyzeAllQuestions ────────────────────────────────────────────────────
// Kategorisi henüz belirlenmemiş soruları AI ile analiz eder ve kaydeder.
async function analyzeAllQuestions(db) {
  const unanalyzed = db.prepare(`
    SELECT q.id, q.question_text, q.product_name
    FROM   questions q
    WHERE  NOT EXISTS (
      SELECT 1 FROM question_categories qc WHERE qc.question_id = q.id
    )
  `).all();

  const insert = db.prepare(`
    INSERT INTO question_categories (question_id, category, confidence_score, analyzed_at)
    VALUES (?, ?, ?, datetime('now'))
  `);

  let analyzed = 0;
  let errors   = 0;

  for (const q of unanalyzed) {
    try {
      const result = await categorizeQuestion(q.question_text, q.product_name);
      if (!result || !VALID_CATEGORIES.includes(result.category)) {
        console.warn(`[sentimentService] Soru ${q.id} geçersiz kategori döndü:`, result);
        errors++;
        continue;
      }
      insert.run(q.id, result.category, result.confidence);
      analyzed++;
    } catch (e) {
      console.error(`[sentimentService] Soru ${q.id} analiz hatası:`, e.message);
      errors++;
    }
  }

  console.log(`[sentimentService] analyzeAllQuestions: ${analyzed} analiz edildi, ${errors} hata`);
  return { analyzed, errors };
}

// ── 2. getQuestionStats ───────────────────────────────────────────────────────
// Kategori dağılımı, en çok sorulan ürünler, iade riski uyarısı.
function getQuestionStats(db, dealerId) {
  const rows = db.prepare(`
    SELECT qc.category, q.product_name, COUNT(*) AS cnt
    FROM   question_categories qc
    JOIN   questions q ON qc.question_id = q.id
    WHERE  q.dealer_id = ?
    GROUP  BY qc.category, q.product_name
  `).all(dealerId);

  const byCategory = {};
  const productMap = {};
  let total = 0;

  for (const row of rows) {
    byCategory[row.category] = (byCategory[row.category] || 0) + row.cnt;
    productMap[row.product_name] = (productMap[row.product_name] || 0) + row.cnt;
    total += row.cnt;
  }

  const topProducts = Object.entries(productMap)
    .map(([product_name, questionCount]) => ({ product_name, questionCount }))
    .sort((a, b) => b.questionCount - a.questionCount)
    .slice(0, 10);

  const iadeCount = byCategory['iade_talebi'] || 0;
  const riskAlert = total > 0 && (iadeCount / total) > 0.15;

  return { total, byCategory, topProducts, riskAlert };
}

// ── 3. getRefundStats ─────────────────────────────────────────────────────────
// Ürün bazlı iade oranları ve risk seviyeleri.
function getRefundStats(db, dealerId) {
  const allOrders = db.prepare(`
    SELECT is_refund, lines_json
    FROM   orders
    WHERE  dealer_id = ?
  `).all(dealerId);

  const totalMap  = {};  // product_name → toplam sipariş satırı
  const refundMap = {};  // product_name → iade satırı

  for (const order of allOrders) {
    const lines = parseLines(order.lines_json);
    for (const line of lines) {
      const name = line.title || line.barcode || 'Bilinmiyor';
      totalMap[name]  = (totalMap[name]  || 0) + 1;
      if (order.is_refund) {
        refundMap[name] = (refundMap[name] || 0) + 1;
      }
    }
  }

  const totalRefunds = Object.values(refundMap).reduce((s, n) => s + n, 0);
  const totalLines   = Object.values(totalMap).reduce((s, n) => s + n, 0);
  const refundRate   = totalLines > 0
    ? parseFloat(((totalRefunds / totalLines) * 100).toFixed(1))
    : 0;

  const byProduct = Object.keys(totalMap).map(product_name => {
    const refundCount = refundMap[product_name] || 0;
    const rate = parseFloat(((refundCount / totalMap[product_name]) * 100).toFixed(1));
    const risk = rate >= 15 ? 'high' : rate >= 8 ? 'medium' : 'low';
    return { product_name, refundCount, refundRate: rate, risk };
  }).sort((a, b) => b.refundRate - a.refundRate);

  return { totalRefunds, refundRate, byProduct };
}

// ── 4. calculateHealthScores ─────────────────────────────────────────────────
// Her ürün için 3 alt skor + genel skor hesaplar, DB'ye kaydeder.
function calculateHealthScores(db, dealerId) {
  // Satış sayıları - dealer_products üzerinden barcode + title eşleşmesi (son 30 gün)
  const dealerProducts = db.prepare(`
    SELECT title, barcode FROM dealer_products WHERE dealer_id = ?
  `).all(dealerId);

  const barcodeMap = {};
  for (const dp of dealerProducts) barcodeMap[dp.title] = dp.barcode;

  const salesStmt = db.prepare(`
    SELECT COALESCE(SUM(json_extract(value, '$.quantity')), 0) as qty
    FROM orders, json_each(orders.lines_json)
    WHERE orders.dealer_id = ?
      AND orders.is_refund = 0
      AND orders.order_date >= datetime('now', '-30 days')
      AND (
        json_extract(value, '$.barcode') = ?
        OR json_extract(value, '$.title') LIKE '%' || SUBSTR(?, 1, 30) || '%'
      )
  `);

  // İade sayıları
  const { byProduct: refundByProduct } = getRefundStats(db, dealerId);
  const refundMap = {};
  for (const r of refundByProduct) refundMap[r.product_name] = r;

  // Soru istatistikleri (iade_talebi oranı)
  const qRows = db.prepare(`
    SELECT q.product_name, qc.category, COUNT(*) AS cnt
    FROM   question_categories qc
    JOIN   questions q ON qc.question_id = q.id
    WHERE  q.dealer_id = ?
    GROUP  BY q.product_name, qc.category
  `).all(dealerId);

  const qTotalMap = {};
  const qIadeMap  = {};
  for (const row of qRows) {
    qTotalMap[row.product_name] = (qTotalMap[row.product_name] || 0) + row.cnt;
    if (row.category === 'iade_talebi') {
      qIadeMap[row.product_name] = (qIadeMap[row.product_name] || 0) + row.cnt;
    }
  }

  // Tüm ürünleri birleştir
  const allProducts = new Set([
    ...dealerProducts.map(dp => dp.title),
    ...refundByProduct.map(r => r.product_name),
    ...Object.keys(qTotalMap),
  ]);

  const deleteExisting = db.prepare(`
    DELETE FROM product_health_scores WHERE product_title = ? AND dealer_product_id IS NULL
  `);
  const insertScore = db.prepare(`
    INSERT INTO product_health_scores
      (dealer_product_id, product_title, sales_score, refund_score, question_score,
       overall_score, alerts, calculated_at)
    VALUES (NULL, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const upsert = db.transaction((title, ss, rs, qs, os, alerts) => {
    deleteExisting.run(title);
    insertScore.run(title, ss, rs, qs, os, JSON.stringify(alerts));
  });

  const results = [];

  for (const name of allProducts) {
    try {
      const salesResult = salesStmt.get(dealerId, barcodeMap[name] || null, name);
      const saleCnt    = salesResult ? salesResult.qty : 0;
      const refundInfo = refundMap[name] || { refundRate: 0 };
      const qTotal     = qTotalMap[name] || 0;
      const qIade      = qIadeMap[name]  || 0;
      const iadeRatePct = qTotal > 0 ? (qIade / qTotal) * 100 : 0;

      const ss = salesScore(saleCnt);
      const rs = refundScore(refundInfo.refundRate);
      const qs = questionScore(iadeRatePct);
      const os = parseFloat(((ss + rs + qs) / 3).toFixed(1));

      const alerts = [];
      if (os < 50)  alerts.push({ type: 'overall',  message: 'Kritik: Ürün performansı düşük',          severity: 'high' });
      if (rs < 60)  alerts.push({ type: 'refund',   message: 'Yüksek iade oranı tespit edildi',         severity: 'medium' });
      if (qs < 60)  alerts.push({ type: 'question', message: 'İade talebi soruları yoğunlaşıyor',       severity: 'medium' });

      upsert(name, ss, rs, qs, os, alerts);
      results.push({ product_title: name, overall_score: os });
    } catch (e) {
      console.error(`[sentimentService] ${name} skor hesaplama hatası:`, e.message);
    }
  }

  console.log(`[sentimentService] calculateHealthScores: ${results.length} ürün işlendi`);
  return results;
}

module.exports = {
  analyzeAllQuestions,
  getQuestionStats,
  getRefundStats,
  calculateHealthScores,
};
