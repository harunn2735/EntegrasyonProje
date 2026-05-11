require('dotenv').config();
const { generate } = require('../services/geminiClient');

async function test() {
  const result = await generate(
    'Urun: Cop Kovasi. Soru: kac gram? Sadece JSON don: {"category": "urun_ozellikleri", "confidence": 0.95} Kategoriler: urun_ozellikleri, kargo_teslimat, iade_talebi, fiyat_kampanya, stok_durumu',
    { maxOutputTokens: 60, jsonMode: true }
  );
  console.log('YANIT:', result);
}

test().catch(function(e) { console.error('HATA:', e.message); });
