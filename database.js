const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'db.sqlite');
const db = new Database(dbPath);

function initDb() {
  db.exec(`
    -- Mevcut tablolar korunuyor, sadece yeni tablolar ekleniyor

    CREATE TABLE IF NOT EXISTS dealers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      profit_margin REAL DEFAULT 20,
      status TEXT DEFAULT 'active',
      upload_status TEXT DEFAULT 'pending',
      uploaded_count INTEGER DEFAULT 0,
      last_sync DATETIME,
      supplier_id TEXT,
      api_key TEXT,
      api_secret TEXT,
      password_hash TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      barcode TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      stock INTEGER DEFAULT 0,
      cost_price REAL DEFAULT 0,
      image_url TEXT,
      supplier_name TEXT DEFAULT 'Genel',
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      dealer_id INTEGER,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    -- Bayi'ye ait XML feed linkleri
    CREATE TABLE IF NOT EXISTS xml_feeds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      supplier_name TEXT DEFAULT 'Genel',
      last_imported DATETIME,
      product_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );

    -- Bayi'ye ait ürünler (mağazasındaki liste)
    CREATE TABLE IF NOT EXISTS dealer_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      barcode TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT,
      stock INTEGER DEFAULT 0,
      critical_stock_level INTEGER DEFAULT 5,
      last_remote_stock INTEGER,
      last_stock_sync_at DATETIME,
      last_stock_alert_at DATETIME,
      cost_price REAL DEFAULT 0,
      xml_category_id INTEGER,
      sale_price REAL DEFAULT 0,
      image_url TEXT,
      supplier_name TEXT DEFAULT 'Genel',
      xml_feed_id INTEGER,
      trendyol_status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(dealer_id, barcode),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );

    -- Sipariş verileri (Trendyol'dan veya manuel)
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      order_number TEXT,
      order_date DATETIME,
      status TEXT DEFAULT 'Created',
      customer_name TEXT,
      cargo_company TEXT,
      tracking_number TEXT,
      shipping_address TEXT,
      package_number TEXT,
      total_price REAL DEFAULT 0,
      commission REAL DEFAULT 0,
      net_price REAL DEFAULT 0,
      product_count INTEGER DEFAULT 1,
      is_refund INTEGER DEFAULT 0,
      lines_json TEXT DEFAULT '[]',
      stock_applied INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );

    -- Müşteri sorularıyla ilgili veriler
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

    -- Bayi mağazaları
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      supplier_id TEXT,
      api_key TEXT,
      api_secret TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );

    -- Tedarikçi bazlı kâr marjı
    CREATE TABLE IF NOT EXISTS supplier_margins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      supplier_name TEXT NOT NULL,
      margin REAL DEFAULT 20,
      updated_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(dealer_id, supplier_name),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );

    CREATE TABLE IF NOT EXISTS category_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      xml_feed_id INTEGER,
      source_category TEXT NOT NULL,
      trendyol_category_id INTEGER,
      trendyol_category_name TEXT,
      attribute_values TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(dealer_id, xml_feed_id, source_category),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id),
      FOREIGN KEY (xml_feed_id) REFERENCES xml_feeds(id)
    );

    CREATE TABLE IF NOT EXISTS dealer_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dealer_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(dealer_id, key),
      FOREIGN KEY (dealer_id) REFERENCES dealers(id)
    );
  `);

  // Mevcut sütunları güvenli şekilde ekle
  const safeAlter = (sql) => { try { db.exec(sql); } catch (e) { } };
  safeAlter(`ALTER TABLE products ADD COLUMN image_url TEXT`);
  safeAlter(`ALTER TABLE products ADD COLUMN supplier_name TEXT DEFAULT 'Genel'`);
  safeAlter(`ALTER TABLE dealers ADD COLUMN password_hash TEXT`);
  safeAlter(`ALTER TABLE dealers ADD COLUMN created_at DATETIME DEFAULT (datetime('now'))`);
  safeAlter(`ALTER TABLE logs ADD COLUMN dealer_id INTEGER`);
  safeAlter(`ALTER TABLE dealer_products ADD COLUMN xml_category_id INTEGER`);
  safeAlter(`ALTER TABLE category_mappings ADD COLUMN xml_feed_id INTEGER`);
  safeAlter(`ALTER TABLE orders ADD COLUMN customer_name TEXT`);
  safeAlter(`ALTER TABLE orders ADD COLUMN cargo_company TEXT`);
  safeAlter(`ALTER TABLE orders ADD COLUMN tracking_number TEXT`);
  safeAlter(`ALTER TABLE orders ADD COLUMN shipping_address TEXT`);
  safeAlter(`ALTER TABLE orders ADD COLUMN package_number TEXT`);
  safeAlter(`ALTER TABLE orders ADD COLUMN lines_json TEXT DEFAULT '[]'`);
  safeAlter(`ALTER TABLE orders ADD COLUMN stock_applied INTEGER DEFAULT 0`);
  try {
    db.exec(`
      DELETE FROM orders
      WHERE id NOT IN (
        SELECT MAX(id)
        FROM orders
        GROUP BY dealer_id, order_number
      );
    `);
  } catch (e) { }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_dealer_order_number ON orders(dealer_id, order_number)`);
  } catch (e) { }
  safeAlter(`ALTER TABLE dealer_products ADD COLUMN critical_stock_level INTEGER DEFAULT 5`);
  safeAlter(`ALTER TABLE dealer_products ADD COLUMN last_remote_stock INTEGER`);
  safeAlter(`ALTER TABLE dealer_products ADD COLUMN last_stock_sync_at DATETIME`);
  safeAlter(`ALTER TABLE dealer_products ADD COLUMN last_stock_alert_at DATETIME`);

  // Varsayılan admin hesabı oluştur (mevcut bayilere şifre yoksa)
  const dealers = db.prepare('SELECT id, email FROM dealers WHERE password_hash IS NULL').all();
  const defaultPassword = bcrypt.hashSync('demo123', 10);
  const updateStmt = db.prepare('UPDATE dealers SET password_hash = ? WHERE id = ?');
  for (const d of dealers) {
    updateStmt.run(defaultPassword, d.id);
  }

  // Demo bayi yoksa oluştur
  const existing = db.prepare("SELECT COUNT(*) as c FROM dealers").get();
  if (existing.c === 0) {
    const hash = bcrypt.hashSync('bayi123', 10);
    db.prepare(`
      INSERT INTO dealers (name, email, phone, profit_margin, supplier_id, api_key, api_secret, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('Demo Bayi A.Ş.', 'bayi@demo.com', '05001234567', 25, '', '', '', hash);
  }

  console.log('✅ Veritabanı ve tablolar hazır.');
}

initDb();

module.exports = db;
