require('dotenv').config();
'use strict';

const { generate } = require('./geminiClient');

const _hasGeminiKey = () =>
  !!(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS);

async function generateAnswer(storeName, productName, questionText) {
  if (!_hasGeminiKey()) return null;
  try {
    return await generate(
      `Sen bir Trendyol satıcısısın. Mağaza adı: ${storeName}.\nMüşteri "${productName}" ürünü hakkında şunu sordu: "${questionText}"\nTürkçe, kısa (1-3 cümle), samimi ve yardımsever bir cevap yaz.\nSadece cevap metnini döndür, başka hiçbir şey ekleme.`,
      { maxOutputTokens: 300, noThinking: true }
    );
  } catch (e) {
    console.error('[aiService] Gemini API hatası:', e.message);
    return null;
  }
}

async function generateForecastComment(productName, weeklySales, trend, forecast7d) {
  if (!_hasGeminiKey()) return null;
  try {
    const trendLabel = trend > 0.1 ? 'artıyor' : trend < -0.1 ? 'azalıyor' : 'stabil';
    const weekLabels = ['4 hafta önce', '3 hafta önce', '2 hafta önce', 'geçen hafta'];
    const salesText = weeklySales.map((s, i) => `${weekLabels[i]}: ${s} adet`).join(', ');

    return await generate(
      `Ürün: ${productName}\nSon 4 hafta satış: ${salesText}\nTrend: ${trendLabel} (${(trend * 100).toFixed(0)}%)\nTahmini önümüzdeki 7 günlük satış: ${forecast7d} adet\n\nBu ürün için kısa Türkçe yorum ve öneri yaz (maksimum 2 cümle). Format:\n"Yorum: [satış durumunu açıklayan 1 cümle]\nÖneri: [stok artır / kampanya yap / fiyat düşür / mevcut durumu koru — somut 1 öneri]"\nSadece bu formatı döndür, başka açıklama ekleme.`,
      { maxOutputTokens: 250, noThinking: true }
    );
  } catch (e) {
    console.error('[aiService] generateForecastComment hatası:', e.message);
    return null;
  }
}

async function categorizeQuestion(questionText, productName) {
  if (!_hasGeminiKey()) return null;
  try {
    const raw = await generate(
      `Şu Türkçe müşteri sorusunu kategorize et.\nÜrün: ${productName}\nSoru: ${questionText}\n\nSadece JSON döndür, başka hiçbir şey yazma:\n{"category": "kategori_adi", "confidence": 0.95}\n\nGeçerli kategoriler:\nurun_ozellikleri, kargo_teslimat, iade_talebi, fiyat_kampanya, stok_durumu`,
      { maxOutputTokens: 60, jsonMode: true, noThinking: true }
    );
    const parsed = JSON.parse(raw);
    if (!parsed.category || typeof parsed.confidence !== 'number') return null;
    return { category: String(parsed.category), confidence: Number(parsed.confidence) };
  } catch (e) {
    console.error('[aiService] categorizeQuestion hatası:', e.message);
    return null;
  }
}

module.exports = { generateAnswer, generateForecastComment, categorizeQuestion };
