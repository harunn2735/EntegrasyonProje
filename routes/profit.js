// routes/profit.js
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const { simulateProfit } = require('../services/profitCalculator');

const config = {
  MIN_PROFIT_MARGIN_THRESHOLD: Number(process.env.MIN_PROFIT_MARGIN_THRESHOLD ?? 15),
  DEFAULT_SHIPPING_COST: Number(process.env.DEFAULT_SHIPPING_COST ?? 15),
  DEFAULT_RETURN_PROVISION_RATE: Number(process.env.DEFAULT_RETURN_PROVISION_RATE ?? 0.02),
  DEFAULT_COMMISSION_RATE: Number(process.env.DEFAULT_COMMISSION_RATE ?? 12),
  DEFAULT_COST_RATIO: Number(process.env.DEFAULT_COST_RATIO ?? 0.60),
};

// ── Yardımcı: dönem filtresi ────────────────────────────────
function getPeriodRange(period, start, end) {
  const now = new Date();
  if (period === 'custom') {
    if (!start || !end) return null; // 400 tetikler
    return { start: `${start} 00:00:00`, end: `${end} 23:59:59` };
  }
  const from = new Date(now);
  if (period === 'daily') from.setDate(now.getDate() - 1);
  else if (period === 'weekly') from.setDate(now.getDate() - 7);
  else if (period === 'monthly') from.setMonth(now.getMonth() - 1);
  else from.setDate(now.getDate() - 7); // varsayılan weekly
  return {
    start: from.toISOString().replace('T', ' ').substring(0, 19),
    end: now.toISOString().replace('T', ' ').substring(0, 19)
  };
}

// ── GET /api/profit/summary ─────────────────────────────────
router.get('/profit/summary', (req, res) => {
  try {
    const { period = 'weekly', start, end } = req.query;
    const range = getPeriodRange(period, start, end);
    if (!range) return res.status(400).json({ error: 'period=custom için start ve end zorunludur' });

    const row = db.prepare(`
      SELECT
        COUNT(DISTINCT order_number) as orderCount,
        ROUND(SUM(sale_price), 2)          as totalRevenue,
        ROUND(SUM(cost_price), 2)          as totalCost,
        ROUND(SUM(actual_commission), 2)   as totalCommission,
        ROUND(SUM(net_profit), 2)          as totalProfit,
        ROUND(AVG(profit_margin), 2)       as avgMargin
      FROM profit_records
      WHERE dealer_id = ? AND created_at BETWEEN ? AND ?
    `).get(req.dealer.id, range.start, range.end);

    res.json(row || { orderCount: 0, totalRevenue: 0, totalCost: 0, totalCommission: 0, totalProfit: 0, avgMargin: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/profit/by-product ──────────────────────────────
router.get('/profit/by-product', (req, res) => {
  try {
    const { page = 1, limit = 50, sortBy = 'totalProfit', sortDir = 'desc' } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;
    const allowed = ['totalProfit', 'totalRevenue', 'avgMargin', 'soldCount'];
    const col = allowed.includes(sortBy) ? sortBy : 'totalProfit';
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';

    const rows = db.prepare(`
      SELECT
        pr.barcode,
        dp.id                           as productId,
        dp.title,
        COUNT(pr.id)                    as soldCount,
        ROUND(SUM(pr.sale_price), 2)    as totalRevenue,
        ROUND(SUM(pr.net_profit), 2)    as totalProfit,
        ROUND(AVG(pr.profit_margin), 2) as avgMargin
      FROM profit_records pr
      LEFT JOIN dealer_products dp ON dp.barcode = pr.barcode AND dp.dealer_id = pr.dealer_id
      WHERE pr.dealer_id = ?
      GROUP BY pr.barcode
      ORDER BY ${col} ${dir}
      LIMIT ? OFFSET ?
    `).all(req.dealer.id, limitNum, offset);

    const { total } = db.prepare(
      'SELECT COUNT(DISTINCT barcode) as total FROM profit_records WHERE dealer_id = ?'
    ).get(req.dealer.id);

    res.json({ products: rows, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/profit/by-category ────────────────────────────
router.get('/profit/by-category', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        cr.category_id,
        cr.category_name,
        cr.rate,
        cr.kdv_rate,
        COUNT(pr.id)                        as orderCount,
        ROUND(SUM(pr.actual_commission), 2) as totalCommission,
        ROUND(SUM(pr.net_profit), 2)        as totalProfit,
        ROUND(AVG(pr.profit_margin), 2)     as avgMargin
      FROM commission_rates cr
      LEFT JOIN profit_records pr ON pr.category_id = cr.category_id AND pr.dealer_id = ?
      GROUP BY cr.category_id
      ORDER BY totalProfit DESC
    `).all(req.dealer.id);

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/profit/order/:orderId ─────────────────────────
router.get('/profit/order/:orderId', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM profit_records
      WHERE dealer_id = ? AND order_number = ?
      ORDER BY id ASC
    `).all(req.dealer.id, req.params.orderId);

    if (!rows.length) return res.status(404).json({ error: 'Bu sipariş için kâr kaydı bulunamadı' });
    res.json({ order_number: req.params.orderId, lines: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/profit/simulate ────────────────────────────────
router.get('/profit/simulate', (req, res) => {
  try {
    const { productId, price } = req.query;
    if (!productId || !price) return res.status(400).json({ error: 'productId ve price zorunludur' });
    const parsedId = parseInt(productId, 10);
    const parsedPrice = parseFloat(price);
    if (!Number.isFinite(parsedId) || parsedId <= 0) return res.status(400).json({ error: 'productId geçerli bir tam sayı olmalıdır' });
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return res.status(400).json({ error: 'price geçerli bir pozitif sayı olmalıdır' });

    const result = simulateProfit({
      productId: parsedId,
      price: parsedPrice,
      db,
      config,
      dealerId: req.dealer.id  // başka dealer'ın ürününü simüle edemez
    });

    if (!result) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/profit/alerts ──────────────────────────────────
router.get('/profit/alerts', (req, res) => {
  try {
    const { type, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;
    const allowedTypes = ['LOW_MARGIN', 'COMMISSION_MISMATCH'];
    let where = 'WHERE dealer_id = ?';
    const params = [req.dealer.id];

    if (type && allowedTypes.includes(type)) {
      where += ' AND alert_type = ?';
      params.push(type);
    }

    const alerts = db.prepare(
      `SELECT * FROM alert_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limitNum, offset);
    const { total } = db.prepare(
      `SELECT COUNT(*) as total FROM alert_logs ${where}`
    ).get(...params);

    res.json({ alerts, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/commission-rates/sync ────────────────────────
// Not: Trendyol'un kamuya açık bir komisyon oranı API'si bulunmamaktadır.
// Bu endpoint body'den gelen oranları transaction içinde kaydeder.
// Body: { rates: [{ category_id, category_name, rate, kdv_rate }] }
router.post('/commission-rates/sync', (req, res) => {
  const { rates } = req.body;
  if (!Array.isArray(rates) || rates.length === 0) {
    return res.status(400).json({ error: 'rates dizisi zorunludur' });
  }

  const upsert = db.prepare(`
    INSERT INTO commission_rates (category_id, category_name, rate, kdv_rate, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(category_id) DO UPDATE SET
      category_name = excluded.category_name,
      rate          = excluded.rate,
      kdv_rate      = excluded.kdv_rate,
      updated_at    = datetime('now')
  `);

  const errors = [];
  let updated = 0;

  const tx = db.transaction(() => {
    for (const r of rates) {
      try {
        if (!r.category_id || !r.category_name || r.rate == null) {
          errors.push({ category_id: r.category_id, reason: 'category_id, category_name ve rate zorunludur' });
          continue;
        }
        if (![8, 10, 20].includes(Number(r.kdv_rate))) {
          errors.push({ category_id: r.category_id, reason: 'kdv_rate 8, 10 veya 20 olmalıdır' });
          continue;
        }
        upsert.run(String(r.category_id), r.category_name, Number(r.rate), Number(r.kdv_rate));
        updated++;
      } catch (e) {
        errors.push({ category_id: r.category_id, reason: e.message });
      }
    }
  });

  tx();
  res.json({ updated, errors });
});

module.exports = router;
