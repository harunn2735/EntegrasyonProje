-- migrations/005_add_customer_reviews.sql
CREATE TABLE IF NOT EXISTS customer_reviews (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id           INTEGER NOT NULL,
  product_id          TEXT,
  barcode             TEXT,
  product_name        TEXT,
  trendyol_review_id  TEXT NOT NULL,
  customer_name       TEXT,
  rating              INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  review_text         TEXT NOT NULL DEFAULT '',
  review_date         DATETIME,
  sentiment           TEXT CHECK(sentiment IN ('pozitif', 'negatif', 'nötr')),
  category            TEXT CHECK(category IN ('Kalite', 'Kargo', 'Fiyat', 'Beklenti', 'Diğer')),
  urgency             TEXT CHECK(urgency IN ('yüksek', 'orta', 'düşük')),
  ai_response         TEXT,
  approved_response   TEXT,
  status              TEXT NOT NULL DEFAULT 'Bekliyor'
                        CHECK(status IN ('Bekliyor', 'Onaylandı', 'Gönderildi', 'Reddedildi')),
  created_at          DATETIME DEFAULT (datetime('now')),
  processed_at        DATETIME,
  UNIQUE(dealer_id, trendyol_review_id),
  FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reviews_dealer_status    ON customer_reviews(dealer_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_dealer_sentiment ON customer_reviews(dealer_id, sentiment);
CREATE INDEX IF NOT EXISTS idx_reviews_rating           ON customer_reviews(dealer_id, rating);
CREATE INDEX IF NOT EXISTS idx_reviews_created          ON customer_reviews(dealer_id, created_at DESC);
