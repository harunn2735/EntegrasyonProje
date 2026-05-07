// scripts/test-pricing-engine.js
// Pricing Engine'i tek bir ürün üzerinde test eder.
// Kullanım:
//   node scripts/test-pricing-engine.js               → İlk mevcut ürünü kullanır
//   node scripts/test-pricing-engine.js 42            → dealer_products.id = 42
//   node scripts/test-pricing-engine.js 42 --dry      → Kaydetme, sadece sonucu göster
//   node scripts/test-pricing-engine.js 42 --cost 0   → Maliyet sıfır simülasyonu
//   node scripts/test-pricing-engine.js 42 --cost 199 → Maliyet override ile çalıştır
//   node scripts/test-pricing-engine.js 42 --json     → Ham JSON çıktısı
'use strict';

const db            = require('../database');
const PricingEngine = require('../src/services/pricing/PricingEngine');

async function main() {
  const args    = process.argv.slice(2);
  const persist = !args.includes('--dry');

  // --cost N: DB'deki cost_price yerine kullanılacak maliyet (0 geçerli değer)
  const costIdx = args.indexOf('--cost');
  const costOverride = costIdx !== -1 ? parseFloat(args[costIdx + 1]) : undefined;

  // Ürün ID'si: CLI arg yoksa DB'deki ilk ürünü al
  let productId = parseInt(args.find(a => /^\d+$/.test(a)), 10);

  if (!productId) {
    const first = db.prepare(
      'SELECT id, title, sale_price, cost_price FROM dealer_products WHERE sale_price > 0 AND cost_price > 0 LIMIT 1'
    ).get();

    if (!first) {
      console.error('❌ Fiyatlandırılabilir ürün bulunamadı (sale_price > 0, cost_price > 0 koşulu).');
      process.exit(1);
    }

    productId = first.id;
    console.log(`ℹ️  Ürün ID belirtilmedi. İlk uygun ürün seçildi: id=${productId} "${first.title}"\n`);
  }

  // ── Ürün bilgilerini göster ─────────────────────────────────────────────────
  const product = db.prepare(
    'SELECT id, title, barcode, stock, sale_price, cost_price, supplier_name FROM dealer_products WHERE id = ?'
  ).get(productId);

  if (!product) {
    console.error(`❌ id=${productId} ile ürün bulunamadı.`);
    process.exit(1);
  }

  console.log('════════════════════════════════════════════════════');
  console.log('  Dinamik Fiyatlandırma Motor Testi');
  console.log('════════════════════════════════════════════════════');
  console.log(`  Ürün   : ${product.title}`);
  console.log(`  Barkod : ${product.barcode}`);
  console.log(`  Stok   : ${product.stock} adet`);
  console.log(`  Mevcut fiyat : ₺${product.sale_price}`);
  // costOverride !== undefined kontrolü: 0 falsy olduğundan || kullanılamaz
  const cost = costOverride !== undefined ? costOverride : product.cost_price;
  console.log(`  Maliyet      : ₺${cost}${costOverride !== undefined ? ' (override)' : ''}`);
  console.log(`  Tedarikçi    : ${product.supplier_name}`);
  console.log(`  Kayıt modu   : ${persist ? 'DB\'ye yaz' : 'dry-run (yazmıyor)'}`);
  console.log('════════════════════════════════════════════════════\n');

  // ── Aktif kuralları göster ───────────────────────────────────────────────────
  const rules = db.prepare('SELECT id, name, rule_type, priority, is_active FROM pricing_rules ORDER BY priority').all();
  console.log('📋 Mevcut Pricing Rules:');
  for (const r of rules) {
    const durum = r.is_active ? '✅ aktif' : '⏸  pasif';
    console.log(`   [${r.priority}] ${r.name} (${r.rule_type}) — ${durum}`);
  }
  console.log('');

  // ── Engine'i çalıştır ────────────────────────────────────────────────────────
  const engine = new PricingEngine(db);

  console.log('⚙️  Engine değerlendiriliyor...\n');
  const recommendation = await engine.evaluateProduct(productId, { persist, costOverride });

  // ── Sonuçları göster ─────────────────────────────────────────────────────────
  if (!recommendation) {
    console.log('⚠️  Maliyet bilgisi eksik, öneri üretilemiyor.');
    return;
  }

  console.log('════════════════════════════════════════════════════');
  console.log('  Öneri Sonucu');
  console.log('════════════════════════════════════════════════════');

  if (recommendation.skipReason) {
    console.log(`  ⏭  Atlandı: ${recommendation.skipReason}`);
  } else {
    const dir = recommendation.priceChangePercent >= 0 ? '▲ ZAM' : '▼ İNDİRİM';
    console.log(`  ${dir}`);
    console.log(`  Mevcut fiyat    : ₺${recommendation.currentPrice.toFixed(2)}`);
    console.log(`  Önerilen fiyat  : ₺${recommendation.recommendedPrice.toFixed(2)}`);
    console.log(`  Değişim         : %${Math.abs(recommendation.priceChangePercent).toFixed(2)}`);
    console.log(`  Güven skoru     : %${(recommendation.confidenceScore * 100).toFixed(0)}`);
    console.log(`  Marj kontrolü   : ${recommendation.marginCheckPassed ? '✓ Geçti' : '⚠️ Müdahale gerekti'}`);
    console.log(`  DB'ye kaydedildi: ${recommendation.shouldPersist() && persist ? 'Evet' : 'Hayır'}`);
  }

  console.log('\n  Gerekçe:');
  recommendation.reasoning.split('. ').forEach(part => {
    if (part.trim()) console.log(`    • ${part.trim()}`);
  });

  if (recommendation.appliedRules.length > 0) {
    console.log('\n  Uygulanan Kurallar:');
    for (const r of recommendation.appliedRules) {
      const katkı = r.contribution !== 0
        ? `${r.contribution > 0 ? '+' : ''}${(r.contribution * 100).toFixed(1)}%`
        : 'veto';
      console.log(`    • [${r.ruleType}] ${r.ruleName} → ${katkı}`);
    }
  }

  console.log('════════════════════════════════════════════════════\n');

  // ── Ham JSON (debug için) ────────────────────────────────────────────────────
  if (args.includes('--json')) {
    console.log('Ham öneri objesi:');
    console.log(JSON.stringify(recommendation, null, 2));
  }
}

main().catch(err => {
  console.error('❌ Test scripti hata ile sonlandı:', err.message);
  process.exit(1);
});
