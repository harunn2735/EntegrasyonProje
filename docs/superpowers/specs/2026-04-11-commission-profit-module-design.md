# Komisyon ve Kâr Hesaplama Modülü — Tasarım Dokümanı

**Tarih:** 2026-04-11  
**Durum:** Onaylı  
**Kapsam:** Trendyol entegrasyon projesine komisyon oranı yönetimi, sipariş bazlı kâr hesabı, simülasyon ve uyarı sistemi eklenmesi.

---

## 1. Bağlam ve Motivasyon

Mevcut projede siparişler Trendyol'dan çekilmekte ve `orders` tablosuna kaydedilmektedir. Her siparişin `lines_json` alanında ürün bazlı komisyon tutarı (`line.commission`) zaten gelmektedir. Ancak:

- Net kâr hiçbir yerde hesaplanıp kaydedilmiyor
- "Bu fiyattan satsam ne kazanırım?" simülasyonu yok
- Trendyol'un kestiği komisyon ile beklenen komisyon karşılaştırılmıyor
- Düşük kâr marjı durumunda uyarı mekanizması yok

Bu modül bu dört boşluğu kapatır.

---

## 2. Mimari Karar: Yaklaşım B

`services/` + `routes/` ayrımı — mevcut `routes/questions.js` ve `services/aiService.js` patterniyle tutarlı.

```
services/profitCalculator.js   ← hesaplama mantığı, DB inject edilebilir
services/profitAlert.js        ← uyarı üretme
routes/profit.js               ← tüm /api/profit/* ve /api/commission-rates/* endpoint'leri
server.js                      ← tek satır ekleme: app.use('/api', require('./routes/profit'))
tests/profitCalculator.test.js ← Jest birim testleri
tests/profitAlert.test.js      ← Jest birim testleri
```

`server.js`'e başka dokunulmaz.

---

## 3. Veritabanı Şeması

### 3.1 Yeni tablolar

```sql
CREATE TABLE IF NOT EXISTS commission_rates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   TEXT    NOT NULL UNIQUE,
  category_name TEXT    NOT NULL,
  rate          REAL    NOT NULL,       -- komisyon yüzdesi, ör: 12.5
  kdv_rate      INTEGER NOT NULL,       -- 8 | 10 | 20
  updated_at    TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profit_records (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id            TEXT    NOT NULL,
  dealer_id           INTEGER NOT NULL,
  barcode             TEXT,
  sale_price          REAL,
  cost_price          REAL,
  actual_commission   REAL,             -- Trendyol'dan gelen gerçek tutar
  expected_commission REAL,             -- commission_rates tablosundan hesaplanan
  kdv_amount          REAL,
  shipping_cost       REAL,
  return_provision    REAL,
  net_profit          REAL,
  profit_margin       REAL,
  created_at          TEXT    DEFAULT (datetime('now')),
  UNIQUE (order_id, dealer_id, barcode)  -- aynı sipariş+ürün çift kez kaydedilmez
);

CREATE TABLE IF NOT EXISTS alert_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  dealer_id   INTEGER NOT NULL,
  order_id    TEXT,
  barcode     TEXT,
  alert_type  TEXT    NOT NULL,         -- 'LOW_MARGIN' | 'COMMISSION_MISMATCH'
  margin      REAL,
  threshold   REAL,
  detail      TEXT,                     -- JSON string, ek bilgi
  created_at  TEXT    DEFAULT (datetime('now'))
);
```

### 3.2 Mevcut tablolarda değişiklik yok

`dealer_products.cost_price` zaten var. `kdv_rate` ürün tablosuna eklenmez; `commission_rates` tablosundan `category_id` üzerinden çekilir.

---

## 4. Config (.env)

```env
MIN_PROFIT_MARGIN_THRESHOLD=15
DEFAULT_SHIPPING_COST=15
DEFAULT_RETURN_PROVISION_RATE=0.02
DEFAULT_COMMISSION_RATE=12
```

---

## 5. Servis: `services/profitCalculator.js`

### 5.1 Commission Rate Cache

```js
// TTL: 5 dakika. Her getCommissionRate() çağrısında expiresAt kontrol edilir.
const cache = new Map(); // key: category_id → { rate, kdv_rate, expiresAt }

function getCommissionRate(category_id, db) {
  const cached = cache.get(category_id);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const row = db.prepare('SELECT rate, kdv_rate FROM commission_rates WHERE category_id = ?')
                .get(category_id);
  if (!row) return null; // null → çağıran DEFAULT_COMMISSION_RATE kullanır

  const entry = { ...row, expiresAt: Date.now() + 5 * 60 * 1000 };
  cache.set(category_id, entry);
  return entry;
}
```

### 5.2 `calculateOrderProfit(order, { db, config, alertService })`

```
1. order.lines_json parse et
2. Her line için:
   a. sale_price = line.discountedPrice ?? line.price
   b. barcode ile dealer_products'tan cost_price çek (dealer_id filtreli)
   c. actual_commission = line.commission
   d. commission_rates = getCommissionRate(category_id, db) ?? DEFAULT_COMMISSION_RATE
   e. expected_commission = round(sale_price × rate / 100, 2)
   f. kdv_amount = round(actual_commission - actual_commission / (1 + kdv_rate / 100), 2)
      // Trendyol komisyonu KDV dahil gelir; KDV payı içinden ayrıştırılır
   g. shipping_cost = ilk line ise config.DEFAULT_SHIPPING_COST, diğerleri 0
      // Kargo maliyeti sipariş bazlı sabit bir gider;
      // birden fazla line'a bölünmez, yalnızca ilk line'a yüklenir.
   h. return_provision = round(sale_price × config.DEFAULT_RETURN_PROVISION_RATE, 2)
   i. net_profit = round(sale_price - cost_price - actual_commission
                         - kdv_amount - shipping_cost - return_provision, 2)
   j. profit_margin = round((net_profit / sale_price) × 100, 2)
   k. profit_records'a INSERT OR IGNORE (order_id + barcode unique)

3. Audit: |actual_commission - expected_commission| / expected_commission > 0.05
   → alertService.checkCommissionMismatch(...)

4. profit_margin < config.MIN_PROFIT_MARGIN_THRESHOLD
   → alertService.checkMargin(...)
```

### 5.3 `simulateProfit(productId, price, { db, config, dealerId })`

```
- dealer_products'tan cost_price çek (id = productId AND dealer_id = dealerId filtreli)
- commission_rates'ten rate + kdv_rate çek (category_id üzerinden)
- Aynı formülü uygula, DB'ye kayıt yapma
- Return: { sale_price, cost_price, commission_amount, kdv_amount,
            shipping_cost, return_provision, net_profit, profit_margin,
            rate_used, kdv_rate_used }
```

---

## 6. Servis: `services/profitAlert.js`

```js
checkMargin(dealer_id, order_id, barcode, margin, threshold, db)
  → margin < threshold
  → alert_logs INSERT: alert_type = 'LOW_MARGIN'
  → console.warn ile log yaz

checkCommissionMismatch(dealer_id, order_id, barcode, actual, expected, db)
  → |actual - expected| / expected > 0.05
  → alert_logs INSERT: alert_type = 'COMMISSION_MISMATCH'
     detail: JSON.stringify({ actual, expected, diff_pct })
```

---

## 7. Orders Sync Entegrasyonu

`server.js`'deki order sync fonksiyonunun sonuna şu blok eklenir:

```js
// Profit hesabı: teslim edilmiş, henüz kaydedilmemiş siparişler
const unprocessed = db.prepare(`
  SELECT * FROM orders
  WHERE dealer_id = ?
    AND status = 'Delivered'
    AND order_id NOT IN (SELECT DISTINCT order_id FROM profit_records WHERE dealer_id = ?)
`).all(dealerId, dealerId);

for (const order of unprocessed) {
  try {
    await calculateOrderProfit(order, { db, config, alertService });
  } catch (e) {
    addLog('error', `Profit hesap hatası [${order.order_id}]: ${e.message}`, dealerId);
    // Hata olan siparişi atla, diğerlerine devam et
  }
}
```

---

## 8. API Endpoint'leri (`routes/profit.js`)

Tümü `authMiddleware` ile korunur.

| Method | Path | Açıklama |
|--------|------|----------|
| GET | `/api/profit/summary` | Dönemsel özet |
| GET | `/api/profit/by-product` | Ürün bazlı kâr tablosu |
| GET | `/api/profit/by-category` | Kategori bazlı özet |
| GET | `/api/profit/order/:orderId` | Tek sipariş detayı |
| GET | `/api/profit/simulate` | Fiyat simülasyonu |
| GET | `/api/profit/alerts` | Alert log listesi |
| POST | `/api/commission-rates/sync` | Trendyol'dan komisyon oranı çek |

### 8.1 `/api/profit/summary`
- Query: `?period=daily|weekly|monthly|custom&start=YYYY-MM-DD&end=YYYY-MM-DD`
- `period=custom` ise `start` ve `end` zorunlu — eksikse `400` döner
- Response: `{ totalRevenue, totalCost, totalCommission, totalProfit, avgMargin, orderCount }`

### 8.2 `/api/profit/by-product`
- Query: `?page=1&limit=50&sortBy=totalProfit&sortDir=desc`
- `sortBy`: `totalProfit | totalRevenue | avgMargin | soldCount` (varsayılan: `totalProfit`)
- `sortDir`: `asc | desc` (varsayılan: `desc`)
- Response: `{ products: [...], total, page, totalPages }`

### 8.3 `/api/profit/by-category`
- Response: kategori bazlı `commission_rates JOIN profit_records` özeti

### 8.4 `/api/profit/order/:orderId`
- Response: `{ order_id, lines: [tam breakdown] }`

### 8.5 `/api/profit/simulate`
- Query: `?productId=X&price=299`
- `req.dealer.id` filtreli — başka dealer'ın ürününü simüle edemez
- Response: tam breakdown, DB'ye kayıt yok

### 8.6 `/api/profit/alerts`
- Query: `?type=LOW_MARGIN|COMMISSION_MISMATCH&page=1&limit=50`
- Response: `{ alerts: [...], total, page, totalPages }`

### 8.7 `POST /api/commission-rates/sync`
- Trendyol kategori komisyon API'sinden oranları çeker
- Transaction içinde `INSERT OR REPLACE` ile upsert yapar
- Hatalı kayıtlar işlemi durdurmaz, `errors[]` ile döner
- Response: `{ updated: N, errors: [{ category_id, reason }] }`

---

## 9. Test Tasarımı

### Kurulum
```bash
npm install --save-dev jest @types/jest
# package.json: "test": "jest"
```

### `tests/profitCalculator.test.js`

**Test 1 — Normal kâr hesabı:**
`sale_price=299, cost_price=150, rate=12.5, kdv_rate=20`  
→ `net_profit` ve `profit_margin` doğru hesaplanıyor mu?

**Test 2 — Eksik commission rate → default kullanımı:**
`getCommissionRate()` null döner → `DEFAULT_COMMISSION_RATE` (12) devreye girer, hata fırlatılmaz.

**Test 3 — Kargo yalnızca ilk line'a ekleniyor:**
2 line'lı sipariş → `shipping_cost` sadece `lines[0]`'da, `lines[1]`'de 0.

**Test 4 — `discountedPrice` önceliği:**
`discountedPrice=250, price=299` → `sale_price=250` kullanılır.

### `tests/profitAlert.test.js`

**Test 5 — Düşük marj alert oluşturur:**
`margin=10, threshold=15` → `alert_logs INSERT` çağrılır, `alert_type='LOW_MARGIN'`.

Tüm testler DB bağlantısı olmadan çalışır; `db` ve `config` constructor veya parametre olarak inject edilir, mock data kullanılır.

---

## 10. Para Hesabı Hassasiyeti

Tüm ara hesaplamalarda `Math.round(value * 100) / 100` ile 2 ondalık yuvarlama uygulanır. Float toplama hatalarını önlemek için her adım ayrı ayrı yuvarlanır.

---

## 11. Kapsam Dışı

- Frontend/UI bileşenleri bu spec kapsamında değil
- Birden fazla para birimi desteği yok (TRY sabit)
- Geçmiş siparişlerin toplu `profit_records` yüklenmesi ayrı bir görev
