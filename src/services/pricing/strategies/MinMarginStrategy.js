// src/services/pricing/strategies/MinMarginStrategy.js
// Güvenlik katmanı: diğer kuralların önerdiği fiyat minimum kâr marjını
// ihlal ediyorsa fiyatı zorla minimum düzeye çeker.
// evaluate() DEĞİL, enforce(currentPrice, proposedPrice) ile çalışır.
'use strict';

const BaseStrategy = require('./BaseStrategy');

class MinMarginStrategy extends BaseStrategy {
  // parameters örnek: { "min_margin_percent": 5 }

  /**
   * Önerilen fiyatın minimum marj koşulunu sağlayıp sağlamadığını kontrol eder.
   * Sağlamazsa minimum izin verilen fiyata yükseltir.
   *
   * @param {number} currentPrice   - Şu anki satış fiyatı (referans)
   * @param {number} proposedPrice  - Diğer kuralların önerdiği fiyat
   * @returns {{
   *   enforced:   boolean,   // true ise müdahale gerçekleşti
   *   finalPrice: number,    // Uygulanacak nihai fiyat
   *   reason:     string,    // Türkçe açıklama (enforced=true ise)
   *   details:    object     // İzleme için ham veriler
   * }}
   */
  enforce(currentPrice, proposedPrice) {
    const cost      = this.productData.cost_price || 0;
    const minMargin = (this.parameters.min_margin_percent ?? 5) / 100;

    // Maliyet bilgisi yoksa minimum marj koruması uygulanamaz
    if (cost <= 0) {
      return {
        enforced:   false,
        finalPrice: proposedPrice,
        reason:     'Maliyet bilgisi eksik, minimum marj kontrolü atlandı',
        details:    { cost, minMargin },
      };
    }

    const minAllowedPrice = Math.round(cost * (1 + minMargin) * 100) / 100;

    if (proposedPrice < minAllowedPrice) {
      const diff = Math.round((minAllowedPrice - proposedPrice) * 100) / 100;
      return {
        enforced:   true,
        finalPrice: minAllowedPrice,
        reason: (
          `⚠️ Minimum marj koruması devreye girdi — önerilen fiyat ₺${proposedPrice.toFixed(2)} ` +
          `(maliyet ₺${cost.toFixed(2)} üzerine yalnızca ` +
          `%${(((proposedPrice - cost) / cost) * 100).toFixed(1)} marj). ` +
          `%${this.parameters.min_margin_percent} minimum marj için ` +
          `₺${diff.toFixed(2)} yükseltilerek ₺${minAllowedPrice.toFixed(2)} uygulandı`
        ),
        details: {
          cost,
          minMarginPercent:  this.parameters.min_margin_percent,
          minAllowedPrice,
          originalProposal:  proposedPrice,
          correctionAmount:  diff,
        },
      };
    }

    // Marj yeterli, müdahale yok
    return {
      enforced:   false,
      finalPrice: proposedPrice,
      reason:     '',
      details: {
        cost,
        minAllowedPrice,
        actualMarginPercent:
          Math.round(((proposedPrice - cost) / cost) * 10000) / 100,
      },
    };
  }

  // MinMarginStrategy evaluate() ile kullanılmaz (enforce() çağrılır)
  evaluate() {
    return null;
  }
}

module.exports = MinMarginStrategy;
