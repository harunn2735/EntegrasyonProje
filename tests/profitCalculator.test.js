// tests/profitCalculator.test.js
'use strict';

const { calculateLineProfit } = require('../services/profitCalculator');

const DEFAULT_CONFIG = {
  DEFAULT_SHIPPING_COST: 15,
  DEFAULT_RETURN_PROVISION_RATE: 0.02,
  DEFAULT_COMMISSION_RATE: 12,
  MIN_PROFIT_MARGIN_THRESHOLD: 15
};

describe('calculateLineProfit', () => {

  // Test 1: Normal kâr hesabı doğruluğu
  test('sale_price=299, cost=150, rate=12.5, kdv=20 → net_profit ve margin doğru', () => {
    const line = { price: 299, commission: 37.38, barcode: 'BC-001' };
    const product = { cost_price: 150 };
    const commissionRate = { rate: 12.5, kdv_rate: 20 };

    // expected_commission = round(299 × 12.5/100, 2) = 37.38
    // kdv_amount = round(37.38 - 37.38/1.20, 2) = round(37.38 - 31.15, 2) = 6.23
    // shipping_cost = 15 (ilk line, index=0)
    // return_provision = round(299 × 0.02, 2) = 5.98
    // net_profit = round(299 - 150 - 37.38 - 6.23 - 15 - 5.98, 2) = 84.41
    // profit_margin = round(84.41/299 × 100, 2) = 28.23

    const result = calculateLineProfit(line, 0, { product, commissionRate, config: DEFAULT_CONFIG });

    expect(result.net_profit).toBeCloseTo(84.41, 1);
    expect(result.profit_margin).toBeCloseTo(28.23, 1);
    expect(result.expected_commission).toBeCloseTo(37.38, 2);
    expect(result.kdv_amount).toBeCloseTo(6.23, 1);
    expect(result.shipping_cost).toBe(15);
    expect(result.return_provision).toBeCloseTo(5.98, 2);
  });

  // Test 2: commission_rate null → DEFAULT_COMMISSION_RATE devreye girer, hata yok
  test('commissionRate null → DEFAULT_COMMISSION_RATE kullanılır, hata fırlatılmaz', () => {
    const line = { price: 200, commission: 24, barcode: 'BC-002' };
    const product = { cost_price: 100 };

    expect(() => {
      const result = calculateLineProfit(line, 0, {
        product,
        commissionRate: null,  // bulunamadı
        config: DEFAULT_CONFIG
      });
      // DEFAULT_COMMISSION_RATE=12 kullanılmalı
      // expected_commission = round(200 × 12/100, 2) = 24.00
      expect(result.rate_used).toBe(12);
      expect(result.expected_commission).toBeCloseTo(24, 2);
    }).not.toThrow();
  });

  // Test 3: Kargo yalnızca ilk line'a eklenir
  test('index=1 olan line için shipping_cost 0 olur', () => {
    const line = { price: 150, commission: 18, barcode: 'BC-003' };
    const product = { cost_price: 80 };
    const commissionRate = { rate: 12, kdv_rate: 20 };

    const line0Result = calculateLineProfit(line, 0, { product, commissionRate, config: DEFAULT_CONFIG });
    const line1Result = calculateLineProfit(line, 1, { product, commissionRate, config: DEFAULT_CONFIG });

    // Kargo maliyeti sipariş bazlı sabit; yalnızca ilk line'a yüklenir
    expect(line0Result.shipping_cost).toBe(15);
    expect(line1Result.shipping_cost).toBe(0);
  });

  // Test 4: discountedPrice önceliği
  test('discountedPrice mevcut olduğunda price yerine o kullanılır', () => {
    const line = { discountedPrice: 250, price: 299, commission: 31.25, barcode: 'BC-004' };
    const product = { cost_price: 120 };
    const commissionRate = { rate: 12.5, kdv_rate: 20 };

    const result = calculateLineProfit(line, 0, { product, commissionRate, config: DEFAULT_CONFIG });

    expect(result.sale_price).toBe(250);
    // expected_commission = round(250 × 12.5/100, 2) = 31.25
    expect(result.expected_commission).toBeCloseTo(31.25, 2);
  });

});
