// src/services/pricing/strategies/VelocityStrategy.js
// Satış hızına (velocity) göre fiyat önerir:
//   - Son dönem hız > baseline hızı → ürün popüler, zam öner
//   - Son dönem hız < baseline hızı → ürün yavaş satıyor, indirim öner
//   - Yetersiz satış verisi varsa kural atlanır
//
// evaluate() async olarak tanımlanmıştır; better-sqlite3 sync olduğundan
// await kullanılmaz ama PricingEngine'in await'ine uyum sağlar.
'use strict';

const BaseStrategy = require('./BaseStrategy');

class VelocityStrategy extends BaseStrategy {
  /*
   * Beklenen parameters örneği:
   * {
   *   "fast_velocity_window_days":      7,    // kısa dönem penceresi
   *   "fast_velocity_min_units":        10,   // bu kadar satıştan az ise kural çalışmaz
   *   "fast_velocity_price_increase_percent": 5,
   *   "slow_velocity_window_days":      30,   // uzun dönem (baseline) penceresi
   *   "slow_velocity_max_units":        2,
   *   "slow_velocity_price_decrease_percent": 5
   * }
   *
   * Ayrıca "min_sales_for_evaluation" ile genel minimum eşik ayarlanabilir.
   */

  async evaluate() {
    const p        = this.parameters;
    const barcode  = this.productData.barcode;
    const dealerId = this.productData.dealer_id;

    // Parametre varsayılanları
    const recentWindow   = p.fast_velocity_window_days       ?? 7;
    const baselineWindow = p.slow_velocity_window_days       ?? 30;
    const minSales       = p.min_sales_for_evaluation        ?? 5;
    const highPremium    = p.fast_velocity_price_increase_percent ?? 5;
    const lowDiscount    = p.slow_velocity_price_decrease_percent ?? 5;

    // Bant eşikleri (baseline'a oran)
    // high_velocity_threshold: bu oran üzerinde hızlı sayılır (varsayılan: baseline'ın %130'u)
    const highRatio = p.high_velocity_threshold ?? 1.3;
    // low_velocity_threshold: bu oran altında yavaş sayılır  (varsayılan: baseline'ın %50'si)
    const lowRatio  = p.low_velocity_threshold  ?? 0.5;

    // Satış verisi çek (better-sqlite3 sync; await gereksiz ama interface tutarlılığı için)
    const recentSales   = this.repository.getSalesVelocity(barcode, dealerId, recentWindow);
    const baselineSales = this.repository.getSalesVelocity(barcode, dealerId, baselineWindow);

    // Değerlendirme için yeterli veri yok mu?
    if (baselineSales < minSales) {
      return null; // Veri yetersiz, kural atlanıyor
    }

    // Günlük ortalama satışlara dönüştür (pencereleri normalize et)
    const recentDailyAvg   = recentSales   / recentWindow;
    const baselineDailyAvg = baselineSales / baselineWindow;

    // Sıfır bölmeden kaç
    if (baselineDailyAvg === 0) return null;

    const ratio = recentDailyAvg / baselineDailyAvg;
    const ratioPercent = Math.round(ratio * 100);

    if (ratio >= highRatio) {
      return {
        contribution: +(highPremium / 100),
        reason: (
          `Satış hızı yüksek — son ${recentWindow} günde baseline'ın %${ratioPercent}'i hızında satış. ` +
          `Talep artışından yararlanmak için %${highPremium} zam önerildi`
        ),
        details: {
          recentSales,
          recentWindow,
          baselineSales,
          baselineWindow,
          recentDailyAvg:   Math.round(recentDailyAvg * 100) / 100,
          baselineDailyAvg: Math.round(baselineDailyAvg * 100) / 100,
          ratio:            Math.round(ratio * 100) / 100,
          action:           'premium',
        },
      };
    }

    if (ratio <= lowRatio) {
      return {
        contribution: -(lowDiscount / 100),
        reason: (
          `Satış hızı düşük — son ${recentWindow} günde baseline'ın yalnızca %${ratioPercent}'i hızında satış. ` +
          `Satışı canlandırmak için %${lowDiscount} indirim önerildi`
        ),
        details: {
          recentSales,
          recentWindow,
          baselineSales,
          baselineWindow,
          recentDailyAvg:   Math.round(recentDailyAvg * 100) / 100,
          baselineDailyAvg: Math.round(baselineDailyAvg * 100) / 100,
          ratio:            Math.round(ratio * 100) / 100,
          action:           'discount',
        },
      };
    }

    // Hız normal aralıkta: değişiklik önerilmiyor
    return null;
  }
}

module.exports = VelocityStrategy;
