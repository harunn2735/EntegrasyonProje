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

module.exports = { generateAnswer };
