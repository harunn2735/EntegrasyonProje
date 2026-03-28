// services/demandForecast.js
'use strict';

const db = require('../database');

/**
 * Son 28 günün siparişlerinden barkod bazlı haftalık satış haritası oluşturur.
 * @param {number} dealerId
 * @returns {Object} { [barcode]: [w0, w1, w2, w3] } — index 0 en eski, 3 en yeni hafta
 */
function getWeeklySalesByBarcode(dealerId) {
  const orders = db
    .prepare(
      `SELECT order_date, lines_json
       FROM orders
       WHERE dealer_id = ?
         AND order_date >= datetime('now', '-28 days')
         AND status NOT IN ('Cancelled', 'Returned', 'UnDelivered')`
    )
    .all(dealerId);

  const now = Date.now();
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const salesMap = {};

  for (const order of orders) {
    const ageMs = now - new Date(order.order_date).getTime();
    const weekIndex = Math.min(3, Math.floor(ageMs / ONE_WEEK_MS)); // 0=bu hafta, 3=en eski
    const slotIndex = 3 - weekIndex; // ters çevir: 0=en eski, 3=en yeni

    let lines;
    try {
      lines = JSON.parse(order.lines_json || '[]');
    } catch {
      lines = [];
    }

    for (const line of lines) {
      if (!line.barcode) continue;
      if (!salesMap[line.barcode]) salesMap[line.barcode] = [0, 0, 0, 0];
      salesMap[line.barcode][slotIndex] += Number(line.quantity) || 1;
    }
  }

  return salesMap;
}

/**
 * 4 haftalık satış dizisinden tahmin hesaplar.
 * @param {number[]} weeklySales — [en_eski, ..., en_yeni]
 * @returns {{ avg4weeks: number, trend: number, forecast7d: number }}
 */
function calculateForecast(weeklySales) {
  const total = weeklySales.reduce((a, b) => a + b, 0);
  const avg4weeks = Math.round((total / 4) * 10) / 10;

  const oldest = weeklySales[0];
  const newest = weeklySales[3];
  const trend =
    oldest === 0
      ? newest > 0 ? 1 : 0
      : Math.round(((newest - oldest) / oldest) * 100) / 100;

  // Ağırlıklı tahmin: son hafta %60, önceki hafta %40
  const forecast7d =
    Math.max(0, Math.round((weeklySales[3] * 0.6 + weeklySales[2] * 0.4) * 10) / 10);

  return { avg4weeks, trend, forecast7d };
}

/**
 * Stok ve tahmin satışa göre durum döndürür.
 * @param {number} stock
 * @param {number} forecast7d
 * @returns {'kritik'|'uyarı'|'yeterli'}
 */
function classifyStock(stock, forecast7d) {
  if (forecast7d === 0) return 'yeterli';
  if (stock < forecast7d) return 'kritik';
  if (stock < forecast7d * 2) return 'uyarı';
  return 'yeterli';
}

/**
 * Dealer'ın tüm ürünleri için tahmin listesi — kritikler önde.
 * @param {number} dealerId
 * @returns {Array}
 */
function getDealerForecast(dealerId) {
  const products = db
    .prepare(
      `SELECT id, barcode, title, category, stock
       FROM dealer_products
       WHERE dealer_id = ?
       ORDER BY title`
    )
    .all(dealerId);

  const salesMap = getWeeklySalesByBarcode(dealerId);

  const results = products.map((product) => {
    const weeklySales = salesMap[product.barcode] || [0, 0, 0, 0];
    const { avg4weeks, trend, forecast7d } = calculateForecast(weeklySales);
    const status = classifyStock(product.stock, forecast7d);
    const trendLabel = trend > 0.1 ? 'Artıyor' : trend < -0.1 ? 'Azalıyor' : 'Stabil';

    return {
      id: product.id,
      barcode: product.barcode,
      title: product.title,
      category: product.category || '',
      stock: product.stock,
      weeklySales,
      avg4weeks,
      trend,
      trendLabel,
      forecast7d,
      status,
    };
  });

  const order = { kritik: 0, uyarı: 1, yeterli: 2 };
  return results.sort((a, b) => order[a.status] - order[b.status]);
}

/**
 * Tek ürün için detaylı tahmin.
 * @param {number} dealerId
 * @param {number} productId — dealer_products.id
 * @returns {Object|null}
 */
function getProductForecast(dealerId, productId) {
  const product = db
    .prepare(
      `SELECT id, barcode, title, category, stock
       FROM dealer_products
       WHERE dealer_id = ? AND id = ?`
    )
    .get(dealerId, productId);

  if (!product) return null;

  const salesMap = getWeeklySalesByBarcode(dealerId);
  const weeklySales = salesMap[product.barcode] || [0, 0, 0, 0];
  const { avg4weeks, trend, forecast7d } = calculateForecast(weeklySales);
  const status = classifyStock(product.stock, forecast7d);
  const trendLabel = trend > 0.1 ? 'Artıyor' : trend < -0.1 ? 'Azalıyor' : 'Stabil';

  return {
    id: product.id,
    barcode: product.barcode,
    title: product.title,
    category: product.category || '',
    stock: product.stock,
    weeklySales,
    avg4weeks,
    trend,
    trendLabel,
    forecast7d,
    status,
  };
}

module.exports = { getDealerForecast, getProductForecast };
