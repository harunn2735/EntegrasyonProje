// src/services/pricing/PriceRecommendation.js
// Dinamik fiyatlandırma motorunun ürettiği öneri nesnesini temsil eder.
// Hem iş mantığı (shouldPersist) hem de DB dönüşümü (toDbRow) burada.
'use strict';

class PriceRecommendation {
  /**
   * @param {object} opts
   * @param {number}   opts.dealerProductId      - dealer_products.id
   * @param {number}   opts.currentPrice         - Mevcut satış fiyatı
   * @param {number}   opts.recommendedPrice     - Motor tarafından önerilen fiyat
   * @param {number}   opts.priceChangePercent   - Değişim yüzdesi (negatif = indirim)
   * @param {Array}    opts.appliedRules          - Uygulanan kural listesi
   *                   [{ ruleId, ruleType, ruleName, contribution, details }]
   * @param {string}   opts.reasoning            - Kullanıcıya gösterilecek Türkçe gerekçe
   * @param {number}   opts.confidenceScore      - Güven skoru [0-1]
   * @param {boolean}  opts.marginCheckPassed    - Min-marj kontrolü geçti mi?
   * @param {string|null} opts.skipReason        - Öneri üretilmeyecekse açıklama, yoksa null
   */
  constructor({
    dealerProductId,
    currentPrice,
    recommendedPrice,
    priceChangePercent,
    appliedRules = [],
    reasoning = '',
    confidenceScore = 0,
    marginCheckPassed = true,
    skipReason = null,
  }) {
    this.dealerProductId    = dealerProductId;
    this.currentPrice       = currentPrice;
    this.recommendedPrice   = recommendedPrice;
    this.priceChangePercent = priceChangePercent;
    this.appliedRules       = appliedRules;
    this.reasoning          = reasoning;
    this.confidenceScore    = confidenceScore;
    this.marginCheckPassed  = marginCheckPassed;
    this.skipReason         = skipReason;
    this.createdAt          = new Date().toISOString();
  }

  /**
   * DB'ye kaydedilmeye değer mi?
   * - skipReason varsa: hayır
   * - Değişim %1'den küçükse: kaydetme (gürültülü öneri oluşmasın)
   */
  shouldPersist() {
    if (this.skipReason) return false;
    return Math.abs(this.priceChangePercent) >= 1;
  }

  /**
   * price_recommendations tablosuna INSERT için hazır nesne döndürür.
   * @returns {object}
   */
  toDbRow() {
    return {
      dealer_product_id:    this.dealerProductId,
      current_price:        this.currentPrice,
      recommended_price:    this.recommendedPrice,
      price_change_percent: this.priceChangePercent,
      applied_rules:        JSON.stringify(this.appliedRules),
      reasoning:            this.reasoning,
      confidence_score:     this.confidenceScore,
      status:               'pending',
    };
  }

  /**
   * Console/log için özet string
   */
  toString() {
    const dir = this.priceChangePercent >= 0 ? '▲' : '▼';
    return (
      `[Öneri] ürün=${this.dealerProductId} ` +
      `₺${this.currentPrice} → ₺${this.recommendedPrice} ` +
      `(${dir}%${Math.abs(this.priceChangePercent).toFixed(2)}) ` +
      `güven=${(this.confidenceScore * 100).toFixed(0)}%`
    );
  }
}

module.exports = PriceRecommendation;
