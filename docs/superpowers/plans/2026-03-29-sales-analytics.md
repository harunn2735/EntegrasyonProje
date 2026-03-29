# Satış Analitik Sayfası — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SQLite sipariş verilerinden günlük/haftalık/aylık ciro ve sipariş grafikleri, 4 özet metrik kart ve en çok satan ürünler tablosu içeren bir satış analitik sayfası ekle.

**Architecture:** `routes/analytics.js` saf SQLite sorgu katmanı (5 endpoint, tümü `req.dealer.id` ile izole), `public/js/analyticsPage.js` IIFE browser bileşeni (mevcut forecastPage.js pattern'ı), `index.html` navigasyon entegrasyonu. Chart.js v4.4.4 zaten CDN'den yüklü — npm install gerekmez.

**Tech Stack:** `better-sqlite3`, `Express`, `Chart.js` (CDN, zaten mevcut), vanilla JS IIFE

---

## Dosya Haritası

| Dosya | İşlem | Sorumluluk |
|-------|-------|-----------|
| `routes/analytics.js` | Oluştur | 5 analitik endpoint — summary, daily, weekly, monthly, top-products |
| `server.js` | Güncelle | `analyticsRouter` require + `app.use('/api/analytics', ...)` mount |
| `public/js/analyticsPage.js` | Oluştur | IIFE browser bileşeni — 4 kart, dual-axis çizgi grafik, yatay bar grafik |
| `index.html` | Güncelle | Nav item, page div, title, navigate() case, script tag |

---

## Task 1: routes/analytics.js — 5 Analitik Endpoint

**Files:**
- Create: `routes/analytics.js`

**Ön bilgi:**
- `orders` tablosu: `order_date DATETIME` (ISO string), `total_price REAL`, `net_price REAL`, `status TEXT`, `lines_json TEXT`
- İptal/iade dışlanır: `status NOT IN ('Cancelled', 'Returned', 'UnDelivered')`
- `req.dealer.id` integer dealer ID (authMiddleware tarafından eklenir)
- `lines_json` örnek: `[{"title":"...", "barcode":"...", "quantity":1, "price":494, "commission":24}]`

- [ ] **Step 1: `routes/analytics.js` dosyasını oluştur**

```javascript
// routes/analytics.js
'use strict';

const express = require('express');
const db = require('../database');

const router = express.Router();

// İptal/iade siparişleri hariç tut
const ACTIVE = `status NOT IN ('Cancelled', 'Returned', 'UnDelivered')`;

// ── ÖZET: bugün / bu hafta / bu ay toplam ─────────────────────
router.get('/summary', (req, res) => {
  try {
    const row = db
      .prepare(
        `SELECT
          ROUND(SUM(CASE WHEN date(order_date) = date('now') THEN total_price ELSE 0 END), 2)            AS today_revenue,
          COUNT(CASE WHEN date(order_date) = date('now') THEN 1 END)                                     AS today_orders,
          ROUND(SUM(CASE WHEN strftime('%Y-%W', order_date) = strftime('%Y-%W', 'now') THEN total_price ELSE 0 END), 2) AS week_revenue,
          COUNT(CASE WHEN strftime('%Y-%W', order_date) = strftime('%Y-%W', 'now') THEN 1 END)           AS week_orders,
          ROUND(SUM(CASE WHEN strftime('%Y-%m', order_date) = strftime('%Y-%m', 'now') THEN total_price ELSE 0 END), 2) AS month_revenue,
          COUNT(CASE WHEN strftime('%Y-%m', order_date) = strftime('%Y-%m', 'now') THEN 1 END)           AS month_orders,
          COUNT(*)                                                                                        AS total_orders,
          ROUND(SUM(total_price), 2)                                                                     AS total_revenue,
          ROUND(SUM(net_price), 2)                                                                       AS total_net_revenue
        FROM orders
        WHERE dealer_id = ? AND ${ACTIVE}`
      )
      .get(req.dealer.id);
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GÜNLÜK: son N gün, boşluklar sıfırla doldurulur ──────────
router.get('/daily', (req, res) => {
  try {
    const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
    const modifier = `-${days} days`;

    const rows = db
      .prepare(
        `SELECT date(order_date) AS day,
                COUNT(*) AS orders,
                ROUND(SUM(total_price), 2) AS revenue,
                ROUND(SUM(net_price), 2) AS net_revenue
         FROM orders
         WHERE dealer_id = ? AND ${ACTIVE}
           AND order_date >= date('now', ?)
         GROUP BY date(order_date)
         ORDER BY day ASC`
      )
      .all(req.dealer.id, modifier);

    // Eksik günleri sıfırla doldur (UTC bazlı)
    const map = Object.fromEntries(rows.map((r) => [r.day, r]));
    const result = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)
      )
        .toISOString()
        .slice(0, 10);
      result.push(map[day] ?? { day, orders: 0, revenue: 0, net_revenue: 0 });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── HAFTALIK: son 12 hafta ────────────────────────────────────
router.get('/weekly', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT strftime('%Y-%W', order_date) AS week,
                COUNT(*) AS orders,
                ROUND(SUM(total_price), 2) AS revenue,
                ROUND(SUM(net_price), 2) AS net_revenue
         FROM orders
         WHERE dealer_id = ? AND ${ACTIVE}
           AND order_date >= date('now', '-84 days')
         GROUP BY strftime('%Y-%W', order_date)
         ORDER BY week ASC`
      )
      .all(req.dealer.id);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AYLIK: son 12 ay, boşluklar sıfırla doldurulur ───────────
router.get('/monthly', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT strftime('%Y-%m', order_date) AS month,
                COUNT(*) AS orders,
                ROUND(SUM(total_price), 2) AS revenue,
                ROUND(SUM(net_price), 2) AS net_revenue
         FROM orders
         WHERE dealer_id = ? AND ${ACTIVE}
           AND order_date >= date('now', '-365 days')
         GROUP BY strftime('%Y-%m', order_date)
         ORDER BY month ASC`
      )
      .all(req.dealer.id);

    // Eksik ayları sıfırla doldur
    const map = Object.fromEntries(rows.map((r) => [r.month, r]));
    const result = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = d.toISOString().slice(0, 7); // YYYY-MM
      result.push(map[key] ?? { month: key, orders: 0, revenue: 0, net_revenue: 0 });
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── EN ÇOK SATAN ÜRÜNLER: lines_json'u JS'de parse et ────────
router.get('/top-products', (req, res) => {
  try {
    const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 30));
    const modifier = `-${days} days`;

    const orders = db
      .prepare(
        `SELECT lines_json
         FROM orders
         WHERE dealer_id = ? AND ${ACTIVE}
           AND order_date >= date('now', ?)`
      )
      .all(req.dealer.id, modifier);

    const productMap = {};
    for (const order of orders) {
      let lines;
      try {
        lines = JSON.parse(order.lines_json || '[]');
      } catch {
        lines = [];
      }
      for (const line of lines) {
        const key = line.barcode || line.title || 'Bilinmiyor';
        if (!productMap[key]) {
          productMap[key] = {
            title: line.title || key,
            barcode: line.barcode || '',
            quantity: 0,
            revenue: 0,
          };
        }
        productMap[key].quantity += Number(line.quantity) || 1;
        productMap[key].revenue += Number(line.price) || 0;
      }
    }

    const result = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .map((p) => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Syntax ve modül kontrolü**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node -e "const r = require('./routes/analytics'); console.log('Router OK:', typeof r, '| routes:', r.stack?.length || 0)"
```

Beklenen: `Router OK: function | routes: 5`

- [ ] **Step 3: Endpoint'leri doğrula**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node -e "
require('dotenv').config();
const db = require('./database');
const dealer = db.prepare('SELECT id FROM dealers LIMIT 1').get();
if (!dealer) { console.log('Dealer yok'); process.exit(0); }
const id = dealer.id;

// summary
const row = db.prepare(\"SELECT COUNT(*) AS total FROM orders WHERE dealer_id = ?\").get(id);
console.log('Dealer', id, 'sipariş sayısı:', row.total);

// daily group
const daily = db.prepare(\"SELECT date(order_date) as day, COUNT(*) as cnt FROM orders WHERE dealer_id = ? GROUP BY date(order_date) ORDER BY day DESC LIMIT 3\").all(id);
console.log('Son 3 günlük veri:', JSON.stringify(daily));
"
```

Beklenen: Hata yok, sipariş sayısı ve günlük veriler yazdırılır.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && git add routes/analytics.js && git commit -m "feat: add analytics REST routes (summary, daily, weekly, monthly, top-products)"
```

---

## Task 2: server.js — Analytics Router Mount

**Files:**
- Modify: `server.js`

- [ ] **Step 1: `analyticsRouter` require satırını ekle**

`server.js` dosyasında şu satırı bul:
```javascript
const forecastRouter = require('./routes/forecast');
```

Hemen **altına** ekle:
```javascript
const analyticsRouter = require('./routes/analytics');
```

- [ ] **Step 2: Router'ı mount et**

`server.js` dosyasında şu satırı bul:
```javascript
app.use('/api/forecast', authMiddleware, forecastRouter);
```

Hemen **altına** ekle:
```javascript
app.use('/api/analytics', authMiddleware, analyticsRouter);
```

- [ ] **Step 3: Syntax kontrolü**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node --check server.js && echo "Syntax OK"
```

Beklenen: `Syntax OK`

- [ ] **Step 4: Commit**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && git add server.js && git commit -m "feat: mount analytics router at /api/analytics"
```

---

## Task 3: public/js/analyticsPage.js — Browser UI Bileşeni

**Files:**
- Create: `public/js/analyticsPage.js`

**Ön bilgi:**
- Chart.js v4.4.4 global `Chart` objesi olarak mevcut (CDN'den yüklü)
- `localStorage.getItem('dealer_token')` ile JWT token alınır
- Renk paleti: turuncu `#F27A1A` (ciro), yeşil `#1D9E75` (sipariş)
- TL formatı: `₺1.234,56` — `toLocaleString('tr-TR', {minimumFractionDigits: 2})`
- `window.loadAnalytics` global olarak expose edilmeli (navigate() çağırır)

- [ ] **Step 1: `public/js/analyticsPage.js` dosyasını oluştur**

```javascript
// public/js/analyticsPage.js
(function () {
  'use strict';

  /* ── CSS ────────────────────────────────────────────────────── */
  const STYLE = `
    #page-analytics {
      padding: 8px 0 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: hidden;
    }
    .ap-shell {
      display: flex;
      flex-direction: column;
      gap: 20px;
      width: 100%;
      max-width: 1180px;
      margin: 0 auto;
    }
    /* ── 4 metrik kart ── */
    .ap-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }
    .ap-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px;
      box-shadow: var(--shadow);
    }
    .ap-card-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: .5px;
      margin-bottom: 8px;
    }
    .ap-card-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--text);
    }
    .ap-card-sub {
      font-size: 12px;
      color: var(--muted);
      margin-top: 4px;
    }
    /* ── Grafik kutusu ── */
    .ap-chart-box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      box-shadow: var(--shadow);
    }
    .ap-chart-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 10px;
    }
    .ap-chart-header h3 {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
    }
    /* ── Sekmeler ── */
    .ap-tabs {
      display: inline-flex;
      gap: 6px;
      padding: 4px;
      border-radius: 10px;
      background: var(--bg3);
      border: 1px solid var(--border);
    }
    .ap-tab {
      padding: 7px 16px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      font-family: inherit;
      transition: .15s ease;
    }
    .ap-tab:hover { color: var(--text); background: rgba(255,255,255,.7); }
    .ap-tab.active {
      background: #F27A1A;
      color: #fff;
      border-color: #F27A1A;
    }
    /* ── Yenile butonu ── */
    .ap-btn-refresh {
      background: #F27A1A;
      color: #fff;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      font-family: inherit;
    }
    /* ── Boş durum ── */
    .ap-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      color: var(--muted);
      font-size: 14px;
    }
    /* ── Responsive ── */
    @media (max-width: 900px) {
      .ap-cards { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 540px) {
      .ap-cards { grid-template-columns: 1fr; }
      .ap-chart-header { flex-direction: column; align-items: flex-start; }
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

  /* ── API yardımcısı ─────────────────────────────────────────── */
  async function apApi(path) {
    const token = localStorage.getItem('dealer_token') || '';
    const res = await fetch(path, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sunucu hatası');
    return data;
  }

  /* ── Türk lirası formatı ────────────────────────────────────── */
  function fmtTL(n) {
    return (
      '₺' +
      Number(n || 0).toLocaleString('tr-TR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  /* ── Grafik instance'ları ────────────────────────────────────── */
  let mainChart = null;
  let topChart = null;
  let currentPeriod = 'daily';

  /* ── 4 Metrik kart ──────────────────────────────────────────── */
  function renderCards(s) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('ap-today-rev', fmtTL(s.today_revenue));
    set('ap-today-sub', `${s.today_orders || 0} sipariş`);
    set('ap-week-rev', fmtTL(s.week_revenue));
    set('ap-week-sub', `${s.week_orders || 0} sipariş`);
    set('ap-month-rev', fmtTL(s.month_revenue));
    set('ap-month-sub', `${s.month_orders || 0} sipariş`);
    set('ap-total-orders', s.total_orders || 0);
    set('ap-total-sub', `Net: ${fmtTL(s.total_net_revenue)}`);
  }

  /* ── Ana dual-axis çizgi grafik ─────────────────────────────── */
  function renderMainChart(data, period) {
    const canvas = document.getElementById('ap-main-chart');
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;
    if (mainChart) { mainChart.destroy(); mainChart = null; }

    // Etiket formatı dönemi göre farklı
    const labels = data.map((d) => {
      if (period === 'daily') {
        // "2026-03-15" → "15 Mar"
        const dt = new Date(d.day + 'T00:00:00Z');
        return dt.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      }
      if (period === 'weekly') {
        // "2026-12" → "Hft 12"
        return 'Hft ' + d.week.split('-')[1];
      }
      // "2026-03" → "Mar 26"
      const [y, m] = d.month.split('-');
      return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString('tr-TR', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      });
    });

    mainChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ciro (₺)',
            data: data.map((d) => d.revenue),
            borderColor: '#F27A1A',
            backgroundColor: 'rgba(242,122,26,.08)',
            fill: true,
            tension: 0.35,
            yAxisID: 'y',
            pointRadius: data.length <= 31 ? 3 : 0,
            pointHoverRadius: 5,
            borderWidth: 2,
          },
          {
            label: 'Sipariş Adedi',
            data: data.map((d) => d.orders),
            borderColor: '#1D9E75',
            backgroundColor: 'rgba(29,158,117,.06)',
            fill: false,
            tension: 0.35,
            yAxisID: 'y1',
            pointRadius: data.length <= 31 ? 3 : 0,
            pointHoverRadius: 5,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                ctx.dataset.yAxisID === 'y'
                  ? ` Ciro: ${fmtTL(ctx.parsed.y)}`
                  : ` Sipariş: ${ctx.parsed.y}`,
            },
          },
        },
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            grid: { color: 'rgba(0,0,0,.05)' },
            ticks: {
              callback: (v) => '₺' + Number(v).toLocaleString('tr-TR'),
            },
          },
          y1: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { precision: 0 },
          },
          x: { grid: { display: false } },
        },
      },
    });
  }

  /* ── Yatay bar grafik (en çok satanlar) ─────────────────────── */
  function renderTopChart(products) {
    const canvas = document.getElementById('ap-top-chart');
    const ctx = canvas && canvas.getContext('2d');
    if (!ctx || typeof Chart === 'undefined') return;
    if (topChart) { topChart.destroy(); topChart = null; }

    if (!products.length) {
      const box = canvas.closest('.ap-chart-box');
      if (box) box.innerHTML = '<div class="ap-empty">Son 30 günde sipariş verisi bulunamadı.</div>';
      return;
    }

    // Başlıkları kısalt
    const labels = products.map((p) =>
      p.title.length > 35 ? p.title.slice(0, 35) + '…' : p.title
    );

    topChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Ciro (₺)',
            data: products.map((p) => p.revenue),
            backgroundColor: 'rgba(242,122,26,.75)',
            borderColor: '#F27A1A',
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                ` Ciro: ${fmtTL(ctx.parsed.x)} | Adet: ${products[ctx.dataIndex]?.quantity ?? 0}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,.05)' },
            ticks: { callback: (v) => '₺' + Number(v).toLocaleString('tr-TR') },
          },
          y: { grid: { display: false } },
        },
      },
    });
  }

  /* ── Sekme geçişi ────────────────────────────────────────────── */
  window._apSwitchPeriod = async function (period) {
    currentPeriod = period;
    document.querySelectorAll('.ap-tab').forEach((t) => t.classList.remove('active'));
    const idx = { daily: 0, weekly: 1, monthly: 2 };
    const tabs = document.querySelectorAll('.ap-tab');
    if (tabs[idx[period]]) tabs[idx[period]].classList.add('active');

    try {
      const data = await apApi(`/api/analytics/${period}`);
      renderMainChart(data, period);
    } catch (e) {
      console.error('[Analytics] Sekme yükleme hatası:', e.message);
    }
  };

  /* ── Ana yükleme fonksiyonu ─────────────────────────────────── */
  async function loadAnalytics() {
    injectStyle();

    const container = document.getElementById('page-analytics');
    if (!container) return;

    // Topbar'a yenile butonu
    const topbar = document.getElementById('topbar-actions');
    if (topbar) {
      topbar.innerHTML =
        '<button class="ap-btn-refresh" onclick="window.loadAnalytics()">Yenile</button>';
    }

    // Sayfa iskeleti
    container.innerHTML = `
      <div class="ap-shell">
        <div class="ap-cards">
          <div class="ap-card">
            <div class="ap-card-label">Bugün Ciro</div>
            <div class="ap-card-value" id="ap-today-rev">—</div>
            <div class="ap-card-sub" id="ap-today-sub"></div>
          </div>
          <div class="ap-card">
            <div class="ap-card-label">Bu Hafta Ciro</div>
            <div class="ap-card-value" id="ap-week-rev">—</div>
            <div class="ap-card-sub" id="ap-week-sub"></div>
          </div>
          <div class="ap-card">
            <div class="ap-card-label">Bu Ay Ciro</div>
            <div class="ap-card-value" id="ap-month-rev">—</div>
            <div class="ap-card-sub" id="ap-month-sub"></div>
          </div>
          <div class="ap-card">
            <div class="ap-card-label">Toplam Sipariş</div>
            <div class="ap-card-value" id="ap-total-orders">—</div>
            <div class="ap-card-sub" id="ap-total-sub"></div>
          </div>
        </div>

        <div class="ap-chart-box">
          <div class="ap-chart-header">
            <h3>Satış Grafiği</h3>
            <div class="ap-tabs">
              <button class="ap-tab active" onclick="window._apSwitchPeriod('daily')">Günlük</button>
              <button class="ap-tab" onclick="window._apSwitchPeriod('weekly')">Haftalık</button>
              <button class="ap-tab" onclick="window._apSwitchPeriod('monthly')">Aylık</button>
            </div>
          </div>
          <canvas id="ap-main-chart" height="280"></canvas>
        </div>

        <div class="ap-chart-box">
          <div class="ap-chart-header">
            <h3>En Çok Satan Ürünler (Son 30 Gün)</h3>
          </div>
          <canvas id="ap-top-chart" height="260"></canvas>
        </div>
      </div>
    `;

    // 3 isteği paralel gönder
    try {
      const [summary, daily, topProducts] = await Promise.all([
        apApi('/api/analytics/summary'),
        apApi('/api/analytics/daily'),
        apApi('/api/analytics/top-products'),
      ]);
      renderCards(summary);
      renderMainChart(daily, 'daily');
      renderTopChart(topProducts);
    } catch (e) {
      container.innerHTML = `<div class="ap-empty">Hata: ${String(e.message).replace(/</g, '&lt;')}</div>`;
    }
  }

  window.loadAnalytics = loadAnalytics;
})();
```

- [ ] **Step 2: Dosya boyutu kontrolü**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node -e "
const fs = require('fs');
const s = fs.statSync('public/js/analyticsPage.js');
console.log('Dosya boyutu:', s.size, 'bytes');
const src = fs.readFileSync('public/js/analyticsPage.js', 'utf8');
const keys = ['window.loadAnalytics', 'window._apSwitchPeriod', 'apApi', 'fmtTL', 'renderCards', 'renderMainChart', 'renderTopChart'];
keys.forEach(k => console.log(src.includes(k) ? 'OK: ' + k : 'EKSIK: ' + k));
"
```

Beklenen: boyut > 8000, tüm anahtarlar `OK:`

- [ ] **Step 3: Commit**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && git add public/js/analyticsPage.js && git commit -m "feat: add analyticsPage.js browser component with dual-axis chart and top-products"
```

---

## Task 4: index.html — Navigasyon ve Sayfa Bağlantısı

**Files:**
- Modify: `index.html`

**Ön bilgi — mevcut yapı:**
- Nav items: `<div class="nav-item" onclick="navigate('forecast')" id="nav-forecast">...` türü divler
- Page divler: `<div class="page" id="page-forecast"></div>` türü
- Titles: `forecast: 'Talep Tahmini',`
- navigate() içi: `if (page === 'forecast') loadForecast();`
- Script tagları sonda (2125+. satırlar): Chart.js CDN, forecastPage.js, questionsPage.js

### Edit 1: Nav item ekle

`index.html` dosyasında şu satırı bul:
```html
<div class="nav-item" onclick="navigate('forecast')" id="nav-forecast">
```

Hemen **üstüne** ekle:
```html
<div class="nav-item" onclick="navigate('analytics')" id="nav-analytics"><span class="icon">📊</span>Satış Grafikleri</div>
```

- [ ] **Step 1: Nav item ekle**

(Yukarıdaki Edit 1'i uygula)

### Edit 2: Page div ekle

`index.html` dosyasında şu satırı bul:
```html
<div class="page" id="page-forecast"></div>
```

Hemen **üstüne** ekle:
```html
<div class="page" id="page-analytics"></div>
```

- [ ] **Step 2: Page div ekle**

(Yukarıdaki Edit 2'yi uygula)

### Edit 3: Titles nesnesine ekle

`index.html` dosyasında şu satırı bul:
```javascript
    forecast: 'Talep Tahmini',
```

Hemen **üstüne** ekle:
```javascript
    analytics: 'Satış Grafikleri',
```

- [ ] **Step 3: Titles ekle**

(Yukarıdaki Edit 3'ü uygula)

### Edit 4: navigate() case ekle

`index.html` dosyasında şu satırı bul:
```javascript
  if (page === 'forecast') loadForecast();
```

Hemen **üstüne** ekle:
```javascript
  if (page === 'analytics') loadAnalytics();
```

- [ ] **Step 4: navigate() case ekle**

(Yukarıdaki Edit 4'ü uygula)

### Edit 5: Script tag ekle

`index.html` dosyasında şu satırı bul:
```html
<script src="/js/forecastPage.js"></script>
```

Hemen **üstüne** ekle:
```html
<script src="/js/analyticsPage.js"></script>
```

- [ ] **Step 5: Script tag ekle**

(Yukarıdaki Edit 5'i uygula)

- [ ] **Step 6: Tüm kontrolleri doğrula**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && node -e "
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const checks = [
  [\"nav-analytics\", \"Nav item\"],
  [\"page-analytics\", \"Page div\"],
  [\"analytics: 'Satış Grafikleri'\", \"Title\"],
  [\"loadAnalytics()\", \"navigate() case\"],
  [\"/js/analyticsPage.js\", \"Script tag\"]
];
let ok = true;
checks.forEach(([needle, label]) => {
  if (!html.includes(needle)) { console.error('EKSIK:', label); ok = false; }
  else console.log('OK:', label);
});
if (ok) console.log('\\nTüm kontroller geçti.');
"
```

Beklenen: Tüm satırlar `OK:` ve `Tüm kontroller geçti.`

- [ ] **Step 7: Commit**

```bash
cd C:/Users/harun/Desktop/claude_trendyol && git add index.html && git commit -m "feat: add analytics page to navigation"
```

---

## Özet Commit Geçmişi

Tüm tasklar tamamlandığında:

```
feat: add analytics page to navigation
feat: add analyticsPage.js browser component with dual-axis chart and top-products
feat: mount analytics router at /api/analytics
feat: add analytics REST routes (summary, daily, weekly, monthly, top-products)
```

## El ile Test

Sunucu çalışırken:
1. `node server.js` başlat
2. Sol menüde **"📊 Satış Grafikleri"** linkine tıkla
3. 4 metrik kart yüklenmeli: Bugün Ciro / Bu Hafta / Bu Ay / Toplam Sipariş
4. Ana grafik: turuncu çizgi = ciro (sol eksen ₺), yeşil = sipariş adedi (sağ eksen)
5. "Haftalık" / "Aylık" sekmelerine tıkla — grafik değişmeli
6. En çok satan ürünler yatay bar grafiği görünmeli

### API Test (sunucu çalışırken)
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bayi@demo.com","password":"bayi123"}' | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/analytics/summary | node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d), null, 2)))"
```

Beklenen: `today_revenue`, `week_revenue`, `month_revenue`, `total_orders` alanları olan JSON
