const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'trendyol_bayi_secret_2024';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ── LOG YARDIMCISI ─────────────────────────────────────────────
function addLog(level, message, dealerId = null) {
    try {
        db.prepare('INSERT INTO logs (level, message, dealer_id) VALUES (?, ?, ?)').run(level, message, dealerId);
    } catch (e) { }
}

// ── AUTH MIDDLEWARE ────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });
    }
    try {
        const token = auth.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.dealer = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş token' });
    }
}

function adminMiddleware(req, res, next) {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== ADMIN_PASSWORD) {
        return res.status(403).json({ error: 'Admin yetkisi gerekiyor' });
    }
    next();
}

// ══════════════════════════════════════════════════════════════
// AUTH ENDPOİNTLERİ
// ══════════════════════════════════════════════════════════════

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email ve şifre gerekli' });

    const dealer = db.prepare('SELECT * FROM dealers WHERE email = ?').get(email);
    if (!dealer) return res.status(401).json({ error: 'Email veya şifre hatalı' });

    const valid = bcrypt.compareSync(password, dealer.password_hash || '');
    if (!valid) return res.status(401).json({ error: 'Email veya şifre hatalı' });

    const token = jwt.sign(
        { id: dealer.id, email: dealer.email, name: dealer.name },
        JWT_SECRET, { expiresIn: '24h' }
    );

    addLog('info', `Bayi girişi: ${dealer.name}`, dealer.id);
    res.json({ ok: true, token, dealer: { id: dealer.id, name: dealer.name, email: dealer.email } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    const dealer = db.prepare('SELECT id, name, email, phone, profit_margin, status, last_sync, supplier_id, api_key FROM dealers WHERE id = ?').get(req.dealer.id);
    res.json(dealer);
});

// Bayi kendi profilini güncellesin (API bilgileri dahil)
app.put('/api/dealer/profile', authMiddleware, (req, res) => {
    const { name, phone, supplier_id, api_key, api_secret, password, profit_margin } = req.body;
    const dealerId = req.dealer.id;
    try {
        let sql = 'UPDATE dealers SET name=?, phone=?, supplier_id=?, api_key=?, profit_margin=?';
        const params = [name, phone, supplier_id, api_key, profit_margin || 20];
        if (api_secret && api_secret.trim() !== '') {
            sql += ', api_secret=?';
            params.push(api_secret);
        }
        if (password && password.trim() !== '') {
            sql += ', password_hash=?';
            params.push(bcrypt.hashSync(password, 10));
        }
        sql += ' WHERE id=?';
        params.push(dealerId);
        db.prepare(sql).run(...params);
        addLog('info', 'Profil güncellendi', dealerId);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════════════════
// LOGS
// ══════════════════════════════════════════════════════════════

app.get('/api/dealer/logs', authMiddleware, (req, res) => {
    const logs = db.prepare('SELECT id, level, message, created_at FROM logs WHERE dealer_id = ? ORDER BY id DESC LIMIT 50').all(req.dealer.id);
    res.json(logs);
});

// ══════════════════════════════════════════════════════════════
// BAYI DASHBOARD
// ══════════════════════════════════════════════════════════════

app.get('/api/dealer/dashboard', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders WHERE dealer_id = ? AND is_refund = 0').get(dealerId).c;
        const totalRefunds = db.prepare('SELECT COUNT(*) as c FROM orders WHERE dealer_id = ? AND is_refund = 1').get(dealerId).c;
        const netRevenue = db.prepare('SELECT COALESCE(SUM(net_price),0) as total FROM orders WHERE dealer_id = ? AND is_refund = 0').get(dealerId).total;
        const storeCount = db.prepare('SELECT COUNT(*) as c FROM stores WHERE dealer_id = ?').get(dealerId).c;
        const productCount = db.prepare('SELECT COUNT(*) as c FROM dealer_products WHERE dealer_id = ?').get(dealerId).c;
        const xmlCount = db.prepare('SELECT COUNT(*) as c FROM xml_feeds WHERE dealer_id = ?').get(dealerId).c;

        // Son 7 günlük sipariş trendi
        const trend = db.prepare(`
            SELECT date(order_date) as day, COUNT(*) as count, SUM(net_price) as revenue
            FROM orders WHERE dealer_id = ? AND order_date >= date('now', '-7 days') AND is_refund = 0
            GROUP BY date(order_date) ORDER BY day
        `).all(dealerId);

        res.json({ totalOrders, totalRefunds, netRevenue, storeCount, productCount, xmlCount, trend });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════════════════
// MAĞAZALAR
// ══════════════════════════════════════════════════════════════

app.get('/api/dealer/stores', authMiddleware, (req, res) => {
    const stores = db.prepare('SELECT * FROM stores WHERE dealer_id = ?').all(req.dealer.id);
    res.json(stores);
});

app.post('/api/dealer/stores', authMiddleware, (req, res) => {
    const { name, supplier_id, api_key, api_secret } = req.body;
    const dealerId = req.dealer.id;
    try {
        if (req.body.id) {
            db.prepare('UPDATE stores SET name=?, supplier_id=?, api_key=?, api_secret=? WHERE id=? AND dealer_id=?')
                .run(name, supplier_id, api_key, api_secret, req.body.id, dealerId);
        } else {
            db.prepare('INSERT INTO stores (dealer_id, name, supplier_id, api_key, api_secret) VALUES (?,?,?,?,?)')
                .run(dealerId, name, supplier_id, api_key, api_secret);
        }
        addLog('success', `Mağaza eklendi/güncellendi: ${name}`, dealerId);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/dealer/stores/:id', authMiddleware, (req, res) => {
    db.prepare('DELETE FROM stores WHERE id = ? AND dealer_id = ?').run(req.params.id, req.dealer.id);
    res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
// XML FEED YÖNETİMİ
// ══════════════════════════════════════════════════════════════

app.get('/api/dealer/xml-feeds', authMiddleware, (req, res) => {
    const feeds = db.prepare('SELECT * FROM xml_feeds WHERE dealer_id = ? ORDER BY created_at DESC').all(req.dealer.id);
    res.json(feeds);
});

app.post('/api/dealer/xml-feeds', authMiddleware, (req, res) => {
    const { name, url, supplier_name } = req.body;
    const dealerId = req.dealer.id;
    if (!url) return res.status(400).json({ error: 'URL gerekli' });
    try {
        const result = db.prepare('INSERT INTO xml_feeds (dealer_id, name, url, supplier_name) VALUES (?,?,?,?)')
            .run(dealerId, name || url, url, supplier_name || 'Genel');
        addLog('success', `XML feed eklendi: ${url}`, dealerId);
        res.json({ ok: true, id: result.lastInsertRowid });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/dealer/xml-feeds/:id', authMiddleware, (req, res) => {
    const feedId = req.params.id;
    const dealerId = req.dealer.id;
    db.prepare('DELETE FROM dealer_products WHERE xml_feed_id = ? AND dealer_id = ?').run(feedId, dealerId);
    db.prepare('DELETE FROM xml_feeds WHERE id = ? AND dealer_id = ?').run(feedId, dealerId);
    res.json({ ok: true });
});

// XML'i parse edip ürünleri bayi'nin mağazasına yükle
app.post('/api/dealer/xml-feeds/:id/import', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const feedId = req.params.id;

    try {
        const feed = db.prepare('SELECT * FROM xml_feeds WHERE id = ? AND dealer_id = ?').get(feedId, dealerId);
        if (!feed) return res.status(404).json({ error: 'XML feed bulunamadı' });

        // XML'i indir
        const response = await axios.get(feed.url, { timeout: 30000, responseType: 'text' });
        const xmlText = response.data;

        // Parse et
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
        const parsed = parser.parse(xmlText);

        // Farklı XML formatlarını destekle
        let items = [];
        const root = parsed;

        // Yaygın XML yapılarını dene
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

        if (items.length === 0) {
            return res.status(400).json({ error: 'XML formatı tanınamadı veya ürün bulunamadı' });
        }

        // Bayi'nin kâr marjını al (tedarikçi bazlı veya genel)
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

        const importMany = db.transaction((prods) => {
            for (const p of prods) {
                // Esnek alan eşleştirme
                const barcode = String(p.barcode || p.Barcode || p.sku || p.SKU || p.code || p.Code || p['@_id'] || '').trim();
                const title = String(p.title || p.Title || p.name || p.Name || p.baslik || '').trim();
                if (!barcode || !title) continue;

                const costPrice = parseFloat(p.price || p.Price || p.cost_price || p.fiyat || 0);
                const salePrice = parseFloat((costPrice * (1 + margin / 100)).toFixed(2));
                const stock = parseInt(p.stock || p.Stock || p.quantity || p.stok || 0);
                const category = String(p.category || p.Category || p.kategori || 'Genel').trim();
                // XML'deki sub_category/top_category isimlerini gerçek Trendyol ID'sine dönüştür
                const xmlSubCat = String(p.sub_category || p.SubCategory || '').replace(/<[^>]+>/g,'').trim();
                const xmlTopCat = String(p.top_category || p.TopCategory || '').replace(/<[^>]+>/g,'').trim();
                const xmlCategoryId = getTrendyolCategoryByName(xmlSubCat, xmlTopCat) || null;

                // Görsel URL'leri — image1, image2...image8 etiketlerini dene (XML formatı)
                const _imageUrls = [];
                for (let _i = 1; _i <= 8; _i++) {
                  const _u = p['image' + _i] || p['resim' + _i] || p['foto' + _i] || p['img' + _i];
                  if (_u && typeof _u === 'string' && _u.trim()) _imageUrls.push(_u.trim());
                  else if (_u && typeof _u === 'object' && (_u['@_url'] || _u.url)) _imageUrls.push((_u['@_url'] || _u.url).trim());
                }
                
                // image1 yoksa tekil etiketlere bak
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

        // Feed'i güncelle
        const count = db.prepare('SELECT COUNT(*) as c FROM dealer_products WHERE dealer_id = ? AND xml_feed_id = ?').get(dealerId, parseInt(feedId)).c;
        db.prepare("UPDATE xml_feeds SET last_imported = datetime('now'), product_count = ? WHERE id = ?").run(count, feedId);

        addLog('success', `XML import tamamlandı: ${count} ürün (${feed.name})`, dealerId);
        res.json({ ok: true, count, margin });
    } catch (e) {
        addLog('error', `XML import hatası: ${e.message}`, dealerId);
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════════════════
// ÜRÜN YÖNETİMİ (BAYİ'YE AİT)
// ══════════════════════════════════════════════════════════════

app.get('/api/dealer/products', authMiddleware, (req, res) => {
    const { page = 1, limit = 50, search = '', supplier = '' } = req.query;
    const dealerId = req.dealer.id;
    const offset = (page - 1) * limit;

    let where = 'WHERE dp.dealer_id = ?';
    const params = [dealerId];

    if (search) {
        where += ' AND (dp.title LIKE ? OR dp.barcode LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
    }
    if (supplier) {
        where += ' AND dp.supplier_name = ?';
        params.push(supplier);
    }

    const products = db.prepare(`SELECT * FROM dealer_products dp ${where} ORDER BY dp.updated_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
    const total = db.prepare(`SELECT COUNT(*) as c FROM dealer_products dp ${where}`).get(...params).c;

    res.json({ products, total, page: parseInt(page), totalPages: Math.ceil(total / limit) });
});

app.patch('/api/dealer/products/:barcode/stock', authMiddleware, (req, res) => {
    const { stock } = req.body;
    const dealerId = req.dealer.id;
    try {
        db.prepare("UPDATE dealer_products SET stock = ?, updated_at = datetime('now') WHERE barcode = ? AND dealer_id = ?")
            .run(parseInt(stock), req.params.barcode, dealerId);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Toplu stok güncelleme
app.post('/api/dealer/products/bulk-stock', authMiddleware, (req, res) => {
    const items = req.body; // [{barcode, stock}]
    const dealerId = req.dealer.id;
    const updateStmt = db.prepare("UPDATE dealer_products SET stock = ?, updated_at = datetime('now') WHERE barcode = ? AND dealer_id = ?");
    const updateMany = db.transaction((list) => {
        for (const item of list) updateStmt.run(parseInt(item.stock), item.barcode, dealerId);
    });
    updateMany(items);
    res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
// TEDARİKÇİ & KÂR MARJI
// ══════════════════════════════════════════════════════════════

app.get('/api/dealer/suppliers', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;

    // Tedarikçi listesi + her birinin ürün sayısı
    const suppliers = db.prepare(`
        SELECT 
            dp.supplier_name,
            COUNT(*) as product_count,
            COALESCE(sm.margin, d.profit_margin, 20) as margin
        FROM dealer_products dp
        LEFT JOIN supplier_margins sm ON sm.dealer_id = dp.dealer_id AND sm.supplier_name = dp.supplier_name
        LEFT JOIN dealers d ON d.id = dp.dealer_id
        WHERE dp.dealer_id = ?
        GROUP BY dp.supplier_name
    `).all(dealerId);

    res.json(suppliers);
});

app.patch('/api/dealer/suppliers/:supplierName/margin', authMiddleware, (req, res) => {
    const { margin } = req.body;
    const dealerId = req.dealer.id;
    const supplierName = decodeURIComponent(req.params.supplierName);

    try {
        // Marjı kaydet/güncelle
        db.prepare(`
            INSERT INTO supplier_margins (dealer_id, supplier_name, margin)
            VALUES (?, ?, ?)
            ON CONFLICT(dealer_id, supplier_name) DO UPDATE SET margin = ?, updated_at = datetime('now')
        `).run(dealerId, supplierName, margin, margin);

        // Bu tedarikçinin ürün satış fiyatlarını güncelle
        const products = db.prepare('SELECT barcode, cost_price FROM dealer_products WHERE dealer_id = ? AND supplier_name = ?').all(dealerId, supplierName);
        const updatePrice = db.prepare("UPDATE dealer_products SET sale_price = ?, updated_at = datetime('now') WHERE dealer_id = ? AND barcode = ?");
        const updateAll = db.transaction((prods) => {
            for (const p of prods) {
                const newPrice = parseFloat((p.cost_price * (1 + margin / 100)).toFixed(2));
                updatePrice.run(newPrice, dealerId, p.barcode);
            }
        });
        updateAll(products);

        addLog('info', `${supplierName} tedarikçisi için kâr marjı %${margin} yapıldı`, dealerId);
        res.json({ ok: true, updated: products.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════════════════
// KÂR/ZARAR ANALİZİ
// ══════════════════════════════════════════════════════════════

app.get('/api/dealer/profit-loss', authMiddleware, (req, res) => {
    const { supplier = '', search = '' } = req.query;
    const dealerId = req.dealer.id;

    let where = 'WHERE dp.dealer_id = ?';
    const params = [dealerId];

    if (supplier) { where += ' AND dp.supplier_name = ?'; params.push(supplier); }
    if (search) { where += ' AND dp.title LIKE ?'; params.push(`%${search}%`); }

    const products = db.prepare(`
        SELECT 
            dp.*,
            (dp.sale_price - dp.cost_price) as profit_per_unit,
            CASE WHEN dp.cost_price > 0 THEN ROUND(((dp.sale_price - dp.cost_price) / dp.cost_price) * 100, 2) ELSE 0 END as margin_pct,
            (dp.sale_price - dp.cost_price) * dp.stock as total_potential_profit
        FROM dealer_products dp
        ${where}
        ORDER BY total_potential_profit DESC
        LIMIT 200
    `).all(...params);

    const summary = db.prepare(`
        SELECT
            COUNT(*) as total_products,
            SUM(dp.cost_price * dp.stock) as total_cost,
            SUM(dp.sale_price * dp.stock) as total_revenue,
            SUM((dp.sale_price - dp.cost_price) * dp.stock) as total_profit
        FROM dealer_products dp ${where}
    `).get(...params);

    res.json({ products, summary });
});

// ══════════════════════════════════════════════════════════════
// SİPARİŞLER
// ══════════════════════════════════════════════════════════════

app.get('/api/dealer/orders', authMiddleware, (req, res) => {
    const { page = 1, limit = 50 } = req.query;
    const dealerId = req.dealer.id;
    const offset = (page - 1) * limit;
    const orders = db.prepare('SELECT * FROM orders WHERE dealer_id = ? ORDER BY order_date DESC LIMIT ? OFFSET ?').all(dealerId, parseInt(limit), offset);
    const total = db.prepare('SELECT COUNT(*) as c FROM orders WHERE dealer_id = ?').get(dealerId).c;
    res.json({ orders, total });
});

// Trendyol'dan sipariş çek
app.post('/api/dealer/orders/sync', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const { store_id } = req.body;

    try {
        let store;
        if (store_id) {
            store = db.prepare('SELECT * FROM stores WHERE id = ? AND dealer_id = ?').get(store_id, dealerId);
        } else {
            // Ana bayi API bilgilerini kullan
            store = db.prepare('SELECT supplier_id, api_key, api_secret FROM dealers WHERE id = ?').get(dealerId);
        }

        if (!store?.supplier_id || !store?.api_key || !store?.api_secret) {
            return res.status(400).json({ error: 'Mağazaya ait API bilgileri eksik' });
        }

        const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
        const response = await axios.get(
            `https://apigw.trendyol.com/integration/order/sellers/${store.supplier_id}/orders?status=Created&page=0&size=50`,
            { headers: { 'Authorization': `Basic ${authString}`, 'User-Agent': `${store.supplier_id} - SelfIntegration` } }
        );

        const orders = response.data?.content || [];
        const insertOrder = db.prepare(`
            INSERT OR IGNORE INTO orders (dealer_id, order_number, order_date, status, total_price, net_price, is_refund)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const insertAll = db.transaction((list) => {
            for (const o of list) {
                const total = o.totalPrice || 0;
                insertOrder.run(dealerId, String(o.orderNumber), new Date(o.orderDate).toISOString(), o.status, total, total * 0.85, 0);
            }
        });
        insertAll(orders);

        addLog('success', `${orders.length} sipariş senkronize edildi`, dealerId);
        res.json({ ok: true, synced: orders.length });
    } catch (e) {
        addLog('error', `Sipariş sync hatası: ${e.message}`, dealerId);
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════════════════
// TRENDYOL ÜRÜN YÜKLEME (BAYİ MAĞAZASINA)
// ══════════════════════════════════════════════════════════════

const CATEGORY_KEYWORDS = [
    // Kulaklik (Gercek Trendyol ID'leri)
    { keys: ['airpod', 'tws', 'bluetooth kulak', 'kablosuz kulak', 'earbud', 'true wireless', 'itws'], categoryId: 1058 },
    { keys: ['kulaklık', 'earphone', 'headphone'], categoryId: 1058 },
    { keys: ['boyun bantlı kulaklık', 'neckband'], categoryId: 5196 },
    { keys: ['oyuncu kulaklık', 'gaming headset'], categoryId: 2700 },
    // Akilli Saat
    { keys: ['akıllı saat', 'smart watch', 'smartwatch', 'watch ultra', 'watch series', 'g9 mini', 't800', 't700'], categoryId: 1890 },
    // Arac Kamera
    { keys: ['arka görüş kamer', 'geri görüş kamer'], categoryId: 1952 },
    { keys: ['araç içi kamera', 'araç kamera', 'dash cam', 'dvr', 'araç içi kayıt', 'araç içi güvenlik'], categoryId: 1949 },
    // Supurge
    { keys: ['araç içi süpürge', 'araç süpürge', 'oto süpürge'], categoryId: 4484 },
    { keys: ['süpürge', 'vakumlu el', 'el süpürge', 'kablosuz süpürge', 'şarjlı süpürge', 'mini süpürge'], categoryId: 873 },
    // Isitici
    { keys: ['ısıtıcı', 'elektrikli soba', 'quartz ısıtıcı', 'fanlı ısıtıcı', 'quartz soba'], categoryId: 833 },
    // Hulahop
    { keys: ['hulahop', 'hula hoop', 'hulahoop', 'egzersiz çemberi', 'egzersiz halkası'], categoryId: 827 },
    // Cop Kovasi
    { keys: ['çöp kovası', 'çöp kutusu', 'çöp tenekesi', 'sensörlü çöp', 'akıllı çöp'], categoryId: 2188 },
    // Banyo
    { keys: ['banyo seti', 'tuvalet fırçası', 'sabunluk', 'banyo rafı', 'duş rafı', 'şampuanlık', 'banyo düzenleyici', 'banyo organizer'], categoryId: 1830 },
    // Jel Kompres / Ortopedik
    { keys: ['jel kompres', 'termojel', 'soğuk sıcak jel', 'buz jeli', 'kompres jel', 'buz paketi'], categoryId: 826 },
    { keys: ['dizlik', 'diz korsesi', 'patella', 'menisküs', 'çapraz bağ'], categoryId: 826 },
    { keys: ['bel korsesi', 'bel destekli'], categoryId: 826 },
    { keys: ['dirsek bandı', 'dirseklik', 'epikondilit'], categoryId: 826 },
    { keys: ['baldırlık', 'baldır desteği'], categoryId: 826 },
    { keys: ['kol askısı'], categoryId: 826 },
    { keys: ['bilekliği', 'bilek destek'], categoryId: 826 },
    { keys: ['topuk çorabı', 'topuk dikeni'], categoryId: 826 },
    // Masaj
    { keys: ['masaj tabancası'], categoryId: 4675 },
    { keys: ['masaj yastığı', 'boyun masaj yast'], categoryId: 4610 },
    { keys: ['masaj aleti', 'masaj cihazı', 'masaj pedi', 'titreşimli masaj', 'ems masaj', 'kelebek masaj', 'hip trainer', 'kalça egzersiz', 'hips trainer'], categoryId: 3550 },
    // Epilator
    { keys: ['epilatör', 'epilasyon aleti', 'tüy alıcı', 'tüy temizleyici', 'kaş bıyık', 'yüz tüy', 'finishing touch', 'flawless'], categoryId: 867 },
    // Nemlendirici
    { keys: ['nemlendirici', 'difüzör', 'aromaterapi', 'buhar makinesi', 'ultrasonik nem'], categoryId: 3013 },
    // Projektor
    { keys: ['projektör', 'projeksiyon', 'gece lambası', 'galaksi lamba', 'robot projektör'], categoryId: 1789 },
    // Oyun Konsolu
    { keys: ['el atarisi', 'retro konsol', 'nostalji oyun', 'taşınabilir konsol', 'arcade konsol', 'psp ps1', 'gamepad', 'oyun kolu', 'ps4 kolu', 'joystick'], categoryId: 1901 },
    // Oyuncak
    { keys: ['manyetik hayvan', 'manyetik meyve', 'mıknatıslı oyun'], categoryId: 1011 },
    { keys: ['ahşap denge', 'kule oyunu', 'ahşap kule'], categoryId: 2256 },
    { keys: ['tesettürlü bebek', 'meryem bebek', 'dua eden bebek', 'edep bebek', 'ilahi söyleyen'], categoryId: 4516 },
    // Mutfak Aletleri
    { keys: ['cupcake kalıbı', 'muffin kalıbı', 'kek kalıbı', 'fırın kalıbı', 'yanmaz muffin'], categoryId: 911 },
    { keys: ['öğütücü', 'kahve öğütücü', 'baharat öğütücü', 'elektrikli öğütücü'], categoryId: 834 },
    { keys: ['sarımsak doğrayıcı', 'soğan doğrayıcı'], categoryId: 834 },
    { keys: ['turbo fan', 'jet fan', 'mini fan', 'vantilatör'], categoryId: 834 },
    // Pil
    { keys: ['kalem pil', 'aa pil', 'aaa pil', 'alkalin pil', 'r6 pil'], categoryId: 1841 },
    // Dolap/Raf Organizer
    { keys: ['dolap içi', 'çekmece örtüsü', 'raf örtüsü', 'shelf liner', 'kaydırmaz raflık', 'kaymaz raf'], categoryId: 4458 },
    { keys: ['evye altı', 'dolap organizer', 'mutfak organizer'], categoryId: 4458 },
    // Yastik
    { keys: ['nano jel yastık', 'jel yastık', 'anti-alerjik yastık', 'otel yastığı'], categoryId: 1850 },
    { keys: ['hamile minderi', 'gebelik minderi', 'uyku minderi'], categoryId: 1850 },
    // Musluk
    { keys: ['musluk başlığı', 'musluk ucu', 'lavabo başlığı', '360 döner musluk', 'su tasarruflu musluk'], categoryId: 4726 },
    // Lunch Box / Saklama
    { keys: ['lunch box', 'saklama kabı', 'yemek kabı', 'beslenme kabı', 'bambu lunch', 'kahvaltılık kutu'], categoryId: 2188 },
    // Uydu Alicisi
    { keys: ['uydu alıcısı', 'uydu alici', 'dijital alıcı', 'wifi uydu', 'youtube uydu'], categoryId: 837 },
    // Yagmurluk
    { keys: ['yağmurluk', 'eva yağmurluk', 'kapüşonlu yağmurluk', 'pardesü yağmurluk', 'su geçirmez'], categoryId: 541 },
    // El Feneri
    { keys: ['el feneri', 'mini fener', 'cob led fener', 'q5 fener', 'şarjlı fener', 'zoomlu fener'], categoryId: 2060 },
    // Telefon Tutucu
    { keys: ['araç içi telefon tutucu', 'araç tutucu', 'magsafe tutucu', 'vakumlu telefon tutucu', 'mıknatıslı tutucu', '360 telefon tutucu'], categoryId: 1056 },
    // Sarj Kablosu / Powerbank
    { keys: ['powerbank', 'taşınabilir şarj', 'kablosuz powerbank', 'magsafe powerbank'], categoryId: 771 },
    { keys: ['şarj kablosu', 'type-c kablo', 'lightning kablo', 'usb kablo', '4in1 kablo', 'hızlı şarj kablo'], categoryId: 5504 },
    // Kemer Delici
    { keys: ['kemer delme', 'kemer delici', 'deri delik açıcı', 'delik açma pensesi', 'perçin pensesi'], categoryId: 834 },
    // Priz
    { keys: ['priz', 'sıva üstü priz', 'duvar prizi', 'topraklı priz', 'ikili priz'], categoryId: 836 },
    // Pubg Eldiven
    { keys: ['pubg eldiven', 'oyun eldiveni', 'parmak eldiveni', 'e-spor eldiven'], categoryId: 5394 },
    // Kedi Kumu
    { keys: ['kedi kumu', 'kumu küreği', 'kedi küreği'], categoryId: 1288 },
    // Yun Topu
    { keys: ['yün kurutma', 'kurutma topu', 'çamaşır topu'], categoryId: 1401 },
    // Eviye
    { keys: ['eviye seti', 'led eviye', 'akıllı eviye', 'çift şelale eviye'], categoryId: 4719 },
    // Vazo
    { keys: ['vazo', 'dekoratif vazo', 'skandinav vazo'], categoryId: 2105 },
    // Kopek
    { keys: ['köpek kovucu', 'ultrasonik köpek', 'köpek eğitim', 'köpek kovucu'], categoryId: 1357 },
    // Boks
    { keys: ['boks padi', 'duvar boks', 'müzikli boks'], categoryId: 827 },
    // Led Panel
    { keys: ['panel led', 'cama yapışır led'], categoryId: 836 }
];

function getCategoryId(title) {
    const lower = (title || '').toLowerCase();
    for (const entry of CATEGORY_KEYWORDS) {
        for (const key of entry.keys) {
            if (lower.includes(key)) return entry.categoryId;
        }
    }
    return 3870; // Genel fallback
}

// XML'deki sub_category ve top_category isimlerini gerçek Trendyol ID'lerine eşleştir
const TRENDYOL_CATEGORY_NAME_MAP = {
    'Banyo Seti': 1830,
    'Banyo Düzenleyici': 1828,
    'Banyo Aksesuarları': 4898,
    'Banyo Rafları': 1827,
    'Banyo Perdesi': 1829,
    'Çöp Kovası': 2188,
    'Mutfak Saklama ve Düzenlemee': 2188,
    'Tencere': 912,
    'Süpürge': 873,
    'Tablet Grupları': 3274, // Robot Süpürge ayrı ama genel süpürge 873
    'Kulıaqlık': 1058,
    'Akıllı Saat': 1890,
    'Nemlendirici': 3013,
    'Hava Nemlendirici': 3013,
    'Epilatör': 867,
    'Masaj Cihazı': 3550,
    'Masaj Tabancası': 4675,
    'Masaj Yastığı': 4610,
    'El Feneri': 2060,
    'Yastık': 1850,
    'Yağmurluk & Rüzgarlık': 541,
    'Pilates & Yoga': 2909,
    'Spor Malzemesi': 827,
    'Sporcu Aksesuarı': 826,
    'Oyuncu Kulaklıık': 2700,
    'Pil & Şarj Cihazı': 1841,
    'Şarj Kablosu': 5504,
    'Şarj Cihazları': 5499,
    'Powerbank': 771,
    'Araç İçi Telefon Tutucu': 1056,
    'Araç İçi Kamera': 1949,
    'Arka Görüş Kamerası': 1952,
    'Araç İçi Süpürge': 4484,
    'Mutfak Düzenleyici': 4458,
    'Mutfak Malızemeleri': 2188,
};

function getTrendyolCategoryByName(subCategory, topCategory) {
    // Önce alt kategori adına bak
    if (subCategory) {
        const sub = String(subCategory).trim();
        if (TRENDYOL_CATEGORY_NAME_MAP[sub]) return TRENDYOL_CATEGORY_NAME_MAP[sub];
        // Bulunamadıysa keyword match dene
        const lower = sub.toLowerCase();
        if (lower.includes('banyo seti') || lower.includes('banyo set')) return 1830;
        if (lower.includes('banyo düzen')) return 1828;
        if (lower.includes('çöp')) return 2188;
        if (lower.includes('mutfak saklama') || lower.includes('saklama')) return 2188;
        if (lower.includes('süpürge')) return 873;
        if (lower.includes('kulıaqlık') || lower.includes('kulaklık')) return 1058;
        if (lower.includes('akıllı saat') || lower.includes('smartwatch')) return 1890;
        if (lower.includes('nemlendirici')) return 3013;
        if (lower.includes('epilatör')) return 867;
        if (lower.includes('masaj tabancası')) return 4675;
        if (lower.includes('masaj yastığı')) return 4610;
        if (lower.includes('masaj')) return 3550;
        if (lower.includes('feneri') || lower.includes('fener')) return 2060;
        if (lower.includes('yastık')) return 1850;
        if (lower.includes('yağmurluk')) return 541;
        if (lower.includes('spor malzemesi')) return 827;
        if (lower.includes('pil')) return 1841;
        if (lower.includes('şarj kablosu') || lower.includes('kablo')) return 5504;
        if (lower.includes('şarj cihaz')) return 5499;
        if (lower.includes('powerbank')) return 771;
        if (lower.includes('telefon tutucu')) return 1056;
        if (lower.includes('araç içi kamera')) return 1949;
        if (lower.includes('mutfak düzenleyici') || lower.includes('düzenleyici')) return 4458;
    }
    // Alt kategori yeterli değilse üst kategoriye bak
    if (topCategory) {
        const top = String(topCategory).trim().toLowerCase();
        if (top.includes('banyo')) return 4898;
        if (top.includes('çöp')) return 2188;
        if (top.includes('mutfak')) return 2188;
    }
    return null; // Bulunamazsa getCategoryId titre devam etsin
}

app.post('/api/dealer/trendyol-upload', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const { store_id } = req.body;

    let store;
    if (store_id) {
        store = db.prepare('SELECT * FROM stores WHERE id = ? AND dealer_id = ?').get(store_id, dealerId);
    } else {
        store = db.prepare('SELECT * FROM dealers WHERE id = ?').get(dealerId);
        if (!store?.supplier_id || !store?.api_key || !store?.api_secret) {
            store = db.prepare(`
                SELECT *
                FROM stores
                WHERE dealer_id = ? AND supplier_id IS NOT NULL AND supplier_id != ''
                  AND api_key IS NOT NULL AND api_key != ''
                  AND api_secret IS NOT NULL AND api_secret != ''
                ORDER BY id ASC
                LIMIT 1
            `).get(dealerId);
        }
    }

    if (!store?.supplier_id || !store?.api_key || !store?.api_secret) {
        return res.status(400).json({ error: 'Trendyol API bilgileri eksik. Ayarlar veya Mağazalarım bölümünden Supplier ID / API Key / API Secret girin.' });
    }

    const products = db.prepare('SELECT * FROM dealer_products WHERE dealer_id = ? AND stock > 0').all(dealerId);
    if (!products.length) {
        return res.status(400).json({ error: 'Gönderilecek stoklu ürün bulunamadı.' });
    }

    res.json({ ok: true, message: `Yükleme başlatıldı (${products.length} ürün)` });

    // Arka planda çalış
    (async () => {
        try {
            console.log('--- UPLOAD TRIGGERED ---', { dealerId, store_id });
            console.log('Store record:', store ? `Found (ID: ${store.id})` : 'NOT FOUND');

            const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
            const API_URL = `https://apigw.trendyol.com/integration/product/sellers/${store.supplier_id}/products`;

const PLACEHOLDER_IMAGE = 'https://cdn.dsmcdn.com/ty1/product/media/images/20200812/11/7798319/11111/1_1_org.jpg';
const BANNED_WORDS = ['n11', 'hepsiburada', 'amazon', 'ciceksepeti', 'instagram', 'facebook', 'whatsapp'];

function isValidImageUrl(u) {
    if (!u || typeof u !== 'string') return false;
    let lower = u.toLowerCase();
    if (!lower.startsWith('http')) return false;
    // Banned words check
    for (let w of BANNED_WORDS) {
        if (lower.includes(w)) return false;
    }
    // Eger trendyol linki iceriyorsa fakat turkiyede satisin disinda ise falan yasak veriyor ama simdilik kalsin.
    return true;
}

            const BATCH_SIZE = 50;

            for (let i = 0; i < products.length; i += BATCH_SIZE) {
                const batch = products.slice(i, i + BATCH_SIZE)
                    .filter(p => p.barcode && p.barcode.length >= 2 && p.barcode.length <= 40);

                if (!batch.length) continue;

                const items = batch.map(p => {
                    const rawUrls = (p.image_url || '').split(',').map(u => u.trim()).filter(u => isValidImageUrl(u));
                    const imageUrls = rawUrls.length > 0 ? rawUrls.slice(0, 8) : [PLACEHOLDER_IMAGE];
                    // Önce XML'den gelen kategori ID'yi kullan, yoksa keyword eşleştirmeye düş
                    const finalCategoryId = (p.xml_category_id && p.xml_category_id > 0) ? p.xml_category_id : getCategoryId(p.title);
                    return {
                        barcode: p.barcode,
                        title: p.title.substring(0, 100),
                        productMainId: p.barcode,
                        brandId: 2613880,
                        categoryId: finalCategoryId,
                        quantity: p.stock,
                        stockCode: p.barcode,
                        dimensionalWeight: 1,
                        description: p.title,
                        currencyType: 'TRY',
                        listPrice: p.sale_price,
                        salePrice: p.sale_price,
                        vatRate: 20,
                        cargoCompanyId: 10,
                        images: imageUrls.map(u => ({ url: u })),
                        attributes: [
                            { attributeId: 1192, attributeValueId: 10633874 },
                            { attributeId: 47, customAttributeValue: 'Çok Renkli' },
                            { attributeId: 348, attributeValueId: 686230 }
                        ]
                    };
                });

                try {
                    await axios.post(API_URL, { items }, {
                        headers: {
                            'Authorization': `Basic ${authString}`,
                            'Content-Type': 'application/json',
                            'User-Agent': `${store.supplier_id} - SelfIntegration`
                        }
                    });
                    addLog('info', `Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} ürün gönderildi`, dealerId);
                } catch (err) {
                    const errorDetail = err.response?.data ? JSON.stringify(err.response.data).substring(0, 500) : err.message;
                    addLog('error', `Trendyol upload batch hatası (${err.message}): ${errorDetail}`, dealerId);
                }
                await new Promise(r => setTimeout(r, 2000));
            }
            addLog('success', `Trendyol yükleme tamamlandı: ${products.length} ürün`, dealerId);
        } catch (e) {
            addLog('error', `Trendyol upload hatası: ${e.message}`, dealerId);
        }
    })();
});

// ══════════════════════════════════════════════════════════════
// ADMİN ENDPOİNTLERİ
// ══════════════════════════════════════════════════════════════

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ ok: true, key: ADMIN_PASSWORD });
    } else {
        res.status(401).json({ error: 'Admin şifresi hatalı' });
    }
});

app.get('/api/admin/dealers', adminMiddleware, (req, res) => {
    const dealers = db.prepare(`
        SELECT d.*, 
            (SELECT COUNT(*) FROM dealer_products dp WHERE dp.dealer_id = d.id) as product_count,
            (SELECT COUNT(*) FROM stores s WHERE s.dealer_id = d.id) as store_count,
            (SELECT COUNT(*) FROM orders o WHERE o.dealer_id = d.id) as order_count
        FROM dealers d
        ORDER BY d.created_at DESC
    `).all();
    res.json(dealers);
});

app.post('/api/admin/dealers', adminMiddleware, (req, res) => {
    const { id, name, email, phone, profit_margin, supplier_id, api_key, api_secret, password } = req.body;
    try {
        if (id) {
            const updates = [name, email, phone, profit_margin, supplier_id, api_key, api_secret];
            let sql = 'UPDATE dealers SET name=?, email=?, phone=?, profit_margin=?, supplier_id=?, api_key=?, api_secret=?';
            if (password) { sql += ', password_hash=?'; updates.push(bcrypt.hashSync(password, 10)); }
            sql += ' WHERE id=?';
            updates.push(id);
            db.prepare(sql).run(...updates);
        } else {
            const hash = bcrypt.hashSync(password || 'bayi123', 10);
            db.prepare('INSERT INTO dealers (name, email, phone, profit_margin, supplier_id, api_key, api_secret, password_hash) VALUES (?,?,?,?,?,?,?,?)')
                .run(name, email, phone || '', profit_margin || 20, supplier_id || '', api_key || '', api_secret || '', hash);
        }
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/admin/dealers/:id', adminMiddleware, (req, res) => {
    db.prepare('DELETE FROM dealers WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

app.get('/api/admin/logs', adminMiddleware, (req, res) => {
    const logs = db.prepare('SELECT l.*, d.name as dealer_name FROM logs l LEFT JOIN dealers d ON d.id = l.dealer_id ORDER BY l.created_at DESC LIMIT 100').all();
    res.json(logs);
});

// ── ESKİ ENDPOİNTLER (Geriye Dönük Uyumluluk) ─────────────────
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD || password === 'demo123') {
        res.json({ ok: true });
    } else {
        res.json({ ok: false, error: 'Şifre yanlış' });
    }
});

app.get('/api/logs', (req, res) => {
    const logs = db.prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT 50').all();
    res.json(logs);
});

// ── ANA YÖNLENDİRME ─────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`✅ Sunucu http://localhost:${PORT} üzerinde çalışıyor.`);
    console.log(`📦 Admin Panel: http://localhost:${PORT}/admin (Şifre: ${ADMIN_PASSWORD})`);
});
