# Marka Yönetimi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Brand Management module that lets dealers search Trendyol brands, set one as the active brand, and bulk-assign it to all their products.

**Architecture:** Three inline `app.get/post` endpoints added to `server.js` (following the existing inline pattern for simple features). A self-contained IIFE frontend module in `public/js/markaYonetimiPage.js` (same pattern as `kategorilerPage.js`). DB migration via the existing `safeAlter` helper in `database.js`.

**Tech Stack:** Node.js/Express, better-sqlite3, Axios, vanilla JS (no framework)

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `database.js` | Add `safeAlter` for `dealer_products.brand_id` |
| Modify | `server.js` | Add 3 brand endpoints after line 2416 |
| Create | `public/js/markaYonetimiPage.js` | Full IIFE module |
| Modify | `index.html` | Nav item, page div, navigate() entry, script tag |

---

### Task 1: DB Migration — add `brand_id` to `dealer_products`

**Files:**
- Modify: `database.js:216` (after the last `safeAlter` call in the block)

- [ ] **Step 1: Open `database.js` and locate the safeAlter block**

The block ends at line 216:
```js
safeAlter(`ALTER TABLE dealer_products ADD COLUMN icerik_uretildi INTEGER DEFAULT 0`);
```

- [ ] **Step 2: Add the new safeAlter call on the next line**

```js
safeAlter(`ALTER TABLE dealer_products ADD COLUMN brand_id INTEGER`);
```

- [ ] **Step 3: Verify the server starts without error**

```
node -e "require('./database')" 
```
Expected: prints `✅ Veritabanı ve tablolar hazır.` with no error.

- [ ] **Step 4: Commit**

```bash
git add database.js
git commit -m "feat: add brand_id column to dealer_products via safeAlter"
```

---

### Task 2: Backend — brand endpoints in `server.js`

**Files:**
- Modify: `server.js:2416` (insert after the last `app.put('/api/dealer/settings'...)` block)

- [ ] **Step 1: Locate insertion point**

Open `server.js`. Find line 2416 (the closing `});` of `app.put('/api/dealer/settings', ...)`).
Insert the three blocks below immediately after it.

- [ ] **Step 2: Add `GET /api/brands/search`**

```js
// ── MARKA YÖNETİMİ ─────────────────────────────────────────────
app.get('/api/brands/search', authMiddleware, async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json([]);
    try {
        const response = await withTrendyolCredentialFallback(req.dealer.id, null, async (store) => {
            const auth = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
            return axios.get(`https://apigw.trendyol.com/integration/product/brands/by-name?name=${encodeURIComponent(q)}`, {
                timeout: 10000,
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/json',
                    'User-Agent': `${store.supplier_id} - SelfIntegration`,
                },
            });
        });
        res.json(response.data || []);
    } catch (err) {
        const detail = err.response?.data?.message || err.message;
        res.status(502).json({ error: `Trendyol API hatası: ${detail}` });
    }
});
```

- [ ] **Step 3: Add `POST /api/brands/save`**

```js
app.post('/api/brands/save', authMiddleware, (req, res) => {
    const { trendyol_brand_id, name } = req.body;
    if (!trendyol_brand_id || !name) {
        return res.status(400).json({ error: 'trendyol_brand_id ve name zorunlu' });
    }
    const brandId = Number(trendyol_brand_id);

    const upsertBrand = db.prepare(`
        INSERT INTO brands (trendyol_brand_id, name)
        VALUES (?, ?)
        ON CONFLICT(trendyol_brand_id) DO UPDATE SET name = excluded.name
    `);
    const upsertSetting = db.prepare(`
        INSERT INTO dealer_settings (dealer_id, key, value, updated_at)
        VALUES (?, 'active_brand_id', ?, datetime('now'))
        ON CONFLICT(dealer_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `);
    const updateProducts = db.prepare(`
        UPDATE dealer_products SET brand_id = ? WHERE dealer_id = ?
    `);

    const tx = db.transaction(() => {
        upsertBrand.run(brandId, String(name));
        upsertSetting.run(req.dealer.id, String(brandId));
        updateProducts.run(brandId, req.dealer.id);
    });
    tx();

    res.json({ ok: true, trendyol_brand_id: brandId, name: String(name) });
});
```

- [ ] **Step 4: Add `GET /api/brands/active`**

```js
app.get('/api/brands/active', authMiddleware, (req, res) => {
    const setting = db.prepare(
        `SELECT value FROM dealer_settings WHERE dealer_id = ? AND key = 'active_brand_id'`
    ).get(req.dealer.id);
    if (!setting) return res.json(null);

    const brand = db.prepare(
        `SELECT trendyol_brand_id AS id, name FROM brands WHERE trendyol_brand_id = ?`
    ).get(Number(setting.value));
    res.json(brand || null);
});
```

- [ ] **Step 5: Manual smoke test**

Start the server (`node server.js`) and with a valid JWT token run:
```
GET  /api/brands/active          → null (no brand set yet)
GET  /api/brands/search?q=Nike   → array of {id, name} from Trendyol
POST /api/brands/save  body: {"trendyol_brand_id":123,"name":"Nike"}  → {ok:true,...}
GET  /api/brands/active          → {id:123, name:"Nike"}
```

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: add brand search, save, and active endpoints"
```

---

### Task 3: Frontend — `public/js/markaYonetimiPage.js`

**Files:**
- Create: `public/js/markaYonetimiPage.js`

- [ ] **Step 1: Create the file with the full IIFE module**

```js
// public/js/markaYonetimiPage.js
(function () {
  'use strict';

  const STYLE = `
    #page-brands { padding: 8px 0 0; }
    .bm-shell {
      display: flex;
      flex-direction: column;
      gap: 20px;
      max-width: 800px;
      margin: 0 auto;
    }
    .bm-card {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: var(--shadow);
      padding: 24px;
    }
    .bm-card-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 16px;
    }
    .bm-active-banner {
      background: linear-gradient(135deg, rgba(108,99,255,.12), rgba(139,92,246,.08));
      border: 2px solid var(--accent);
      border-radius: 16px;
      padding: 24px;
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .bm-active-icon {
      width: 56px;
      height: 56px;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      flex-shrink: 0;
    }
    .bm-active-info { flex: 1; }
    .bm-active-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .6px;
      color: var(--accent);
      margin-bottom: 4px;
    }
    .bm-active-name {
      font-size: 22px;
      font-weight: 700;
      color: var(--text);
    }
    .bm-active-id {
      font-size: 12px;
      color: var(--muted);
      margin-top: 2px;
    }
    .bm-warning {
      background: rgba(217,119,6,.08);
      border: 1px solid rgba(217,119,6,.35);
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: var(--yellow);
      font-weight: 500;
    }
    .bm-search-row {
      display: flex;
      gap: 10px;
    }
    .bm-search-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--bg3);
      color: var(--text);
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color .15s;
    }
    .bm-search-input:focus { border-color: var(--accent); }
    .bm-results {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .bm-result-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 10px;
      transition: border-color .15s, background .15s;
    }
    .bm-result-item:hover { border-color: var(--accent); background: rgba(108,99,255,.05); }
    .bm-result-name { font-size: 14px; font-weight: 600; color: var(--text); }
    .bm-result-id { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .bm-empty { font-size: 13px; color: var(--muted); text-align: center; padding: 20px 0; }
    .bm-spinner { text-align: center; padding: 20px 0; color: var(--muted); font-size: 13px; }
  `;

  let debounceTimer = null;
  let activeBrand = null;

  function injectStyle() {
    if (document.getElementById('bm-style')) return;
    const el = document.createElement('style');
    el.id = 'bm-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderActiveBrand() {
    if (!activeBrand) {
      return `
        <div class="bm-warning">
          ⚠️ Aktif marka seçilmemiş — ürün yüklemeden önce aşağıdan bir marka seçiniz.
        </div>`;
    }
    return `
      <div class="bm-active-banner">
        <div class="bm-active-icon">🏷️</div>
        <div class="bm-active-info">
          <div class="bm-active-label">Aktif Marka</div>
          <div class="bm-active-name">${esc(activeBrand.name)}</div>
          <div class="bm-active-id">Trendyol Brand ID: ${esc(activeBrand.id)}</div>
        </div>
      </div>`;
  }

  function renderPage() {
    const el = document.getElementById('page-brands');
    if (!el) return;
    el.innerHTML = `
      <div class="content">
        <div class="bm-shell">

          <div>${renderActiveBrand()}</div>

          <div class="bm-card">
            <div class="bm-card-title">🔍 Trendyol'da Marka Ara</div>
            <div class="bm-search-row">
              <input
                id="bm-query"
                class="bm-search-input"
                type="text"
                placeholder="Marka adı yazın (min. 2 karakter)…"
                oninput="bmOnInput()"
                autocomplete="off"
              />
            </div>
            <div id="bm-results" class="bm-results"></div>
          </div>

        </div>
      </div>`;
  }

  async function loadActive() {
    try {
      const token = localStorage.getItem('token');
      const r = await fetch('/api/brands/active', {
        headers: { Authorization: `Bearer ${token}` },
      });
      activeBrand = r.ok ? await r.json() : null;
    } catch (_) {
      activeBrand = null;
    }
  }

  async function doSearch(q) {
    const resultsEl = document.getElementById('bm-results');
    if (!resultsEl) return;
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }

    resultsEl.innerHTML = '<div class="bm-spinner">Aranıyor…</div>';
    try {
      const token = localStorage.getItem('token');
      const r = await fetch(`/api/brands/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = r.ok ? await r.json() : [];
      const list = Array.isArray(data) ? data : [];
      if (!list.length) {
        resultsEl.innerHTML = '<div class="bm-empty">Sonuç bulunamadı.</div>';
        return;
      }
      resultsEl.innerHTML = list.slice(0, 20).map(b => `
        <div class="bm-result-item">
          <div>
            <div class="bm-result-name">${esc(b.name)}</div>
            <div class="bm-result-id">ID: ${esc(b.id)}</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="bmSave(${Number(b.id)}, ${JSON.stringify(esc(b.name))})">
            Seç &amp; Aktif Yap
          </button>
        </div>`).join('');
    } catch (_) {
      resultsEl.innerHTML = '<div class="bm-empty">Arama başarısız.</div>';
    }
  }

  async function bmSave(trendyolBrandId, name) {
    const token = localStorage.getItem('token');
    try {
      const r = await fetch('/api/brands/save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trendyol_brand_id: trendyolBrandId, name }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Kayıt başarısız');
      activeBrand = { id: trendyolBrandId, name };
      const activeBannerEl = document.querySelector('#page-brands > .content > .bm-shell > div:first-child');
      if (activeBannerEl) activeBannerEl.innerHTML = renderActiveBrand();
      document.getElementById('bm-results').innerHTML = '';
      document.getElementById('bm-query').value = '';
      if (typeof showToast === 'function') showToast(`✅ "${name}" aktif marka olarak seçildi, tüm ürünler güncellendi.`);
    } catch (err) {
      if (typeof showToast === 'function') showToast(`❌ ${err.message}`, 'error');
    }
  }

  function bmOnInput() {
    clearTimeout(debounceTimer);
    const q = (document.getElementById('bm-query')?.value || '').trim();
    debounceTimer = setTimeout(() => doSearch(q), 400);
  }

  window.loadBrandsPage = async function () {
    injectStyle();
    await loadActive();
    renderPage();
  };

  window.bmOnInput = bmOnInput;
  window.bmSave = bmSave;
})();
```

- [ ] **Step 2: Verify the file exists**

```
ls "public/js/markaYonetimiPage.js"
```
Expected: file listed.

- [ ] **Step 3: Commit**

```bash
git add public/js/markaYonetimiPage.js
git commit -m "feat: add markaYonetimiPage.js frontend module"
```

---

### Task 4: index.html — nav item, page div, navigate(), script tag

**Files:**
- Modify: `index.html`

Four small, independent edits. Apply them in order.

- [ ] **Step 1: Add nav item (after the `categories` nav item, line ~1024)**

Find:
```html
        <div class="nav-item" onclick="navigate('categories')" id="nav-categories"><span class="icon">📂</span>Kategori Yönetimi</div>
```
Replace with:
```html
        <div class="nav-item" onclick="navigate('categories')" id="nav-categories"><span class="icon">📂</span>Kategori Yönetimi</div>
        <div class="nav-item" onclick="navigate('brands')" id="nav-brands"><span class="icon">🏷️</span>Marka Yönetimi</div>
```

- [ ] **Step 2: Add `brands` to the titles map in `navigate()` (line ~1672)**

Find:
```js
      const titles = { dashboard: 'Dashboard', xml: 'XML Feedler', products: 'Ürünlerim', margins: 'Kâr Marjları', profitloss: 'Kâr / Zarar Analizi', stores: 'Mağazalarım', orders: 'Siparişler', analytics: 'Satış Grafikleri', forecast: 'Talep Tahmini', pricing: 'Fiyat Önerileri', 'pricing-rules': 'Fiyat Kuralları', questions: 'Müşteri Soruları', health: 'Ürün Sağlık Merkezi', stock: 'Stok Uyarıları', settings: 'Trendyol Ayarları', categories: 'Kategori Yönetimi' };
```
Replace with:
```js
      const titles = { dashboard: 'Dashboard', xml: 'XML Feedler', products: 'Ürünlerim', margins: 'Kâr Marjları', profitloss: 'Kâr / Zarar Analizi', stores: 'Mağazalarım', orders: 'Siparişler', analytics: 'Satış Grafikleri', forecast: 'Talep Tahmini', pricing: 'Fiyat Önerileri', 'pricing-rules': 'Fiyat Kuralları', questions: 'Müşteri Soruları', health: 'Ürün Sağlık Merkezi', stock: 'Stok Uyarıları', settings: 'Trendyol Ayarları', categories: 'Kategori Yönetimi', brands: 'Marka Yönetimi' };
```

- [ ] **Step 3: Add `brands` handler in `navigate()` (line ~1689)**

Find:
```js
      if (page === 'categories') loadKategorilerPage();
```
Add after it:
```js
      if (page === 'brands') loadBrandsPage();
```

- [ ] **Step 4: Add `<div id="page-brands">` (before the closing `</div>` of the main pages container)**

Find:
```html
<div id="page-categories" class="page"></div>
```
Add after it:
```html
<div id="page-brands" class="page"></div>
```

- [ ] **Step 5: Add script tag (after the last `<script src="/js/...">` at bottom)**

Find:
```html
  <script src="/js/kategorilerPage.js"></script>
```
Add after it:
```html
  <script src="/js/markaYonetimiPage.js"></script>
```

- [ ] **Step 6: Manual browser test**

Open the app. Click "Marka Yönetimi" in the sidebar.
- If no active brand: yellow warning banner shows.
- Type a brand name (≥2 chars): results appear after 400ms.
- Click "Seç & Aktif Yap": banner switches to the blue active-brand card.
- Refresh: active brand still shown.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: wire Marka Yönetimi into index.html nav and navigate()"
```

---

## Self-Review

**Spec coverage:**
| Requirement | Task |
|---|---|
| `safeAlter` brand_id on dealer_products | Task 1 |
| dealer_settings active_brand_id key-value | Task 2, Step 3 |
| GET /api/brands/search → Trendyol | Task 2, Step 2 |
| POST /api/brands/save → insert + set active + bulk update | Task 2, Step 3 |
| GET /api/brands/active → join | Task 2, Step 4 |
| Page load → /api/brands/active, large card | Task 3 |
| 400ms debounce search | Task 3 |
| Tıklayınca /api/brands/save | Task 3 |
| Yellow warning when no active brand | Task 3 |
| Active card refresh after save | Task 3 |
| Nav item "Ürünler & Stok" grubunda | Task 4, Step 1 |
| navigate() titles + handler | Task 4, Steps 2-3 |
| page-brands div | Task 4, Step 4 |
| script tag | Task 4, Step 5 |

**Placeholder scan:** None found.

**Type consistency:**
- `trendyol_brand_id` (integer) consistent across DB, endpoint, frontend.
- `activeBrand.id` = `trendyol_brand_id` in all three tasks.
- `loadBrandsPage` registered on `window` in Task 3, called in Task 4 Step 3.
- `bmOnInput` / `bmSave` registered on `window` in Task 3, called via inline `onclick` in same task.
