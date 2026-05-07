// src/services/pricing/PricingEngine.js
// Ana orchestrator: kural listesini çeker, her stratejiyi sırayla çalıştırır,
// MinMargin güvenlik katmanını sona uygular ve öneriyi üretir/kaydeder.
// Öneri modu: otomatik fiyat değişikliği yapmaz, yalnızca price_recommendations'a yazar.
'use strict';

const RuleRepository    = require('./RuleRepository');
const PriceRecommendation = require('./PriceRecommendation');
const MinMarginStrategy   = require('./strategies/MinMarginStrategy');
const StockBasedStrategy  = require('./strategies/StockBasedStrategy');
const VelocityStrategy    = require('./strategies/VelocityStrategy');

class PricingEngine {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.db         = db;
    this.repository = new RuleRepository(db);
  }

  // ── Strategy Factory ────────────────────────────────────────────────────────
  /**
   * rule_type'a göre doğru strateji nesnesini oluşturur.
   * @param {object} rule        - pricing_rules satırı
   * @param {object} productData - dealer_products satırı
   * @returns {BaseStrategy}
   */
  _createStrategy(rule, productData) {
    switch (rule.rule_type) {
      case 'min_margin':     return new MinMarginStrategy(rule, productData, this.repository);
      case 'stock_based':    return new StockBasedStrategy(rule, productData, this.repository);
      case 'velocity_based': return new VelocityStrategy(rule, productData, this.repository);
      default:
        throw new Error(`[PricingEngine] Bilinmeyen kural tipi: ${rule.rule_type}`);
    }
  }

  // ── Güven Skoru Hesabı ─────────────────────────────────────────────────────
  /**
   * Kaç kural uygulandı, marj müdahalesi gerekti mi, değişim ne kadar büyük —
   * bu üç faktör 0-1 arası bir güven skoru üretir.
   */
  _calcConfidence(appliedRulesCount, marginCheckPassed, priceChangePercent) {
    let score = 0.5;
    score += Math.min(appliedRulesCount * 0.1, 0.3);  // her kural +%10, max +%30
    if (marginCheckPassed) score += 0.1;              // marj koruması devreye girmediyse daha güvenli
    if (Math.abs(priceChangePercent) > 15) score -= 0.2; // büyük değişim = belirsizlik
    return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  }

  // ── Ana Değerlendirme ──────────────────────────────────────────────────────
  /**
   * Tek bir ürün için fiyat önerisi üretir.
   *
   * @param {number}  dealerProductId              - dealer_products.id
   * @param {{ persist?: boolean, costOverride?: number }} [options]
   *   persist:      true ise öneri price_recommendations tablosuna yazılır (varsayılan: true)
   *   costOverride: DB'deki cost_price yerine kullanılacak maliyet (test/simülasyon)
   * @returns {Promise<PriceRecommendation|null>}
   *   Öneri üretilemezse null döner (ürün bulunamadı, maliyet bilinmiyor vb.)
   */
  async evaluateProduct(dealerProductId, options = {}) {
    const persist = options.persist !== false; // varsayılan: true

    // 1. Ürün verisini çek ────────────────────────────────────────────────────
    const product = this.repository.getDealerProduct(dealerProductId);
    if (!product) {
      console.warn(`[PricingEngine] Ürün bulunamadı: id=${dealerProductId}`);
      return null;
    }

    // costOverride varsa DB değerinin üzerine yaz (0 geçerli bir değer — !== undefined kontrolü)
    const effectiveCost = options.costOverride !== undefined ? options.costOverride : product.cost_price;
    const product_ = effectiveCost !== product.cost_price
      ? { ...product, cost_price: effectiveCost }
      : product;

    // Maliyet bilinmiyorsa öneri anlamsız — atla
    if (!product_.cost_price || product_.cost_price <= 0) {
      return null;
    }

    // Satış fiyatı tanımsızsa öneri üretme
    const currentPrice = product_.sale_price || 0;
    if (currentPrice <= 0) {
      return null;
    }

    // 2. Uygulanabilir kuralları getir (product > supplier > global, priority ASC) ─
    const rules = this.repository.getApplicableRules(dealerProductId);

    // 3. min_margin dışındaki kuralları çalıştır; katkıları topla ────────────
    const appliedRules   = [];
    const reasoningParts = [];
    let   totalContribution = 0;

    for (const rule of rules) {
      if (rule.rule_type === 'min_margin') continue; // Güvenlik katmanı sona bırakılır

      let result = null;
      try {
        const strategy = this._createStrategy(rule, product_);
        result = await strategy.evaluate(); // sync stratejilerde await no-op
      } catch (err) {
        console.error(`[PricingEngine] Kural ${rule.id} (${rule.name}) hatası:`, err.message);
        continue;
      }

      if (result === null) continue; // Kural bu ürün için geçerli değil

      totalContribution += result.contribution;
      appliedRules.push({
        ruleId:       rule.id,
        ruleType:     rule.rule_type,
        ruleName:     rule.name,
        contribution: result.contribution,
        details:      result.details,
      });
      reasoningParts.push(result.reason);
    }

    // 4. Ham önerilen fiyatı hesapla ──────────────────────────────────────────
    let recommendedPrice = currentPrice * (1 + totalContribution);

    // 5. MinMargin güvenlik katmanını uygula ──────────────────────────────────
    const minMarginRule = rules.find(r => r.rule_type === 'min_margin');
    let marginCheckPassed = true; // true = müdahale gerekmedi

    if (minMarginRule) {
      const minStrategy = this._createStrategy(minMarginRule, product_);
      const enforcement = minStrategy.enforce(currentPrice, recommendedPrice);

      if (enforcement.enforced) {
        recommendedPrice  = enforcement.finalPrice;
        marginCheckPassed = false; // Marj ihlali vardı, müdahale gerekti
        reasoningParts.push(enforcement.reason);
        appliedRules.push({
          ruleId:       minMarginRule.id,
          ruleType:     'min_margin',
          ruleName:     minMarginRule.name,
          contribution: 0,              // veto rolü, fiyat katkısı değil
          details:      enforcement.details,
        });
      }
    }

    // 6. Kuruşa yuvarla ───────────────────────────────────────────────────────
    recommendedPrice = Math.round(recommendedPrice * 100) / 100;

    // 7. Değişim yüzdesi ──────────────────────────────────────────────────────
    const priceChangePercent =
      Math.round(((recommendedPrice - currentPrice) / currentPrice) * 10000) / 100;

    // 8. Güven skoru ──────────────────────────────────────────────────────────
    const confidenceScore = this._calcConfidence(
      appliedRules.length,
      marginCheckPassed,
      priceChangePercent,
    );

    // 9. Gerekçe metni oluştur ─────────────────────────────────────────────────
    if (reasoningParts.length === 0) {
      reasoningParts.push(
        'Mevcut fiyat optimal görünüyor, herhangi bir kural tetiklenmedi'
      );
    }
    const dir = priceChangePercent >= 0 ? '+' : '';
    reasoningParts.push(
      `Net fiyat etkisi: ${dir}%${Math.abs(priceChangePercent).toFixed(2)}`
    );
    reasoningParts.push(
      marginCheckPassed
        ? 'Minimum marj kontrolü: ✓ Geçti'
        : 'Minimum marj kontrolü: ⚠️ Müdahale gerekti'
    );

    // 10. Öneri nesnesini oluştur ──────────────────────────────────────────────
    // Değişiklik %1'den azsa skipReason set et (anlamsız küçük önerileri filtrele)
    const skipReason = Math.abs(priceChangePercent) < 1
      ? `Değişiklik %${Math.abs(priceChangePercent).toFixed(2)} olduğundan öneri üretilmedi (eşik: %1)`
      : null;

    const recommendation = new PriceRecommendation({
      dealerProductId,
      currentPrice,
      recommendedPrice,
      priceChangePercent,
      appliedRules,
      reasoning:      reasoningParts.join('. '),
      confidenceScore,
      marginCheckPassed,
      skipReason,
    });

    // 11. Veritabanına kaydet (persist=true ve kayda değer öneri ise) ──────────
    if (persist && recommendation.shouldPersist()) {
      try {
        this.repository.saveRecommendation(recommendation);
      } catch (err) {
        // Kayıt hatası motoru durdurmamalı; sadece logla
        console.error('[PricingEngine] Öneri kaydedilemedi:', err.message);
      }
    }

    return recommendation;
  }

  // ── Toplu Değerlendirme (cron için) ────────────────────────────────────────
  /**
   * Tüm aktif ürünler (veya belirli bir bayiye ait ürünler) için öneri üretir.
   * Cron job tarafından periyodik olarak çağrılır.
   *
   * @param {number|null} dealerId - null ise tüm bayilerin ürünleri işlenir
   * @returns {Promise<{ total: number, created: number, skipped: number, errors: number }>}
   */
  async evaluateAllProducts(dealerId = null) {
    let stmt;
    if (dealerId !== null) {
      stmt = this.db.prepare(`
        SELECT id FROM dealer_products
        WHERE dealer_id = ? AND sale_price > 0 AND cost_price > 0
      `);
    } else {
      stmt = this.db.prepare(`
        SELECT id FROM dealer_products
        WHERE sale_price > 0 AND cost_price > 0
      `);
    }

    const products = dealerId !== null ? stmt.all(dealerId) : stmt.all();

    let total   = 0;
    let created = 0;
    let skipped = 0;
    let errors  = 0;

    for (const row of products) {
      total++;
      try {
        const rec = await this.evaluateProduct(row.id, { persist: true });
        if (!rec) {
          skipped++;
        } else if (rec.shouldPersist()) {
          created++;
        } else {
          skipped++;
        }
      } catch (err) {
        errors++;
        console.error(`[PricingEngine] Ürün ${row.id} işlenemedi:`, err.message);
      }
    }

    console.log(
      `[PricingEngine] Toplu değerlendirme tamamlandı — ` +
      `toplam: ${total}, öneri: ${created}, atlandı: ${skipped}, hata: ${errors}`
    );

    return { total, created, skipped, errors };
  }
}

module.exports = PricingEngine;
