'use strict';

const db = require('../database');
const { generate } = require('./geminiClient');

function addLog(level, message, dealerId = null) {
  try {
    db.prepare('INSERT INTO logs (level, message, dealer_id) VALUES (?, ?, ?)').run(level, message, dealerId);
  } catch (_) {}
}

async function urunIcerikUret({ title = '', category = '', brand = '', attributes = {} } = {}, dealerId = null) {
  if (!process.env.GEMINI_API_KEY) {
    const msg = 'urunIcerikUret: GEMINI_API_KEY tanımlı değil';
    addLog('error', msg, dealerId);
    throw new Error(msg);
  }

  const attrStr = attributes && Object.keys(attributes).length > 0
    ? Object.entries(attributes).map(([k, v]) => `${k}: ${v}`).join(', ')
    : null;

  const prompt = `Bir Trendyol ürünü için SEO uyumlu başlık ve açıklama üret.

Ürün Bilgileri:
- Mevcut Başlık: ${title || '(belirtilmemiş)'}
- Kategori: ${category || '(belirtilmemiş)'}
- Marka: ${brand || '(belirtilmemiş)'}${attrStr ? `\n- Özellikler: ${attrStr}` : ''}

Kurallar:
- Başlık: En fazla 100 karakter, SEO uyumlu, Trendyol formatında (Marka + Ürün Adı + Önemli Özellik)
- Açıklama: 200-400 karakter arası, Türkçe, ürünün özelliklerini ve faydalarını vurgula, doğal ve akıcı dil
- Gereksiz tekrar veya dolgu kelime kullanma

SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey ekleme:
{"baslik": "...", "aciklama": "..."}`;

  try {
    const text = await generate(prompt, { maxOutputTokens: 512 });
    if (!text) throw new Error('Gemini boş yanıt döndürdü');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Geçerli JSON bulunamadı. Yanıt: ${text.slice(0, 200)}`);

    const result = JSON.parse(jsonMatch[0]);
    if (typeof result.baslik !== 'string' || typeof result.aciklama !== 'string') {
      throw new Error(`Eksik alan. Alınan: ${JSON.stringify(result)}`);
    }

    result.baslik = result.baslik.trim().substring(0, 100);
    result.aciklama = result.aciklama.trim();
    return result;
  } catch (err) {
    addLog('error', `urunIcerikUret hatası [${title}]: ${err.message}`, dealerId);
    throw err;
  }
}

module.exports = { urunIcerikUret };
