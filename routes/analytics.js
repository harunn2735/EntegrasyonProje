// routes/analytics.js
'use strict';

const express = require('express');
const db = require('../database');

const router = express.Router();

// İptal/iade siparişleri hariç tut
const ACTIVE = `status NOT IN ('Cancelled', 'Returned', 'UnDelivered')`;

// ── ÖZET: bugün / bu hafta / bu ay toplam ─────────────────────
router.get('/summary', (req, res) => {
  try {
    const row = db
      .prepare(
        `SELECT
          ROUND(SUM(CASE WHEN date(order_date) = date('now') THEN total_price ELSE 0 END), 2)            AS today_revenue,
          COUNT(CASE WHEN date(order_date) = date('now') THEN 1 END)                                     AS today_orders,
          ROUND(SUM(CASE WHEN strftime('%Y-%W', order_date) = strftime('%Y-%W', 'now') THEN total_price ELSE 0 END), 2) AS week_revenue,
          COUNT(CASE WHEN strftime('%Y-%W', order_date) = strftime('%Y-%W', 'now') THEN 1 END)           AS week_orders,
          ROUND(SUM(CASE WHEN strftime('%Y-%m', order_date) = strftime('%Y-%m', 'now') THEN total_price ELSE 0 END), 2) AS month_revenue,
          COUNT(CASE WHEN strftime('%Y-%m', order_date) = strftime('%Y-%m', 'now') THEN 1 END)           AS month_orders,
          COUNT(*)                                                                                        AS total_orders,
          ROUND(SUM(total_price), 2)                                                                     AS total_revenue,
          ROUND(SUM(net_price), 2)                                                                       AS total_net_revenue
        FROM orders
        WHERE dealer_id = ? AND ${ACTIVE}`
      )
      .get(req.dealer.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GÜNLÜK: son N gün, boşluklar sıfırla doldurulur ──────────
router.get('/daily', (req, res) => {
  try {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
    const modifier = `-${days} days`;

    const rows = db
      .prepare(
        `SELECT date(order_date) AS day,
                COUNT(*) AS orders,
                ROUND(SUM(total_price), 2) AS revenue,
                ROUND(SUM(net_price), 2) AS net_revenue
         FROM orders
         WHERE dealer_id = ? AND ${ACTIVE}
           AND order_date >= date('now', ?)
         GROUP BY date(order_date)
         ORDER BY day ASC`
      )
      .all(req.dealer.id, modifier);

    // Eksik günleri sıfırla doldur (UTC bazlı)
    const map = Object.fromEntries(rows.map((r) => [r.day, r]));
    const result = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)
      )
        .toISOString()
        .slice(0, 10);
      result.push(map[day] ?? { day, orders: 0, revenue: 0, net_revenue: 0 });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── HAFTALIK: son 12 hafta ────────────────────────────────────
router.get('/weekly', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT strftime('%Y-%W', order_date) AS week,
                COUNT(*) AS orders,
                ROUND(SUM(total_price), 2) AS revenue,
                ROUND(SUM(net_price), 2) AS net_revenue
         FROM orders
         WHERE dealer_id = ? AND ${ACTIVE}
           AND order_date >= date('now', '-84 days')
         GROUP BY strftime('%Y-%W', order_date)
         ORDER BY week ASC`
      )
      .all(req.dealer.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AYLIK: son 12 ay, boşluklar sıfırla doldurulur ───────────
router.get('/monthly', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT strftime('%Y-%m', order_date) AS month,
                COUNT(*) AS orders,
                ROUND(SUM(total_price), 2) AS revenue,
                ROUND(SUM(net_price), 2) AS net_revenue
         FROM orders
         WHERE dealer_id = ? AND ${ACTIVE}
           AND order_date >= date('now', '-365 days')
         GROUP BY strftime('%Y-%m', order_date)
         ORDER BY month ASC`
      )
      .all(req.dealer.id);

    // Eksik ayları sıfırla doldur
    const map = Object.fromEntries(rows.map((r) => [r.month, r]));
    const result = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = d.toISOString().slice(0, 7); // YYYY-MM
      result.push(map[key] ?? { month: key, orders: 0, revenue: 0, net_revenue: 0 });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── EN ÇOK SATAN ÜRÜNLER: lines_json'u JS'de parse et ────────
router.get('/top-products', (req, res) => {
  try {
    const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 30));
    const modifier = `-${days} days`;

    const orders = db
      .prepare(
        `SELECT lines_json
         FROM orders
         WHERE dealer_id = ? AND ${ACTIVE}
           AND order_date >= date('now', ?)`
      )
      .all(req.dealer.id, modifier);

    const productMap = {};
    for (const order of orders) {
      let lines;
      try {
        lines = JSON.parse(order.lines_json || '[]');
      } catch {
        lines = [];
      }
      for (const line of lines) {
        const key = line.barcode || line.title || 'Bilinmiyor';
        if (!productMap[key]) {
          productMap[key] = {
            title: line.title || key,
            barcode: line.barcode || '',
            quantity: 0,
            revenue: 0,
          };
        }
        productMap[key].quantity += Number(line.quantity) || 1;
        productMap[key].revenue += Number(line.price) || 0;
      }
    }

    const result = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map((p) => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SİPARİŞ DURUM DAĞILIMI ───────────────────────────────────
router.get('/status', (req, res) => {
  try {
    const row = db
      .prepare(
        `SELECT
          SUM(CASE WHEN status IN ('Delivered','Shipped') THEN 1 ELSE 0 END)                                                       AS delivered,
          SUM(CASE WHEN status NOT IN ('Delivered','Shipped','Cancelled','Returned','UnDelivered') THEN 1 ELSE 0 END)               AS processing,
          SUM(CASE WHEN status IN ('Cancelled','Returned','UnDelivered') THEN 1 ELSE 0 END)                                        AS cancelled
         FROM orders WHERE dealer_id = ?`
      )
      .get(req.dealer.id);
    res.json({
      delivered:  row.delivered  || 0,
      processing: row.processing || 0,
      cancelled:  row.cancelled  || 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
