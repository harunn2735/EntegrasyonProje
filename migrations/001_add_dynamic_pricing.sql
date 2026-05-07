-- Migration: 001_add_dynamic_pricing
-- Dinamik Fiyatlandırma modülü için gerekli tablolar

-- ── 1. pricing_rules ────────────────────────────────────────────────────────
-- Kural tanımları: min_margin | stock_based | velocity_based
CREATE TABLE IF NOT EXISTS pricing_rules (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  rule_type  TEXT    NOT NULL CHECK(rule_type IN ('min_margin', 'stock_based', 'velocity_based')),
  scope_type TEXT    NOT NULL DEFAULT 'global' CHECK(scope_type IN ('global', 'supplier', 'product')),
  scope_id   INTEGER,                          -- supplier_id veya dealer_product_id; global için NULL
  parameters TEXT    NOT NULL DEFAULT '{}',   -- JSON: kural parametreleri
  priority   INTEGER NOT NULL DEFAULT 10,     -- düşük = yüksek öncelik
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at DATETIME DEFAULT (datetime('now')),
  updated_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_is_active  ON pricing_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_rule_type  ON pricing_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_scope      ON pricing_rules(scope_type, scope_id);

-- ── 2. price_recommendations ────────────────────────────────────────────────
-- Sistem tarafından üretilen fiyat önerileri (öneri modu, otomatik uygulama yok)
-- NOT: products tablosu TEXT PK (barcode) kullandığından dealer_products(id) referans alındı.
--      Bu sayede öneri hem bayi hem ürün bazında tutulur.
CREATE TABLE IF NOT EXISTS price_recommendations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_product_id    INTEGER NOT NULL,
  current_price        REAL    NOT NULL,
  recommended_price    REAL    NOT NULL,
  price_change_percent REAL    NOT NULL,
  applied_rules        TEXT    NOT NULL DEFAULT '[]',  -- JSON: [{rule_id, rule_type, impact}]
  reasoning            TEXT    NOT NULL DEFAULT '',    -- insan-okunabilir gerekçe
  confidence_score     REAL    NOT NULL DEFAULT 0 CHECK(confidence_score >= 0 AND confidence_score <= 1),
  status               TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at           DATETIME DEFAULT (datetime('now')),
  decided_at           DATETIME,
  decided_by           TEXT,
  FOREIGN KEY (dealer_product_id) REFERENCES dealer_products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_price_rec_dealer_product ON price_recommendations(dealer_product_id);
CREATE INDEX IF NOT EXISTS idx_price_rec_status         ON price_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_price_rec_created_at     ON price_recommendations(created_at);

-- ── 3. price_history ────────────────────────────────────────────────────────
-- Gerçekleşen fiyat değişikliklerinin kalıcı kaydı
CREATE TABLE IF NOT EXISTS price_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_product_id INTEGER NOT NULL,
  old_price         REAL    NOT NULL,
  new_price         REAL    NOT NULL,
  change_reason     TEXT    NOT NULL DEFAULT '',
  recommendation_id INTEGER,                           -- öneri üzerinden değiştiyse FK; manuel ise NULL
  changed_at        DATETIME DEFAULT (datetime('now')),
  changed_by        TEXT    NOT NULL DEFAULT 'system' CHECK(changed_by IN ('system', 'user', 'manual')),
  FOREIGN KEY (dealer_product_id) REFERENCES dealer_products(id) ON DELETE CASCADE,
  FOREIGN KEY (recommendation_id) REFERENCES price_recommendations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_dealer_product ON price_history(dealer_product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_changed_at     ON price_history(changed_at);
