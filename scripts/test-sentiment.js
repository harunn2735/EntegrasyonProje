require('dotenv').config();
const { OpenAI } = require('openai');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function test() {
  const result = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 60,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: 'Urun: Cop Kovasi. Soru: kac gram? Sadece JSON don: {"category": "urun_ozellikleri", "confidence": 0.95} Kategoriler: urun_ozellikleri, kargo_teslimat, iade_talebi, fiyat_kampanya, stok_durumu'
    }]
  });
  console.log('YANIT:', result.choices[0].message.content);
}

test().catch(function(e) { console.error('HATA:', e.message); });