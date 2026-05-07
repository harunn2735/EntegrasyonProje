// routes/pricing.js
// Dinamik fiyatlandırma modülü API endpoint'leri.
// Auth middleware server.js'te mount noktasında uygulanır (req.dealer erişilebilir).
'use strict';

const express = require('express');
const axios   = require('axios');
const router  = express.Router();
const db      = require('../database');
const PricingEngine = require('../src/services/pricing/PricingEngine');

// ── Yardımcı: Trendyol API kimlik bilgileri ─────────────────────────────────
// Önce aktif mağaza dener, yoksa doğrudan dealer credentials kullanır.
function getTrendyolCredentials(dealerId) {
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

// ── Yardımcı: Tek ürünün fiyatını Trendyol'a gönder ─────────────────────────
// Hata durumunda fırlat; çağıran catch'ler (local DB zaten güncellendi).
async function pushPriceToTrendyol(dealerId, barcode, newPrice, stock) {
  const creds = getTrendyolCredentials(dealerId);
  if (!creds?.supplier_id || !creds?.api_key || !creds?.api_secret) {
    throw new Error('Trendyol API bilgileri eksik veya tanımsız');
  }
  const authHeader = `Basic ${Buffer.from(`${creds.api_key}:${creds.api_secret}`).toString('base64')}`;
  await axios.post(
    `https://apigw.trendyol.com/integration/product/sellers/${creds.supplier_id}/price-and-inventory`,
    {
      items: [{
        barcode,
        quantity: Math.max(0, Number(stock || 0)),
        salePrice:  Number(newPrice),
        listPrice:  Number(newPrice),
      }],
    },
    {
      timeout: 15000,
      headers: {
        Authorization:  authHeader,
        'Content-Type': 'application/json',
        'User-Agent':   `${creds.supplier_id} - SelfIntegration`,
      },
    }
  );
}

// ── Yardımcı: Tahmini aylık gelir etkisi (pending öneriler) ─────────────────
// Son 30 günün satış adedi ile fiyat farkını çarpar.
// Satış verisi yoksa 1 adet varsayılan kullanılır.
function calcMonthlyImpact(dealerId) {
  const row = db.prepare(`
    WITH monthly_sales AS (
      SELECT
        json_extract(jl.value, '$.barcode')                              AS barcode,
        SUM(CAST(json_extract(jl.value, '$.quantity') AS INTEGER))       AS qty
      FROM   orders o,
             json_each(o.lines_json) jl
      WHERE  o.is_refund   = 0
        AND  o.dealer_id   = ?
        AND  o.order_date  >= datetime('now', '-30 days')
      GROUP BY json_extract(jl.value, '$.barcode')
    )
    SELECT ROUND(SUM(
      (pr.recommended_price - pr.current_price) * COALESCE(ms.qty, 1)
    ), 2) AS impact
    FROM   price_recommendations pr
    JOIN   dealer_products dp ON dp.id = pr.dealer_product_id
    LEFT JOIN monthly_sales ms ON ms.barcode = dp.barcode
    WHERE  dp.dealer_id = ? AND pr.status = 'pending'
  `).get(dealerId, dealerId);
  return row?.impact ?? 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/pricing/recommendations
// Sayfalanmış öneri listesi. Her kayıtta ürün adı JOIN ile gelir.
// ══════════════════════════════════════════════════════════════════════════════
router.get('/recommendations', (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const dealerId  = req.dealer.id;
    const pageNum   = Math.max(1, parseInt(page,  10) || 1);
    const limitNum  = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset    = (pageNum - 1) * limitNum;

    const ALLOWED_STATUSES = ['pending', 'approved', 'rejected', 'expired'];
    const statusFilter = status && ALLOWED_STATUSES.includes(status) ? status : null;

    // Filtreleme WHERE parçası
    const where    = statusFilter ? 'AND pr.status = ?' : '';
    const baseArgs = statusFilter ? [dealerId, statusFilter] : [dealerId];

    const rows = db.prepare(`
      SELECT
        pr.id,
        pr.dealer_product_id,
        pr.current_price,
        pr.recommended_price,
        pr.price_change_percent,
        pr.confidence_score,
        pr.reasoning,
        pr.status,
        pr.created_at,
        pr.decided_at,
        pr.decided_by,
        dp.title,
        dp.barcode,
        dp.stock,
        dp.supplier_name
      FROM price_recommendations pr
      JOIN dealer_products dp ON dp.id = pr.dealer_product_id
      WHERE dp.dealer_id = ? ${where}
      ORDER BY pr.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...baseArgs, limitNum, offset);

    // Toplam sayılar
    const { total } = db.prepare(`
      SELECT COUNT(*) as total
      FROM price_recommendations pr
      JOIN dealer_products dp ON dp.id = pr.dealer_product_id
      WHERE dp.dealer_id = ? ${where}
    `).get(...baseArgs);

    const { pending } = db.prepare(`
      SELECT COUNT(*) as pending
      FROM price_recommendations pr
      JOIN dealer_products dp ON dp.id = pr.dealer_product_id
      WHERE dp.dealer_id = ? AND pr.status = 'pending'
    `).get(dealerId);

    const estimatedMonthlyImpact = calcMonthlyImpact(dealerId);

    res.json({
      recommendations: rows,
      total,
      pending,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      estimatedMonthlyImpact,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/pricing/recommendations/:id
// Tek öneri detayı; applied_rules JSON parse edilmiş gelir.
// ══════════════════════════════════════════════════════════════════════════════
router.get('/recommendations/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz öneri ID' });

    const row = db.prepare(`
      SELECT
        pr.*,
        dp.title,
        dp.barcode,
        dp.stock,
        dp.cost_price,
        dp.supplier_name,
        dp.dealer_id
      FROM price_recommendations pr
      JOIN dealer_products dp ON dp.id = pr.dealer_product_id
      WHERE pr.id = ? AND dp.dealer_id = ?
    `).get(id, req.dealer.id);

    if (!row) return res.status(404).json({ error: 'Öneri bulunamadı' });

    // applied_rules JSON string'i parse et
    try { row.applied_rules = JSON.parse(row.applied_rules || '[]'); } catch { row.applied_rules = []; }

    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/pricing/recommendations/:id/approve
// Öneriyi onayla: DB güncelle → price_history kaydet → Trendyol'a gönder.
// ══════════════════════════════════════════════════════════════════════════════
router.post('/recommendations/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz öneri ID' });

    // Öneriyi getir ve dealer'ın yetkisini doğrula
    const rec = db.prepare(`
      SELECT pr.*, dp.barcode, dp.stock, dp.dealer_id
      FROM price_recommendations pr
      JOIN dealer_products dp ON dp.id = pr.dealer_product_id
      WHERE pr.id = ? AND dp.dealer_id = ?
    `).get(id, req.dealer.id);

    if (!rec) return res.status(404).json({ error: 'Öneri bulunamadı' });
    if (rec.status !== 'pending') {
      return res.status(409).json({ error: `Öneri zaten '${rec.status}' durumunda, tekrar işlenemez` });
    }

    const newPrice   = rec.recommended_price;
    const decidedBy  = req.dealer.email;

    // Local DB işlemleri tek transaction içinde
    const applyApproval = db.transaction(() => {
      db.prepare(`
        UPDATE price_recommendations
        SET    status = 'approved', decided_at = datetime('now'), decided_by = ?
        WHERE  id = ?
      `).run(decidedBy, id);

      db.prepare(`
        UPDATE dealer_products
        SET    sale_price = ?, updated_at = datetime('now')
        WHERE  id = ?
      `).run(newPrice, rec.dealer_product_id);

      db.prepare(`
        INSERT INTO price_history
          (dealer_product_id, old_price, new_price, change_reason, recommendation_id, changed_by)
        VALUES (?, ?, ?, ?, ?, 'user')
      `).run(
        rec.dealer_product_id,
        rec.current_price,
        newPrice,
        'Dinamik fiyatlandırma önerisi kullanıcı tarafından onaylandı',
        id
      );
    });

    applyApproval();

    // Trendyol fiyat güncellemesi (best-effort: başarısız olursa DB değişikliğini geri almıyoruz)
    let trendyolStatus = 'ok';
    try {
      await pushPriceToTrendyol(rec.dealer_id, rec.barcode, newPrice, rec.stock);
    } catch (tErr) {
      trendyolStatus = `hata: ${tErr.message}`;
      console.error(`[Pricing] Trendyol fiyat push hatası (öneri ${id}):`, tErr.message);
    }

    res.json({ success: true, newPrice, trendyolStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/pricing/recommendations/:id/reject
// Body (opsiyonel): { reason: "string" }
// ══════════════════════════════════════════════════════════════════════════════
router.post('/recommendations/:id/reject', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz öneri ID' });

    const rec = db.prepare(`
      SELECT pr.id, pr.status, dp.dealer_id
      FROM price_recommendations pr
      JOIN dealer_products dp ON dp.id = pr.dealer_product_id
      WHERE pr.id = ? AND dp.dealer_id = ?
    `).get(id, req.dealer.id);

    if (!rec) return res.status(404).json({ error: 'Öneri bulunamadı' });
    if (rec.status !== 'pending') {
      return res.status(409).json({ error: `Öneri zaten '${rec.status}' durumunda, tekrar işlenemez` });
    }

    const reason    = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : null;
    const decidedBy = reason ? `${req.dealer.email} — ${reason}` : req.dealer.email;

    db.prepare(`
      UPDATE price_recommendations
      SET    status = 'rejected', decided_at = datetime('now'), decided_by = ?
      WHERE  id = ?
    `).run(decidedBy, id);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/pricing/simulate/:dealerProductId
// Engine'i persist=false ile çalıştırır; DB'ye kayıt yapmaz.
// ══════════════════════════════════════════════════════════════════════════════
router.post('/simulate/:dealerProductId', async (req, res) => {
  try {
    const dealerProductId = parseInt(req.params.dealerProductId, 10);
    if (!Number.isFinite(dealerProductId)) {
      return res.status(400).json({ error: 'Geçersiz ürün ID' });
    }

    // Ürünün bu dealer'a ait olduğunu doğrula
    const product = db.prepare(
      'SELECT id FROM dealer_products WHERE id = ? AND dealer_id = ?'
    ).get(dealerProductId, req.dealer.id);
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

    const engine = new PricingEngine(db);
    const recommendation = await engine.evaluateProduct(dealerProductId, { persist: false });

    if (!recommendation) {
      return res.status(422).json({
        error: 'Bu ürün için öneri üretilemedi (maliyet eksik veya fiyat tanımsız)',
      });
    }

    res.json(recommendation);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/pricing/rules
// Tüm pricing kurallarını listele (is_active filtresi opsiyonel).
// ══════════════════════════════════════════════════════════════════════════════
router.get('/rules', (req, res) => {
  try {
    const { active } = req.query; // ?active=1 veya ?active=0
    let query  = 'SELECT * FROM pricing_rules';
    const args = [];

    if (active === '1' || active === '0') {
      query += ' WHERE is_active = ?';
      args.push(Number(active));
    }
    query += ' ORDER BY priority ASC';

    const rules = db.prepare(query).all(...args);

    // parameters JSON string'i parse et
    rules.forEach(r => {
      try { r.parameters = JSON.parse(r.parameters || '{}'); } catch { r.parameters = {}; }
    });

    res.json(rules);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/pricing/rules/:id
// Body: { parameters?: {...}, is_active?: 0|1, priority?: number }
// ══════════════════════════════════════════════════════════════════════════════
router.put('/rules/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Geçersiz kural ID' });

    const existing = db.prepare('SELECT * FROM pricing_rules WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Kural bulunamadı' });

    const { parameters, is_active, priority } = req.body ?? {};
    const updates = [];
    const args    = [];

    if (parameters !== undefined) {
      if (typeof parameters !== 'object' || parameters === null) {
        return res.status(400).json({ error: 'parameters geçerli bir JSON objesi olmalıdır' });
      }
      updates.push('parameters = ?');
      args.push(JSON.stringify(parameters));
    }

    if (is_active !== undefined) {
      if (is_active !== 0 && is_active !== 1) {
        return res.status(400).json({ error: 'is_active 0 veya 1 olmalıdır' });
      }
      updates.push('is_active = ?');
      args.push(is_active);
    }

    if (priority !== undefined) {
      const p = parseInt(priority, 10);
      if (!Number.isFinite(p) || p < 1) {
        return res.status(400).json({ error: 'priority 1 veya üzeri tam sayı olmalıdır' });
      }
      updates.push('priority = ?');
      args.push(p);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi (parameters, is_active, priority)' });
    }

    updates.push("updated_at = datetime('now')");
    args.push(id);

    db.prepare(`UPDATE pricing_rules SET ${updates.join(', ')} WHERE id = ?`).run(...args);

    const updated = db.prepare('SELECT * FROM pricing_rules WHERE id = ?').get(id);
    try { updated.parameters = JSON.parse(updated.parameters || '{}'); } catch { updated.parameters = {}; }

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/pricing/scan
// Bu dealer'ın tüm ürünleri için fiyat önerisi üretir (cron ile aynı iş).
// ══════════════════════════════════════════════════════════════════════════════
router.post('/scan', async (req, res) => {
  try {
    const engine = new PricingEngine(db);
    const result = await engine.evaluateAllProducts(req.dealer.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
