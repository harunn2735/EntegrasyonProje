// src/services/pricing/strategies/StockBasedStrategy.js
// Stok seviyesine göre fiyat önerir:
//   - Yüksek stok → eritmek için indirim
//   - Düşük stok  → kıtlık primi
// Stok bu iki eşik arasındaysa kural uygulanmaz (null döner).
'use strict';

const BaseStrategy = require('./BaseStrategy');

class StockBasedStrategy extends BaseStrategy {
  /*
   * Beklenen parameters örneği:
   * {
   *   "high_stock_threshold":          50,   // >= bu adet → indirim uygula
   *   "high_stock_price_decrease_percent":  5,
   *   "low_stock_threshold":           10,   // <= bu adet → prim uygula
   *   "low_stock_price_increase_percent":  10,
   *   "out_of_stock_action":           "hide"  // 0 stok için aksiyon (motoru etkilemez)
   * }
   */

  evaluate() {
    const stock = this.productData.stock ?? 0;
    const p     = this.parameters;

    const highThreshold     = p.high_stock_threshold               ?? 50;
    const highDecreaseRate  = p.high_stock_price_decrease_percent  ?? 5;
    const lowThreshold      = p.low_stock_threshold                ?? 10;
    const lowIncreaseRate   = p.low_stock_price_increase_percent   ?? 10;

    // Stok sıfırsa öneri üretme (ürün zaten satışa kapalı olmalı)
    if (stock === 0) return null;

    if (stock >= highThreshold) {
      return {
        contribution: -(highDecreaseRate / 100),
        reason: (
          `Stok fazlası tespit edildi (${stock} adet ≥ eşik ${highThreshold}). ` +
          `Stoğu eritmek için %${highDecreaseRate} indirim önerildi`
        ),
        details: {
          stock,
          threshold:  highThreshold,
          action:     'discount',
          rateApplied: highDecreaseRate,
        },
      };
    }

    if (stock <= lowThreshold) {
      return {
        contribution: +(lowIncreaseRate / 100),
        reason: (
          `Düşük stok uyarısı (${stock} adet ≤ eşik ${lowThreshold}). ` +
          `Kıtlık primi olarak %${lowIncreaseRate} zam önerildi`
        ),
        details: {
          stock,
          threshold:   lowThreshold,
          action:      'premium',
          rateApplied: lowIncreaseRate,
        },
      };
    }

    // Stok normal aralıkta: bu kural devreye girmez
    return null;
  }
}

module.exports = StockBasedStrategy;
