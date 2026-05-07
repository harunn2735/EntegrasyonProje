// src/services/pricing/strategies/BaseStrategy.js
// Tüm fiyatlandırma stratejileri için temel sınıf.
// Subclass'lar evaluate() metodunu override etmelidir.
'use strict';

class BaseStrategy {
  /**
   * @param {object}                                    rule        - pricing_rules satırı
   * @param {object}                                    productData - dealer_products satırı
   * @param {import('../RuleRepository')}               repository
   */
  constructor(rule, productData, repository) {
    this.rule        = rule;
    this.productData = productData;
    this.repository  = repository;

    // parameters alanı JSON string olarak saklanır; bir kez parse et
    try {
      this.parameters = JSON.parse(rule.parameters || '{}');
    } catch {
      this.parameters = {};
    }
  }

  /**
   * Kuralı değerlendirip fiyat değişim katkısını döndürür.
   *
   * Dönen değer biçimi:
   *   {
   *     contribution: number,   // -0.05 = %5 indirim, +0.05 = %5 zam
   *     reason:       string,   // Türkçe insan-okunabilir açıklama
   *     details:      object    // İzleme için ham veriler
   *   }
   *
   * Kural bu ürün için geçerli değilse null döndürülmeli.
   *
   * @returns {{ contribution: number, reason: string, details: object }|null}
   */
  evaluate() {
    throw new Error(`evaluate() metodunu ${this.constructor.name} sınıfında implement edin.`);
  }
}

module.exports = BaseStrategy;
