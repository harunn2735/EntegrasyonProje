require('dotenv').config();
  // services/aiService.js
  'use strict';

  const { OpenAI } = require('openai');

  let client = null;

  function getClient() {
    if (!client) {
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
    if (!process.env.OPENAI_API_KEY) return null;

    try {
      const completion = await getClient().chat.completions.create({
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: `Sen bir Trendyol satıcısısın. Mağaza adı: ${storeName}.\nMüşteri "${productName}" ürünü hakkında şunu sordu: "${questionText}"\nTürkçe, kısa (1-3 cümle), samimi ve yardımsever bir cevap yaz.\nSadece cevap metnini döndür, başka hiçbir şey ekleme.`,
          },
        ],
      });
      return completion.choices[0].message.content?.trim() || null;
    } catch (e) {
      console.error('[aiService] OpenAI API hatası:', e.message);
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
    if (!process.env.OPENAI_API_KEY) return null;

    try {
      const trendLabel = trend > 0.1 ? 'artıyor' : trend < -0.1 ? 'azalıyor' : 'stabil';
      const weekLabels = ['4 hafta önce', '3 hafta önce', '2 hafta önce', 'geçen hafta'];
      const salesText = weeklySales
        .map((s, i) => `${weekLabels[i]}: ${s} adet`)
        .join(', ');

      const completion = await getClient().chat.completions.create({
        model: process.env.AI_MODEL || 'gpt-4o-mini',
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

      return completion.choices[0].message.content?.trim() || null;
    } catch (e) {
      console.error('[aiService] generateForecastComment hatası:', e.message);
      return null;
    }
  }

/**
 * Türkçe müşteri sorusunu 5 kategoriden birine atar.
 * @param {string} questionText
 * @param {string} productName
 * @returns {Promise<{category: string, confidence: number}|null>}
 */
async function categorizeQuestion(questionText, productName) {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const completion = await getClient().chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      max_tokens: 60,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: `Şu Türkçe müşteri sorusunu kategorize et.
Ürün: ${productName}
Soru: ${questionText}

Sadece JSON döndür, başka hiçbir şey yazma:
{"category": "kategori_adi", "confidence": 0.95}

Geçerli kategoriler:
urun_ozellikleri, kargo_teslimat, iade_talebi, fiyat_kampanya, stok_durumu`,
        },
      ],
    });

    const raw = completion.choices[0].message.content?.trim();
    const parsed = JSON.parse(raw);
    if (!parsed.category || typeof parsed.confidence !== 'number') return null;
    return { category: String(parsed.category), confidence: Number(parsed.confidence) };
  } catch (e) {
    console.error('[aiService] categorizeQuestion hatası:', e.message);
    return null;
  }
}

module.exports = { generateAnswer, generateForecastComment, categorizeQuestion };
