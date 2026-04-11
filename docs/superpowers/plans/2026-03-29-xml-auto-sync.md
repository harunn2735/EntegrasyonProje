# XML Otomatik Senkronizasyon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her bayinin panelden ayarlayabileceği aralıkla (1–24 saat) XML feed'lerini otomatik olarak yeniden çekip stok/fiyat/yeni ürün güncellemelerini uygulayan bir cron sistemi ekle.

**Architecture:** `dealer_settings` key-value tablosu ile her bayiye özel `xml_sync_interval_hours` saklıyoruz. Server.js'deki mevcut XML import bloğu `importXmlFeedById(dealerId, feedId)` adlı bir fonksiyona çıkarılıyor; hem mevcut route hem de yeni cron bu fonksiyonu kullanıyor. Cron 15 dakikada bir çalışır, her feed'in `last_imported` değerine bakarak interval dolmuşsa import çalıştırır.

**Tech Stack:** Node.js, better-sqlite3, node-cron (zaten yüklü), Express (zaten mevcut)

---

## File Map

| Dosya | İşlem | Sorumluluk |
|-------|-------|-----------|
| `database.js` | Modify | `dealer_settings` tablosu + safeAlter |
| `server.js` | Modify | `importXmlFeedById()` fonksiyonu çıkar, GET/PUT `/api/dealer/settings` route'ları ekle, xmlSyncCron'u bağla |
| `cron/xmlSyncCron.js` | Create | 15 dk'da bir çalış, interval kontrolü yap, import tetikle |
| `index.html` | Modify | XML Feeds sayfasına ayar kartı + otomatik sync durumu ekle |

---

### Task 1: dealer_settings tablosu

**Files:**
- Modify: `database.js:165-199`

- [ ] **Step 1: `dealer_settings` tablosunu `database.js`'e ekle**

`database.js` dosyasını aç. `db.exec(`` ... ``)` bloğunun sonundaki `category_mappings` CREATE TABLE'ından hemen sonra şunu ekle:

```javascript
    CREATE TABLE IF NOT EXISTS dealer_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(dealer_id, key),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );
```

- [ ] **Step 2: safeAlter satırları arasına (herhangi bir satıra) hiçbir şey ekleme — CREATE TABLE IF NOT EXISTS zaten idempotent**

Bu tablo `CREATE TABLE IF NOT EXISTS` ile tanımlandığından safeAlter gerekmez.

- [ ] **Step 3: Sunucuyu başlat ve tablo oluştuğunu kontrol et**

```bash
node -e "const db = require('./database'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='dealer_settings'\").get())"
```

Beklenen çıktı: `{ name: 'dealer_settings' }`

- [ ] **Step 4: Commit**

```bash
git add database.js
git commit -m "feat: add dealer_settings table for per-dealer key-value settings"
```

---

### Task 2: Settings API route'ları (GET + PUT)

**Files:**
- Modify: `server.js` — `startQuestionsCron()` çağrısından önce herhangi bir yere ekle (örn. analytics router mount'undan sonra)

- [ ] **Step 1: GET `/api/dealer/settings` route'unu server.js'e ekle**

`app.use('/api/analytics', authMiddleware, analyticsRouter);` satırından hemen sonra şunu ekle:

```javascript
// ── BAYI AYARLARI ──────────────────────────────────────────────
app.get('/api/dealer/settings', authMiddleware, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM dealer_settings WHERE dealer_id = ?').all(req.dealer.id);
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    // Varsayılan değerler
    const defaults = { xml_sync_enabled: '1', xml_sync_interval_hours: '6' };
    res.json({ ...defaults, ...settings });
});

app.put('/api/dealer/settings', authMiddleware, (req, res) => {
    const { xml_sync_enabled, xml_sync_interval_hours } = req.body;
    const upsert = db.prepare(`
        INSERT INTO dealer_settings (dealer_id, key, value, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(dealer_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `);
    const update = db.transaction(() => {
        if (xml_sync_enabled !== undefined) upsert.run(req.dealer.id, 'xml_sync_enabled', String(xml_sync_enabled));
        if (xml_sync_interval_hours !== undefined) {
            const hours = Math.max(1, Math.min(24, parseInt(xml_sync_interval_hours, 10) || 6));
            upsert.run(req.dealer.id, 'xml_sync_interval_hours', String(hours));
        }
    });
    update();
    res.json({ ok: true });
});
```

- [ ] **Step 2: Sunucuyu başlat ve route'u test et**

```bash
# önce bir token al (login isteği yap), sonra:
curl -s http://localhost:3000/api/dealer/settings \
  -H "Authorization: Bearer <TOKEN>"
```

Beklenen: `{"xml_sync_enabled":"1","xml_sync_interval_hours":"6"}`

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add GET/PUT /api/dealer/settings for xml sync config"
```

---

### Task 3: importXmlFeedById fonksiyonunu çıkar

**Files:**
- Modify: `server.js:1198-1332`

- [ ] **Step 1: Mevcut route handler'ını bir fonksiyona çıkar**

`server.js`'te `app.post('/api/dealer/xml-feeds/:id/import', ...)` route'unun hemen üstüne bu fonksiyonu ekle:

```javascript
async function importXmlFeedById(dealerId, feedId) {
    const feed = db.prepare('SELECT * FROM xml_feeds WHERE id = ? AND dealer_id = ?').get(feedId, dealerId);
    if (!feed) throw new Error('XML feed bulunamadı');

    const response = await axios.get(feed.url, { timeout: 30000, responseType: 'text' });
    const xmlText = response.data;

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(xmlText);

    let items = [];
    const root = parsed;
    const tryPaths = [
        root?.catalog?.product,
        root?.products?.product,
        root?.items?.item,
        root?.ProductList?.Product,
        root?.feed?.entry,
        Object.values(root || {})?.[0]?.product,
        Object.values(root || {})?.[0],
    ];
    for (const p of tryPaths) {
        if (Array.isArray(p)) { items = p; break; }
        if (p && typeof p === 'object' && !Array.isArray(p)) { items = [p]; break; }
    }
    if (items.length === 0) throw new Error('XML formatı tanınamadı veya ürün bulunamadı');

    const marginRow = db.prepare('SELECT margin FROM supplier_margins WHERE dealer_id = ? AND supplier_name = ?')
        .get(dealerId, feed.supplier_name);
    const dealer = db.prepare('SELECT profit_margin FROM dealers WHERE id = ?').get(dealerId);
    const margin = marginRow?.margin ?? dealer?.profit_margin ?? 20;

    const insertOrUpdate = db.prepare(`
        INSERT INTO dealer_products (dealer_id, barcode, title, category, xml_category_id, stock, cost_price, sale_price, image_url, supplier_name, xml_feed_id)
        VALUES (@dealer_id, @barcode, @title, @category, @xml_category_id, @stock, @cost_price, @sale_price, @image_url, @supplier_name, @xml_feed_id)
        ON CONFLICT(dealer_id, barcode) DO UPDATE SET
            title = excluded.title,
            category = excluded.category,
            xml_category_id = excluded.xml_category_id,
            stock = excluded.stock,
            cost_price = excluded.cost_price,
            sale_price = excluded.sale_price,
            image_url = excluded.image_url,
            updated_at = datetime('now')
    `);
    const getCategoryMapping = db.prepare(`
        SELECT trendyol_category_id
        FROM category_mappings
        WHERE dealer_id = ? AND source_category = ? AND (xml_feed_id = ? OR xml_feed_id IS NULL)
        ORDER BY CASE WHEN xml_feed_id = ? THEN 0 ELSE 1 END
        LIMIT 1
    `);

    const importMany = db.transaction((prods) => {
        for (const p of prods) {
            const barcode = String(p.barcode || p.Barcode || p.sku || p.SKU || p.code || p.Code || p['@_id'] || '').trim();
            const title = String(p.title || p.Title || p.name || p.Name || p.baslik || '').trim();
            if (!barcode || !title) continue;

            const costPrice = parseFloat(p.price || p.Price || p.cost_price || p.fiyat || 0);
            const salePrice = parseFloat((costPrice * (1 + margin / 100)).toFixed(2));
            const stock = parseInt(p.stock || p.Stock || p.quantity || p.stok || 0);
            const xmlCategoryCandidates = getXmlCategoryCandidates(p);
            const category = xmlCategoryCandidates[0] || 'Genel';
            const savedMapping = getCategoryMapping.get(dealerId, category, parseInt(feedId), parseInt(feedId));
            const xmlCategoryId = savedMapping?.trendyol_category_id || getTrendyolCategoryByName(xmlCategoryCandidates) || null;

            const _imageUrls = [];
            for (let _i = 1; _i <= 8; _i++) {
                const _u = p['image' + _i] || p['resim' + _i] || p['foto' + _i] || p['img' + _i];
                if (_u && typeof _u === 'string' && _u.trim()) _imageUrls.push(_u.trim());
                else if (_u && typeof _u === 'object' && (_u['@_url'] || _u.url)) _imageUrls.push((_u['@_url'] || _u.url).trim());
            }
            if (_imageUrls.length === 0) {
                let _single = p.image || p.resim || p.img || p.picture || p.foto || p.photo || p.image_url || p.imageUrl || p.gorsel || p.urun_resim || p.ImageUrl;
                if (_single && typeof _single === 'string' && _single.trim()) _imageUrls.push(_single.trim());
                else if (_single && typeof _single === 'object' && (_single['@_url'] || _single.url)) _imageUrls.push((_single['@_url'] || _single.url).trim());
                else if (p.images?.image) {
                    const imgs = Array.isArray(p.images.image) ? p.images.image : [p.images.image];
                    imgs.forEach(i => {
                        let u = typeof i === 'string' ? i : (i['@_url'] || i.url || '');
                        if (u.trim()) _imageUrls.push(u.trim());
                    });
                }
            }
            const imageUrl = _imageUrls.join(',');

            insertOrUpdate.run({
                dealer_id: dealerId,
                barcode,
                title: title.substring(0, 200),
                category,
                stock,
                cost_price: costPrice,
                sale_price: salePrice,
                image_url: imageUrl,
                supplier_name: feed.supplier_name || 'Genel',
                xml_feed_id: parseInt(feedId),
                xml_category_id: xmlCategoryId
            });
        }
    });

    importMany(items);

    const count = db.prepare('SELECT COUNT(*) as c FROM dealer_products WHERE dealer_id = ? AND xml_feed_id = ?')
        .get(dealerId, parseInt(feedId)).c;
    db.prepare("UPDATE xml_feeds SET last_imported = datetime('now'), product_count = ? WHERE id = ?")
        .run(count, feedId);

    addLog('success', `XML import tamamlandı: ${count} ürün (${feed.name})`, dealerId);
    return { ok: true, count, margin };
}
```

- [ ] **Step 2: Mevcut route'u bu fonksiyonu kullanacak şekilde güncelle**

Mevcut `app.post('/api/dealer/xml-feeds/:id/import', ...)` bloğunun (1198–1332) tamamını şu kısa halyle değiştir:

```javascript
app.post('/api/dealer/xml-feeds/:id/import', authMiddleware, async (req, res) => {
    try {
        const result = await importXmlFeedById(req.dealer.id, req.params.id);
        res.json(result);
    } catch (e) {
        addLog('error', `XML import hatası: ${e.message}`, req.dealer.id);
        res.status(500).json({ error: e.message });
    }
});
```

- [ ] **Step 3: Manuel import'un hâlâ çalıştığını doğrula**

Panelde XML Feedler sayfasına git → "⬇️ İçe Aktar" butonuna bas → başarı toast'u gelmeli.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "refactor: extract importXmlFeedById function from route handler"
```

---

### Task 4: xmlSyncCron.js oluştur

**Files:**
- Create: `cron/xmlSyncCron.js`

- [ ] **Step 1: Dosyayı oluştur**

```javascript
// cron/xmlSyncCron.js
'use strict';

const cron = require('node-cron');
const db = require('../database');

function startXmlSyncCron(importXmlFeedById) {
  // Her 15 dakikada bir kontrol et; asıl import sıklığı dealer ayarına göre belirlenir
  cron.schedule('*/15 * * * *', async () => {
    const dealers = db
      .prepare(`SELECT id, name FROM dealers WHERE status = 'active'`)
      .all();

    for (const dealer of dealers) {
      // Bu bayi için ayarları oku
      const rows = db
        .prepare('SELECT key, value FROM dealer_settings WHERE dealer_id = ?')
        .all(dealer.id);
      const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));

      const enabled = settings.xml_sync_enabled !== '0';
      if (!enabled) continue;

      const intervalHours = Math.max(1, parseInt(settings.xml_sync_interval_hours || '6', 10));
      const intervalMs = intervalHours * 60 * 60 * 1000;

      // Bu bayinin aktif feed'lerini al
      const feeds = db
        .prepare(`SELECT id, name, last_imported FROM xml_feeds WHERE dealer_id = ? AND status = 'active'`)
        .all(dealer.id);

      for (const feed of feeds) {
        const lastImported = feed.last_imported ? new Date(feed.last_imported).getTime() : 0;
        const now = Date.now();

        if (now - lastImported < intervalMs) continue; // Henüz erken

        try {
          const result = await importXmlFeedById(dealer.id, feed.id);
          console.log(`[XML Sync Cron] Dealer ${dealer.id} (${dealer.name}), Feed "${feed.name}": ${result.count} ürün güncellendi`);
        } catch (e) {
          console.error(`[XML Sync Cron] Dealer ${dealer.id}, Feed ${feed.id} hatası:`, e.message);
        }
      }
    }
  });

  console.log('✅ XML Sync cron job başlatıldı (her 15 dakikada kontrol eder).');
}

module.exports = startXmlSyncCron;
```

- [ ] **Step 2: server.js'e require ve başlatma satırlarını ekle**

`server.js` en üstündeki require bloğuna (diğer cron require'larının yanına) şunu ekle:

```javascript
const startXmlSyncCron = require('./cron/xmlSyncCron');
```

`startOrdersCron(syncDealerOrders);` satırından hemen sonra şunu ekle:

```javascript
startXmlSyncCron(importXmlFeedById);
```

- [ ] **Step 3: Sunucuyu başlat ve log'u kontrol et**

```bash
node server.js
```

Beklenen çıktı arasında:
```
✅ XML Sync cron job başlatıldı (her 15 dakikada kontrol eder).
```

- [ ] **Step 4: Cron'u hızlı test et (interval'ı 0'a zorla)**

Terminalden test etmek için:

```bash
node -e "
require('dotenv').config();
const db = require('./database');
const { XMLParser } = require('fast-xml-parser');
const axios = require('axios');
// importXmlFeedById server.js'de olduğu için direkt test edilemez
// Bunun yerine sunucu çalışırken panelden 'İçe Aktar' ile doğrula
console.log('Cron dosyası yüklenebiliyor:', require('./cron/xmlSyncCron'));
"
```

Beklenen: fonksiyon objesi yazdırır, hata vermez.

- [ ] **Step 5: Commit**

```bash
git add cron/xmlSyncCron.js server.js
git commit -m "feat: add xml sync cron job with per-dealer interval control"
```

---

### Task 5: Panele XML Sync Ayar Kartı Ekle

**Files:**
- Modify: `index.html:1093-1109` (page-xml div'i)

- [ ] **Step 1: XML feeds sayfasına ayar kartını ekle**

`index.html`'de `<div class="page" id="page-xml">` ile başlayan bölümü bul. İçindeki `.tip` div'inden hemen sonra (yani `<div class="card" style="margin-bottom:20px">` satırından önce) şu kartı ekle:

```html
          <div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:24px;flex-wrap:wrap">
            <div style="flex:1;min-width:200px">
              <div style="font-weight:600;font-size:14px;margin-bottom:2px">⏱ Otomatik XML Senkronizasyon</div>
              <div style="font-size:12px;color:var(--muted)" id="xml-sync-status">Yükleniyor…</div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
                <input type="checkbox" id="xml-sync-enabled" onchange="saveXmlSyncSettings()" style="width:16px;height:16px;cursor:pointer">
                Aktif
              </label>
              <div style="display:flex;align-items:center;gap:6px">
                <label style="font-size:13px;color:var(--muted)">Her</label>
                <select id="xml-sync-interval"
                  onchange="saveXmlSyncSettings()"
                  style="padding:6px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px">
                  <option value="1">1 saat</option>
                  <option value="2">2 saat</option>
                  <option value="4">4 saat</option>
                  <option value="6" selected>6 saat</option>
                  <option value="12">12 saat</option>
                  <option value="24">24 saat</option>
                </select>
                <label style="font-size:13px;color:var(--muted)">bir güncelle</label>
              </div>
            </div>
          </div>
```

- [ ] **Step 2: `loadXmlSyncSettings()` ve `saveXmlSyncSettings()` fonksiyonlarını JS bloğuna ekle**

`index.html`'deki `async function loadXmlFeeds()` fonksiyonundan hemen önce şunları ekle:

```javascript
    async function loadXmlSyncSettings() {
      try {
        const s = await api('/api/dealer/settings');
        if (!s) return;
        const cb = document.getElementById('xml-sync-enabled');
        const sel = document.getElementById('xml-sync-interval');
        if (cb) cb.checked = s.xml_sync_enabled !== '0';
        if (sel) sel.value = s.xml_sync_interval_hours || '6';
        updateXmlSyncStatus(s);
      } catch (e) { /* sessiz hata */ }
    }

    function updateXmlSyncStatus(s) {
      const el = document.getElementById('xml-sync-status');
      if (!el) return;
      if (s.xml_sync_enabled === '0') {
        el.textContent = 'Kapalı — feed\'ler otomatik güncellenmez';
        el.style.color = 'var(--muted)';
      } else {
        const h = s.xml_sync_interval_hours || '6';
        el.textContent = `Her ${h} saatte bir tüm aktif feed'ler otomatik güncellenir`;
        el.style.color = '#1D9E75';
      }
    }

    async function saveXmlSyncSettings() {
      const enabled = document.getElementById('xml-sync-enabled')?.checked ? '1' : '0';
      const interval = document.getElementById('xml-sync-interval')?.value || '6';
      try {
        await api('/api/dealer/settings', {
          method: 'PUT',
          body: JSON.stringify({ xml_sync_enabled: enabled, xml_sync_interval_hours: interval })
        });
        updateXmlSyncStatus({ xml_sync_enabled: enabled, xml_sync_interval_hours: interval });
      } catch (e) { toast('Ayar kaydedilemedi: ' + e.message, 'error'); }
    }
```

- [ ] **Step 3: `loadXmlFeeds()` içinde `loadXmlSyncSettings()` çağrısını ekle**

`async function loadXmlFeeds()` fonksiyonunun en başına (ilk try'dan önce) şunu ekle:

```javascript
      loadXmlSyncSettings();
```

- [ ] **Step 4: Panelde test et**

1. Sunucuyu başlat
2. XML Feedler sayfasına git
3. "⏱ Otomatik XML Senkronizasyon" kartı görünmeli
4. Interval'ı "1 saat" olarak değiştir → yeşil yazı "Her 1 saatte bir tüm aktif feed'ler otomatik güncellenir" olmalı
5. Sayfayı yenile → ayar korunmuş olmalı (DB'ye kaydedildi)
6. "Aktif" checkbox'ını kaldır → yazı gri "Kapalı" olmalı

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add xml sync settings card to xml feeds page"
```

---

## Self-Review

**Spec coverage:**
- ✅ XML'e yeni ürün geldiğinde ekler → `importXmlFeedById` UPSERT ile yeni barcodeları ekler
- ✅ Stok düştüğünde/bittiğinde günceller → `ON CONFLICT DO UPDATE SET stock = excluded.stock`
- ✅ Fiyat değişirse günceller → `sale_price = excluded.sale_price`
- ✅ Panelden interval ayarlanabilir → Task 5 UI kartı
- ✅ Kapatılabilir → `xml_sync_enabled` checkbox
- ✅ Mevcut manuel import bozulmadı → route aynı fonksiyonu çağırıyor

**Placeholder scan:** Tüm adımlarda tam kod mevcut. ✅

**Type consistency:** `importXmlFeedById(dealerId, feedId)` — Task 3'te tanımlandı, Task 4'te cron'a geçildi, Task 2 route'u da aynı imzayı kullanıyor. ✅
