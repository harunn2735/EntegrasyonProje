# Sipariş Tabanlı Otomatik Stok Düşme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trendyol'dan çekilen siparişlerde ürün stoğu otomatik düşülsün, iptal/iade gelince stok geri eklensin ve her 30 dakikada cron job siparişleri otomatik sync etsin.

**Architecture:** `stock_applied` flag ile her siparişin stok etkisi tek seferlik uygulanır. `applyStockChanges()` ve `syncDealerOrders()` server.js'e eklenir; endpoint bu fonksiyonu çağırır. Cron job `syncDealerOrders`'ı dependency injection ile alır (dairesel bağımlılık önlemek için).

**Tech Stack:** `better-sqlite3`, `node-cron`, `axios`, `express`

---

## Dosya Haritası

| Dosya | İşlem | Sorumluluk |
|-------|-------|-----------|
| `database.js` | Güncelle | `orders` tablosuna `stock_applied` sütunu + safeAlter |
| `server.js` | Güncelle | `applyStockChanges()` + `syncDealerOrders()` ekle, endpoint güncelle, cron mount |
| `cron/ordersCron.js` | Oluştur | 30 dk'lık sipariş sync cron'u (syncDealerOrders dependency injection) |

---

## Task 1: database.js — stock_applied Sütunu

**Files:**
- Modify: `database.js`

- [ ] **Step 1: `orders` CREATE TABLE bloğuna `stock_applied` ekle**

`database.js` dosyasında şu satırı bul:
```javascript
      lines_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );
```

Şununla değiştir:
```javascript
      lines_json TEXT DEFAULT '[]',
      stock_applied INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );
```

- [ ] **Step 2: safeAlter ile mevcut veritabanına sütun ekle**

`database.js`'de şu satırı bul:
```javascript
  safeAlter(`ALTER TABLE orders ADD COLUMN lines_json TEXT DEFAULT '[]'`);
```

Hemen **altına** ekle:
```javascript
  safeAlter(`ALTER TABLE orders ADD COLUMN stock_applied INTEGER DEFAULT 0`);
```

- [ ] **Step 3: Doğrula**

```bash
cd C:/Users/harun/Desktop/claude_trendyol
node -e "const db = require('./database'); const cols = db.pragma('table_info(orders)'); console.log(cols.map(c => c.name).join(', '));"
```

Beklenen çıktı: `..., lines_json, stock_applied, created_at` (stock_applied görünmeli)

- [ ] **Step 4: Commit**

```bash
git add database.js
git commit -m "feat: add stock_applied column to orders table"
```

---

## Task 2: server.js — applyStockChanges() + syncDealerOrders() + Endpoint Güncelle

**Files:**
- Modify: `server.js`

Bu task 3 ayrı edit içerir.

- [ ] **Step 1: `applyStockChanges()` fonksiyonunu ekle**

`server.js`'de şu satırı bul:
```javascript
app.post('/api/dealer/orders/sync', authMiddleware, async (req, res) => {
```

Hemen **üstüne** şu iki fonksiyonu ekle:

```javascript
// ── STOK DÜŞME / GERI EKLEME ──────────────────────────────────
const CANCELLED_STATUSES = new Set(['Cancelled', 'Returned', 'UnDelivered']);

function applyStockChanges(dealerId, orders) {
    const getApplied = db.prepare('SELECT stock_applied FROM orders WHERE dealer_id = ? AND order_number = ?');
    const deductStmt = db.prepare(
        "UPDATE dealer_products SET stock = MAX(0, stock - ?), updated_at = datetime('now') WHERE dealer_id = ? AND barcode = ?"
    );
    const restoreStmt = db.prepare(
        "UPDATE dealer_products SET stock = stock + ?, updated_at = datetime('now') WHERE dealer_id = ? AND barcode = ?"
    );
    const markApplied = db.prepare('UPDATE orders SET stock_applied = ? WHERE dealer_id = ? AND order_number = ?');

    const tx = db.transaction(() => {
        for (const order of orders) {
            const row = getApplied.get(dealerId, order.order_number);
            const isCancelled = CANCELLED_STATUSES.has(order.status);
            const wasApplied = row?.stock_applied === 1;

            if (!isCancelled && !wasApplied) {
                for (const line of order.lines) {
                    if (!line.barcode) continue;
                    deductStmt.run(line.quantity, dealerId, line.barcode);
                }
                markApplied.run(1, dealerId, order.order_number);
            } else if (isCancelled && wasApplied) {
                for (const line of order.lines) {
                    if (!line.barcode) continue;
                    restoreStmt.run(line.quantity, dealerId, line.barcode);
                }
                markApplied.run(0, dealerId, order.order_number);
            }
        }
    });

    tx();

    if (process.env.AUTO_PUSH_TRENDYOL_STOCK === 'true') {
        pushDealerStocksToTrendyol(dealerId).catch(e =>
            console.error('[Stock] Trendyol push hatası:', e.message)
        );
    }
}
```

- [ ] **Step 2: `syncDealerOrders()` fonksiyonunu ekle**

Aynı yerde, `applyStockChanges` fonksiyonunun hemen altına (hâlâ `app.post('/api/dealer/orders/sync', ...`'ın üstünde):

```javascript
async function syncDealerOrders(dealer) {
    const dealerId = dealer.id;
    const authString = Buffer.from(`${dealer.api_key}:${dealer.api_secret}`).toString('base64');

    const response = await axios.get(
        `https://apigw.trendyol.com/integration/order/sellers/${dealer.supplier_id}/orders?page=0&size=200`,
        { headers: { 'Authorization': `Basic ${authString}`, 'User-Agent': `${dealer.supplier_id} - SelfIntegration` } }
    );

    const rawOrders = response.data?.content || [];
    const grouped = new Map();
    const getLocalProduct = db.prepare('SELECT stock, image_url, title FROM dealer_products WHERE dealer_id = ? AND barcode = ? LIMIT 1');

    for (const item of rawOrders) {
        const orderNumber = String(item.orderNumber || '').trim();
        if (!orderNumber) continue;

        if (!grouped.has(orderNumber)) {
            const address = item.shipmentAddress || item.address || {};
            grouped.set(orderNumber, {
                dealer_id: dealerId,
                order_number: orderNumber,
                order_date: item.orderDate ? new Date(item.orderDate).toISOString() : new Date().toISOString(),
                status: item.status || 'Created',
                customer_name: [item.customerFirstName, item.customerLastName].filter(Boolean).join(' ').trim() || address.fullName || '-',
                cargo_company: item.cargoProviderName || item.cargoCompanyName || '-',
                tracking_number: item.cargoTrackingNumber || item.trackingNumber || '-',
                shipping_address: [address.fullAddress, address.address1, address.address2, address.district, address.city].filter(Boolean).join(', '),
                package_number: String(item.packageNumber || item.shipmentPackageId || ''),
                total_price: Number(item.totalPrice || item.grossAmount || 0),
                commission: 0,
                net_price: Number(item.totalPrice || item.grossAmount || 0),
                product_count: 0,
                is_refund: /return|refund|iade/i.test(String(item.status || '')) ? 1 : 0,
                lines: []
            });
        }

        const target = grouped.get(orderNumber);
        const lines = Array.isArray(item.lines) && item.lines.length ? item.lines : [item];
        for (const line of lines) {
            const quantity = parseInt(line.quantity || line.amount || 1, 10) || 1;
            const lineTotal = Number(line.price || line.paidPrice || line.totalPrice || 0);
            const commission = Number(line.commission || line.tyCommission || 0);
            const barcode = String(line.barcode || line.productCode || line.merchantSku || '').trim();
            const localProduct = barcode ? getLocalProduct.get(dealerId, barcode) : null;

            target.product_count += quantity;
            target.commission += commission;
            target.lines.push({
                title: String(line.productName || item.productName || 'Ürün'),
                barcode,
                quantity,
                price: lineTotal,
                commission,
                image_url: line.imageUrl || line.image || localProduct?.image_url || '',
                stock_status: localProduct ? (Number(localProduct.stock || 0) > 0 ? 'Stokta' : 'Tükendi') : 'Bilinmiyor',
                local_stock: localProduct?.stock ?? null
            });
        }
    }

    const upsertOrder = db.prepare(`
        INSERT INTO orders (
            dealer_id, order_number, order_date, status, customer_name, cargo_company, tracking_number, shipping_address, package_number,
            total_price, commission, net_price, product_count, is_refund, lines_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dealer_id, order_number) DO UPDATE SET
            order_date = excluded.order_date,
            status = excluded.status,
            customer_name = excluded.customer_name,
            cargo_company = excluded.cargo_company,
            tracking_number = excluded.tracking_number,
            shipping_address = excluded.shipping_address,
            package_number = excluded.package_number,
            total_price = excluded.total_price,
            commission = excluded.commission,
            net_price = excluded.net_price,
            product_count = excluded.product_count,
            is_refund = excluded.is_refund,
            lines_json = excluded.lines_json
    `);

    const orders = [...grouped.values()].map(order => ({
        ...order,
        net_price: Math.max(0, Number((order.total_price - order.commission).toFixed(2)))
    }));

    const tx = db.transaction((list) => {
        for (const order of list) {
            upsertOrder.run(
                order.dealer_id, order.order_number, order.order_date, order.status,
                order.customer_name, order.cargo_company, order.tracking_number, order.shipping_address, order.package_number,
                order.total_price, order.commission, order.net_price, order.product_count, order.is_refund,
                JSON.stringify(order.lines)
            );
        }
    });
    tx(orders);

    applyStockChanges(dealerId, orders);

    addLog('success', `${orders.length} sipariş senkronize edildi`, dealerId);
    return { synced: orders.length };
}
```

- [ ] **Step 3: Mevcut endpoint'i `syncDealerOrders()` çağıracak şekilde güncelle**

Mevcut endpoint'i bul (şu an 120+ satır uzunluğunda):
```javascript
app.post('/api/dealer/orders/sync', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const { store_id } = req.body;

    try {
        const store = store_id
            ? db.prepare('SELECT * FROM stores WHERE id = ? AND dealer_id = ?').get(store_id, dealerId)
            : db.prepare('SELECT supplier_id, api_key, api_secret FROM dealers WHERE id = ?').get(dealerId);

        if (!store?.supplier_id || !store?.api_key || !store?.api_secret) {
            return res.status(400).json({ error: 'Mağazaya ait API bilgileri eksik' });
        }

        const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
        const response = await axios.get(
```

Tüm bu endpoint'i (kapanan `});` dahil) şununla **tamamen değiştir**:

```javascript
app.post('/api/dealer/orders/sync', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const { store_id } = req.body;

    try {
        const storeOrDealer = store_id
            ? db.prepare('SELECT * FROM stores WHERE id = ? AND dealer_id = ?').get(store_id, dealerId)
            : db.prepare('SELECT supplier_id, api_key, api_secret FROM dealers WHERE id = ?').get(dealerId);

        if (!storeOrDealer?.supplier_id || !storeOrDealer?.api_key || !storeOrDealer?.api_secret) {
            return res.status(400).json({ error: 'Mağazaya ait API bilgileri eksik' });
        }

        const result = await syncDealerOrders({ id: dealerId, ...storeOrDealer });
        res.json({ ok: true, ...result });
    } catch (e) {
        addLog('error', `Sipariş sync hatası: ${e.message}`, dealerId);
        res.status(500).json({ error: e.message });
    }
});
```

- [ ] **Step 4: Syntax kontrolü**

```bash
node -e "require('./server')" 2>&1 | head -5
```

Beklenen çıktı: Hata yoksa sunucu başlar ve `✅ Veritabanı ve tablolar hazır.` yazar. Hata varsa satır numarasına bakarak düzelt.

NOT: Bu komutu `Ctrl+C` ile durdurman gerekebilir — sunucu ayakta kalır.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: extract syncDealerOrders() and add stock deduction logic"
```

---

## Task 3: cron/ordersCron.js Oluştur

**Files:**
- Create: `cron/ordersCron.js`

- [ ] **Step 1: `cron/ordersCron.js` dosyasını yaz**

```javascript
// cron/ordersCron.js
'use strict';

const cron = require('node-cron');
const db = require('../database');

function startOrdersCron(syncDealerOrders) {
  cron.schedule('*/30 * * * *', async () => {
    console.log('[Siparişler Cron] Çalışıyor...');

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
        const result = await syncDealerOrders(dealer);
        if (result.synced > 0) {
          console.log(`[Siparişler Cron] Dealer ${dealer.id} (${dealer.name}): ${result.synced} sipariş sync edildi`);
        }
      } catch (e) {
        console.error(`[Siparişler Cron] Dealer ${dealer.id} hatası:`, e.message);
      }
    }
  });

  console.log('✅ Siparişler cron job başlatıldı (her 30 dakika).');
}

module.exports = startOrdersCron;
```

- [ ] **Step 2: Modül syntax kontrolü**

```bash
node -e "require('./cron/ordersCron'); console.log('Cron module OK')"
```

Beklenen çıktı: `Cron module OK`

- [ ] **Step 3: Commit**

```bash
git add cron/ordersCron.js
git commit -m "feat: add orders cron job (every 30 minutes, all active dealers)"
```

---

## Task 4: server.js — Cron'u Bağla

**Files:**
- Modify: `server.js`

- [ ] **Step 1: `startOrdersCron` require satırını ekle**

`server.js`'de şu satırı bul:
```javascript
const startQuestionsCron = require('./cron/questionsCron');
```

Hemen **altına** ekle:
```javascript
const startOrdersCron = require('./cron/ordersCron');
```

- [ ] **Step 2: Cron'u başlat**

`server.js`'de şu satırı bul:
```javascript
startQuestionsCron();
```

Hemen **altına** ekle:
```javascript
startOrdersCron(syncDealerOrders);
```

- [ ] **Step 3: Sunucuyu başlat ve doğrula**

```bash
node server.js
```

Beklenen çıktıda şunlar görünmeli:
```
✅ Veritabanı ve tablolar hazır.
⚠️  ANTHROPIC_API_KEY tanımlı değil — sorular cron job başlatılmadı.
✅ Siparişler cron job başlatıldı (her 30 dakika).
✅ Sunucu http://localhost:3000 üzerinde çalışıyor.
```

(ANTHROPIC_API_KEY tanımlıysa sorular cron uyarısı görünmez)

- [ ] **Step 4: Endpoint'i test et**

Sunucu çalışırken başka terminalde:
```bash
# Login ol
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bayi@demo.com","password":"bayi123"}' | node -e "process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

# Sync endpoint'ini test et
curl -s -X POST http://localhost:3000/api/dealer/orders/sync \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

Beklenen çıktı: `{"ok":true,"synced":N}` (N sipariş sayısı, 0 da olabilir — Trendyol API bilgileri yoksa hata dönebilir)

- [ ] **Step 5: stock_applied çalışıyor mu doğrula**

```bash
node -e "
const db = require('./database');
const orders = db.prepare('SELECT order_number, status, stock_applied FROM orders LIMIT 5').all();
console.log(JSON.stringify(orders, null, 2));
"
```

Beklenen: `stock_applied` alanı `0` veya `1` değeri ile görünmeli.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: start orders cron in server.js"
```

---

## Özet Commit Geçmişi

Tüm tasklar tamamlandığında git log şöyle görünmeli:

```
feat: start orders cron in server.js
feat: add orders cron job (every 30 minutes, all active dealers)
feat: extract syncDealerOrders() and add stock deduction logic
feat: add stock_applied column to orders table
```
