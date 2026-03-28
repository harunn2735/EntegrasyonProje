# AI Destekli Müşteri Soru Cevaplama — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trendyol'dan müşteri sorularını otomatik çekip Claude ile Türkçe cevap öneren, admin panelinden onaylanıp Trendyol'a gönderilen bir sistem ekle.

**Architecture:** Modüler yaklaşım — `services/aiService.js` (Anthropic wrapper), `routes/questions.js` (Express router + fetch helper), `cron/questionsCron.js` (15 dk'lık cron), `public/js/questionsPage.js` (admin UI). server.js'e sadece mount + cron start satırları eklenir.

**Tech Stack:** `@anthropic-ai/sdk`, `node-cron`, `better-sqlite3`, `axios`, `express`

---

## Dosya Haritası

| Dosya | İşlem | Sorumluluk |
|-------|-------|-----------|
| `package.json` | Güncelle | `@anthropic-ai/sdk` ve `node-cron` bağımlılıkları |
| `.env.example` | Güncelle | `ANTHROPIC_API_KEY`, `AI_MODEL` değişkenleri |
| `database.js` | Güncelle | `questions` tablosu ve safeAlter |
| `services/aiService.js` | Oluştur | Anthropic SDK wrapper — `generateAnswer()` |
| `routes/questions.js` | Oluştur | API endpoint'leri + `fetchAndSaveQuestions()` export |
| `cron/questionsCron.js` | Oluştur | 15 dk'lık cron job |
| `server.js` | Güncelle | Router mount + cron başlatma |
| `public/js/questionsPage.js` | Oluştur | Admin panel "Sorular" sayfası UI |
| `index.html` | Güncelle | Nav item + page div + navigate() + script tag |

---

## Task 1: Bağımlılıkları Kur + .env.example Güncelle

**Files:**
- Modify: `package.json` (npm install ile)
- Modify: `.env.example`

- [ ] **Step 1: Paketleri kur**

```bash
cd C:/Users/harun/Desktop/claude_trendyol
npm install @anthropic-ai/sdk node-cron
```

Beklenen çıktı: `added X packages` içeren bir satır, hata yok.

- [ ] **Step 2: .env.example'a yeni değişkenleri ekle**

`.env.example` dosyasının sonuna ekle:

```
# AI soru cevaplama
ANTHROPIC_API_KEY=
AI_MODEL=claude-haiku-4-5-20251001
```

- [ ] **Step 3: .env dosyanda da ANTHROPIC_API_KEY satırını ekle (gerçek key ile)**

Kendi `.env` dosyana (varsa) şunu ekle — `sk-ant-...` ile başlayan gerçek API key'ini yaz:

```
ANTHROPIC_API_KEY=sk-ant-api03-...
AI_MODEL=claude-haiku-4-5-20251001
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add @anthropic-ai/sdk and node-cron dependencies"
```

---

## Task 2: Veritabanına questions Tablosu Ekle

**Files:**
- Modify: `database.js`

- [ ] **Step 1: `database.js`'de `initDb()` fonksiyonunun `db.exec(...)` bloğuna `questions` tablosunu ekle**

`CREATE TABLE IF NOT EXISTS stores (` satırından önce şunu ekle:

```javascript
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      question_id TEXT NOT NULL,
      product_name TEXT,
      question_text TEXT NOT NULL,
      ai_answer TEXT,
      status TEXT DEFAULT 'pending',
      asked_at DATETIME,
      sent_at DATETIME,
      created_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(dealer_id, question_id),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );
```

- [ ] **Step 2: Sunucuyu başlatarak tablonun oluşturulduğunu doğrula**

```bash
node -e "require('./database'); console.log('OK')"
```

Beklenen çıktı:
```
✅ Veritabanı ve tablolar hazır.
OK
```

- [ ] **Step 3: Commit**

```bash
git add database.js
git commit -m "feat: add questions table to database"
```

---

## Task 3: services/aiService.js Oluştur

**Files:**
- Create: `services/aiService.js`

- [ ] **Step 1: `services/` dizinini oluştur ve `aiService.js` yaz**

```javascript
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
```

- [ ] **Step 2: Servisi test et (ANTHROPIC_API_KEY tanımlıysa)**

```bash
node -e "
require('dotenv').config();
const { generateAnswer } = require('./services/aiService');
generateAnswer('Test Mağaza', 'Bluetooth Kulaklık', 'Bu ürün su geçirmez mi?')
  .then(ans => console.log('Cevap:', ans))
  .catch(e => console.error(e));
"
```

Beklenen çıktı: Türkçe 1-3 cümlelik bir cevap metni.
API key yoksa: `Cevap: null`

- [ ] **Step 3: Commit**

```bash
git add services/aiService.js
git commit -m "feat: add aiService — Anthropic wrapper for Turkish Q&A"
```

---

## Task 4: routes/questions.js Oluştur

**Files:**
- Create: `routes/questions.js`

> **Not:** Trendyol Questions API endpoint'leri `integration/product/sellers/{id}/questions` path'ini kullanır. Eğer bu endpoint çalışmazsa Trendyol Partner Panel > API dokümantasyonu > Questions bölümünden doğru path'i kontrol et.

- [ ] **Step 1: `routes/questions.js` dosyasını yaz**

```javascript
// routes/questions.js
'use strict';

const express = require('express');
const axios = require('axios');
const db = require('../database');
const { generateAnswer } = require('../services/aiService');

const router = express.Router();

// ── TRENDYOL AUTH HELPER ────────────────────────────────────
function trendyolHeaders(dealer) {
  const auth = Buffer.from(`${dealer.api_key}:${dealer.api_secret}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'User-Agent': `${dealer.supplier_id} - SelfIntegration`,
    'Content-Type': 'application/json',
  };
}

// ── FETCH & SAVE HELPER (cron ve route her ikisi de kullanır) ─
async function fetchAndSaveQuestions(dealer) {
  let response;
  try {
    response = await axios.get(
      `https://apigw.trendyol.com/integration/product/sellers/${dealer.supplier_id}/questions?status=waitingForAnswer&page=0&size=50`,
      { headers: trendyolHeaders(dealer), timeout: 8000 }
    );
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    throw new Error(`Trendyol API hatası: ${detail}`);
  }

  const questions = response.data?.content || response.data?.questions || [];
  let saved = 0;

  for (const q of questions) {
    const questionId = String(q.id || q.questionId || '');
    if (!questionId) continue;

    // Daha önce kaydedildiyse atla
    const existing = db
      .prepare('SELECT id FROM questions WHERE dealer_id = ? AND question_id = ?')
      .get(dealer.id, questionId);
    if (existing) continue;

    const productName = q.productName || q.product?.name || '';
    const questionText = q.text || q.questionText || '';
    const askedAt = q.createdDate
      ? new Date(q.createdDate).toISOString()
      : new Date().toISOString();

    const aiAnswer = await generateAnswer(dealer.name || '', productName, questionText);

    db.prepare(`
      INSERT OR IGNORE INTO questions
        (dealer_id, question_id, product_name, question_text, ai_answer, status, asked_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(dealer.id, questionId, productName, questionText, aiAnswer, askedAt);

    saved++;
  }

  return { fetched: questions.length, saved };
}

// ── GET /api/questions ──────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const status = ['pending', 'sent', 'rejected'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const rows = db
      .prepare(
        'SELECT * FROM questions WHERE dealer_id = ? AND status = ? ORDER BY asked_at DESC LIMIT 100'
      )
      .all(req.dealer.id, status);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Sunucu hatası', detail: e.message });
  }
});

// ── POST /api/questions/fetch ───────────────────────────────
router.post('/fetch', async (req, res) => {
  const dealer = db
    .prepare('SELECT id, name, supplier_id, api_key, api_secret FROM dealers WHERE id = ?')
    .get(req.dealer.id);

  if (!dealer?.supplier_id || !dealer?.api_key || !dealer?.api_secret) {
    return res.status(400).json({ error: 'Trendyol API bilgileri eksik' });
  }

  try {
    const result = await fetchAndSaveQuestions(dealer);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── PUT /api/questions/:id ──────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const { ai_answer } = req.body;
    if (typeof ai_answer !== 'string') {
      return res.status(400).json({ error: 'ai_answer alanı gerekli' });
    }
    const result = db
      .prepare(
        "UPDATE questions SET ai_answer = ? WHERE id = ? AND dealer_id = ? AND status = 'pending'"
      )
      .run(ai_answer, req.params.id, req.dealer.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Soru bulunamadı veya düzenlenemez durumda' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/questions/:id/approve ────────────────────────
router.post('/:id/approve', async (req, res) => {
  const question = db
    .prepare("SELECT * FROM questions WHERE id = ? AND dealer_id = ? AND status = 'pending'")
    .get(req.params.id, req.dealer.id);

  if (!question) {
    return res.status(404).json({ error: 'Soru bulunamadı veya zaten işlendi' });
  }
  if (!question.ai_answer || !question.ai_answer.trim()) {
    return res.status(400).json({ error: 'Cevap metni boş olamaz' });
  }

  const dealer = db
    .prepare('SELECT supplier_id, api_key, api_secret FROM dealers WHERE id = ?')
    .get(req.dealer.id);

  try {
    await axios.post(
      `https://apigw.trendyol.com/integration/product/sellers/${dealer.supplier_id}/questions/${question.question_id}/answers`,
      { text: question.ai_answer.trim() },
      { headers: trendyolHeaders(dealer), timeout: 8000 }
    );

    db.prepare(
      "UPDATE questions SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
    ).run(question.id);

    res.json({ ok: true });
  } catch (e) {
    const detail = e.response?.data?.message || e.message;
    res.status(502).json({ error: "Trendyol'a gönderilemedi", detail });
  }
});

// ── POST /api/questions/:id/reject ─────────────────────────
router.post('/:id/reject', (req, res) => {
  try {
    const result = db
      .prepare(
        "UPDATE questions SET status = 'rejected' WHERE id = ? AND dealer_id = ? AND status = 'pending'"
      )
      .run(req.params.id, req.dealer.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Soru bulunamadı veya zaten işlendi' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.fetchAndSaveQuestions = fetchAndSaveQuestions;
```

- [ ] **Step 2: Router'ı syntax hataları için kontrol et**

```bash
node -e "require('./routes/questions'); console.log('Router OK')"
```

Beklenen çıktı: `Router OK`

- [ ] **Step 3: Commit**

```bash
git add routes/questions.js services/aiService.js
git commit -m "feat: add questions router with Trendyol fetch and AI answer generation"
```

---

## Task 5: cron/questionsCron.js Oluştur

**Files:**
- Create: `cron/questionsCron.js`

- [ ] **Step 1: `cron/` dizini oluştur ve `questionsCron.js` yaz**

```javascript
// cron/questionsCron.js
'use strict';

const cron = require('node-cron');
const db = require('../database');
const { fetchAndSaveQuestions } = require('../routes/questions');

function startQuestionsCron() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY tanımlı değil — sorular cron job başlatılmadı.');
    return;
  }

  cron.schedule('*/15 * * * *', async () => {
    console.log('[Sorular Cron] Çalışıyor...');

    const dealers = db
      .prepare(
        `SELECT id, name, supplier_id, api_key, api_secret
         FROM dealers
         WHERE status = 'active'
           AND supplier_id IS NOT NULL AND supplier_id != ''
           AND api_key IS NOT NULL AND api_key != ''
           AND api_secret IS NOT NULL AND api_secret != ''`
      )
      .all();

    for (const dealer of dealers) {
      try {
        const result = await fetchAndSaveQuestions(dealer);
        if (result.saved > 0) {
          console.log(`[Sorular Cron] Dealer ${dealer.id} (${dealer.name}): ${result.saved} yeni soru kaydedildi`);
        }
      } catch (e) {
        console.error(`[Sorular Cron] Dealer ${dealer.id} hatası:`, e.message);
      }
    }
  });

  console.log('✅ Sorular cron job başlatıldı (her 15 dakika).');
}

module.exports = startQuestionsCron;
```

- [ ] **Step 2: Modülü kontrol et**

```bash
node -e "require('./cron/questionsCron'); console.log('Cron module OK')"
```

Beklenen çıktı: `Cron module OK` (cron başlamaz çünkü ANTHROPIC_API_KEY yok veya uyarı verir)

- [ ] **Step 3: Commit**

```bash
git add cron/questionsCron.js
git commit -m "feat: add questions cron job (every 15 minutes, all active dealers)"
```

---

## Task 6: server.js'i Güncelle

**Files:**
- Modify: `server.js`

- [ ] **Step 1: `server.js`'de `require('./routes/orderDetail')` satırının hemen altına questions router'ı ekle**

Mevcut:
```javascript
const orderDetailRouter = require('./routes/orderDetail');
```

Sonrasına ekle:
```javascript
const questionsRouter = require('./routes/questions');
const startQuestionsCron = require('./cron/questionsCron');
```

- [ ] **Step 2: `server.js`'de `app.use('/api/orders', authMiddleware, orderDetailRouter)` satırının hemen altına questions router'ı mount et**

Bu satırı bul:
```javascript
app.use('/api/orders', authMiddleware, orderDetailRouter);
```

Hemen altına ekle:
```javascript
app.use('/api/questions', authMiddleware, questionsRouter);
```

- [ ] **Step 3: `server.js`'in sonundaki `app.listen(...)` çağrısını bul ve hemen üstüne cron başlatma satırını ekle**

`app.listen` satırını bul (genellikle dosyanın sonuna yakın):
```javascript
app.listen(PORT, ...
```

Hemen üstüne ekle:
```javascript
startQuestionsCron();
```

- [ ] **Step 4: Sunucuyu başlat ve hataların olmadığını doğrula**

```bash
node server.js
```

Beklenen çıktıda şunlar görünmeli (sıra farklı olabilir):
```
✅ Veritabanı ve tablolar hazır.
✅ Sorular cron job başlatıldı (her 15 dakika).
Server running on port 3000
```

ANTHROPIC_API_KEY yoksa:
```
⚠️  ANTHROPIC_API_KEY tanımlı değil — sorular cron job başlatılmadı.
```

- [ ] **Step 5: API endpoint'lerini test et**

Sunucu çalışırken başka bir terminalde:

```bash
# Önce login ol, token al
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bayi@demo.com","password":"bayi123"}' | grep -o '"token":"[^"]*"'
```

Token'ı kopyala, sonra:
```bash
TOKEN="buraya_token_yapistir"

# Soruları listele (boş array döner — henüz soru yok)
curl -s http://localhost:3000/api/questions \
  -H "Authorization: Bearer $TOKEN"
```

Beklenen çıktı: `[]`

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: mount questions router and start questions cron in server.js"
```

---

## Task 7: public/js/questionsPage.js Oluştur

**Files:**
- Create: `public/js/questionsPage.js`

- [ ] **Step 1: `public/js/questionsPage.js` dosyasını yaz**

```javascript
// public/js/questionsPage.js
(function () {
  'use strict';

  // ── CSS ─────────────────────────────────────────────────────
  const STYLE = `
    #page-questions { padding: 0; }
    .qp-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px;
    }
    .qp-header h2 { font-size: 18px; font-weight: 700; color: var(--text); }
    .qp-tabs {
      display: flex; gap: 8px; margin-bottom: 20px;
    }
    .qp-tab {
      padding: 7px 16px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg2); cursor: pointer; font-size: 13px; font-weight: 500;
      color: var(--muted);
    }
    .qp-tab.active {
      background: var(--accent); color: #fff; border-color: var(--accent);
    }
    .qp-card {
      background: var(--card); border-radius: var(--radius); border: 1px solid var(--border);
      padding: 18px 20px; margin-bottom: 14px; box-shadow: var(--shadow);
    }
    .qp-card-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 10px;
    }
    .qp-product { font-size: 13px; font-weight: 600; color: var(--text); }
    .qp-date { font-size: 12px; color: var(--muted); }
    .qp-question {
      font-size: 13px; color: var(--text); margin-bottom: 12px;
      padding: 10px 12px; background: var(--bg3); border-radius: 8px;
      font-style: italic;
    }
    .qp-label {
      font-size: 11px; font-weight: 700; color: var(--muted);
      text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px;
    }
    .qp-textarea {
      width: 100%; min-height: 80px; padding: 10px 12px;
      border: 1px solid var(--border); border-radius: 8px;
      font-family: inherit; font-size: 13px; color: var(--text);
      background: var(--bg2); resize: vertical; margin-bottom: 12px;
      box-sizing: border-box;
    }
    .qp-textarea:focus { outline: none; border-color: var(--accent); }
    .qp-textarea[readonly] { background: var(--bg3); color: var(--muted); }
    .qp-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .qp-btn {
      padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; border: none; font-family: inherit;
    }
    .qp-btn-approve { background: var(--green); color: #fff; }
    .qp-btn-approve:hover { opacity: .85; }
    .qp-btn-reject {
      background: var(--bg3); color: var(--muted); border: 1px solid var(--border);
    }
    .qp-btn-reject:hover { background: #fee2e2; color: var(--red); border-color: var(--red); }
    .qp-btn-fetch {
      background: var(--accent); color: #fff; padding: 8px 16px;
      border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; border: none; font-family: inherit;
    }
    .qp-btn-fetch:disabled { opacity: .6; cursor: not-allowed; }
    .qp-empty {
      text-align: center; padding: 48px; color: var(--muted); font-size: 14px;
    }
    .qp-no-ai {
      font-size: 12px; color: var(--yellow); margin-bottom: 8px;
      padding: 6px 10px; background: #fefce8; border-radius: 6px;
    }
    .qp-status-badge {
      font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 12px;
    }
    .qp-status-sent { background: #dcfce7; color: var(--green); }
    .qp-status-rejected { background: #fee2e2; color: var(--red); }
  `;

  let styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    const el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
    styleInjected = true;
  }

  // ── API HELPER ───────────────────────────────────────────────
  async function qpApi(path, opts = {}) {
    const token = localStorage.getItem('dealer_token') || '';
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sunucu hatası');
    return data;
  }

  // ── TOAST HELPER ─────────────────────────────────────────────
  function qpToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    if (!t) return;
    const d = document.createElement('div');
    d.className = `toast-item toast-${type}`;
    d.textContent = msg;
    t.appendChild(d);
    setTimeout(() => d.remove(), 3500);
  }

  // ── HTML HELPERS ─────────────────────────────────────────────
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let currentStatus = 'pending';
  let saveTimers = {};

  // ── RENDER CARD ──────────────────────────────────────────────
  function renderCard(q) {
    const date = q.asked_at
      ? new Date(q.asked_at).toLocaleDateString('tr-TR')
      : '';
    const isPending = q.status === 'pending';

    const noAiBadge = !q.ai_answer
      ? `<div class="qp-no-ai">⚠️ AI cevabı üretilemedi — lütfen manuel yazın.</div>`
      : '';

    const statusBadge = !isPending
      ? `<span class="qp-status-badge qp-status-${q.status}">${q.status === 'sent' ? '✓ Gönderildi' : '✗ Reddedildi'}</span>`
      : '';

    const actions = isPending
      ? `<div class="qp-actions">
           <button class="qp-btn qp-btn-reject" onclick="window._qpReject(${q.id})">✗ Reddet</button>
           <button class="qp-btn qp-btn-approve" onclick="window._qpApprove(${q.id})">✓ Onayla &amp; Gönder</button>
         </div>`
      : '';

    return `
      <div class="qp-card" id="qp-card-${q.id}">
        <div class="qp-card-header">
          <span class="qp-product">📦 ${esc(q.product_name || 'Ürün')}</span>
          <div style="display:flex;gap:8px;align-items:center;">
            ${statusBadge}
            <span class="qp-date">${date}</span>
          </div>
        </div>
        <div class="qp-question">"${esc(q.question_text)}"</div>
        ${noAiBadge}
        <div class="qp-label">AI Cevabı</div>
        <textarea
          class="qp-textarea"
          id="qp-answer-${q.id}"
          ${!isPending ? 'readonly' : ''}
          oninput="window._qpSaveDebounce(${q.id})"
        >${esc(q.ai_answer || '')}</textarea>
        ${actions}
      </div>
    `;
  }

  // ── LOAD QUESTIONS ───────────────────────────────────────────
  async function loadQuestions(status) {
    if (status !== undefined) currentStatus = status;
    injectStyle();

    const container = document.getElementById('page-questions');
    if (!container) return;

    container.innerHTML = `
      <div class="qp-header">
        <h2>Müşteri Soruları</h2>
        <button class="qp-btn-fetch" id="qp-btn-fetch" onclick="window._qpFetch()">🔄 Trendyol'dan Çek</button>
      </div>
      <div class="qp-tabs">
        <button class="qp-tab ${currentStatus === 'pending' ? 'active' : ''}" onclick="window.loadQuestions('pending')">Bekleyen</button>
        <button class="qp-tab ${currentStatus === 'sent' ? 'active' : ''}" onclick="window.loadQuestions('sent')">Gönderildi</button>
        <button class="qp-tab ${currentStatus === 'rejected' ? 'active' : ''}" onclick="window.loadQuestions('rejected')">Reddedildi</button>
      </div>
      <div id="qp-list"><div class="qp-empty">⏳ Yükleniyor...</div></div>
    `;

    try {
      const questions = await qpApi(`/api/questions?status=${currentStatus}`);
      const list = document.getElementById('qp-list');
      if (!list) return;
      if (!questions.length) {
        list.innerHTML = `<div class="qp-empty">Bu kategoride soru bulunamadı.</div>`;
      } else {
        list.innerHTML = questions.map(renderCard).join('');
      }
    } catch (e) {
      const list = document.getElementById('qp-list');
      if (list) list.innerHTML = `<div class="qp-empty">❌ ${esc(e.message)}</div>`;
    }
  }

  // ── ACTIONS ──────────────────────────────────────────────────
  window._qpSaveDebounce = function (id) {
    clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(async () => {
      const ta = document.getElementById(`qp-answer-${id}`);
      if (!ta) return;
      try {
        await qpApi(`/api/questions/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ ai_answer: ta.value }),
        });
      } catch (_) { /* silent — kullanıcı onay sırasında hata alır */ }
    }, 800);
  };

  window._qpApprove = async function (id) {
    const ta = document.getElementById(`qp-answer-${id}`);
    if (ta) {
      try {
        await qpApi(`/api/questions/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ ai_answer: ta.value }),
        });
      } catch (_) {}
    }
    try {
      await qpApi(`/api/questions/${id}/approve`, { method: 'POST' });
      document.getElementById(`qp-card-${id}`)?.remove();
      const list = document.getElementById('qp-list');
      if (list && !list.querySelector('.qp-card')) {
        list.innerHTML = `<div class="qp-empty">Bu kategoride soru bulunamadı.</div>`;
      }
      qpToast("✅ Cevap Trendyol'a gönderildi", 'success');
    } catch (e) {
      qpToast('❌ ' + e.message, 'error');
    }
  };

  window._qpReject = async function (id) {
    try {
      await qpApi(`/api/questions/${id}/reject`, { method: 'POST' });
      document.getElementById(`qp-card-${id}`)?.remove();
      const list = document.getElementById('qp-list');
      if (list && !list.querySelector('.qp-card')) {
        list.innerHTML = `<div class="qp-empty">Bu kategoride soru bulunamadı.</div>`;
      }
      qpToast('Soru reddedildi', 'info');
    } catch (e) {
      qpToast('❌ ' + e.message, 'error');
    }
  };

  window._qpFetch = async function () {
    const btn = document.getElementById('qp-btn-fetch');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Çekiliyor...'; }
    try {
      const result = await qpApi('/api/questions/fetch', { method: 'POST' });
      qpToast(`✅ ${result.saved} yeni soru eklendi (${result.fetched} çekildi)`, 'success');
      loadQuestions(currentStatus);
    } catch (e) {
      qpToast('❌ ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = "🔄 Trendyol'dan Çek"; }
    }
  };

  window.loadQuestions = loadQuestions;
})();
```

- [ ] **Step 2: Commit**

```bash
git add public/js/questionsPage.js
git commit -m "feat: add questionsPage.js — admin panel Sorular page UI"
```

---

## Task 8: index.html'i Güncelle

**Files:**
- Modify: `index.html`

Bu task 4 ayrı edit işlemi içerir. Her birini sırayla yap.

- [ ] **Step 1: Sidebar nav item ekle**

`index.html`'de şu satırı bul:
```html
        <div class="nav-item" onclick="navigate('orders')" id="nav-orders"><span class="icon">📋</span>Siparişler</div>
```

Hemen **altına** ekle:
```html
        <div class="nav-item" onclick="navigate('questions')" id="nav-questions"><span class="icon">💬</span>Sorular</div>
```

- [ ] **Step 2: Page div ekle**

`index.html`'de şu satırı bul:
```html
        <div class="page" id="page-settings">
```

Hemen **üstüne** ekle:
```html
        <div class="page" id="page-questions"></div>
```

- [ ] **Step 3: navigate() fonksiyonunu güncelle**

`index.html`'de şu satırı bul:
```javascript
      const titles = { dashboard: 'Dashboard', xml: 'XML Feedler', products: 'Ürünlerim', margins: 'Kâr Marjları', profitloss: 'Kâr / Zarar Analizi', stores: 'Mağazalarım', orders: 'Siparişler', settings: 'Trendyol Ayarları' };
```

Şununla değiştir:
```javascript
      const titles = { dashboard: 'Dashboard', xml: 'XML Feedler', products: 'Ürünlerim', margins: 'Kâr Marjları', profitloss: 'Kâr / Zarar Analizi', stores: 'Mağazalarım', orders: 'Siparişler', questions: 'Müşteri Soruları', settings: 'Trendyol Ayarları' };
```

Aynı `navigate()` fonksiyonunda şu satırı bul:
```javascript
      if (page === 'orders') loadOrders();
```

Hemen **altına** ekle:
```javascript
      if (page === 'questions') loadQuestions();
```

- [ ] **Step 4: questionsPage.js script tag'ini ekle**

`index.html`'in sonunda şu satırı bul:
```html
  <script src="/js/orderModal.js"></script>
```

Hemen **altına** ekle:
```html
  <script src="/js/questionsPage.js"></script>
```

- [ ] **Step 5: Sunucuyu başlat ve test et**

```bash
node server.js
```

Tarayıcıda `http://localhost:3000` aç:
1. Giriş yap (bayi@demo.com / bayi123)
2. Sol menüde "💬 Sorular" görünmeli
3. Tıklayınca "Müşteri Soruları" başlığı ve sekmeler görünmeli
4. "🔄 Trendyol'dan Çek" butonuna bas — API bilgisi yoksa hata toast'u görünmeli

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add Sorular page to admin panel nav and navigate function"
```

---

## Özet Commit Geçmişi

Tüm tasklar tamamlandığında git log şöyle görünmeli:

```
feat: add Sorular page to admin panel nav and navigate function
feat: add questionsPage.js — admin panel Sorular page UI
feat: mount questions router and start questions cron in server.js
feat: add questions cron job (every 15 minutes, all active dealers)
feat: add questions router with Trendyol fetch and AI answer generation
feat: add aiService — Anthropic wrapper for Turkish Q&A
feat: add questions table to database
chore: add @anthropic-ai/sdk and node-cron dependencies
```

## Trendyol API Notu

Trendyol Questions API endpoint path'ini Trendyol Partner Panel'den doğrula. Eğer `integration/product/sellers/{id}/questions` çalışmazsa şu alternatifleri dene:

- `integration/sellers/{id}/questions`
- `integration/order/sellers/{id}/questions`

Yanıt yapısında `content` array'i yoksa `data.questions`, `data.result` veya `data.data` olabilir — `fetchAndSaveQuestions()` fonksiyonundaki `response.data?.content || response.data?.questions` satırını buna göre güncelle.
