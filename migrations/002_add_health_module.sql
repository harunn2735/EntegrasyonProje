-- Migration: 002_add_health_module
-- Ürün Sağlık Merkezi modülü için gerekli tablolar

-- ── 1. question_categories ──────────────────────────────────────────────────
-- Her soruya atanan kategori etiketi (AI analizi sonucu).
-- Bir soru birden fazla kategoride yer alabilir.
CREATE TABLE IF NOT EXISTS question_categories (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id      INTEGER NOT NULL,
  category         TEXT    NOT NULL CHECK(category IN (
                     'urun_ozellikleri',
                     'kargo_teslimat',
                     'iade_talebi',
                     'fiyat_kampanya',
                     'stok_durumu'
                   )),
  confidence_score REAL    NOT NULL DEFAULT 1.0
                           CHECK(confidence_score >= 0 AND confidence_score <= 1),
  analyzed_at      DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_qcat_question_id ON question_categories(question_id);
CREATE INDEX IF NOT EXISTS idx_qcat_category    ON question_categories(category);

-- ── 2. product_health_scores ────────────────────────────────────────────────
-- Ürün başına hesaplanan bileşik sağlık skoru.
-- Her hesaplama yeni bir satır ekler; en güncel kayıt geçerlidir.
CREATE TABLE IF NOT EXISTS product_health_scores (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_product_id INTEGER,                    -- dealer_products.id; NULL ise title bazlı
  product_title     TEXT    NOT NULL,
  sales_score       REAL    NOT NULL DEFAULT 0  CHECK(sales_score    >= 0 AND sales_score    <= 100),
  refund_score      REAL    NOT NULL DEFAULT 0  CHECK(refund_score   >= 0 AND refund_score   <= 100),
  question_score    REAL    NOT NULL DEFAULT 0  CHECK(question_score >= 0 AND question_score <= 100),
  overall_score     REAL    NOT NULL DEFAULT 0  CHECK(overall_score  >= 0 AND overall_score  <= 100),
  alerts            TEXT    NOT NULL DEFAULT '[]',  -- JSON array: [{ type, message, severity }]
  calculated_at     DATETIME DEFAULT (datetime('now')),
  FOREIGN KEY (dealer_product_id) REFERENCES dealer_products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_phs_dealer_product_id ON product_health_scores(dealer_product_id);
CREATE INDEX IF NOT EXISTS idx_phs_overall_score     ON product_health_scores(overall_score);
CREATE INDEX IF NOT EXISTS idx_phs_calculated_at     ON product_health_scores(calculated_at);
