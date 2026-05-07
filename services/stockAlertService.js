'use strict';

function getStockSettings(db, dealerId) {
  const rows = db.prepare(
    'SELECT key, value FROM dealer_settings WHERE dealer_id = ?'
  ).all(dealerId);
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    criticalPct:  Number(m.stock_alert_threshold_pct)  || 10,
    warningPct:   Number(m.stock_warning_threshold_pct) || 20,
    syncInterval: Number(m.xml_sync_interval_hours)     || 4,
  };
}

function getStockAlerts(db, dealerId) {
  const { criticalPct, warningPct } = getStockSettings(db, dealerId);

  // Window function: her xml_feed_id partition'ındaki maksimum stoku referans al.
  // xml_feed_id NULL olan ürünler kendi aralarında ayrı bir partition oluşturur.
  const rows = db.prepare(`
    SELECT
      dp.id,
      dp.title,
      dp.barcode,
      dp.stock          AS current_stock,
      dp.supplier_name,
      dp.updated_at,
      dp.xml_feed_id,
      xf.name           AS feed_name,
      xf.last_imported,
      MAX(dp.stock) OVER (PARTITION BY dp.xml_feed_id) AS ref_stock
    FROM dealer_products dp
    LEFT JOIN xml_feeds xf ON xf.id = dp.xml_feed_id
    WHERE dp.dealer_id = ?
  `).all(dealerId);

  const lastSyncAt = rows.reduce((best, r) => {
    if (!r.last_imported) return best;
    return !best || r.last_imported > best ? r.last_imported : best;
  }, null);

  const critical = [], warning = [], ok = [];

  for (const row of rows) {
    const ref = (row.ref_stock > 0) ? row.ref_stock : 1;
    const pct = Math.round((row.current_stock / ref) * 100);

    const item = {
      id:           row.id,
      title:        row.title,
      barcode:      row.barcode,
      currentStock: row.current_stock,
      refStock:     row.ref_stock,
      stockPct:     pct,
      supplierName: row.supplier_name,
      feedName:     row.feed_name,
      updatedAt:    row.updated_at,
    };

    if      (pct <= criticalPct) critical.push({ ...item, status: 'critical' });
    else if (pct <= warningPct)  warning.push({ ...item, status: 'warning' });
    else                         ok.push({ ...item, status: 'ok' });
  }

  critical.sort((a, b) => a.stockPct - b.stockPct);
  warning.sort((a, b) => a.stockPct - b.stockPct);

  return {
    critical,
    warning,
    ok,
    summary: {
      totalProducts: rows.length,
      criticalCount: critical.length,
      warningCount:  warning.length,
      okCount:       ok.length,
      lastSyncAt,
    },
  };
}

function updateStockSettings(db, dealerId, { criticalPct, warningPct }) {
  const upsert = db.prepare(`
    INSERT INTO dealer_settings (dealer_id, key, value)
    VALUES (?, ?, ?)
    ON CONFLICT(dealer_id, key) DO UPDATE SET value = excluded.value
  `);
  db.transaction(() => {
    upsert.run(dealerId, 'stock_alert_threshold_pct',  String(criticalPct));
    upsert.run(dealerId, 'stock_warning_threshold_pct', String(warningPct));
  })();
}

module.exports = { getStockSettings, getStockAlerts, updateStockSettings };
