// services/profitAlert.js
'use strict';

/**
 * Kâr marjı minimum eşiğin altındaysa alert_logs'a LOW_MARGIN kaydı ekler.
 * @param {{ dealer_id, order_number, barcode, margin, threshold, db }} opts
 */
function checkMargin({ dealer_id, order_number, barcode, margin, threshold, db }) {
  if (margin >= threshold) return;

  console.warn(`[ProfitAlert] LOW_MARGIN — ${barcode} @ sipariş ${order_number}: %${margin} < %${threshold}`);

  db.prepare(`
    INSERT INTO alert_logs (dealer_id, order_number, barcode, alert_type, margin, threshold, detail)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(dealer_id, order_number, barcode, 'LOW_MARGIN', margin, threshold);
}

/**
 * Gerçek komisyon ile beklenen komisyon arasındaki fark %5'ten fazlaysa
 * alert_logs'a COMMISSION_MISMATCH kaydı ekler.
 * @param {{ dealer_id, order_number, barcode, actual, expected, db }} opts
 */
function checkCommissionMismatch({ dealer_id, order_number, barcode, actual, expected, db }) {
  if (expected === 0) return;
  const diff_pct = Math.abs(actual - expected) / expected;
  if (diff_pct <= 0.05) return;

  const detail = JSON.stringify({ actual, expected, diff_pct: Math.round(diff_pct * 10000) / 100 });
  console.warn(`[ProfitAlert] COMMISSION_MISMATCH — ${barcode}: actual=${actual}, expected=${expected}, fark=%${(diff_pct * 100).toFixed(1)}`);

  db.prepare(`
    INSERT INTO alert_logs (dealer_id, order_number, barcode, alert_type, margin, threshold, detail)
    VALUES (?, ?, ?, ?, NULL, NULL, ?)
  `).run(dealer_id, order_number, barcode, 'COMMISSION_MISMATCH', detail);
}

module.exports = { checkMargin, checkCommissionMismatch };
