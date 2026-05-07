// src/services/pricing/RuleRepository.js
// Dinamik fiyatlandırma modülünün tüm veri erişimini yönetir.
// better-sqlite3 prepared statement'leri kullanır — tüm sorgular sync.
'use strict';

class RuleRepository {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this._prepareStatements();
  }

  // ── Prepared statement'leri bir kez hazırla (performans) ───────────────────
  _prepareStatements() {
    // Ürün verisi: fiyatlandırma için gerekli tüm alanlar
    this._stmtGetProduct = this.db.prepare(`
      SELECT
        dp.id,
        dp.dealer_id,
        dp.barcode,
        dp.title,
        dp.stock,
        dp.cost_price,
        dp.sale_price,
        dp.supplier_name,
        dp.xml_feed_id,
        dp.critical_stock_level
      FROM dealer_products dp
      WHERE dp.id = ?
    `);

    // Uygulanabilir kurallar: product > supplier > global öncelik sırasıyla
    // scope_type = 'supplier' için scope_id, xml_feed_id ile eşleşir
    this._stmtGetRules = this.db.prepare(`
      SELECT pr.*
      FROM pricing_rules pr
      WHERE pr.is_active = 1
        AND (
          pr.scope_type = 'global'
          OR (pr.scope_type = 'product'   AND pr.scope_id = ?)
          OR (pr.scope_type = 'supplier'  AND pr.scope_id = (
                SELECT xml_feed_id FROM dealer_products WHERE id = ?
              ))
        )
      ORDER BY
        CASE pr.scope_type
          WHEN 'product'  THEN 0
          WHEN 'supplier' THEN 1
          ELSE                 2
        END ASC,
        pr.priority ASC
    `);

    // Satış hızı hesabı: json_each ile lines_json içinden barcode filtresi
    // is_refund = 0 ile iadeler hariç tutulur
    this._stmtGetVelocity = this.db.prepare(`
      SELECT
        COALESCE(
          SUM(CAST(json_extract(jl.value, '$.quantity') AS INTEGER)),
          0
        ) AS total_qty
      FROM   orders o,
             json_each(o.lines_json) jl
      WHERE  o.dealer_id   = ?
        AND  o.is_refund   = 0
        AND  o.order_date  >= datetime('now', '-' || ? || ' days')
        AND  json_extract(jl.value, '$.barcode') = ?
    `);

    // Öneri kaydetme
    this._stmtInsertRec = this.db.prepare(`
      INSERT INTO price_recommendations
        (dealer_product_id, current_price, recommended_price, price_change_percent,
         applied_rules, reasoning, confidence_score, status)
      VALUES
        (@dealer_product_id, @current_price, @recommended_price, @price_change_percent,
         @applied_rules, @reasoning, @confidence_score, @status)
    `);

    // Mevcut pending önerileri expire et (yeni öneri gelmeden önce)
    this._stmtExpirePending = this.db.prepare(`
      UPDATE price_recommendations
      SET    status = 'expired', decided_at = datetime('now')
      WHERE  dealer_product_id = ?
        AND  status = 'pending'
    `);
  }

  // ── Ürün verisi ─────────────────────────────────────────────────────────────
  /**
   * dealer_products kaydını döndürür.
   * @param {number} dealerProductId
   * @returns {object|null}
   */
  getDealerProduct(dealerProductId) {
    return this._stmtGetProduct.get(dealerProductId) ?? null;
  }

  // ── Kural listesi ────────────────────────────────────────────────────────────
  /**
   * Bir ürün için uygulanabilir tüm aktif kuralları öncelik sırasıyla döndürür.
   * Dar kapsam (product) geniş kapsamdan (global) önce gelir.
   * @param {number} dealerProductId
   * @returns {object[]}
   */
  getApplicableRules(dealerProductId) {
    return this._stmtGetRules.all(dealerProductId, dealerProductId);
  }

  // ── Satış hızı ───────────────────────────────────────────────────────────────
  /**
   * Belirtilen geri bakış penceresi içindeki toplam satış adedini döndürür.
   * lines_json JSON dizisi SQLite json_each() ile parse edilir.
   * @param {string} barcode
   * @param {number} dealerId
   * @param {number} lookbackDays
   * @returns {number} Toplam satış adedi (iade hariç)
   */
  getSalesVelocity(barcode, dealerId, lookbackDays) {
    const row = this._stmtGetVelocity.get(dealerId, lookbackDays, barcode);
    return row?.total_qty ?? 0;
  }

  // ── Öneri kaydetme ────────────────────────────────────────────────────────────
  /**
   * Mevcut 'pending' önerileri expire ederek yeni öneriyi kaydeder.
   * @param {import('./PriceRecommendation')} recommendation
   * @returns {number} Yeni kaydın id'si
   */
  saveRecommendation(recommendation) {
    const expireAndInsert = this.db.transaction((rec) => {
      // Eski bekleyen öneriyi geçersiz kıl (çift öneri karışıklığını önler)
      this._stmtExpirePending.run(rec.dealerProductId);
      const info = this._stmtInsertRec.run(rec.toDbRow());
      return info.lastInsertRowid;
    });

    return expireAndInsert(recommendation);
  }
}

module.exports = RuleRepository;
