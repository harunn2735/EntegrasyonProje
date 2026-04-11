# Komisyon ve Kâr Hesaplama Modülü — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trendyol entegrasyon projesine sipariş bazlı kâr hesabı, komisyon denetimi, fiyat simülasyonu ve düşük marj uyarısı eklemek.

**Architecture:** `services/profitCalculator.js` ve `services/profitAlert.js` saf hesaplama servisleri olarak yazılır (DB inject edilebilir, test edilebilir). `routes/profit.js` tüm API endpoint'lerini barındırır. `server.js`'e yalnızca iki dokunuş yapılır: route mount satırı ve `syncDealerOrders` sonuna profit hesap bloğu.

**Tech Stack:** Node.js, Express, better-sqlite3, Jest (test), axios (mevcut), dotenv (mevcut)

---

## Dosya Haritası

| Dosya | İşlem | Sorumluluk |
|-------|--------|------------|
| `database.js` | Modify | `commission_rates`, `profit_records`, `alert_logs` tablolarını oluştur |
| `.env` | Modify | 4 yeni config değişkeni ekle |
| `package.json` | Modify | Jest kur, `"test": "jest"` ekle |
| `services/profitAlert.js` | **Create** | `checkMargin`, `checkCommissionMismatch` |
| `services/profitCalculator.js` | **Create** | `calculateLineProfit`, `calculateOrderProfit`, `simulateProfit`, commission rate cache |
| `routes/profit.js` | **Create** | 7 endpoint: summary, by-product, by-category, order/:id, simulate, alerts, commission-rates/sync |
| `server.js` | Modify | 1) `app.use` mount; 2) sync sonrası profit hesap bloğu |
| `tests/profitAlert.test.js` | **Create** | Test 5 — düşük marj alert |
| `tests/profitCalculator.test.js` | **Create** | Test 1-4 — hesaplama doğruluğu |

---

## Task 1: Jest Kurulumu

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Jest'i kur**

```bash
cd "c:\Users\harun\Desktop\BİTİRME PROJESİ\claude_trendyol"
npm install --save-dev jest @types/jest
```

Expected: `node_modules/jest` oluşur, `package-lock.json` güncellenir.

- [ ] **Step 2: package.json'a test script ekle**

`package.json`'daki `"test"` satırını güncelle:

```json
"scripts": {
  "start": "node server.js",
  "dev": "nodemon server.js",
  "test": "jest --testEnvironment=node"
},
```

- [ ] **Step 3: Jest'in çalıştığını doğrula**

```bash
npx jest --version
```

Expected: sürüm numarası basar (örn. `29.x.x`).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install jest for unit testing"
```

---

## Task 2: Veritabanı Tablolarını Ekle

**Files:**
- Modify: `database.js`

- [ ] **Step 1: database.js'i oku**

`database.js`'i oku, mevcut `CREATE TABLE` bloklarının nerede bittiğini bul.

- [ ] **Step 2: Üç yeni tabloyu ekle**

`database.js`'deki mevcut son `db.prepare(...).run()` tablo oluşturma bloğunun hemen **altına** şunları ekle:

```js
// ── Komisyon ve Kâr Tabloları ──────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS commission_rates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id   TEXT    NOT NULL UNIQUE,
    category_name TEXT    NOT NULL,
    rate          REAL    NOT NULL,
    kdv_rate      INTEGER NOT NULL DEFAULT 20,
    updated_at    TEXT    DEFAULT (datetime('now'))
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS profit_records (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number        TEXT    NOT NULL,
    dealer_id           INTEGER NOT NULL,
    barcode             TEXT,
    category_id         TEXT,
    sale_price          REAL,
    cost_price          REAL,
    actual_commission   REAL,
    expected_commission REAL,
    kdv_amount          REAL,
    shipping_cost       REAL,
    return_provision    REAL,
    net_profit          REAL,
    profit_margin       REAL,
    created_at          TEXT    DEFAULT (datetime('now')),
    UNIQUE (order_number, dealer_id, barcode)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS alert_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dealer_id   INTEGER NOT NULL,
    order_number TEXT,
    barcode     TEXT,
    alert_type  TEXT    NOT NULL,
    margin      REAL,
    threshold   REAL,
    detail      TEXT,
    created_at  TEXT    DEFAULT (datetime('now'))
  )
`).run();
```

- [ ] **Step 3: Tabloların oluştuğunu doğrula**

```bash
node -e "
const db = require('./database');
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(t=>t.name);
console.log(tables);
"
```

Expected çıktıda şunlar görünmeli: `commission_rates`, `profit_records`, `alert_logs`.

- [ ] **Step 4: Commit**

```bash
git add database.js
git commit -m "feat: add commission_rates, profit_records, alert_logs tables"
```

---

## Task 3: .env Config Değişkenleri

**Files:**
- Modify: `.env`

- [ ] **Step 1: .env dosyasını oku, mevcut içeriği gör**

- [ ] **Step 2: Dört satır ekle**

`.env` dosyasının sonuna şunları ekle:

```env
MIN_PROFIT_MARGIN_THRESHOLD=15
DEFAULT_SHIPPING_COST=15
DEFAULT_RETURN_PROVISION_RATE=0.02
DEFAULT_COMMISSION_RATE=12
```

- [ ] **Step 3: dotenv'in bu değerleri okuduğunu doğrula**

```bash
node -e "
require('dotenv').config();
console.log({
  MIN: process.env.MIN_PROFIT_MARGIN_THRESHOLD,
  SHIP: process.env.DEFAULT_SHIPPING_COST,
  RET: process.env.DEFAULT_RETURN_PROVISION_RATE,
  COM: process.env.DEFAULT_COMMISSION_RATE
});
"
```

Expected: dört değer de ekrana basılır.

- [ ] **Step 4: Commit (`.env` commit edilmez, sadece `.env.example` varsa orayı güncelle)**

`.env.example` dosyası varsa aynı değişkenleri (değersiz) ekle. Yoksa bu adımı atla.

```bash
git add .env.example 2>/dev/null || true
git commit -m "chore: add profit/commission config variables to .env" --allow-empty
```

---

## Task 4: ProfitAlertService — TDD

**Files:**
- Create: `tests/profitAlert.test.js`
- Create: `services/profitAlert.js`

- [ ] **Step 1: Başarısız testi yaz**

`tests/profitAlert.test.js` dosyasını oluştur:

```js
'use strict';

const { checkMargin, checkCommissionMismatch } = require('../services/profitAlert');

describe('ProfitAlertService', () => {
  // Test 5: Düşük marj → alert_logs INSERT çağrılır
  test('checkMargin: margin < threshold → inserts LOW_MARGIN alert', () => {
    const insertedRows = [];
    const mockDb = {
      prepare: () => ({
        run: (...args) => insertedRows.push(args)
      })
    };

    checkMargin({
      dealer_id: 1,
      order_number: 'ORD-001',
      barcode: 'BC-001',
      margin: 10,
      threshold: 15,
      db: mockDb
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toContain('LOW_MARGIN');
    expect(insertedRows[0]).toContain(10);  // margin
    expect(insertedRows[0]).toContain(15);  // threshold
  });

  test('checkMargin: margin >= threshold → no insert', () => {
    const insertedRows = [];
    const mockDb = {
      prepare: () => ({ run: (...args) => insertedRows.push(args) })
    };

    checkMargin({
      dealer_id: 1,
      order_number: 'ORD-001',
      barcode: 'BC-001',
      margin: 20,
      threshold: 15,
      db: mockDb
    });

    expect(insertedRows).toHaveLength(0);
  });

  test('checkCommissionMismatch: diff > 5% → inserts COMMISSION_MISMATCH alert', () => {
    const insertedRows = [];
    const mockDb = {
      prepare: () => ({ run: (...args) => insertedRows.push(args) })
    };

    // actual=40, expected=37 → diff=3/37=8.1% > 5%
    checkCommissionMismatch({
      dealer_id: 1,
      order_number: 'ORD-001',
      barcode: 'BC-001',
      actual: 40,
      expected: 37,
      db: mockDb
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toContain('COMMISSION_MISMATCH');
  });

  test('checkCommissionMismatch: diff <= 5% → no insert', () => {
    const insertedRows = [];
    const mockDb = {
      prepare: () => ({ run: (...args) => insertedRows.push(args) })
    };

    // actual=37.5, expected=37 → diff=0.5/37=1.35% < 5%
    checkCommissionMismatch({
      dealer_id: 1,
      order_number: 'ORD-001',
      barcode: 'BC-001',
      actual: 37.5,
      expected: 37,
      db: mockDb
    });

    expect(insertedRows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

```bash
npx jest tests/profitAlert.test.js --no-coverage
```

Expected: `Cannot find module '../services/profitAlert'` hatası.

- [ ] **Step 3: services/profitAlert.js'i yaz**

```js
// services/profitAlert.js
'use strict';

/**
 * Kâr marjı minimum eşiğin altındaysa alert_logs'a LOW_MARGIN kaydı ekler.
 * @param {{ dealer_id, order_number, barcode, margin, threshold, db }} opts
 */
function checkMargin({ dealer_id, order_number, barcode, margin, threshold, db }) {
  if (margin >= threshold) return;

  console.warn(`[ProfitAlert] LOW_MARGIN — ${barcode} @ sipariş ${order_number}: %${margin} < %${threshold}`);

  db.prepare(`
    INSERT INTO alert_logs (dealer_id, order_number, barcode, alert_type, margin, threshold, detail)
    VALUES (?, ?, ?, 'LOW_MARGIN', ?, ?, NULL)
  `).run(dealer_id, order_number, barcode, margin, threshold);
}

/**
 * Gerçek komisyon ile beklenen komisyon arasındaki fark %5'ten fazlaysa
 * alert_logs'a COMMISSION_MISMATCH kaydı ekler.
 * @param {{ dealer_id, order_number, barcode, actual, expected, db }} opts
 */
function checkCommissionMismatch({ dealer_id, order_number, barcode, actual, expected, db }) {
  if (expected === 0) return;
  const diff_pct = Math.abs(actual - expected) / expected;
  if (diff_pct <= 0.05) return;

  const detail = JSON.stringify({ actual, expected, diff_pct: Math.round(diff_pct * 10000) / 100 });
  console.warn(`[ProfitAlert] COMMISSION_MISMATCH — ${barcode}: actual=${actual}, expected=${expected}, fark=%${(diff_pct * 100).toFixed(1)}`);

  db.prepare(`
    INSERT INTO alert_logs (dealer_id, order_number, barcode, alert_type, margin, threshold, detail)
    VALUES (?, ?, ?, 'COMMISSION_MISMATCH', NULL, NULL, ?)
  `).run(dealer_id, order_number, barcode, detail);
}

module.exports = { checkMargin, checkCommissionMismatch };
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

```bash
npx jest tests/profitAlert.test.js --no-coverage
```

Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add services/profitAlert.js tests/profitAlert.test.js
git commit -m "feat: add ProfitAlertService with LOW_MARGIN and COMMISSION_MISMATCH alerts"
```

---

## Task 5: ProfitCalculatorService — TDD

**Files:**
- Create: `tests/profitCalculator.test.js`
- Create: `services/profitCalculator.js`

- [ ] **Step 1: Başarısız testi yaz**

`tests/profitCalculator.test.js` dosyasını oluştur:

```js
// tests/profitCalculator.test.js
'use strict';

const { calculateLineProfit } = require('../services/profitCalculator');

const DEFAULT_CONFIG = {
  DEFAULT_SHIPPING_COST: 15,
  DEFAULT_RETURN_PROVISION_RATE: 0.02,
  DEFAULT_COMMISSION_RATE: 12,
  MIN_PROFIT_MARGIN_THRESHOLD: 15
};

describe('calculateLineProfit', () => {

  // Test 1: Normal kâr hesabı doğruluğu
  test('sale_price=299, cost=150, rate=12.5, kdv=20 → net_profit ve margin doğru', () => {
    const line = { price: 299, commission: 37.38, barcode: 'BC-001' };
    const product = { cost_price: 150 };
    const commissionRate = { rate: 12.5, kdv_rate: 20 };

    // expected_commission = round(299 × 12.5/100, 2) = 37.38
    // kdv_amount = round(37.38 - 37.38/1.20, 2) = round(37.38 - 31.15, 2) = 6.23
    // shipping_cost = 15 (ilk line, index=0)
    // return_provision = round(299 × 0.02, 2) = 5.98
    // net_profit = round(299 - 150 - 37.38 - 6.23 - 15 - 5.98, 2) = 84.41
    // profit_margin = round(84.41/299 × 100, 2) = 28.23

    const result = calculateLineProfit(line, 0, { product, commissionRate, config: DEFAULT_CONFIG });

    expect(result.net_profit).toBeCloseTo(84.41, 1);
    expect(result.profit_margin).toBeCloseTo(28.23, 1);
    expect(result.expected_commission).toBeCloseTo(37.38, 2);
    expect(result.kdv_amount).toBeCloseTo(6.23, 1);
    expect(result.shipping_cost).toBe(15);
    expect(result.return_provision).toBeCloseTo(5.98, 2);
  });

  // Test 2: commission_rate null → DEFAULT_COMMISSION_RATE devreye girer, hata yok
  test('commissionRate null → DEFAULT_COMMISSION_RATE kullanılır, hata fırlatılmaz', () => {
    const line = { price: 200, commission: 24, barcode: 'BC-002' };
    const product = { cost_price: 100 };

    expect(() => {
      const result = calculateLineProfit(line, 0, {
        product,
        commissionRate: null,  // bulunamadı
        config: DEFAULT_CONFIG
      });
      // DEFAULT_COMMISSION_RATE=12 kullanılmalı
      // expected_commission = round(200 × 12/100, 2) = 24.00
      expect(result.rate_used).toBe(12);
      expect(result.expected_commission).toBeCloseTo(24, 2);
    }).not.toThrow();
  });

  // Test 3: Kargo yalnızca ilk line'a eklenir
  test('index=1 olan line için shipping_cost 0 olur', () => {
    const line = { price: 150, commission: 18, barcode: 'BC-003' };
    const product = { cost_price: 80 };
    const commissionRate = { rate: 12, kdv_rate: 20 };

    const line0Result = calculateLineProfit(line, 0, { product, commissionRate, config: DEFAULT_CONFIG });
    const line1Result = calculateLineProfit(line, 1, { product, commissionRate, config: DEFAULT_CONFIG });

    // Kargo maliyeti sipariş bazlı sabit; yalnızca ilk line'a yüklenir
    expect(line0Result.shipping_cost).toBe(15);
    expect(line1Result.shipping_cost).toBe(0);
  });

  // Test 4: discountedPrice önceliği
  test('discountedPrice mevcut olduğunda price yerine o kullanılır', () => {
    const line = { discountedPrice: 250, price: 299, commission: 31.25, barcode: 'BC-004' };
    const product = { cost_price: 120 };
    const commissionRate = { rate: 12.5, kdv_rate: 20 };

    const result = calculateLineProfit(line, 0, { product, commissionRate, config: DEFAULT_CONFIG });

    expect(result.sale_price).toBe(250);
    // expected_commission = round(250 × 12.5/100, 2) = 31.25
    expect(result.expected_commission).toBeCloseTo(31.25, 2);
  });

});
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

```bash
npx jest tests/profitCalculator.test.js --no-coverage
```

Expected: `Cannot find module '../services/profitCalculator'` hatası.

- [ ] **Step 3: services/profitCalculator.js'i yaz**

```js
// services/profitCalculator.js
'use strict';

// ── Yardımcı ────────────────────────────────────────────────
function round2(value) {
  return Math.round(value * 100) / 100;
}

// ── Commission Rate Cache (TTL: 5 dakika) ───────────────────
const _cache = new Map();

function getCommissionRate(category_id, db) {
  if (!category_id) return null;

  const cached = _cache.get(category_id);
  if (cached && Date.now() < cached.expiresAt) return cached;

  if (!db) return null;
  const row = db.prepare('SELECT rate, kdv_rate FROM commission_rates WHERE category_id = ?')
                .get(String(category_id));
  if (!row) return null;

  const entry = { rate: row.rate, kdv_rate: row.kdv_rate, expiresAt: Date.now() + 5 * 60 * 1000 };
  _cache.set(category_id, entry);
  return entry;
}

// ── Tek Line Hesabı (saf fonksiyon, DB gerektirmez) ─────────
/**
 * Bir sipariş kalemi için kâr hesabını yapar.
 * @param {object} line       - Sipariş satırı (lines_json'dan)
 * @param {number} index      - Satır index'i (kargo kimin üzerine yükleneceğini belirler)
 * @param {{ product, commissionRate, config }} opts
 */
function calculateLineProfit(line, index, { product, commissionRate, config }) {
  // discountedPrice varsa onu, yoksa price'ı kullan
  const sale_price = round2(line.discountedPrice ?? line.price ?? 0);
  const cost_price = round2(product?.cost_price ?? 0);
  const actual_commission = round2(line.commission ?? 0);

  const rate = commissionRate?.rate ?? config.DEFAULT_COMMISSION_RATE;
  const kdv_rate = commissionRate?.kdv_rate ?? 20;

  const expected_commission = round2(sale_price * rate / 100);
  // Trendyol komisyonu KDV dahil gelir; KDV payı içinden ayrıştırılır
  const kdv_amount = round2(actual_commission - actual_commission / (1 + kdv_rate / 100));
  // Kargo maliyeti sipariş bazlı sabit bir gider;
  // birden fazla line'a bölünmez, yalnızca ilk line'a yüklenir.
  const shipping_cost = index === 0 ? Number(config.DEFAULT_SHIPPING_COST) : 0;
  const return_provision = round2(sale_price * Number(config.DEFAULT_RETURN_PROVISION_RATE));

  const net_profit = round2(
    sale_price - cost_price - actual_commission - kdv_amount - shipping_cost - return_provision
  );
  const profit_margin = sale_price > 0 ? round2((net_profit / sale_price) * 100) : 0;

  return {
    barcode: line.barcode,
    sale_price,
    cost_price,
    actual_commission,
    expected_commission,
    kdv_amount,
    shipping_cost,
    return_provision,
    net_profit,
    profit_margin,
    rate_used: rate,
    kdv_rate_used: kdv_rate
  };
}

// ── Sipariş Kâr Hesabı (DB gerektirir) ─────────────────────
/**
 * Bir siparişin tüm kalemlerini hesaplar ve profit_records'a kaydeder.
 * @param {object} order         - orders tablosundan gelen satır
 * @param {{ db, config, alertService }} opts
 */
async function calculateOrderProfit(order, { db, config, alertService }) {
  const lines = JSON.parse(order.lines_json || '[]');
  const getProduct = db.prepare(
    'SELECT cost_price, xml_category_id FROM dealer_products WHERE barcode = ? AND dealer_id = ?'
  );
  const insertProfit = db.prepare(`
    INSERT OR IGNORE INTO profit_records
      (order_number, dealer_id, barcode, category_id,
       sale_price, cost_price, actual_commission, expected_commission,
       kdv_amount, shipping_cost, return_provision, net_profit, profit_margin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const barcode = line.barcode || '';

    const product = barcode ? getProduct.get(barcode, order.dealer_id) : null;
    const category_id = product?.xml_category_id ? String(product.xml_category_id) : null;
    const commissionRate = getCommissionRate(category_id, db);

    const r = calculateLineProfit(line, i, { product, commissionRate, config });

    insertProfit.run(
      order.order_number, order.dealer_id, r.barcode, category_id,
      r.sale_price, r.cost_price, r.actual_commission, r.expected_commission,
      r.kdv_amount, r.shipping_cost, r.return_provision, r.net_profit, r.profit_margin
    );

    // Komisyon denetimi: fark > %5 ise alert
    if (alertService && r.expected_commission > 0) {
      alertService.checkCommissionMismatch({
        dealer_id: order.dealer_id,
        order_number: order.order_number,
        barcode: r.barcode,
        actual: r.actual_commission,
        expected: r.expected_commission,
        db
      });
    }

    // Düşük marj uyarısı
    if (alertService && r.profit_margin < Number(config.MIN_PROFIT_MARGIN_THRESHOLD)) {
      alertService.checkMargin({
        dealer_id: order.dealer_id,
        order_number: order.order_number,
        barcode: r.barcode,
        margin: r.profit_margin,
        threshold: Number(config.MIN_PROFIT_MARGIN_THRESHOLD),
        db
      });
    }
  }
}

// ── Simülasyon (DB okur, kayıt yazmaz) ─────────────────────
/**
 * Belirtilen fiyat ile kâr simülasyonu yapar. DB'ye kayıt yazmaz.
 * @param {{ productId, price, db, config, dealerId }} opts
 */
function simulateProfit({ productId, price, db, config, dealerId }) {
  const product = db.prepare(
    'SELECT cost_price, xml_category_id FROM dealer_products WHERE id = ? AND dealer_id = ?'
  ).get(productId, dealerId);

  if (!product) return null;

  const category_id = product.xml_category_id ? String(product.xml_category_id) : null;
  const commissionRate = getCommissionRate(category_id, db);

  const mockLine = { price: Number(price), commission: 0, barcode: '' };
  // Simulate: actual_commission = expected_commission (tahmin modunda gerçek veri yok)
  const rate = commissionRate?.rate ?? config.DEFAULT_COMMISSION_RATE;
  const sale_price = round2(Number(price));
  mockLine.commission = round2(sale_price * rate / 100);

  const r = calculateLineProfit(mockLine, 0, { product, commissionRate, config });
  return {
    sale_price: r.sale_price,
    cost_price: r.cost_price,
    commission_amount: r.actual_commission,
    kdv_amount: r.kdv_amount,
    shipping_cost: r.shipping_cost,
    return_provision: r.return_provision,
    net_profit: r.net_profit,
    profit_margin: r.profit_margin,
    rate_used: r.rate_used,
    kdv_rate_used: r.kdv_rate_used
  };
}

module.exports = { calculateLineProfit, calculateOrderProfit, simulateProfit, getCommissionRate };
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

```bash
npx jest tests/profitCalculator.test.js --no-coverage
```

Expected: `4 passed`.

- [ ] **Step 5: Tüm testleri çalıştır**

```bash
npx jest --no-coverage
```

Expected: `8 passed` (4 profitAlert + 4 profitCalculator).

- [ ] **Step 6: Commit**

```bash
git add services/profitCalculator.js tests/profitCalculator.test.js
git commit -m "feat: add ProfitCalculatorService with line profit calc, simulation, and rate cache"
```

---

## Task 6: routes/profit.js Oluştur

**Files:**
- Create: `routes/profit.js`

- [ ] **Step 1: Dosyayı oluştur**

`routes/profit.js` dosyasını aşağıdaki içerikle oluştur:

```js
// routes/profit.js
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const { calculateOrderProfit, simulateProfit } = require('../services/profitCalculator');
const alertService = require('../services/profitAlert');

require('dotenv').config();

const config = {
  MIN_PROFIT_MARGIN_THRESHOLD: Number(process.env.MIN_PROFIT_MARGIN_THRESHOLD ?? 15),
  DEFAULT_SHIPPING_COST: Number(process.env.DEFAULT_SHIPPING_COST ?? 15),
  DEFAULT_RETURN_PROVISION_RATE: Number(process.env.DEFAULT_RETURN_PROVISION_RATE ?? 0.02),
  DEFAULT_COMMISSION_RATE: Number(process.env.DEFAULT_COMMISSION_RATE ?? 12),
};

// ── Yardımcı: dönem filtresi ────────────────────────────────
function getPeriodRange(period, start, end) {
  const now = new Date();
  if (period === 'custom') {
    if (!start || !end) return null; // 400 tetikler
    return { start: `${start} 00:00:00`, end: `${end} 23:59:59` };
  }
  const from = new Date(now);
  if (period === 'daily') from.setDate(now.getDate() - 1);
  else if (period === 'weekly') from.setDate(now.getDate() - 7);
  else if (period === 'monthly') from.setMonth(now.getMonth() - 1);
  else from.setDate(now.getDate() - 7); // varsayılan weekly
  return { start: from.toISOString().replace('T', ' ').substring(0, 19), end: now.toISOString().replace('T', ' ').substring(0, 19) };
}

// ── GET /api/profit/summary ─────────────────────────────────
router.get('/profit/summary', (req, res) => {
  try {
    const { period = 'weekly', start, end } = req.query;
    const range = getPeriodRange(period, start, end);
    if (!range) return res.status(400).json({ error: 'period=custom için start ve end zorunludur' });

    const row = db.prepare(`
      SELECT
        COUNT(DISTINCT order_number) as orderCount,
        ROUND(SUM(sale_price), 2)          as totalRevenue,
        ROUND(SUM(cost_price), 2)          as totalCost,
        ROUND(SUM(actual_commission), 2)   as totalCommission,
        ROUND(SUM(net_profit), 2)          as totalProfit,
        ROUND(AVG(profit_margin), 2)       as avgMargin
      FROM profit_records
      WHERE dealer_id = ? AND created_at BETWEEN ? AND ?
    `).get(req.dealer.id, range.start, range.end);

    res.json(row || { orderCount: 0, totalRevenue: 0, totalCost: 0, totalCommission: 0, totalProfit: 0, avgMargin: 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/profit/by-product ──────────────────────────────
router.get('/profit/by-product', (req, res) => {
  try {
    const { page = 1, limit = 50, sortBy = 'totalProfit', sortDir = 'desc' } = req.query;
    const allowed = ['totalProfit', 'totalRevenue', 'avgMargin', 'soldCount'];
    const col = allowed.includes(sortBy) ? sortBy : 'totalProfit';
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const rows = db.prepare(`
      SELECT
        pr.barcode,
        dp.title,
        COUNT(pr.id)                  as soldCount,
        ROUND(SUM(pr.sale_price), 2)  as totalRevenue,
        ROUND(SUM(pr.net_profit), 2)  as totalProfit,
        ROUND(AVG(pr.profit_margin), 2) as avgMargin
      FROM profit_records pr
      LEFT JOIN dealer_products dp ON dp.barcode = pr.barcode AND dp.dealer_id = pr.dealer_id
      WHERE pr.dealer_id = ?
      GROUP BY pr.barcode
      ORDER BY ${col} ${dir}
      LIMIT ? OFFSET ?
    `).all(req.dealer.id, parseInt(limit), offset);

    const { total } = db.prepare(
      'SELECT COUNT(DISTINCT barcode) as total FROM profit_records WHERE dealer_id = ?'
    ).get(req.dealer.id);

    res.json({ products: rows, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/profit/by-category ────────────────────────────
router.get('/profit/by-category', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        cr.category_id,
        cr.category_name,
        cr.rate,
        cr.kdv_rate,
        COUNT(pr.id)                      as orderCount,
        ROUND(SUM(pr.actual_commission), 2) as totalCommission,
        ROUND(SUM(pr.net_profit), 2)      as totalProfit,
        ROUND(AVG(pr.profit_margin), 2)   as avgMargin
      FROM commission_rates cr
      LEFT JOIN profit_records pr ON pr.category_id = cr.category_id AND pr.dealer_id = ?
      GROUP BY cr.category_id
      ORDER BY totalProfit DESC
    `).all(req.dealer.id);

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/profit/order/:orderId ─────────────────────────
router.get('/profit/order/:orderId', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM profit_records
      WHERE dealer_id = ? AND order_number = ?
      ORDER BY id ASC
    `).all(req.dealer.id, req.params.orderId);

    if (!rows.length) return res.status(404).json({ error: 'Bu sipariş için kâr kaydı bulunamadı' });
    res.json({ order_number: req.params.orderId, lines: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/profit/simulate ────────────────────────────────
router.get('/profit/simulate', (req, res) => {
  try {
    const { productId, price } = req.query;
    if (!productId || !price) return res.status(400).json({ error: 'productId ve price zorunludur' });

    const result = simulateProfit({
      productId: parseInt(productId),
      price: parseFloat(price),
      db,
      config,
      dealerId: req.dealer.id  // başka dealer'ın ürününü simüle edemez
    });

    if (!result) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/profit/alerts ──────────────────────────────────
router.get('/profit/alerts', (req, res) => {
  try {
    const { type, page = 1, limit = 50 } = req.query;
    const allowedTypes = ['LOW_MARGIN', 'COMMISSION_MISMATCH'];
    let where = 'WHERE dealer_id = ?';
    const params = [req.dealer.id];

    if (type && allowedTypes.includes(type)) {
      where += ' AND alert_type = ?';
      params.push(type);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const alerts = db.prepare(
      `SELECT * FROM alert_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, parseInt(limit), offset);
    const { total } = db.prepare(
      `SELECT COUNT(*) as total FROM alert_logs ${where}`
    ).get(...params);

    res.json({ alerts, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/commission-rates/sync ────────────────────────
// Not: Trendyol'un kamuya açık bir komisyon oranı API'si bulunmamaktadır.
// Bu endpoint body'den gelen oranları transaction içinde kaydeder.
// Body: { rates: [{ category_id, category_name, rate, kdv_rate }] }
router.post('/commission-rates/sync', (req, res) => {
  const { rates } = req.body;
  if (!Array.isArray(rates) || rates.length === 0) {
    return res.status(400).json({ error: 'rates dizisi zorunludur' });
  }

  const upsert = db.prepare(`
    INSERT INTO commission_rates (category_id, category_name, rate, kdv_rate, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(category_id) DO UPDATE SET
      category_name = excluded.category_name,
      rate          = excluded.rate,
      kdv_rate      = excluded.kdv_rate,
      updated_at    = datetime('now')
  `);

  const errors = [];
  let updated = 0;

  const tx = db.transaction(() => {
    for (const r of rates) {
      try {
        if (!r.category_id || !r.category_name || r.rate == null) {
          errors.push({ category_id: r.category_id, reason: 'category_id, category_name ve rate zorunludur' });
          continue;
        }
        if (![8, 10, 20].includes(Number(r.kdv_rate))) {
          errors.push({ category_id: r.category_id, reason: 'kdv_rate 8, 10 veya 20 olmalıdır' });
          continue;
        }
        upsert.run(String(r.category_id), r.category_name, Number(r.rate), Number(r.kdv_rate));
        updated++;
      } catch (e) {
        errors.push({ category_id: r.category_id, reason: e.message });
      }
    }
  });

  tx();
  res.json({ updated, errors });
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add routes/profit.js
git commit -m "feat: add profit and commission-rates API routes"
```

---

## Task 7: server.js Entegrasyonu

**Files:**
- Modify: `server.js` (2 yer)

- [ ] **Step 1: Route mount satırını ekle**

`server.js`'i oku. `app.use('/api', require('./routes/questions'))` satırını bul. Hemen **altına** şunu ekle:

```js
app.use('/api', require('./routes/profit'));
```

- [ ] **Step 2: Orders sync sonrası profit hesap bloğunu ekle**

`server.js`'deki `syncDealerOrders` fonksiyonunu bul (yaklaşık satır 765). Fonksiyon şu satırla bitiyor:

```js
    addLog('success', `${orders.length} sipariş senkronize edildi`, dealerId);
    return { synced: orders.length };
```

Bu iki satırdan **önce** şu bloğu ekle:

```js
    // Profit hesabı: teslim edilmiş, henüz kaydedilmemiş siparişleri işle
    const { calculateOrderProfit } = require('./services/profitCalculator');
    const alertService = require('./services/profitAlert');
    const profitConfig = {
        MIN_PROFIT_MARGIN_THRESHOLD: Number(process.env.MIN_PROFIT_MARGIN_THRESHOLD ?? 15),
        DEFAULT_SHIPPING_COST: Number(process.env.DEFAULT_SHIPPING_COST ?? 15),
        DEFAULT_RETURN_PROVISION_RATE: Number(process.env.DEFAULT_RETURN_PROVISION_RATE ?? 0.02),
        DEFAULT_COMMISSION_RATE: Number(process.env.DEFAULT_COMMISSION_RATE ?? 12),
    };
    const unprocessed = db.prepare(`
        SELECT * FROM orders
        WHERE dealer_id = ?
          AND status = 'Delivered'
          AND order_number NOT IN (
            SELECT DISTINCT order_number FROM profit_records WHERE dealer_id = ?
          )
    `).all(dealerId, dealerId);

    for (const unprocessedOrder of unprocessed) {
        try {
            await calculateOrderProfit(unprocessedOrder, { db, config: profitConfig, alertService });
        } catch (e) {
            addLog('error', `Profit hesap hatası [${unprocessedOrder.order_number}]: ${e.message}`, dealerId);
            // Hata olan siparişi atla, diğerlerine devam et
        }
    }
    if (unprocessed.length > 0) {
        addLog('success', `${unprocessed.length} sipariş için kâr hesaplandı`, dealerId);
    }
```

- [ ] **Step 3: Sunucuyu başlat ve hata olmadığını doğrula**

```bash
node server.js &
sleep 2
curl -s http://localhost:3000/api/profit/summary \
  -H "Authorization: Bearer GECERLI_TOKEN" | head -c 200
kill %1
```

Expected: JSON response (token geçerliyse veri, değilse 401 — 500 değil).

- [ ] **Step 4: Tüm testlerin hâlâ geçtiğini doğrula**

```bash
npx jest --no-coverage
```

Expected: `8 passed`.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: wire profit routes and post-sync profit calculation into order sync"
```

---

## Task 8: Manuel Doğrulama

**Files:** Yok (sadece test komutları)

- [ ] **Step 1: commission-rates/sync endpoint'ini test et**

```bash
node server.js &
sleep 2

curl -s -X POST http://localhost:3000/api/commission-rates/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer GECERLI_TOKEN" \
  -d '{
    "rates": [
      { "category_id": "411", "category_name": "Elektrikli Süpürgeler", "rate": 12.5, "kdv_rate": 20 },
      { "category_id": "412", "category_name": "Mutfak Ürünleri", "rate": 10.0, "kdv_rate": 10 }
    ]
  }'
```

Expected: `{"updated":2,"errors":[]}`

- [ ] **Step 2: Simülasyon endpoint'ini test et**

```bash
curl -s "http://localhost:3000/api/profit/simulate?productId=1&price=299" \
  -H "Authorization: Bearer GECERLI_TOKEN"
```

Expected: `net_profit`, `profit_margin`, `rate_used` içeren JSON.

- [ ] **Step 3: Summary endpoint'ini test et**

```bash
curl -s "http://localhost:3000/api/profit/summary?period=monthly" \
  -H "Authorization: Bearer GECERLI_TOKEN"
```

Expected: `{ totalRevenue, totalCost, totalCommission, totalProfit, avgMargin, orderCount }` içeren JSON.

- [ ] **Step 4: Custom period hata kontrolü**

```bash
curl -s "http://localhost:3000/api/profit/summary?period=custom" \
  -H "Authorization: Bearer GECERLI_TOKEN"
```

Expected: `{"error":"period=custom için start ve end zorunludur"}` ile HTTP 400.

- [ ] **Step 5: Sunucuyu kapat ve son commit**

```bash
kill %1
git add -A
git commit -m "feat: commission and profit module complete"
```

---

## Self-Review Notları

**Spec coverage:**
- ✅ `commission_rates` tablosu — Task 2
- ✅ `profit_records` tablosu — Task 2  
- ✅ `alert_logs` tablosu — Task 2
- ✅ `.env` config — Task 3
- ✅ `ProfitAlertService` (checkMargin, checkCommissionMismatch) — Task 4
- ✅ `ProfitCalculatorService` (calculateLineProfit, calculateOrderProfit, simulateProfit, cache) — Task 5
- ✅ Orders sync entegrasyonu — Task 7
- ✅ GET /api/profit/summary (period=custom 400 validasyonu dahil) — Task 6
- ✅ GET /api/profit/by-product (sortBy/sortDir dahil) — Task 6
- ✅ GET /api/profit/by-category — Task 6
- ✅ GET /api/profit/order/:orderId — Task 6
- ✅ GET /api/profit/simulate (dealer_id filtreli) — Task 6
- ✅ GET /api/profit/alerts — Task 6
- ✅ POST /api/commission-rates/sync (transaction, errors[]) — Task 6
- ✅ Jest kurulumu, 5 test case — Task 1 + Task 4 + Task 5
- ✅ `discountedPrice ?? price` önceliği — Task 5 Test 4
- ✅ DEFAULT_COMMISSION_RATE fallback — Task 5 Test 2
- ✅ Kargo yalnızca ilk line — Task 5 Test 3
- ✅ Audit %5 mismatch — Task 4 Test 3
