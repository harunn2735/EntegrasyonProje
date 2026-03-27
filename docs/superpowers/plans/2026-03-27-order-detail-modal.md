# Sipariş Detay Modal Sistemi — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sipariş tablosundaki her satıra tıklanınca müşteri, adres, ürünler ve kargo takip bilgilerini gösteren bir modal açmak; veriyi önce local DB'den, yoksa Trendyol API'den çekmek.

**Architecture:** Yeni `routes/orderDetail.js` dosyası hybrid GET endpoint'i barındırır ve Express Router olarak server.js'e mount edilir. `public/js/orderModal.js` kendi CSS'ini inject eden bağımsız bir modal modülüdür. `authMiddleware` server.js'de kalır, router'ı mount ederken uygulanır.

**Tech Stack:** Node.js, Express 5, better-sqlite3, axios, vanilla JS (no framework), JWT auth

---

## Dosya Haritası

| Eylem | Dosya | Sorumluluk |
|---|---|---|
| Oluştur | `routes/orderDetail.js` | Hybrid fetch endpoint, kargo link helper |
| Oluştur | `public/js/orderModal.js` | Modal CSS inject, HTML render, event delegation |
| Değiştir | `server.js` satır 21 | `public/` dizini için statik dosya servisi ekle |
| Değiştir | `server.js` satır ~1644 sonrası | `orderDetailRouter` require + mount |
| Değiştir | `index.html` satır 1984 | `<tr>`'ye `data-order-number` ekle (yeni loadOrders) |
| Değiştir | `index.html` satır 1836 | `<tr>`'ye `data-order-number` ekle (eski loadOrders) |
| Değiştir | `index.html` kapanış `</body>` | `<script src="/js/orderModal.js">` ekle |

---

## Task 1: `routes/orderDetail.js` — Kargo Link Helper ve Temel Yapı

**Files:**
- Create: `routes/orderDetail.js`

- [ ] **Adım 1: Dosyayı oluştur — kargo helper ve boş router**

`routes/orderDetail.js` dosyasını aşağıdaki içerikle oluştur:

```javascript
const express = require('express');
const axios = require('axios');
const db = require('../database');

const router = express.Router();

// ── KARGO TAKİP LİNK HELPERı ──────────────────────────────────
const CARGO_PATTERNS = [
  { re: /yurtiçi|yurtici/i, url: (n) => `https://www.yurticikargo.com/tr/online-islemler/gonderi-sorgula?kod=${n}` },
  { re: /aras/i,             url: (n) => `https://kargotakip.araskargo.com.tr/MainPage.aspx?code=${n}` },
  { re: /mng/i,              url: (n) => `https://www.mngkargo.com.tr/gonderi-takip?takipNo=${n}` },
  { re: /ptt/i,              url: (n) => `https://www.ptt.gov.tr/tr/anasayfa/kargo-takip?q=${n}` },
  { re: /sürat|surat/i,      url: (n) => `https://www.suratkargo.com.tr/KargoTakip/${n}` },
  { re: /dhl/i,              url: (n) => `https://www.dhl.com/tr-tr/home/tracking.html?tracking-id=${n}` },
];

function getTrackingUrl(cargoCompany, trackingNumber) {
  if (!trackingNumber || trackingNumber === '-' || !cargoCompany || cargoCompany === '-') return null;
  const match = CARGO_PATTERNS.find(c => c.re.test(cargoCompany));
  return match ? match.url(encodeURIComponent(trackingNumber)) : null;
}

module.exports = router;
```

- [ ] **Adım 2: Commit**

```bash
git add routes/orderDetail.js
git commit -m "feat: add orderDetail router with cargo tracking helper"
```

---

## Task 2: `routes/orderDetail.js` — Local DB Fetch

**Files:**
- Modify: `routes/orderDetail.js`

- [ ] **Adım 1: Local DB fetch fonksiyonunu ekle**

`module.exports = router;` satırından **önce** şunu ekle:

```javascript
// ── LOCAL DB'DEN SİPARİŞ ÇEK ──────────────────────────────────
function fetchFromLocal(dealerId, orderNumber) {
  const order = db.prepare(
    'SELECT * FROM orders WHERE dealer_id = ? AND order_number = ?'
  ).get(dealerId, orderNumber);

  if (!order) return null;

  let lines = [];
  try { lines = JSON.parse(order.lines_json || '[]'); } catch (_) {}

  const getStock = db.prepare(
    'SELECT stock, image_url FROM dealer_products WHERE dealer_id = ? AND barcode = ? LIMIT 1'
  );

  lines = lines.map(line => {
    const local = line.barcode ? getStock.get(dealerId, line.barcode) : null;
    return {
      title:       line.title || '',
      barcode:     line.barcode || '',
      quantity:    line.quantity || 1,
      price:       line.price || 0,
      image_url:   line.image_url || local?.image_url || '',
      local_stock: local?.stock ?? line.local_stock ?? null,
    };
  });

  return { ...order, lines, source: 'local' };
}
```

- [ ] **Adım 2: Commit**

```bash
git add routes/orderDetail.js
git commit -m "feat: add local DB fetch to orderDetail router"
```

---

## Task 3: `routes/orderDetail.js` — Trendyol API Fallback

**Files:**
- Modify: `routes/orderDetail.js`

- [ ] **Adım 1: Trendyol fetch fonksiyonunu ekle**

`fetchFromLocal` fonksiyonundan **sonra**, `module.exports` satırından **önce** ekle:

```javascript
// ── TRENDYOL API'DAN SİPARİŞ ÇEK ─────────────────────────────
async function fetchFromTrendyol(dealerId, orderNumber) {
  const dealer = db.prepare(
    'SELECT supplier_id, api_key, api_secret FROM dealers WHERE id = ?'
  ).get(dealerId);

  if (!dealer?.supplier_id || !dealer?.api_key || !dealer?.api_secret) {
    return { error: 'API bilgileri tanımlı değil', status: 400 };
  }

  const authString = Buffer.from(`${dealer.api_key}:${dealer.api_secret}`).toString('base64');

  let response;
  try {
    response = await axios.get(
      `https://apigw.trendyol.com/integration/order/sellers/${dealer.supplier_id}/orders?orderNumber=${orderNumber}`,
      {
        headers: {
          Authorization: `Basic ${authString}`,
          'User-Agent': `${dealer.supplier_id} - SelfIntegration`,
        },
        timeout: 5000,
      }
    );
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return { error: 'Trendyol API zaman aşımı', status: 504 };
    }
    const detail = err.response?.data?.message || err.message;
    return { error: 'Trendyol API hatası', detail, status: 502 };
  }

  const items = response.data?.content || [];
  if (!items.length) return null;

  // İlk item'dan temel bilgileri al, tüm item'lardan line'ları topla
  const first = items[0];
  const address = first.shipmentAddress || first.address || {};
  let totalPrice = 0;
  let commission = 0;
  const lines = [];

  for (const item of items) {
    const itemLines = Array.isArray(item.lines) && item.lines.length ? item.lines : [item];
    for (const line of itemLines) {
      const price = Number(line.price || line.paidPrice || line.totalPrice || 0);
      const comm  = Number(line.commission || line.tyCommission || 0);
      totalPrice += price;
      commission += comm;
      lines.push({
        title:       String(line.productName || item.productName || 'Ürün'),
        barcode:     String(line.barcode || line.productCode || line.merchantSku || '').trim(),
        quantity:    parseInt(line.quantity || line.amount || 1, 10) || 1,
        price,
        image_url:   line.imageUrl || line.image || '',
        local_stock: null,
      });
    }
  }

  return {
    order_number:     String(first.orderNumber || orderNumber),
    order_date:       first.orderDate ? new Date(first.orderDate).toISOString() : new Date().toISOString(),
    status:           first.status || 'Created',
    customer_name:    [first.customerFirstName, first.customerLastName].filter(Boolean).join(' ').trim() || address.fullName || '-',
    shipping_address: [address.fullAddress, address.address1, address.address2, address.district, address.city].filter(Boolean).join(', '),
    cargo_company:    first.cargoProviderName || first.cargoCompanyName || '-',
    tracking_number:  first.cargoTrackingNumber || first.trackingNumber || '-',
    package_number:   String(first.packageNumber || first.shipmentPackageId || ''),
    total_price:      totalPrice,
    net_price:        Math.max(0, totalPrice - commission),
    is_refund:        /return|refund|iade/i.test(String(first.status || '')) ? 1 : 0,
    lines,
    source: 'trendyol',
  };
}
```

- [ ] **Adım 2: Commit**

```bash
git add routes/orderDetail.js
git commit -m "feat: add Trendyol API fallback to orderDetail router"
```

---

## Task 4: `routes/orderDetail.js` — Route Handler

**Files:**
- Modify: `routes/orderDetail.js`

- [ ] **Adım 1: GET handler'ı ekle**

`fetchFromTrendyol` fonksiyonundan **sonra**, `module.exports` satırından **önce** ekle:

```javascript
// ── GET /api/orders/:orderNumber ──────────────────────────────
router.get('/:orderNumber', async (req, res) => {
  const dealerId = req.dealer.id;
  const { orderNumber } = req.params;

  // 1. Local DB'den dene
  const local = fetchFromLocal(dealerId, orderNumber);
  if (local) {
    const tracking_url  = getTrackingUrl(local.cargo_company, local.tracking_number);
    const trendyol_url  = `https://partner.trendyol.com/orders/${orderNumber}`;
    return res.json({ ...local, tracking_url, trendyol_url });
  }

  // 2. Trendyol API'dan dene
  const remote = await fetchFromTrendyol(dealerId, orderNumber);

  if (remote?.error) {
    return res.status(remote.status || 502).json({ error: remote.error, detail: remote.detail });
  }

  if (!remote) {
    return res.status(404).json({ error: 'Sipariş bulunamadı' });
  }

  const tracking_url = getTrackingUrl(remote.cargo_company, remote.tracking_number);
  const trendyol_url = `https://partner.trendyol.com/orders/${orderNumber}`;
  return res.json({ ...remote, tracking_url, trendyol_url });
});
```

- [ ] **Adım 2: Commit**

```bash
git add routes/orderDetail.js
git commit -m "feat: add GET /:orderNumber handler with hybrid fetch"
```

---

## Task 5: `server.js` — Router'ı Monte Et

**Files:**
- Modify: `server.js`

- [ ] **Adım 1: `public/` için statik middleware ekle**

`server.js` satır 21'deki mevcut satırdan **sonra** ekle:

```javascript
// Mevcut satır (dokunma):
app.use(express.static(path.join(__dirname)));
// Yeni satır (ekle):
app.use(express.static(path.join(__dirname, 'public')));
```

- [ ] **Adım 2: Router'ı require et ve mount et**

`server.js`'de `const db = require('./database');` satırından **sonra** ekle:

```javascript
const orderDetailRouter = require('./routes/orderDetail');
```

Ardından `app.get('/api/dealer/orders/:orderNumber', authMiddleware, ...)` bloğunun (satır 1623) **hemen öncesine** ekle:

```javascript
app.use('/api/orders', authMiddleware, orderDetailRouter);
```

- [ ] **Adım 3: Sunucuyu başlat ve endpoint'i test et**

```bash
npm start
```

Yeni pencerede:
```bash
# Önce token al
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bayiemail@example.com","password":"sifre"}' | jq .token
```

Token'ı `TOKEN` değişkenine koy ve test et:
```bash
curl -s http://localhost:3000/api/orders/TEST_ORDER_NUMBER \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Beklenen: `{ "error": "Sipariş bulunamadı" }` (404) veya gerçek sipariş verisi.

- [ ] **Adım 4: Commit**

```bash
git add server.js
git commit -m "feat: mount orderDetail router at /api/orders with authMiddleware"
```

---

## Task 6: `public/js/orderModal.js` — CSS Inject ve Modal HTML

**Files:**
- Create: `public/js/orderModal.js`

- [ ] **Adım 1: Dosyayı oluştur — CSS inject ve modal template**

```javascript
(function () {
  'use strict';

  // ── CSS ─────────────────────────────────────────────────────
  const STYLE = `
    #om-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.45);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; padding: 16px;
    }
    #om-card {
      background: #fff; border-radius: 16px; width: 100%;
      max-width: 680px; max-height: 90vh; overflow-y: auto;
      box-shadow: 0 8px 40px rgba(0,0,0,.18); display: flex; flex-direction: column;
    }
    #om-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 24px 16px; border-bottom: 1px solid #e2e8f0;
    }
    #om-header h3 { font-size: 16px; font-weight: 700; color: #1e293b; margin: 0; }
    #om-close {
      background: none; border: none; font-size: 20px; cursor: pointer;
      color: #64748b; padding: 4px 8px; border-radius: 6px; line-height: 1;
    }
    #om-close:hover { background: #f1f5f9; }
    #om-body { padding: 20px 24px; flex: 1; }
    #om-spinner { text-align: center; padding: 48px; color: #64748b; font-size: 14px; }
    .om-meta-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;
    }
    .om-meta-item { display: flex; flex-direction: column; gap: 2px; }
    .om-meta-label { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
    .om-meta-value { font-size: 13px; color: #1e293b; font-weight: 500; }
    .om-section-title {
      font-size: 12px; font-weight: 700; color: #64748b;
      text-transform: uppercase; letter-spacing: .5px;
      margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;
    }
    .om-lines { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
    .om-line {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; background: #f8fafc; border-radius: 10px;
    }
    .om-line-img {
      width: 44px; height: 44px; border-radius: 8px; object-fit: cover;
      background: #e2e8f0; flex-shrink: 0; font-size: 18px;
      display: flex; align-items: center; justify-content: center;
    }
    .om-line-img img { width: 100%; height: 100%; border-radius: 8px; object-fit: cover; }
    .om-line-info { flex: 1; min-width: 0; }
    .om-line-title { font-size: 13px; font-weight: 500; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .om-line-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .om-line-price { font-size: 13px; font-weight: 600; color: #1e293b; white-space: nowrap; }
    #om-footer {
      display: flex; gap: 10px; padding: 16px 24px;
      border-top: 1px solid #e2e8f0; justify-content: flex-end;
    }
    .om-btn {
      padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; border: 1px solid #e2e8f0; background: #f8fafc;
      color: #1e293b; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
    }
    .om-btn:hover { background: #f1f5f9; }
    .om-btn-primary { background: #6c63ff; color: #fff; border-color: #6c63ff; }
    .om-btn-primary:hover { background: #5b52e0; }
    .om-btn:disabled { opacity: .45; cursor: not-allowed; pointer-events: none; }
    @media (max-width: 540px) { .om-meta-grid { grid-template-columns: 1fr; } }
  `;

  function injectStyle() {
    if (document.getElementById('om-style')) return;
    const el = document.createElement('style');
    el.id = 'om-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  // ── YARDIMCILAR ─────────────────────────────────────────────
  function esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtMoney(val) {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(val || 0));
  }

  function fmtDate(val) {
    if (!val) return '-';
    const d = new Date(val);
    return isNaN(d) ? '-' : d.toLocaleDateString('tr-TR');
  }

  function avatarHtml(name) {
    const text = String(name || '?').trim();
    const initials = text.split(/\s+/).slice(0,2).map(p => p[0] || '').join('').toUpperCase() || '?';
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = text.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `<div class="om-line-img" style="background:hsl(${hue} 65% 88%);color:hsl(${hue} 55% 36%);font-size:12px;font-weight:700">${initials}</div>`;
  }

  module_exports_placeholder(); // işaretçi — aşağıdaki task'ta kaldırılır
})();
```

> **Not:** `module_exports_placeholder()` satırı Task 7'de silinecek ve yerine gerçek init kodu eklenecek. Bu adımda dosya kaydedilir, tarayıcı henüz yüklenmez.

- [ ] **Adım 2: Commit**

```bash
git add public/js/orderModal.js
git commit -m "feat: add orderModal CSS and helper functions"
```

---

## Task 7: `public/js/orderModal.js` — Modal Render ve Event Delegation

**Files:**
- Modify: `public/js/orderModal.js`

- [ ] **Adım 1: `module_exports_placeholder();` satırını sil, yerine aşağıdakileri ekle**

`module_exports_placeholder();` satırını tamamen kaldır. Yerine şunları ekle (hâlâ `})();` kapanışından önce):

```javascript
  // ── MODAL OLUŞTUR ────────────────────────────────────────────
  function createOverlay() {
    const div = document.createElement('div');
    div.id = 'om-overlay';
    div.innerHTML = `
      <div id="om-card">
        <div id="om-header">
          <h3 id="om-title">Sipariş Detayı</h3>
          <button id="om-close" title="Kapat">×</button>
        </div>
        <div id="om-body"><div id="om-spinner">Yükleniyor…</div></div>
        <div id="om-footer"></div>
      </div>`;
    return div;
  }

  function closeModal() {
    const el = document.getElementById('om-overlay');
    if (el) el.remove();
  }

  function renderModal(order) {
    document.getElementById('om-title').textContent = `Sipariş #${order.order_number}`;

    const linesHtml = (order.lines || []).map(line => {
      const imgHtml = line.image_url
        ? `<div class="om-line-img"><img src="${esc(line.image_url)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='📦'"></div>`
        : avatarHtml(line.title);
      const stockLabel = line.local_stock != null ? ` · Stok: ${line.local_stock}` : '';
      return `
        <div class="om-line">
          ${imgHtml}
          <div class="om-line-info">
            <div class="om-line-title">${esc(line.title || '-')}</div>
            <div class="om-line-sub">${esc(line.barcode || '-')}${stockLabel}</div>
          </div>
          <div class="om-line-price">${esc(String(line.quantity || 1))} × ${fmtMoney(line.price)}</div>
        </div>`;
    }).join('');

    document.getElementById('om-body').innerHTML = `
      <div class="om-meta-grid">
        <div class="om-meta-item">
          <span class="om-meta-label">Müşteri</span>
          <span class="om-meta-value">${esc(order.customer_name || '-')}</span>
        </div>
        <div class="om-meta-item">
          <span class="om-meta-label">Tarih</span>
          <span class="om-meta-value">${fmtDate(order.order_date)}</span>
        </div>
        <div class="om-meta-item">
          <span class="om-meta-label">Adres</span>
          <span class="om-meta-value">${esc(order.shipping_address || '-')}</span>
        </div>
        <div class="om-meta-item">
          <span class="om-meta-label">Kargo</span>
          <span class="om-meta-value">${esc(order.cargo_company || '-')} · ${esc(order.tracking_number || '-')}</span>
        </div>
        <div class="om-meta-item">
          <span class="om-meta-label">Toplam</span>
          <span class="om-meta-value">${fmtMoney(order.total_price)}</span>
        </div>
        <div class="om-meta-item">
          <span class="om-meta-label">Net</span>
          <span class="om-meta-value" style="color:#16a34a;font-weight:700">${fmtMoney(order.net_price)}</span>
        </div>
      </div>
      <div class="om-section-title">Ürünler</div>
      <div class="om-lines">${linesHtml || '<div style="color:#64748b;font-size:13px">Ürün satırı bulunamadı.</div>'}</div>`;

    const trackBtn = order.tracking_url
      ? `<a href="${esc(order.tracking_url)}" target="_blank" rel="noopener" class="om-btn">📦 Kargo Takip</a>`
      : `<button class="om-btn" disabled>📦 Kargo Takip</button>`;

    document.getElementById('om-footer').innerHTML = `
      ${trackBtn}
      <a href="${esc(order.trendyol_url)}" target="_blank" rel="noopener" class="om-btn om-btn-primary">🔗 Trendyol'da Aç</a>`;
  }

  // ── MODAL AÇ ─────────────────────────────────────────────────
  async function openModal(orderNumber) {
    closeModal();
    injectStyle();

    const overlay = createOverlay();
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.getElementById('om-close').addEventListener('click', closeModal);

    const token = localStorage.getItem('dealer_token') || sessionStorage.getItem('dealer_token') || '';

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        document.getElementById('om-body').innerHTML =
          `<div style="color:#dc2626;padding:24px;font-size:13px">Hata: ${esc(data.error || 'Bilinmeyen hata')}</div>`;
        document.getElementById('om-footer').innerHTML = '';
        return;
      }
      renderModal(data);
    } catch (err) {
      document.getElementById('om-body').innerHTML =
        `<div style="color:#dc2626;padding:24px;font-size:13px">Bağlantı hatası: ${esc(err.message)}</div>`;
      document.getElementById('om-footer').innerHTML = '';
    }
  }

  // ── ESCAPE TUŞU ──────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // ── EVENT DELEGATION — ORDERS TBODY ──────────────────────────
  function bindOrdersTable() {
    const tbody = document.getElementById('orders-tbody');
    if (!tbody) return;
    tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-order-number]');
      if (!tr) return;
      openModal(tr.dataset.orderNumber);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOrdersTable);
  } else {
    bindOrdersTable();
  }
```

- [ ] **Adım 2: Commit**

```bash
git add public/js/orderModal.js
git commit -m "feat: add modal render, open/close and event delegation"
```

---

## Task 8: `index.html` — `data-order-number` ve Script Tag

**Files:**
- Modify: `index.html`

- [ ] **Adım 1: Yeni `loadOrders()` içindeki `<tr>` satırını güncelle (satır ~1984)**

Mevcut satırı bul:

```javascript
          return `<tr>
```

Değiştir:

```javascript
          return `<tr data-order-number="${esc(o.order_number)}" style="cursor:pointer">
```

- [ ] **Adım 2: Eski `loadOrders()` içindeki `<tr>` satırını güncelle (satır ~1836)**

Mevcut satırı bul:

```javascript
        tbody.innerHTML = d.orders.map(o => `<tr>
```

Değiştir:

```javascript
        tbody.innerHTML = d.orders.map(o => `<tr data-order-number="${esc(o.order_number)}" style="cursor:pointer">
```

- [ ] **Adım 3: Script tag'ini ekle**

`index.html`'in en sonundaki `</body>` etiketini bul ve hemen öncesine ekle:

```html
  <script src="/js/orderModal.js"></script>
</body>
```

- [ ] **Adım 4: Token key'ini kontrol et**

`index.html`'de `localStorage.setItem` veya `sessionStorage.setItem` çağrılarını ara ve `dealer_token` key'ini doğrula:

```bash
grep -n "localStorage\|sessionStorage" index.html | grep -i "token\|setItem"
```

`orderModal.js` içinde `localStorage.getItem('dealer_token')` kullanıldı. Eğer gerçek key farklıysa (örn. `token` veya `jwt`), `public/js/orderModal.js` içindeki şu satırı güncelle:

```javascript
const token = localStorage.getItem('dealer_token') || sessionStorage.getItem('dealer_token') || '';
```

- [ ] **Adım 5: Commit**

```bash
git add index.html
git commit -m "feat: add data-order-number to order table rows and load orderModal.js"
```

---

## Task 9: Uçtan Uca Test

**Files:** (değişiklik yok)

- [ ] **Adım 1: Sunucuyu yeniden başlat**

```bash
npm start
```

- [ ] **Adım 2: Tarayıcıda aç**

`http://localhost:3000` adresine git, giriş yap, Siparişler sayfasına geç.

- [ ] **Adım 3: Tıklama testi**

Tabloda bir satıra tıkla. Beklenen:
- Spinner görünür
- Müşteri adı, adres, kargo, ürün listesi yüklenir
- Kargo takip numarası varsa "📦 Kargo Takip" butonu aktif
- "🔗 Trendyol'da Aç" butonu her zaman aktif

- [ ] **Adım 4: Kapanma testi**

- Overlay'in dışına tıkla → modal kapanır
- `×` butonuna tıkla → modal kapanır
- `Escape` tuşuna bas → modal kapanır

- [ ] **Adım 5: Fallback testi (opsiyonel)**

DB'de olmayan sipariş numarasıyla direkt endpoint'i çağır:

```bash
curl -s http://localhost:3000/api/orders/OLMAYAN_NO \
  -H "Authorization: Bearer $TOKEN"
# Beklenen: {"error":"Sipariş bulunamadı"} 404
```

- [ ] **Adım 6: Final commit**

```bash
git add -A
git status  # beklenmedik dosya yoksa:
git commit -m "feat: order detail modal system complete"
```

---

## Self-Review Notu

- **Spec coverage:** Tüm spec maddeleri karşılandı — routes/orderDetail.js ✓, public/js/orderModal.js ✓, data-order-number attribute ✓, server.js mount ✓, .env değil DB credentials ✓, hata yönetimi ✓, mevcut kod bozulmadı ✓
- **Token key riski:** Task 8 Adım 4'te token key doğrulama adımı eklendi
- **`public/` statik servis:** Task 5'te `app.use(express.static(..., 'public'))` eklenerek `/js/orderModal.js` yolu çalışır hale getiriliyor
- **İki loadOrders:** Satır ~1836 (eski) ve ~1984 (yeni) — her ikisi de Task 8'de güncelleniyor
