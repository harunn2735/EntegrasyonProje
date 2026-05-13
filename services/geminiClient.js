'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── API key listesi (çoklu key desteği + geriye uyumluluk) ───────────────────
// Öncelik: GEMINI_API_KEYS (virgülle ayrılmış) → GEMINI_API_KEY (tekli)
const _keys = (
  process.env.GEMINI_API_KEYS
    ?.split(',')
    .map(k => k.trim())
    .filter(Boolean)
) ?? (process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY] : []);

if (_keys.length === 0) {
  console.warn('[Gemini] Uyarı: GEMINI_API_KEY veya GEMINI_API_KEYS tanımlı değil.');
} else if (_keys.length > 1) {
  console.log(`[Gemini] ${_keys.length} API key yüklendi (round-robin + 429 failover).`);
}

// Her key için lazy-init GoogleGenerativeAI cache'i
const _genAICache = new Map();

function _getGenAI(key) {
  if (!_genAICache.has(key)) {
    _genAICache.set(key, new GoogleGenerativeAI(key));
  }
  return _genAICache.get(key);
}

// ── Round-robin pointer ──────────────────────────────────────────────────────
let _keyIndex = 0;

// ── Günlük kullanım sayacı (bellek içi, gece yarısı sıfırlanır) ──────────────
const _usage = { date: '', count: 0 };

function _todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function _incrementUsage() {
  const today = _todayStr();
  if (_usage.date !== today) { _usage.date = today; _usage.count = 0; }
  return ++_usage.count;
}

function getDailyUsage() {
  const today = _todayStr();
  return _usage.date === today ? _usage.count : 0;
}

// ── Model fabrikası ─────────────────────────────────────────────────────────
// key parametresi verilmezse mevcut round-robin key'i kullanır (sadece dışarıdan
// çağrılan kullanım için; generate() her zaman key geçer).
function getModel(opts = {}, key) {
  const resolvedKey = key ?? _keys[_keyIndex] ?? _keys[0];
  const generationConfig = {};
  if (opts.maxOutputTokens) generationConfig.maxOutputTokens = opts.maxOutputTokens;
  if (opts.jsonMode)         generationConfig.responseMimeType = 'application/json';
  if (opts.noThinking)       generationConfig.thinkingConfig = { thinkingBudget: 0 };

  return _getGenAI(resolvedKey).getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    generationConfig,
  });
}

// ── Ana istek fonksiyonu ─────────────────────────────────────────────────────
/**
 * Prompt'u Gemini'ye gönderir.
 * - Keyler round-robin sırasıyla kullanılır.
 * - Bir key 429 alırsa hemen diğerine geçer (bekleme yok).
 * - Tüm keyler 429 alırsa hata fırlatır.
 */
async function generate(prompt, opts = {}) {
  const callNum    = _incrementUsage();
  const dailyLimit = parseInt(process.env.GEMINI_DAILY_LIMIT || '0', 10);

  if (dailyLimit > 0 && callNum > dailyLimit) {
    const msg = `[Gemini] Günlük limit (${dailyLimit}) doldu — istek #${callNum} reddedildi`;
    console.warn(msg);
    throw new Error(`GEMINI_DAILY_LIMIT_EXCEEDED: ${msg}`);
  }

  const n = _keys.length;
  if (n === 0) throw new Error('[Gemini] API key tanımlı değil.');

  console.log(`[Gemini] istek #${callNum}${dailyLimit > 0 ? `/${dailyLimit}` : ''} — key[${_keyIndex}] kullanılıyor`);

  // Round-robin: bu isteğin başlangıç key'ini al, pointer'ı ilerlet
  const startIdx = _keyIndex;
  _keyIndex = (startIdx + 1) % n;

  for (let i = 0; i < n; i++) {
    const keyIdx = (startIdx + i) % n;
    const model  = getModel(opts, _keys[keyIdx]);

    try {
      if (i > 0) console.log(`[Gemini] key[${keyIdx}] deneniyor (${i + 1}/${n})...`);
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (err) {
      const msg   = err?.message || String(err);
      const is429 = err?.status === 429
                 || msg.includes('429')
                 || msg.includes('RESOURCE_EXHAUSTED')
                 || msg.includes('quota');

      if (is429) {
        if (i < n - 1) {
          const nextIdx = (keyIdx + 1) % n;
          console.warn(`[Gemini] key[${keyIdx}] 429 rate limit — key[${nextIdx}]'e geçiliyor...`);
          continue;
        }
        throw new Error(`[Gemini] Tüm ${n} API key 429 rate limit'e takıldı.`);
      }
      throw err;
    }
  }
}

module.exports = { generate, getModel, getDailyUsage };
