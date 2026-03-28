// services/aiService.js
'use strict';

const Anthropic = require('@anthropic-ai/sdk');

let client = null;

function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Trendyol müşteri sorusuna Türkçe kısa cevap üretir.
 * @param {string} storeName  - Mağaza adı
 * @param {string} productName - Ürün adı
 * @param {string} questionText - Müşteri sorusu
 * @returns {Promise<string|null>} - Cevap metni veya null (hata durumunda)
 */
async function generateAnswer(storeName, productName, questionText) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const message = await getClient().messages.create({
      model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Sen bir Trendyol satıcısısın. Mağaza adı: ${storeName}.\nMüşteri "${productName}" ürünü hakkında şunu sordu: "${questionText}"\nTürkçe, kısa (1-3 cümle), samimi ve yardımsever bir cevap yaz.\nSadece cevap metnini döndür, başka hiçbir şey ekleme.`,
        },
      ],
    });
    return message.content[0]?.text?.trim() || null;
  } catch (e) {
    console.error('[aiService] Anthropic API hatası:', e.message);
    return null;
  }
}

/**
 * Ürün satış verisi için Türkçe yorum ve öneri üretir.
 * @param {string} productName
 * @param {number[]} weeklySales — [en_eski, ..., en_yeni]
 * @param {number} trend — pozitif=artıyor, negatif=azalıyor
 * @param {number} forecast7d — tahmini 7 günlük satış
 * @returns {Promise<string|null>}
 */
async function generateForecastComment(productName, weeklySales, trend, forecast7d) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const trendLabel = trend > 0.1 ? 'artıyor' : trend < -0.1 ? 'azalıyor' : 'stabil';
    const weekLabels = ['4 hafta önce', '3 hafta önce', '2 hafta önce', 'geçen hafta'];
    const salesText = weeklySales
      .map((s, i) => `${weekLabels[i]}: ${s} adet`)
      .join(', ');

    const message = await getClient().messages.create({
      model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      messages: [
        {
          role: 'user',
          content: `Ürün: ${productName}
Son 4 hafta satış: ${salesText}
Trend: ${trendLabel} (${(trend * 100).toFixed(0)}%)
Tahmini önümüzdeki 7 günlük satış: ${forecast7d} adet

Bu ürün için kısa Türkçe yorum ve öneri yaz (maksimum 2 cümle). Format:
"Yorum: [satış durumunu açıklayan 1 cümle]
Öneri: [stok artır / kampanya yap / fiyat düşür / mevcut durumu koru — somut 1 öneri]"
Sadece bu formatı döndür, başka açıklama ekleme.`,
        },
      ],
    });

    return message.content[0]?.text?.trim() || null;
  } catch (e) {
    console.error('[aiService] generateForecastComment hatası:', e.message);
    return null;
  }
}

module.exports = { generateAnswer, generateForecastComment };
