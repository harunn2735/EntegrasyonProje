// services/profitCalculator.js
'use strict';

// ── Yardımcı ────────────────────────────────────────────────
function round2(value) {
  return Math.round(value * 100) / 100;
}

// ── Commission Rate Cache (TTL: 5 dakika) ───────────────────
const _cache = new Map();

function getCommissionRate(category_id, db) {
  if (!category_id) return null;

  const cached = _cache.get(category_id);
  if (cached && Date.now() < cached.expiresAt) return cached;

  if (!db) return null;
  const row = db.prepare('SELECT rate, kdv_rate FROM commission_rates WHERE category_id = ?')
                .get(String(category_id));
  if (!row) return null;

  const entry = { rate: row.rate, kdv_rate: row.kdv_rate, expiresAt: Date.now() + 5 * 60 * 1000 };
  _cache.set(category_id, entry);
  return entry;
}

// ── Tek Line Hesabı (saf fonksiyon, DB gerektirmez) ─────────
/**
 * Bir sipariş kalemi için kâr hesabını yapar.
 * @param {object} line       - Sipariş satırı (lines_json'dan)
 * @param {number} index      - Satır index'i (kargo kimin üzerine yükleneceğini belirler)
 * @param {{ product, commissionRate, config }} opts
 */
function calculateLineProfit(line, index, { product, commissionRate, config }) {
  // discountedPrice varsa onu, yoksa price'ı kullan
  const sale_price = round2(line.discountedPrice ?? line.price ?? 0);
  const cost_price = round2(product?.cost_price ?? 0);
  const actual_commission = round2(line.commission ?? 0);

  const rate = commissionRate?.rate ?? config.DEFAULT_COMMISSION_RATE;
  const kdv_rate = commissionRate?.kdv_rate ?? 20;

  const expected_commission = round2(sale_price * rate / 100);
  // Trendyol komisyonu KDV dahil gelir; KDV payı içinden ayrıştırılır
  const kdv_amount = round2(actual_commission - actual_commission / (1 + kdv_rate / 100));
  // Kargo maliyeti sipariş bazlı sabit bir gider;
  // birden fazla line'a bölünmez, yalnızca ilk line'a yüklenir.
  const shipping_cost = index === 0 ? Number(config.DEFAULT_SHIPPING_COST) : 0;
  const return_provision = round2(sale_price * Number(config.DEFAULT_RETURN_PROVISION_RATE));

  const net_profit = round2(
    sale_price - cost_price - actual_commission - kdv_amount - shipping_cost - return_provision
  );
  const profit_margin = sale_price > 0 ? round2((net_profit / sale_price) * 100) : 0;

  return {
    barcode: line.barcode,
    sale_price,
    cost_price,
    actual_commission,
    expected_commission,
    kdv_amount,
    shipping_cost,
    return_provision,
    net_profit,
    profit_margin,
    rate_used: rate,
    kdv_rate_used: kdv_rate
  };
}

// ── Sipariş Kâr Hesabı (DB gerektirir) ─────────────────────
/**
 * Bir siparişin tüm kalemlerini hesaplar ve profit_records'a kaydeder.
 * @param {object} order         - orders tablosundan gelen satır
 * @param {{ db, config, alertService }} opts
 */
async function calculateOrderProfit(order, { db, config, alertService }) {
  const lines = JSON.parse(order.lines_json || '[]');
  const getProduct = db.prepare(
    'SELECT cost_price, xml_category_id FROM dealer_products WHERE barcode = ? AND dealer_id = ?'
  );
  const insertProfit = db.prepare(`
    INSERT OR IGNORE INTO profit_records
      (order_number, dealer_id, barcode, category_id,
       sale_price, cost_price, actual_commission, expected_commission,
       kdv_amount, shipping_cost, return_provision, net_profit, profit_margin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const barcode = line.barcode || '';

    const product = barcode ? getProduct.get(barcode, order.dealer_id) : null;
    const category_id = product?.xml_category_id ? String(product.xml_category_id) : null;
    const commissionRate = getCommissionRate(category_id, db);

    const r = calculateLineProfit(line, i, { product, commissionRate, config });

    insertProfit.run(
      order.order_number, order.dealer_id, r.barcode, category_id,
      r.sale_price, r.cost_price, r.actual_commission, r.expected_commission,
      r.kdv_amount, r.shipping_cost, r.return_provision, r.net_profit, r.profit_margin
    );

    // Komisyon denetimi: fark > %5 ise alert
    if (alertService && r.expected_commission > 0) {
      alertService.checkCommissionMismatch({
        dealer_id: order.dealer_id,
        order_number: order.order_number,
        barcode: r.barcode,
        actual: r.actual_commission,
        expected: r.expected_commission,
        db
      });
    }

    // Düşük marj uyarısı
    if (alertService && r.profit_margin < Number(config.MIN_PROFIT_MARGIN_THRESHOLD)) {
      alertService.checkMargin({
        dealer_id: order.dealer_id,
        order_number: order.order_number,
        barcode: r.barcode,
        margin: r.profit_margin,
        threshold: Number(config.MIN_PROFIT_MARGIN_THRESHOLD),
        db
      });
    }
  }
}

// ── Simülasyon (DB okur, kayıt yazmaz) ─────────────────────
/**
 * Belirtilen fiyat ile kâr simülasyonu yapar. DB'ye kayıt yazmaz.
 * @param {{ productId, price, db, config, dealerId }} opts
 */
function simulateProfit({ productId, price, db, config, dealerId }) {
  const product = db.prepare(
    'SELECT cost_price, xml_category_id FROM dealer_products WHERE id = ? AND dealer_id = ?'
  ).get(productId, dealerId);

  if (!product) return null;

  const category_id = product.xml_category_id ? String(product.xml_category_id) : null;
  const commissionRate = getCommissionRate(category_id, db);

  const mockLine = { price: Number(price), commission: 0, barcode: '' };
  // Simulate: actual_commission = expected_commission (tahmin modunda gerçek veri yok)
  const rate = commissionRate?.rate ?? config.DEFAULT_COMMISSION_RATE;
  const sale_price = round2(Number(price));
  mockLine.commission = round2(sale_price * rate / 100);

  const r = calculateLineProfit(mockLine, 0, { product, commissionRate, config });
  return {
    sale_price: r.sale_price,
    cost_price: r.cost_price,
    commission_amount: r.actual_commission,
    kdv_amount: r.kdv_amount,
    shipping_cost: r.shipping_cost,
    return_provision: r.return_provision,
    net_profit: r.net_profit,
    profit_margin: r.profit_margin,
    rate_used: r.rate_used,
    kdv_rate_used: r.kdv_rate_used
  };
}

module.exports = { calculateLineProfit, calculateOrderProfit, simulateProfit, getCommissionRate };
