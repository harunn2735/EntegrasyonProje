# Talep Tahmini (Demand Forecast) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Geçmiş sipariş verilerine dayalı ürün bazlı talep tahmini sistemi ekle — her ürün için son 4 haftalık satış ortalaması, trend ve 7 günlük tahmin hesaplanır; Claude Türkçe yorum üretir; UI stok durumunu görselleştirir.

**Architecture:** `services/demandForecast.js` saf hesaplama katmanı (SQLite sorgusu + JS hesaplama), `routes/forecast.js` ince REST katmanı, `public/js/forecastPage.js` mevcut questionsPage.js IIFE pattern'ını izleyen browser bileşeni. Claude yorumu lazy-load (sadece ürüne tıklanınca). Chart.js CDN olarak eklenir (npm paketi değil — browser kütüphanesi).

**Tech Stack:** `better-sqlite3`, `@anthropic-ai/sdk` (zaten kurulu), `Chart.js` (CDN), `Express`

---

## Dosya Haritası

| Dosya | İşlem | Sorumluluk |
|-------|-------|-----------|
| `services/demandForecast.js` | Oluştur | Haftalık satış hesaplama, tahmin, stok sınıflandırma |
| `services/aiService.js` | Güncelle | `generateForecastComment()` fonksiyonu ekle |
| `routes/forecast.js` | Oluştur | GET /api/forecast, GET /api/forecast/:productId |
| `public/js/forecastPage.js` | Oluştur | Browser IIFE — UI, filtreler, Chart.js grafik |
| `index.html` | Güncelle | Nav item, page div, titles, navigate(), Chart.js CDN, script tag |
| `server.js` | Güncelle | Forecast router mount |

---

## Task 1: services/demandForecast.js — Hesaplama Servisi

**Files:**
- Create: `services/demandForecast.js`

**Ön bilgi:**
- `orders` tablosunda `lines_json TEXT` alanı var: `[{barcode, quantity, title, price, ...}]`
- `dealer_products` tablosunda `id, barcode, title, category, stock` alanları var
- İptal/iade siparişler hariç tutulur: `status NOT IN ('Cancelled','Returned','UnDelivered')`
- `weeklySales` dizisi 4 elemanlı, index 0 = en eski hafta, index 3 = son hafta

- [ ] **Step 1: `services/demandForecast.js` dosyasını oluştur**

```javascript
// services/demandForecast.js
'use strict';

const db = require('../database');

/**
 * Son 28 günün siparişlerinden barkod bazlı haftalık satış haritası oluşturur.
 * @param {number} dealerId
 * @returns {Object} { [barcode]: [w0, w1, w2, w3] } — index 0 en eski, 3 en yeni hafta
 */
function getWeeklySalesByBarcode(dealerId) {
  const orders = db
    .prepare(
      `SELECT order_date, lines_json
       FROM orders
       WHERE dealer_id = ?
         AND order_date >= datetime('now', '-28 days')
         AND status NOT IN ('Cancelled', 'Returned', 'UnDelivered')`
    )
    .all(dealerId);

  const now = Date.now();
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const salesMap = {};

  for (const order of orders) {
    const ageMs = now - new Date(order.order_date).getTime();
    const weekIndex = Math.min(3, Math.floor(ageMs / ONE_WEEK_MS)); // 0=bu hafta, 3=en eski
    const slotIndex = 3 - weekIndex; // ters çevir: 0=en eski, 3=en yeni

    let lines;
    try {
      lines = JSON.parse(order.lines_json || '[]');
    } catch {
      lines = [];
    }

    for (const line of lines) {
      if (!line.barcode) continue;
      if (!salesMap[line.barcode]) salesMap[line.barcode] = [0, 0, 0, 0];
      salesMap[line.barcode][slotIndex] += Number(line.quantity) || 1;
    }
  }

  return salesMap;
}

/**
 * 4 haftalık satış dizisinden tahmin hesaplar.
 * @param {number[]} weeklySales — [en_eski, ..., en_yeni]
 * @returns {{ avg4weeks: number, trend: number, forecast7d: number }}
 */
function calculateForecast(weeklySales) {
  const total = weeklySales.reduce((a, b) => a + b, 0);
  const avg4weeks = Math.round((total / 4) * 10) / 10;

  const oldest = weeklySales[0];
  const newest = weeklySales[3];
  const trend =
    oldest === 0
      ? newest > 0 ? 1 : 0
      : Math.round(((newest - oldest) / oldest) * 100) / 100;

  // Ağırlıklı tahmin: son hafta %60, önceki hafta %40
  const forecast7d =
    Math.max(0, Math.round((weeklySales[3] * 0.6 + weeklySales[2] * 0.4) * 10) / 10);

  return { avg4weeks, trend, forecast7d };
}

/**
 * Stok ve tahmin satışa göre durum döndürür.
 * @param {number} stock
 * @param {number} forecast7d
 * @returns {'kritik'|'uyarı'|'yeterli'}
 */
function classifyStock(stock, forecast7d) {
  if (forecast7d === 0) return 'yeterli';
  if (stock < forecast7d) return 'kritik';
  if (stock < forecast7d * 2) return 'uyarı';
  return 'yeterli';
}

/**
 * Dealer'ın tüm ürünleri için tahmin listesi — kritikler önde.
 * @param {number} dealerId
 * @returns {Array}
 */
function getDealerForecast(dealerId) {
  const products = db
    .prepare(
      `SELECT id, barcode, title, category, stock
       FROM dealer_products
       WHERE dealer_id = ?
       ORDER BY title`
    )
    .all(dealerId);

  const salesMap = getWeeklySalesByBarcode(dealerId);

  const results = products.map((product) => {
    const weeklySales = salesMap[product.barcode] || [0, 0, 0, 0];
    const { avg4weeks, trend, forecast7d } = calculateForecast(weeklySales);
    const status = classifyStock(product.stock, forecast7d);
    const trendLabel = trend > 0.1 ? 'Artıyor' : trend < -0.1 ? 'Azalıyor' : 'Stabil';

    return {
      id: product.id,
      barcode: product.barcode,
      title: product.title,
      category: product.category || '',
      stock: product.stock,
      weeklySales,
      avg4weeks,
      trend,
      trendLabel,
      forecast7d,
      status,
    };
  });

  const order = { kritik: 0, uyarı: 1, yeterli: 2 };
  return results.sort((a, b) => order[a.status] - order[b.status]);
}

/**
 * Tek ürün için detaylı tahmin.
 * @param {number} dealerId
 * @param {number} productId — dealer_products.id
 * @returns {Object|null}
 */
function getProductForecast(dealerId, productId) {
  const product = db
    .prepare(
      `SELECT id, barcode, title, category, stock
       FROM dealer_products
       WHERE dealer_id = ? AND id = ?`
    )
    .get(dealerId, productId);

  if (!product) return null;

  const salesMap = getWeeklySalesByBarcode(dealerId);
  const weeklySales = salesMap[product.barcode] || [0, 0, 0, 0];
  const { avg4weeks, trend, forecast7d } = calculateForecast(weeklySales);
  const status = classifyStock(product.stock, forecast7d);
  const trendLabel = trend > 0.1 ? 'Artıyor' : trend < -0.1 ? 'Azalıyor' : 'Stabil';

  return {
    id: product.id,
    barcode: product.barcode,
    title: product.title,
    category: product.category || '',
    stock: product.stock,
    weeklySales,
    avg4weeks,
    trend,
    trendLabel,
    forecast7d,
    status,
  };
}

module.exports = { getDealerForecast, getProductForecast };
```

- [ ] **Step 2: Modül syntax kontrolü**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node -e "const f = require('./services/demandForecast'); console.log('Module OK, exports:', Object.keys(f).join(', '))"
```

Beklenen: `Module OK, exports: getDealerForecast, getProductForecast`

- [ ] **Step 3: Hesaplama mantığı kontrolü**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node -e "
const { getDealerForecast } = require('./services/demandForecast');
const db = require('./database');
const dealer = db.prepare('SELECT id FROM dealers LIMIT 1').get();
if (!dealer) { console.log('Dealer yok'); process.exit(0); }
const results = getDealerForecast(dealer.id);
console.log('Toplam ürün:', results.length);
console.log('İlk 2 ürün:', JSON.stringify(results.slice(0, 2), null, 2));
"
```

Beklenen: Hata yok, ürün listesi yazdırılır (0 da olabilir).

- [ ] **Step 4: Commit**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && git add services/demandForecast.js && git commit -m "feat: add demand forecast service (weekly sales, trend, stock classification)"
```

---

## Task 2: services/aiService.js — generateForecastComment Ekle

**Files:**
- Modify: `services/aiService.js`

- [ ] **Step 1: `generateForecastComment` fonksiyonunu ekle**

`services/aiService.js` dosyasında şu satırı bul:
```javascript
module.exports = { generateAnswer };
```

Hemen **üstüne** ekle:

```javascript
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
```

Ardından `module.exports` satırını güncelle:
```javascript
module.exports = { generateAnswer, generateForecastComment };
```

- [ ] **Step 2: Syntax kontrolü**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node -e "const ai = require('./services/aiService'); console.log('Exports:', Object.keys(ai).join(', '))"
```

Beklenen: `Exports: generateAnswer, generateForecastComment`

- [ ] **Step 3: Commit**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && git add services/aiService.js && git commit -m "feat: add generateForecastComment to aiService"
```

---

## Task 3: routes/forecast.js — REST Endpoint'leri

**Files:**
- Create: `routes/forecast.js`

- [ ] **Step 1: `routes/forecast.js` dosyasını oluştur**

```javascript
// routes/forecast.js
'use strict';

const express = require('express');
const { getDealerForecast, getProductForecast } = require('../services/demandForecast');
const { generateForecastComment } = require('../services/aiService');

const router = express.Router();

// GET /api/forecast — tüm ürünlerin tahmin listesi (AI yorum yok)
router.get('/', (req, res) => {
  try {
    const forecasts = getDealerForecast(req.dealer.id);
    res.json(forecasts);
  } catch (e) {
    res.status(500).json({ error: 'Tahmin hesaplanamadı', detail: e.message });
  }
});

// GET /api/forecast/:productId — tek ürün + Claude yorumu
router.get('/:productId', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (!productId || isNaN(productId)) {
      return res.status(400).json({ error: 'Geçersiz ürün ID' });
    }

    const forecast = getProductForecast(req.dealer.id, productId);
    if (!forecast) {
      return res.status(404).json({ error: 'Ürün bulunamadı' });
    }

    const aiComment = await generateForecastComment(
      forecast.title,
      forecast.weeklySales,
      forecast.trend,
      forecast.forecast7d
    ).catch(() => null);

    res.json({ ...forecast, aiComment });
  } catch (e) {
    res.status(500).json({ error: 'Tahmin alınamadı', detail: e.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Syntax kontrolü**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node -e "const r = require('./routes/forecast'); console.log('Router OK:', typeof r)"
```

Beklenen: `Router OK: function`

- [ ] **Step 3: Commit**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && git add routes/forecast.js && git commit -m "feat: add forecast REST routes (GET /api/forecast, GET /api/forecast/:productId)"
```

---

## Task 4: public/js/forecastPage.js — Browser UI

**Files:**
- Create: `public/js/forecastPage.js`

**Not:** Chart.js CDN'den gelir (index.html'de script tag ile). Bu dosya `Chart` global değişkenine erişir.

- [ ] **Step 1: `public/js/forecastPage.js` dosyasını oluştur**

```javascript
// public/js/forecastPage.js
(function () {
  'use strict';

  const STYLE = `
    #page-forecast {
      padding: 8px 0 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: hidden;
    }
    .fp-shell {
      display: flex;
      flex-direction: column;
      gap: 18px;
      width: 100%;
      max-width: 1180px;
      margin: 0 auto;
    }
    .fp-toolbar {
      background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,255,255,.92));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: var(--shadow);
    }
    .fp-toolbar-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }
    .fp-heading h2 {
      font-size: 17px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 4px;
    }
    .fp-heading p {
      font-size: 13px;
      color: var(--muted);
    }
    .fp-tabs {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 6px;
      border-radius: 14px;
      background: var(--bg3);
      border: 1px solid var(--border);
    }
    .fp-tab {
      padding: 10px 18px;
      border-radius: 10px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      transition: .2s ease;
      font-family: inherit;
    }
    .fp-tab:hover { color: var(--text); background: rgba(255,255,255,.72); }
    .fp-tab.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
      box-shadow: 0 8px 18px rgba(108,99,255,.18);
    }
    .fp-btn-refresh {
      background: var(--accent);
      color: #fff;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      font-family: inherit;
    }
    .fp-btn-refresh:disabled { opacity: .6; cursor: not-allowed; }
    .fp-card {
      background: var(--card);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      padding: 16px 20px;
      margin-bottom: 12px;
      box-shadow: var(--shadow);
      cursor: pointer;
      transition: box-shadow .15s ease;
    }
    .fp-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,.1); }
    .fp-card-critical {
      border-left: 4px solid var(--red, #ef4444);
    }
    .fp-card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .fp-card-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .fp-card-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 13px;
      color: var(--muted);
    }
    .fp-card-meta strong { color: var(--text); }
    .fp-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 12px;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .fp-badge-critical { background: #fee2e2; color: #ef4444; }
    .fp-badge-warning  { background: #fef3c7; color: #d97706; }
    .fp-badge-ok       { background: #dcfce7; color: #16a34a; }
    .fp-detail {
      margin-top: 16px;
      border-top: 1px solid var(--border);
      padding-top: 16px;
    }
    .fp-chart-wrap {
      width: 100%;
      max-width: 560px;
      margin: 0 auto 16px;
    }
    .fp-ai {
      font-size: 13px;
      color: var(--text);
      background: var(--bg3);
      border-radius: 8px;
      padding: 12px 14px;
      line-height: 1.6;
      white-space: pre-wrap;
    }
    .fp-ai-loading { color: var(--muted); font-style: italic; }
    .fp-ai-nokey   { color: var(--yellow, #ca8a04); }
    .fp-ai-error   { color: var(--red, #ef4444); }
    .fp-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      width: 100%;
      color: var(--muted);
      font-size: 14px;
    }
    @media (max-width: 768px) {
      #page-forecast { padding-top: 0; }
      .fp-toolbar { padding: 16px; }
      .fp-card-row { flex-direction: column; align-items: flex-start; }
      .fp-tabs { display: flex; width: 100%; }
      .fp-tab { flex: 1 1 80px; text-align: center; }
    }
  `;

  let styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    const el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
    styleInjected = true;
  }

  async function fpApi(path, opts = {}) {
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

  function fpToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    if (!t) return;
    const d = document.createElement('div');
    d.className = `toast-item toast-${type}`;
    d.textContent = msg;
    t.appendChild(d);
    setTimeout(() => d.remove(), 3500);
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let allForecasts = [];
  let activeFilter = 'all';
  const expandedCharts = {};

  function statusBadge(status) {
    const map = {
      kritik: ['🔴 Kritik', 'fp-badge-critical'],
      uyarı:  ['🟡 Uyarı',  'fp-badge-warning'],
      yeterli:['🟢 Yeterli','fp-badge-ok'],
    };
    const [label, cls] = map[status] || ['—', ''];
    return `<span class="fp-badge ${cls}">${label}</span>`;
  }

  function trendArrow(trendLabel) {
    if (trendLabel === 'Artıyor')  return '↑';
    if (trendLabel === 'Azalıyor') return '↓';
    return '→';
  }

  function renderCard(item) {
    const cardClass = item.status === 'kritik' ? 'fp-card fp-card-critical' : 'fp-card';
    return `
      <div class="${cardClass}" id="fp-card-${item.id}" onclick="window._fpToggleDetail(${item.id})">
        <div class="fp-card-row">
          <div class="fp-card-title" title="${esc(item.title)}">${esc(item.title)}</div>
          ${statusBadge(item.status)}
        </div>
        <div class="fp-card-meta">
          <span>📦 Stok: <strong>${item.stock}</strong></span>
          <span>📈 7g Tahmin: <strong>${item.forecast7d}</strong> adet</span>
          <span>Trend: ${trendArrow(item.trendLabel)} <strong>${esc(item.trendLabel)}</strong></span>
          <span>4H Ort: ${item.avg4weeks} adet</span>
        </div>
        <div class="fp-detail" id="fp-detail-${item.id}" style="display:none;">
          <div class="fp-chart-wrap"><canvas id="fp-chart-${item.id}" height="160"></canvas></div>
          <div class="fp-ai" id="fp-ai-${item.id}"><span class="fp-ai-loading">Claude yorumu yükleniyor...</span></div>
        </div>
      </div>
    `;
  }

  function renderList() {
    const list = document.getElementById('fp-list');
    if (!list) return;
    const filtered =
      activeFilter === 'all'
        ? allForecasts
        : allForecasts.filter((f) => f.status === activeFilter);
    if (!filtered.length) {
      list.innerHTML = '<div class="fp-empty">Bu kategoride ürün bulunamadı.</div>';
      return;
    }
    list.innerHTML = filtered.map(renderCard).join('');
  }

  window._fpToggleDetail = async function (id) {
    const detail = document.getElementById(`fp-detail-${id}`);
    if (!detail) return;

    if (detail.style.display !== 'none') {
      detail.style.display = 'none';
      if (expandedCharts[id]) {
        expandedCharts[id].destroy();
        delete expandedCharts[id];
      }
      return;
    }

    detail.style.display = 'block';

    try {
      const data = await fpApi(`/api/forecast/${id}`);

      // Grafik
      const canvas = document.getElementById(`fp-chart-${id}`);
      const ctx = canvas && canvas.getContext('2d');
      if (ctx && typeof Chart !== 'undefined') {
        if (expandedCharts[id]) expandedCharts[id].destroy();
        expandedCharts[id] = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: [
              '4 Hafta Önce',
              '3 Hafta Önce',
              '2 Hafta Önce',
              'Geçen Hafta',
              'Tahmin (7g)',
            ],
            datasets: [
              {
                label: 'Satış (adet)',
                data: [...data.weeklySales, data.forecast7d],
                backgroundColor: [
                  'rgba(108,99,255,.7)',
                  'rgba(108,99,255,.7)',
                  'rgba(108,99,255,.7)',
                  'rgba(108,99,255,.7)',
                  'rgba(245,158,11,.5)',
                ],
                borderColor: [
                  '#6c63ff', '#6c63ff', '#6c63ff', '#6c63ff', '#f59e0b',
                ],
                borderWidth: 2,
                borderSkipped: false,
              },
            ],
          },
          options: {
            responsive: true,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} adet` } },
            },
            scales: {
              y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } },
            },
          },
        });
      }

      // AI Yorumu
      const aiDiv = document.getElementById(`fp-ai-${id}`);
      if (aiDiv) {
        if (data.aiComment) {
          aiDiv.innerHTML = `<div class="fp-ai-text">${esc(data.aiComment)}</div>`;
        } else {
          aiDiv.innerHTML =
            '<span class="fp-ai-nokey">⚠️ AI yorumu için ANTHROPIC_API_KEY gerekli.</span>';
        }
      }
    } catch (e) {
      const aiDiv = document.getElementById(`fp-ai-${id}`);
      if (aiDiv)
        aiDiv.innerHTML = `<span class="fp-ai-error">Hata: ${esc(e.message)}</span>`;
      fpToast(e.message, 'error');
    }
  };

  window._fpFilter = function (filter) {
    activeFilter = filter;
    document.querySelectorAll('.fp-tab').forEach((t) => t.classList.remove('active'));
    const tabMap = { all: 0, kritik: 1, 'uyarı': 2, yeterli: 3 };
    const tabIdx = tabMap[filter];
    const tabs = document.querySelectorAll('.fp-tab');
    if (tabs[tabIdx]) tabs[tabIdx].classList.add('active');
    renderList();
  };

  async function loadForecast() {
    injectStyle();

    const container = document.getElementById('page-forecast');
    if (!container) return;

    const topbarActions = document.getElementById('topbar-actions');
    if (topbarActions) {
      topbarActions.innerHTML =
        '<button class="fp-btn-refresh" onclick="window.loadForecast()">Yenile</button>';
    }

    container.innerHTML = `
      <div class="fp-shell">
        <div class="fp-toolbar">
          <div class="fp-toolbar-head">
            <div class="fp-heading">
              <h2>Talep Tahmini</h2>
              <p>Son 4 haftanın satış verisine göre stok risk analizi ve önümüzdeki 7 günlük tahmin.</p>
            </div>
          </div>
          <div class="fp-tabs">
            <button class="fp-tab active" onclick="window._fpFilter('all')">Tümü</button>
            <button class="fp-tab" onclick="window._fpFilter('kritik')">🔴 Kritik</button>
            <button class="fp-tab" onclick="window._fpFilter('uyarı')">🟡 Uyarı</button>
            <button class="fp-tab" onclick="window._fpFilter('yeterli')">🟢 Yeterli</button>
          </div>
        </div>
        <div id="fp-list"><div class="fp-empty">Yükleniyor...</div></div>
      </div>
    `;

    try {
      allForecasts = await fpApi('/api/forecast');
      renderList();
    } catch (e) {
      const list = document.getElementById('fp-list');
      if (list)
        list.innerHTML = `<div class="fp-empty">Hata: ${esc(e.message)}</div>`;
    }
  }

  window.loadForecast = loadForecast;
})();
```

- [ ] **Step 2: Dosya oluşturuldu mu kontrol et**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node -e "const fs = require('fs'); const s = fs.statSync('public/js/forecastPage.js'); console.log('Dosya boyutu:', s.size, 'bytes')"
```

Beklenen: `Dosya boyutu: XXXXX bytes` (hata yoksa OK)

- [ ] **Step 3: Commit**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && git add public/js/forecastPage.js && git commit -m "feat: add forecastPage.js browser component with Chart.js integration"
```

---

## Task 5: index.html — Navigasyon ve Sayfa Bağlantısı

**Files:**
- Modify: `index.html`

Bu task 5 ayrı edit içerir. Her biri sırasıyla uygulanmalı.

**Ön bilgi — mevcut yapı:**
- Nav items satırı: `<div class="nav-item" onclick="navigate('questions')" id="nav-questions">💬 Sorular</div>`
- Page divler: `<div class="page" id="page-questions"></div>`
- Titles: `questions: 'Müşteri Soruları'`
- navigate() fonk: `if (page === 'questions') loadQuestions();`
- Script tagları sonda: `<script src="/js/questionsPage.js"></script>`

### Edit 1: Nav item ekle

`index.html` dosyasında şu satırı bul:
```html
<div class="nav-item" onclick="navigate('questions')" id="nav-questions">
```

Hemen **üstüne** ekle:
```html
<div class="nav-item" onclick="navigate('forecast')" id="nav-forecast"><span class="icon">🔮</span>Talep Tahmini</div>
```

- [ ] **Step 1: Nav item ekle**

(Yukarıdaki Edit 1'i uygula)

### Edit 2: Page div ekle

`index.html` dosyasında şu satırı bul:
```html
<div class="page" id="page-questions"></div>
```

Hemen **üstüne** ekle:
```html
<div class="page" id="page-forecast"></div>
```

- [ ] **Step 2: Page div ekle**

(Yukarıdaki Edit 2'yi uygula)

### Edit 3: Titles nesnesine ekle

`index.html` dosyasında şu satırı bul:
```javascript
    questions: 'Müşteri Soruları',
```

Hemen **üstüne** ekle:
```javascript
    forecast: 'Talep Tahmini',
```

- [ ] **Step 3: Titles ekle**

(Yukarıdaki Edit 3'ü uygula)

### Edit 4: navigate() case'i ekle

`index.html` dosyasında şu satırı bul:
```javascript
  if (page === 'questions') loadQuestions();
```

Hemen **üstüne** ekle:
```javascript
  if (page === 'forecast') loadForecast();
```

- [ ] **Step 4: navigate() case ekle**

(Yukarıdaki Edit 4'ü uygula)

### Edit 5: Chart.js CDN + forecastPage.js script tag ekle

`index.html` dosyasında şu satırı bul:
```html
<script src="/js/questionsPage.js"></script>
```

Hemen **üstüne** ekle:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script src="/js/forecastPage.js"></script>
```

- [ ] **Step 5: Script tagları ekle**

(Yukarıdaki Edit 5'i uygula)

- [ ] **Step 6: Dosya syntax kontrolü**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node -e "
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const checks = [
  [\"nav-forecast\", \"Nav item\"],
  [\"page-forecast\", \"Page div\"],
  [\"forecast: 'Talep Tahmini'\", \"Title\"],
  [\"loadForecast()\", \"navigate case\"],
  [\"chart.js\", \"Chart.js CDN\"],
  [\"forecastPage.js\", \"Script tag\"]
];
let ok = true;
checks.forEach(([needle, label]) => {
  if (!html.includes(needle)) { console.error('EKSIK:', label, '(', needle, ')'); ok = false; }
});
if (ok) console.log('Tüm kontroller geçti.');
"
```

Beklenen: `Tüm kontroller geçti.`

- [ ] **Step 7: Commit**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && git add index.html && git commit -m "feat: add forecast page to navigation and wire up Chart.js CDN"
```

---

## Task 6: server.js — Forecast Router Mount

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Forecast router require satırı ekle**

`server.js` dosyasında şu satırı bul:
```javascript
const questionsRouter = require('./routes/questions');
```

Hemen **altına** ekle:
```javascript
const forecastRouter = require('./routes/forecast');
```

- [ ] **Step 2: Router'ı mount et**

`server.js` dosyasında şu satırı bul:
```javascript
app.use('/api/questions', authMiddleware, questionsRouter);
```

Hemen **altına** ekle:
```javascript
app.use('/api/forecast', authMiddleware, forecastRouter);
```

- [ ] **Step 3: Syntax kontrolü**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node --check server.js && echo "Syntax OK"
```

Beklenen: `Syntax OK`

- [ ] **Step 4: Sunucu başlatma testi**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node -e "
// Sadece module load test — sunucuyu başlatmadan
process.env.PORT = '0';
process.env.JWT_SECRET = 'test';
const app = require('./server');
console.log('Server module loaded OK');
" 2>&1 | head -10
```

Beklenen çıktıda: `✅ Veritabanı ve tablolar hazır.` görünmeli, hata olmamalı.

NOT: Sunucu başlarsa Ctrl+C ile dur.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && git add server.js && git commit -m "feat: mount forecast router at /api/forecast"
```

---

## Özet Commit Geçmişi

Tüm tasklar tamamlandığında:

```
feat: mount forecast router at /api/forecast
feat: add forecast page to navigation and wire up Chart.js CDN
feat: add forecastPage.js browser component with Chart.js integration
feat: add forecast REST routes (GET /api/forecast, GET /api/forecast/:productId)
feat: add generateForecastComment to aiService
feat: add demand forecast service (weekly sales, trend, stock classification)
```

## El ile Test

Sunucu çalışırken:
1. Browser'da `http://localhost:3000` aç
2. Sol menüde "🔮 Talep Tahmini" linkine tıkla
3. Ürün listesi yüklenmeli — stok durumlarına göre renkli badge'ler görünmeli
4. Kritik ürünler (varsa) listede en üstte kırmızı kenarlıkla görünmeli
5. Bir ürüne tıkla → grafik + "Claude yorumu yükleniyor..." görünmeli
6. ANTHROPIC_API_KEY .env'de tanımlıysa Claude yorumu gelecek
