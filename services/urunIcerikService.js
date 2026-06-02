'use strict';

const geminiClient = require('./geminiClient');

async function urunIcerikUret(urunAdi) {
  const prompt = `Bir Trendyol ürünü için Türkçe içerik yaz.
Ürün adı: ${urunAdi}

Sadece şu iki satırı yaz, başka hiçbir şey ekleme:
BASLIK: (100 karakterden kısa, SEO uyumlu başlık)
ACIKLAMA: (200-300 karakterlik ürün açıklaması)`;

  const text = await geminiClient.generate(prompt);

  const baslikMatch = text.match(/BASLIK:\s*(.+)/);
  const aciklamaMatch = text.match(/ACIKLAMA:\s*(.+)/s);

  const baslik = baslikMatch ? baslikMatch[1].trim().substring(0, 100) : urunAdi;
  const aciklama = aciklamaMatch ? aciklamaMatch[1].trim().substring(0, 500) : '';

  return { baslik, aciklama };
}

module.exports = { urunIcerikUret };
