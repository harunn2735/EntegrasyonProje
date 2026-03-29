const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { XMLParser } = require('fast-xml-parser');
const db = require('./database');
const orderDetailRouter = require('./routes/orderDetail');
const questionsRouter = require('./routes/questions');
const forecastRouter = require('./routes/forecast');
const analyticsRouter = require('./routes/analytics');
const startQuestionsCron = require('./cron/questionsCron');
const startOrdersCron = require('./cron/ordersCron');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'trendyol_bayi_secret_2024';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

// ── LOG YARDIMCISI ─────────────────────────────────────────────
function addLog(level, message, dealerId = null) {
    try {
        db.prepare('INSERT INTO logs (level, message, dealer_id) VALUES (?, ?, ?)').run(level, message, dealerId);
    } catch (e) { }
}

function getCriticalStockThreshold(product) {
    const value = Number(product?.critical_stock_level);
    return Number.isFinite(value) && value >= 0 ? value : 5;
}

function getMailTransport() {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return null;
    }

    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

async function sendCriticalStockEmail(dealerId, products) {
    if (!products?.length) return { sent: false, reason: 'no-products' };

    const dealer = db.prepare('SELECT name, email FROM dealers WHERE id = ?').get(dealerId);
    const transport = getMailTransport();
    const to = process.env.STOCK_ALERT_TO || dealer?.email;
    if (!transport || !to) {
        return { sent: false, reason: 'mail-not-configured' };
    }

    const rows = products.map(product =>
        `<tr><td>${product.barcode || '-'}</td><td>${product.title || '-'}</td><td>${product.stock}</td><td>${getCriticalStockThreshold(product)}</td></tr>`
    ).join('');

    await transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to,
        subject: `Kritik Stok Uyarısı - ${dealer?.name || 'Bayi'}`,
        html: `
          <h3>Kritik stok uyarısı</h3>
          <p>Aşağıdaki ürünler kritik stok seviyesine düştü:</p>
          <table border="1" cellpadding="6" cellspacing="0">
            <thead><tr><th>Barkod</th><th>Ürün</th><th>Stok</th><th>Eşik</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        `
    });

    const markAlerted = db.prepare("UPDATE dealer_products SET last_stock_alert_at = datetime('now') WHERE dealer_id = ? AND barcode = ?");
    const tx = db.transaction((items) => {
        for (const item of items) markAlerted.run(dealerId, item.barcode);
    });
    tx(products);

    return { sent: true, count: products.length, to };
}

async function checkCriticalStockAndNotify(dealerId, barcodes = []) {
    const uniqueBarcodes = [...new Set((barcodes || []).filter(Boolean))];
    const rows = uniqueBarcodes.length
        ? db.prepare(`
            SELECT *
            FROM dealer_products
            WHERE dealer_id = ?
              AND barcode IN (${uniqueBarcodes.map(() => '?').join(',')})
        `).all(dealerId, ...uniqueBarcodes)
        : db.prepare('SELECT * FROM dealer_products WHERE dealer_id = ?').all(dealerId);

    const criticalProducts = rows.filter(product =>
        Number(product.stock || 0) <= getCriticalStockThreshold(product)
    );

    if (!criticalProducts.length) {
        return { notified: false, count: 0 };
    }

    const emailResult = await sendCriticalStockEmail(dealerId, criticalProducts);
    addLog(
        emailResult.sent ? 'info' : 'error',
        emailResult.sent
            ? `Kritik stok e-postası gönderildi: ${criticalProducts.length} ürün`
            : `Kritik stok algılandı ama e-posta gönderilemedi: ${emailResult.reason}`,
        dealerId
    );

    return { notified: emailResult.sent, count: criticalProducts.length, reason: emailResult.reason || null };
}

function getPreferredStoreOrDealer(dealerId, storeId = null) {
    if (storeId) {
        const store = db.prepare('SELECT * FROM stores WHERE id = ? AND dealer_id = ?').get(storeId, dealerId);
        if (store?.supplier_id && store?.api_key && store?.api_secret) return store;
    }
    return getDealerTrendyolCredentials(dealerId);
}

async function pushDealerStocksToTrendyol(dealerId, storeId = null, onlyChanged = true) {
    const store = getPreferredStoreOrDealer(dealerId, storeId);
    if (!store?.supplier_id || !store?.api_key || !store?.api_secret) {
        throw new Error('Mağazaya ait Trendyol API bilgileri eksik.');
    }

    const products = db.prepare(`
        SELECT barcode, stock, sale_price, last_remote_stock
        FROM dealer_products
        WHERE dealer_id = ?
          AND barcode IS NOT NULL AND barcode != ''
          ${onlyChanged ? 'AND (last_remote_stock IS NULL OR last_remote_stock != stock)' : ''}
        ORDER BY updated_at DESC
        LIMIT 1000
    `).all(dealerId);

    if (!products.length) {
        return { pushed: 0, batchRequestId: null };
    }

    const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
    const items = products.map(product => ({
        barcode: product.barcode,
        quantity: Math.max(0, Number(product.stock || 0)),
        salePrice: Number(product.sale_price || 0),
        listPrice: Number(product.sale_price || 0)
    }));

    const response = await axios.post(
        `https://apigw.trendyol.com/integration/product/sellers/${store.supplier_id}/price-and-inventory`,
        { items },
        {
            timeout: 30000,
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'User-Agent': `${store.supplier_id} - SelfIntegration`
            }
        }
    );

    const markSynced = db.prepare(`
        UPDATE dealer_products
        SET last_remote_stock = stock,
            last_stock_sync_at = datetime('now'),
            updated_at = datetime('now')
        WHERE dealer_id = ? AND barcode = ?
    `);
    const tx = db.transaction((list) => {
        for (const item of list) markSynced.run(dealerId, item.barcode);
    });
    tx(products);

    addLog('success', `Trendyol stok güncellemesi gönderildi: ${products.length} ürün`, dealerId);
    return { pushed: products.length, batchRequestId: response.data?.batchRequestId || null };
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

const trendyolCategoryCache = new Map();

function flattenTrendyolCategories(items, parentId = null, result = []) {
    for (const item of items || []) {
        const subCategories = item.subCategories || item.children || [];
        result.push({
            id: item.id,
            name: item.name,
            parentId,
            leaf: !subCategories.length
        });
        if (subCategories.length) flattenTrendyolCategories(subCategories, item.id, result);
    }
    return result;
}

async function getCachedTrendyolCategories(dealerId) {
    const cacheAgeMs = 6 * 60 * 60 * 1000;
    const cached = trendyolCategoryCache.get(dealerId);
    if (cached?.items?.length && (Date.now() - cached.fetchedAt) < cacheAgeMs) {
        return cached.items;
    }

    const response = await withTrendyolCredentialFallback(dealerId, null, async (store) => {
        const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
        return axios.get('https://apigw.trendyol.com/integration/product/product-categories', {
            timeout: 30000,
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'User-Agent': `${store.supplier_id} - SelfIntegration`
            }
        });
    });

    const categories = flattenTrendyolCategories(Array.isArray(response.data) ? response.data : (response.data?.categories || []));
    trendyolCategoryCache.set(dealerId, { items: categories, fetchedAt: Date.now() });
    return categories;
}

function getDealerTrendyolCredentials(dealerId) {
    let store = db.prepare('SELECT * FROM dealers WHERE id = ?').get(dealerId);
    if (store?.supplier_id && store?.api_key && store?.api_secret) return store;

    store = db.prepare(`
        SELECT *
        FROM stores
        WHERE dealer_id = ? AND supplier_id IS NOT NULL AND supplier_id != ''
          AND api_key IS NOT NULL AND api_key != ''
          AND api_secret IS NOT NULL AND api_secret != ''
        ORDER BY id ASC
        LIMIT 1
    `).get(dealerId);

    return store;
}

function getAllDealerTrendyolCredentials(dealerId, preferredStoreId = null) {
    const dealer = db.prepare('SELECT * FROM dealers WHERE id = ?').get(dealerId);
    const stores = db.prepare(`
        SELECT *
        FROM stores
        WHERE dealer_id = ?
          AND supplier_id IS NOT NULL AND supplier_id != ''
          AND api_key IS NOT NULL AND api_key != ''
          AND api_secret IS NOT NULL AND api_secret != ''
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id ASC
    `).all(dealerId, preferredStoreId || 0);

    const candidates = [];
    if (dealer?.supplier_id && dealer?.api_key && dealer?.api_secret) {
        candidates.push({ ...dealer, source_type: 'dealer' });
    }
    for (const store of stores) {
        candidates.push({ ...store, source_type: 'store' });
    }

    const seen = new Set();
    return candidates.filter((item) => {
        const key = `${item.source_type}:${item.id}:${item.supplier_id}:${item.api_key}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function withTrendyolCredentialFallback(dealerId, preferredStoreId, requestFn) {
    const credentials = getAllDealerTrendyolCredentials(dealerId, preferredStoreId);
    if (!credentials.length) {
        throw new Error('Trendyol API bilgileri eksik.');
    }

    let lastError;
    for (const credential of credentials) {
        try {
            return await requestFn(credential);
        } catch (error) {
            lastError = error;
            const status = error?.response?.status;
            if (status && status !== 401 && status !== 403) {
                throw error;
            }
        }
    }

    throw lastError || new Error('Trendyol isteği başarısız oldu.');
}

async function fetchTrendyolCategoryAttributes(dealerId, categoryId, preferredStoreId = null) {
    const response = await withTrendyolCredentialFallback(dealerId, preferredStoreId, async (store) => {
        const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
        return axios.get(`https://apigw.trendyol.com/integration/product/product-categories/${categoryId}/attributes`, {
            timeout: 30000,
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'User-Agent': `${store.supplier_id} - SelfIntegration`
            }
        });
    });

    return (response.data?.categoryAttributes || []).map(a => ({
        id: a.attribute?.id,
        name: a.attribute?.name,
        required: !!a.required,
        allow_custom: !!a.allowCustom,
        values: (a.attributeValues || []).map(v => ({ id: v.id, name: v.name }))
    }));
}

function getPreferredAttributeTerms(attributeName, sourceCategory, trendyolCategoryName) {
    const attr = normalizeCategoryText(attributeName);
    const source = normalizeCategoryText(`${sourceCategory || ''} ${trendyolCategoryName || ''}`);

    if (attr.includes('boyut') || attr.includes('ebat') || attr.includes('olcu')) {
        return ['standart', 'tek ebat', 'one size', 'std'];
    }
    if (attr.includes('materyal') || attr.includes('malzeme')) {
        if (source.includes('banyo') || source.includes('mutfak') || source.includes('duzenleyici') || source.includes('cop')) {
            return ['plastik', 'pp', 'polipropilen', 'metal', 'paslanmaz celik', 'celik'];
        }
        return ['plastik', 'metal', 'paslanmaz celik', 'celik', 'ahsap', 'cam', 'seramik', 'silikon', 'kumas'];
    }
    if (attr.includes('parca sayisi') || attr.includes('adet')) {
        return ['1 parca', '1 adet', 'tekli', 'tek parca', '1'];
    }
    if (attr.includes('renk')) {
        return ['cok renkli', 'beyaz', 'siyah', 'gri', 'mavi'];
    }
    if (attr.includes('sekil')) {
        return ['dikdortgen', 'yuvarlak', 'oval'];
    }
    return [];
}

function getCustomAttributeFallback(attributeName, sourceCategory, trendyolCategoryName) {
    const attr = normalizeCategoryText(attributeName);
    const source = normalizeCategoryText(`${sourceCategory || ''} ${trendyolCategoryName || ''}`);

    if (attr.includes('boyut') || attr.includes('ebat') || attr.includes('olcu')) return 'Standart';
    if (attr.includes('parca sayisi') || attr.includes('adet')) return '1';
    if (attr.includes('renk')) return 'Çok Renkli';
    if (attr.includes('materyal') || attr.includes('malzeme')) {
        if (source.includes('banyo') || source.includes('mutfak') || source.includes('duzenleyici') || source.includes('cop')) {
            return 'Plastik';
        }
        return 'Plastik';
    }
    return '';
}

function guessAttributeValue(attr, sourceCategory, trendyolCategoryName) {
    const preferredTerms = getPreferredAttributeTerms(attr.name, sourceCategory, trendyolCategoryName);
    const options = Array.isArray(attr.values) ? attr.values : [];

    for (const term of preferredTerms) {
        const normalizedTerm = normalizeCategoryText(term);
        const exact = options.find(v => normalizeCategoryText(v.name) === normalizedTerm);
        if (exact) return String(exact.id);
    }

    for (const term of preferredTerms) {
        const normalizedTerm = normalizeCategoryText(term);
        const partial = options.find(v => normalizeCategoryText(v.name).includes(normalizedTerm));
        if (partial) return String(partial.id);
    }

    if (attr.required && options.length === 1) {
        return String(options[0].id);
    }

    if (!options.length && attr.allow_custom) {
        return getCustomAttributeFallback(attr.name, sourceCategory, trendyolCategoryName);
    }

    return '';
}

function cleanupOrphanDealerProducts(dealerId) {
    try {
        return db.prepare(`
            DELETE FROM dealer_products
            WHERE dealer_id = ?
              AND xml_feed_id IS NOT NULL
              AND xml_feed_id NOT IN (
                  SELECT id FROM xml_feeds WHERE dealer_id = ?
              )
        `).run(dealerId, dealerId).changes;
    } catch (e) {
        return 0;
    }
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
        cleanupOrphanDealerProducts(dealerId);
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
    cleanupOrphanDealerProducts(req.dealer.id);
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
    db.prepare('DELETE FROM category_mappings WHERE xml_feed_id = ? AND dealer_id = ?').run(feedId, dealerId);
    res.json({ ok: true });
});

app.get('/api/dealer/category-mappings/source-categories', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    cleanupOrphanDealerProducts(dealerId);
    const feedId = parseInt(req.query.feed_id || '0', 10);
    const where = feedId ? 'WHERE dp.dealer_id = ? AND dp.xml_feed_id = ?' : 'WHERE dp.dealer_id = ?';
    const params = feedId ? [dealerId, feedId] : [dealerId];

    const rows = db.prepare(`
        SELECT
            dp.category as source_category,
            dp.xml_feed_id,
            xf.name as feed_name,
            COUNT(*) as product_count,
            COALESCE(cmf.trendyol_category_id, cmg.trendyol_category_id) as trendyol_category_id,
            COALESCE(cmf.trendyol_category_name, cmg.trendyol_category_name) as trendyol_category_name,
            COALESCE(cmf.attribute_values, cmg.attribute_values) as attribute_values
        FROM dealer_products dp
        LEFT JOIN xml_feeds xf ON xf.id = dp.xml_feed_id
        LEFT JOIN category_mappings cmf
          ON cmf.dealer_id = dp.dealer_id
         AND cmf.source_category = dp.category
         AND cmf.xml_feed_id = dp.xml_feed_id
        LEFT JOIN category_mappings cmg
          ON cmg.dealer_id = dp.dealer_id
         AND cmg.source_category = dp.category
         AND cmg.xml_feed_id IS NULL
        ${where}
        GROUP BY dp.category, dp.xml_feed_id, xf.name, cmf.trendyol_category_id, cmg.trendyol_category_id, cmf.trendyol_category_name, cmg.trendyol_category_name, cmf.attribute_values, cmg.attribute_values
        ORDER BY product_count DESC, source_category ASC
    `).all(...params);

    const total = rows.length;
    const mapped = rows.filter(r => r.trendyol_category_id).length;

    res.json({
        categories: rows.map(r => ({
            source_category: r.source_category,
            xml_feed_id: r.xml_feed_id,
            feed_name: r.feed_name,
            product_count: r.product_count,
            trendyol_category_id: r.trendyol_category_id,
            trendyol_category_name: r.trendyol_category_name,
            attribute_values: (() => {
                try { return JSON.parse(r.attribute_values || '{}'); } catch (e) { return {}; }
            })()
        })),
        summary: {
            total,
            mapped,
            unmapped: total - mapped,
            percent: total ? Math.round((mapped / total) * 100) : 0
        }
    });
});

app.get('/api/dealer/trendyol-categories', authMiddleware, async (req, res) => {
    try {
        const q = String(req.query.q || '').trim().toLocaleLowerCase('tr-TR');
        const categories = (await getCachedTrendyolCategories(req.dealer.id))
            .filter(c => c.leaf)
            .filter(c => !q || c.name.toLocaleLowerCase('tr-TR').includes(q))
            .slice(0, 100);

        res.json(categories);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/dealer/trendyol-categories/:id/attributes-v2', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const preferredStoreId = parseInt(req.query.store_id || '0', 10) || null;

    try {
        const response = await withTrendyolCredentialFallback(dealerId, preferredStoreId, async (store) => {
            const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
            return axios.get(`https://apigw.trendyol.com/integration/product/product-categories/${req.params.id}/attributes`, {
                timeout: 30000,
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'Content-Type': 'application/json',
                    'User-Agent': `${store.supplier_id} - SelfIntegration`
                }
            });
        });

        const attrs = (response.data?.categoryAttributes || []).map(a => ({
            id: a.attribute?.id,
            name: a.attribute?.name,
            required: !!a.required,
            allow_custom: !!a.allowCustom,
            values: (a.attributeValues || []).map(v => ({ id: v.id, name: v.name }))
        }));

        res.json(attrs);
    } catch (e) {
        const detail = e.response?.data?.message || e.response?.data?.errorMessage || e.message;
        const status = e.response?.status === 401 || e.response?.status === 403 ? 502 : 500;
        addLog('error', `Kategori özellikleri alınamadı (#${req.params.id}): ${detail}`, dealerId);
        res.status(status).json({ error: detail });
    }
});

/* app.get('/api/dealer/trendyol-categories/:id/attributes', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const preferredStoreId = parseInt(req.query.store_id || '0', 10) || null;
        return res.status(400).json({ error: 'Önce Trendyol API bilgilerini kaydedin.' });
    }

    try {
        const response = await withTrendyolCredentialFallback(dealerId, preferredStoreId, async (store) => {
            const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
            return axios.get(`https://apigw.trendyol.com/integration/product/product-categories/${req.params.id}/attributes`, {
                timeout: 30000,
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'Content-Type': 'application/json',
                    'User-Agent': `${store.supplier_id} - SelfIntegration`
                }
            });
        });

        const attrs = (response.data?.categoryAttributes || []).map(a => ({
            id: a.attribute?.id,
            name: a.attribute?.name,
            required: !!a.required,
            allow_custom: !!a.allowCustom,
            values: (a.attributeValues || []).map(v => ({ id: v.id, name: v.name }))
        }));

        res.json(attrs);
    } catch (e) {
        res.status(500).json({ error: e.response?.data?.message || e.message });
    }
}); */

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

app.post('/api/dealer/category-mappings', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    const {
        source_category,
        xml_feed_id,
        trendyol_category_id,
        trendyol_category_name,
        attribute_values
    } = req.body;

    if (!source_category || !trendyol_category_id || !trendyol_category_name) {
        return res.status(400).json({ error: 'Kaynak kategori ve Trendyol kategori bilgisi zorunlu.' });
    }

    try {
        db.prepare(`
            INSERT INTO category_mappings (dealer_id, xml_feed_id, source_category, trendyol_category_id, trendyol_category_name, attribute_values, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(dealer_id, xml_feed_id, source_category) DO UPDATE SET
                trendyol_category_id = excluded.trendyol_category_id,
                trendyol_category_name = excluded.trendyol_category_name,
                attribute_values = excluded.attribute_values,
                updated_at = datetime('now')
        `).run(
            dealerId,
            xml_feed_id || null,
            source_category,
            trendyol_category_id,
            trendyol_category_name,
            JSON.stringify(attribute_values || {})
        );

        const update = db.prepare(`
            UPDATE dealer_products
            SET xml_category_id = ?, updated_at = datetime('now')
            WHERE dealer_id = ? AND category = ? AND (? IS NULL OR xml_feed_id = ?)
        `).run(trendyol_category_id, dealerId, source_category, xml_feed_id || null, xml_feed_id || null);

        addLog('success', `Kategori eşleşti: ${source_category} -> ${trendyol_category_name} (#${trendyol_category_id})`, dealerId);
        res.json({ ok: true, updatedProducts: update.changes });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/dealer/category-mappings/auto-suggest', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const feedId = parseInt(req.body.feed_id || '0', 10) || null;
    const where = feedId ? 'WHERE dp.dealer_id = ? AND dp.xml_feed_id = ?' : 'WHERE dp.dealer_id = ?';
    const params = feedId ? [dealerId, feedId] : [dealerId];

    try {
        const categories = (await getCachedTrendyolCategories(dealerId)).filter(c => c.leaf);
        const rows = db.prepare(`
            SELECT DISTINCT
                dp.category as source_category,
                dp.xml_feed_id,
                COALESCE(cmf.trendyol_category_id, cmg.trendyol_category_id) as trendyol_category_id
            FROM dealer_products dp
            LEFT JOIN category_mappings cmf
              ON cmf.dealer_id = dp.dealer_id
             AND cmf.source_category = dp.category
             AND cmf.xml_feed_id = dp.xml_feed_id
            LEFT JOIN category_mappings cmg
              ON cmg.dealer_id = dp.dealer_id
             AND cmg.source_category = dp.category
             AND cmg.xml_feed_id IS NULL
            ${where}
            ORDER BY dp.category ASC
        `).all(...params);

        const saveMapping = db.prepare(`
            INSERT INTO category_mappings (dealer_id, xml_feed_id, source_category, trendyol_category_id, trendyol_category_name, attribute_values, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(dealer_id, xml_feed_id, source_category) DO UPDATE SET
                trendyol_category_id = excluded.trendyol_category_id,
                trendyol_category_name = excluded.trendyol_category_name,
                updated_at = datetime('now')
        `);
        const updateProducts = db.prepare(`
            UPDATE dealer_products
            SET xml_category_id = ?, updated_at = datetime('now')
            WHERE dealer_id = ? AND category = ? AND (? IS NULL OR xml_feed_id = ?)
        `);

        const suggestions = [];
        const applySuggestions = db.transaction((items) => {
            for (const item of items) {
                saveMapping.run(
                    dealerId,
                    item.xml_feed_id || null,
                    item.source_category,
                    item.trendyol_category_id,
                    item.trendyol_category_name,
                    '{}'
                );
                updateProducts.run(item.trendyol_category_id, dealerId, item.source_category, item.xml_feed_id || null, item.xml_feed_id || null);
            }
        });

        for (const row of rows) {
            if (row.trendyol_category_id) continue;
            const suggestion = suggestTrendyolCategory(row.source_category, categories);
            if (!suggestion) continue;

            suggestions.push({
                source_category: row.source_category,
                xml_feed_id: row.xml_feed_id,
                trendyol_category_id: suggestion.category.id,
                trendyol_category_name: suggestion.category.name,
                score: suggestion.score,
                method: suggestion.method
            });
        }

        applySuggestions(suggestions);
        addLog('success', `Toplu otomatik kategori önerisi uygulandı: ${suggestions.length} eşleşme`, dealerId);
        res.json({ ok: true, count: suggestions.length, suggestions: suggestions.slice(0, 50) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// XML'i parse edip ürünleri bayi'nin mağazasına yükle
app.post('/api/dealer/category-mappings/auto-fill-attributes', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const feedId = parseInt(req.body.feed_id || '0', 10) || null;
    const xmlFeedId = parseInt(req.body.xml_feed_id || '0', 10) || null;
    const sourceCategory = String(req.body.source_category || '').trim() || null;
    const preferredStoreId = parseInt(req.body.store_id || '0', 10) || null;

    const whereParts = ['dp.dealer_id = ?'];
    const params = [dealerId];

    if (feedId) {
        whereParts.push('dp.xml_feed_id = ?');
        params.push(feedId);
    }
    if (xmlFeedId) {
        whereParts.push('dp.xml_feed_id = ?');
        params.push(xmlFeedId);
    }
    if (sourceCategory) {
        whereParts.push('dp.category = ?');
        params.push(sourceCategory);
    }

    try {
        const rows = db.prepare(`
            SELECT
                dp.category as source_category,
                dp.xml_feed_id,
                xf.name as feed_name,
                COUNT(*) as product_count,
                COALESCE(cmf.trendyol_category_id, cmg.trendyol_category_id) as trendyol_category_id,
                COALESCE(cmf.trendyol_category_name, cmg.trendyol_category_name) as trendyol_category_name,
                COALESCE(cmf.attribute_values, cmg.attribute_values) as attribute_values
            FROM dealer_products dp
            LEFT JOIN xml_feeds xf ON xf.id = dp.xml_feed_id
            LEFT JOIN category_mappings cmf
              ON cmf.dealer_id = dp.dealer_id
             AND cmf.source_category = dp.category
             AND cmf.xml_feed_id = dp.xml_feed_id
            LEFT JOIN category_mappings cmg
              ON cmg.dealer_id = dp.dealer_id
             AND cmg.source_category = dp.category
             AND cmg.xml_feed_id IS NULL
            WHERE ${whereParts.join(' AND ')}
            GROUP BY dp.category, dp.xml_feed_id, xf.name, cmf.trendyol_category_id, cmg.trendyol_category_id, cmf.trendyol_category_name, cmg.trendyol_category_name, cmf.attribute_values, cmg.attribute_values
            ORDER BY product_count DESC, source_category ASC
        `).all(...params).filter(row => row.trendyol_category_id);

        const upsertMapping = db.prepare(`
            INSERT INTO category_mappings (dealer_id, xml_feed_id, source_category, trendyol_category_id, trendyol_category_name, attribute_values, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(dealer_id, xml_feed_id, source_category) DO UPDATE SET
                trendyol_category_id = excluded.trendyol_category_id,
                trendyol_category_name = excluded.trendyol_category_name,
                attribute_values = excluded.attribute_values,
                updated_at = datetime('now')
        `);

        let updatedCategories = 0;
        let filledAttributes = 0;

        for (const row of rows) {
            const attrs = await fetchTrendyolCategoryAttributes(dealerId, row.trendyol_category_id, preferredStoreId);
            const existingValues = (() => {
                try { return JSON.parse(row.attribute_values || '{}'); } catch (e) { return {}; }
            })();
            const nextValues = { ...existingValues };

            for (const attr of attrs) {
                if (!attr?.id || !attr.required) continue;
                if (String(nextValues[attr.id] || '').trim() !== '') continue;

                const guessedValue = guessAttributeValue(attr, row.source_category, row.trendyol_category_name);
                if (String(guessedValue || '').trim() === '') continue;

                nextValues[attr.id] = guessedValue;
                filledAttributes += 1;
            }

            if (JSON.stringify(existingValues) === JSON.stringify(nextValues)) continue;

            upsertMapping.run(
                dealerId,
                row.xml_feed_id || null,
                row.source_category,
                row.trendyol_category_id,
                row.trendyol_category_name,
                JSON.stringify(nextValues)
            );
            updatedCategories += 1;
        }

        addLog('info', `Kategori özellikleri otomatik dolduruldu: kategori=${updatedCategories}, özellik=${filledAttributes}`, dealerId);
        res.json({ ok: true, processed: rows.length, updatedCategories, filledAttributes });
    } catch (e) {
        res.status(500).json({ error: e.response?.data?.message || e.message });
    }
});

app.post('/api/dealer/trendyol-upload/precheck', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const preferredStoreId = parseInt(req.body.store_id || '0', 10) || null;

    try {
        const products = db.prepare('SELECT * FROM dealer_products WHERE dealer_id = ? AND stock > 0').all(dealerId);
        if (!products.length) {
            return res.json({ ok: true, ready: false, totalProducts: 0, missingCategories: [], message: 'Gönderilecek stoklu ürün bulunamadı.' });
        }

        const getUploadCategoryMapping = db.prepare(`
            SELECT trendyol_category_id, trendyol_category_name, attribute_values
            FROM category_mappings
            WHERE dealer_id = ? AND source_category = ? AND (xml_feed_id = ? OR xml_feed_id IS NULL)
            ORDER BY CASE WHEN xml_feed_id = ? THEN 0 ELSE 1 END
            LIMIT 1
        `);

        const grouped = new Map();
        for (const product of products) {
            const mapping = getUploadCategoryMapping.get(dealerId, product.category, product.xml_feed_id || null, product.xml_feed_id || null);
            const categoryId = product.xml_category_id || mapping?.trendyol_category_id || null;
            const categoryName = mapping?.trendyol_category_name || '';
            const key = `${product.category || ''}__${product.xml_feed_id || 'null'}__${categoryId || 0}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    source_category: product.category,
                    xml_feed_id: product.xml_feed_id || null,
                    trendyol_category_id: categoryId,
                    trendyol_category_name: categoryName,
                    product_count: 0,
                    attribute_values: (() => {
                        try { return JSON.parse(mapping?.attribute_values || '{}'); } catch (e) { return {}; }
                    })()
                });
            }
            grouped.get(key).product_count += 1;
        }

        const missingCategories = [];
        for (const row of grouped.values()) {
            if (!row.trendyol_category_id) {
                missingCategories.push({
                    source_category: row.source_category,
                    xml_feed_id: row.xml_feed_id,
                    trendyol_category_id: null,
                    trendyol_category_name: '',
                    product_count: row.product_count,
                    missing_attributes: ['Trendyol kategorisi eşlenmemiş']
                });
                continue;
            }

            const attrs = await fetchTrendyolCategoryAttributes(dealerId, row.trendyol_category_id, preferredStoreId);
            const missing = attrs
                .filter(attr => attr.required)
                .filter(attr => String(row.attribute_values?.[attr.id] || '').trim() === '')
                .map(attr => attr.name)
                .filter(Boolean);

            if (missing.length) {
                missingCategories.push({
                    source_category: row.source_category,
                    xml_feed_id: row.xml_feed_id,
                    trendyol_category_id: row.trendyol_category_id,
                    trendyol_category_name: row.trendyol_category_name,
                    product_count: row.product_count,
                    missing_attributes: missing
                });
            }
        }

        res.json({
            ok: true,
            ready: missingCategories.length === 0,
            totalProducts: products.length,
            missingCount: missingCategories.length,
            missingCategories: missingCategories.slice(0, 100)
        });
    } catch (e) {
        res.status(500).json({ error: e.response?.data?.message || e.message });
    }
});

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

app.post('/api/dealer/xml-feeds/:id/import', authMiddleware, async (req, res) => {
    try {
        const result = await importXmlFeedById(req.dealer.id, req.params.id);
        res.json(result);
    } catch (e) {
        addLog('error', `XML import hatası: ${e.message}`, req.dealer.id);
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════════════════
// ÜRÜN YÖNETİMİ (BAYİ'YE AİT)
// ══════════════════════════════════════════════════════════════

app.get('/api/dealer/products', authMiddleware, (req, res) => {
    const { page = 1, limit = 50, search = '', supplier = '' } = req.query;
    const dealerId = req.dealer.id;
    cleanupOrphanDealerProducts(dealerId);
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

app.post('/api/dealer/products/sync-trendyol', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const { store_id } = req.body;

    try {
        const store = getPreferredStoreOrDealer(dealerId, store_id || null);
        if (!store?.supplier_id || !store?.api_key || !store?.api_secret) {
            return res.status(400).json({ error: 'Mağazaya ait Trendyol API bilgileri eksik.' });
        }

        const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
        const collected = [];
        const pageSize = 200;

        for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
            const response = await axios.get(
                `https://apigw.trendyol.com/integration/product/sellers/${store.supplier_id}/products?page=${pageIndex}&size=${pageSize}`,
                {
                    timeout: 30000,
                    headers: {
                        'Authorization': `Basic ${authString}`,
                        'Content-Type': 'application/json',
                        'User-Agent': `${store.supplier_id} - SelfIntegration`
                    }
                }
            );

            const content = response.data?.content || response.data?.products || [];
            if (!content.length) break;
            collected.push(...content);
            if (content.length < pageSize) break;
        }

        const upsertProduct = db.prepare(`
            INSERT INTO dealer_products (
                dealer_id, barcode, title, category, stock, critical_stock_level, last_remote_stock, last_stock_sync_at, sale_price, image_url, supplier_name, trendyol_status, updated_at
            ) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT critical_stock_level FROM dealer_products WHERE dealer_id = ? AND barcode = ?), 5), ?, datetime('now'), ?, ?, ?, 'synced', datetime('now'))
            ON CONFLICT(dealer_id, barcode) DO UPDATE SET
                title = excluded.title,
                category = COALESCE(NULLIF(excluded.category, ''), dealer_products.category),
                stock = excluded.stock,
                last_remote_stock = excluded.last_remote_stock,
                last_stock_sync_at = datetime('now'),
                sale_price = CASE WHEN excluded.sale_price > 0 THEN excluded.sale_price ELSE dealer_products.sale_price END,
                image_url = COALESCE(NULLIF(excluded.image_url, ''), dealer_products.image_url),
                supplier_name = COALESCE(NULLIF(excluded.supplier_name, ''), dealer_products.supplier_name),
                trendyol_status = 'synced',
                updated_at = datetime('now')
        `);

        const tx = db.transaction((items) => {
            for (const item of items) {
                const barcode = String(item.barcode || item.productMainId || item.stockCode || '').trim();
                if (!barcode) continue;
                upsertProduct.run(
                    dealerId,
                    barcode,
                    String(item.title || item.productMainId || barcode).substring(0, 200),
                    String(item.categoryName || item.categoryId || '').trim(),
                    parseInt(item.quantity ?? item.stock ?? 0, 10) || 0,
                    dealerId,
                    barcode,
                    parseInt(item.quantity ?? item.stock ?? 0, 10) || 0,
                    Number(item.salePrice || item.listPrice || 0),
                    item.images?.[0]?.url || '',
                    'Trendyol'
                );
            }
        });
        tx(collected);

        await checkCriticalStockAndNotify(dealerId, collected.map(item => item.barcode || item.productMainId || item.stockCode));
        addLog('success', `Trendyol ürün/stok senkronizasyonu tamamlandı: ${collected.length} ürün`, dealerId);
        res.json({ ok: true, synced: collected.length });
    } catch (e) {
        addLog('error', `Trendyol ürün sync hatası: ${e.message}`, dealerId);
        res.status(500).json({ error: e.response?.data?.message || e.message });
    }
});

app.post('/api/dealer/products/push-stock-trendyol', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const result = await pushDealerStocksToTrendyol(dealerId, req.body.store_id || null, req.body.only_changed !== false);
        res.json({ ok: true, ...result });
    } catch (e) {
        res.status(500).json({ error: e.response?.data?.message || e.message });
    }
});

app.post('/api/dealer/products/check-critical-stock', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const result = await checkCriticalStockAndNotify(dealerId);
        res.json({ ok: true, ...result });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/dealer/products/:barcode/stock', authMiddleware, async (req, res) => {
    const { stock } = req.body;
    const dealerId = req.dealer.id;
    try {
        db.prepare("UPDATE dealer_products SET stock = ?, updated_at = datetime('now') WHERE barcode = ? AND dealer_id = ?")
            .run(parseInt(stock), req.params.barcode, dealerId);
        await checkCriticalStockAndNotify(dealerId, [req.params.barcode]);
        if (String(process.env.AUTO_PUSH_TRENDYOL_STOCK || '').toLowerCase() === 'true') {
            await pushDealerStocksToTrendyol(dealerId, null, true);
        }
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Toplu stok güncelleme
app.post('/api/dealer/products/bulk-stock', authMiddleware, async (req, res) => {
    const items = req.body; // [{barcode, stock}]
    const dealerId = req.dealer.id;
    const updateStmt = db.prepare("UPDATE dealer_products SET stock = ?, updated_at = datetime('now') WHERE barcode = ? AND dealer_id = ?");
    const updateMany = db.transaction((list) => {
        for (const item of list) updateStmt.run(parseInt(item.stock), item.barcode, dealerId);
    });
    try {
        updateMany(items);
        await checkCriticalStockAndNotify(dealerId, items.map(item => item.barcode));
        if (String(process.env.AUTO_PUSH_TRENDYOL_STOCK || '').toLowerCase() === 'true') {
            await pushDealerStocksToTrendyol(dealerId, null, true);
        }
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
    const dealerId = req.dealer.id;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '12', 10)));
    const offset = (page - 1) * limit;

    // Filtering
    const status = (req.query.status || '').trim();
    const type = (req.query.type || '').trim();          // sale | refund
    const search = (req.query.search || '').trim();
    const dateFrom = (req.query.date_from || '').trim();
    const dateTo = (req.query.date_to || '').trim();

    // Sorting
    const allowedSorts = ['order_number', 'order_date', 'total_price', 'net_price', 'status', 'customer_name', 'product_count'];
    const sortCol = allowedSorts.includes(req.query.sort) ? req.query.sort : 'order_date';
    const sortDir = req.query.dir === 'asc' ? 'ASC' : 'DESC';

    // Build WHERE clauses
    const conditions = ['dealer_id = ?'];
    const params = [dealerId];

    if (status) {
        conditions.push('status = ?');
        params.push(status);
    }
    if (type === 'sale') {
        conditions.push('is_refund = 0');
    } else if (type === 'refund') {
        conditions.push('is_refund = 1');
    }
    if (search) {
        conditions.push("(order_number LIKE ? OR customer_name LIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
    }
    if (dateFrom) {
        conditions.push("date(order_date) >= date(?)");
        params.push(dateFrom);
    }
    if (dateTo) {
        conditions.push("date(order_date) <= date(?)");
        params.push(dateTo);
    }

    const where = conditions.join(' AND ');

    const total = db.prepare(`SELECT COUNT(*) as c FROM orders WHERE ${where}`).get(...params).c;
    const orders = db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`).all(...params, limit, offset);

    // Aggregate stats (unfiltered for this dealer)
    const stats = db.prepare(`
        SELECT
            COUNT(*) as totalOrders,
            COALESCE(SUM(total_price), 0) as totalRevenue,
            COALESCE(SUM(net_price), 0) as netRevenue,
            SUM(CASE WHEN status = 'Picking' THEN 1 ELSE 0 END) as pickingCount
        FROM orders WHERE dealer_id = ? AND is_refund = 0
    `).get(dealerId);

    // Last sync time
    const lastSync = db.prepare("SELECT MAX(created_at) as t FROM logs WHERE dealer_id = ? AND message LIKE '%sipariş senkronize%'").get(dealerId);

    res.json({
        orders,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        stats: {
            totalOrders: stats.totalOrders || 0,
            totalRevenue: Number((stats.totalRevenue || 0).toFixed(2)),
            netRevenue: Number((stats.netRevenue || 0).toFixed(2)),
            pickingCount: stats.pickingCount || 0,
            lastSyncAt: lastSync?.t || null
        }
    });
});

app.use('/api/orders', authMiddleware, orderDetailRouter);
app.use('/api/questions', authMiddleware, questionsRouter);
app.use('/api/forecast', authMiddleware, forecastRouter);
app.use('/api/analytics', authMiddleware, analyticsRouter);

// ── BAYI AYARLARI ──────────────────────────────────────────────
app.get('/api/dealer/settings', authMiddleware, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM dealer_settings WHERE dealer_id = ?').all(req.dealer.id);
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
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

app.get('/api/dealer/orders/:orderNumber', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    const order = db.prepare('SELECT * FROM orders WHERE dealer_id = ? AND order_number = ?').get(dealerId, req.params.orderNumber);
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });

    let lines = [];
    try { lines = JSON.parse(order.lines_json || '[]'); } catch (e) { lines = []; }

    const getLocalStock = db.prepare('SELECT stock, image_url, title FROM dealer_products WHERE dealer_id = ? AND barcode = ? LIMIT 1');
    lines = lines.map(line => {
        const local = line.barcode ? getLocalStock.get(dealerId, line.barcode) : null;
        return {
            ...line,
            local_stock: local?.stock ?? line.local_stock ?? null,
            image_url: line.image_url || local?.image_url || '',
            title: line.title || local?.title || ''
        };
    });

    res.json({ ...order, lines });
});

// Trendyol'dan sipariş çek
/* app.post('/api/dealer/orders/sync', authMiddleware, async (req, res) => {
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
}); */

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

function normalizeCategoryText(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .trim()
        .toLocaleLowerCase('tr-TR')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s/|-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const NORMALIZED_TRENDYOL_CATEGORY_NAME_MAP = Object.fromEntries(
    Object.entries(TRENDYOL_CATEGORY_NAME_MAP).map(([name, id]) => [normalizeCategoryText(name), id])
);

function getXmlCategoryCandidates(product) {
    const candidateFields = [
        product?.sub_category,
        product?.SubCategory,
        product?.subcategory,
        product?.subCategory,
        product?.top_category,
        product?.TopCategory,
        product?.topcategory,
        product?.topCategory,
        product?.category,
        product?.Category,
        product?.kategori,
        product?.Kategori,
        product?.category_name,
        product?.categoryName,
        product?.product_category,
        product?.productCategory,
        product?.department,
        product?.Department,
        product?.product_type,
        product?.productType,
        product?.group,
        product?.Group
    ];

    return [...new Set(
        candidateFields
            .flatMap((value) => typeof value === 'string' ? value.split(/>|\/|\|/g) : [])
            .map((value) => String(value || '').replace(/<[^>]+>/g, ' ').trim())
            .filter(Boolean)
    )];
}

function tokenizeNormalizedText(value) {
    return normalizeCategoryText(value)
        .split(' ')
        .map(s => s.trim())
        .filter(s => s && s.length > 1);
}

function scoreCategoryMatch(sourceCategory, trendyolCategoryName) {
    const source = normalizeCategoryText(sourceCategory);
    const target = normalizeCategoryText(trendyolCategoryName);
    if (!source || !target) return 0;
    if (source === target) return 100;
    if (source.includes(target) || target.includes(source)) return 92;

    const sourceTokens = tokenizeNormalizedText(source);
    const targetTokens = tokenizeNormalizedText(target);
    if (!sourceTokens.length || !targetTokens.length) return 0;

    let score = 0;
    for (const token of sourceTokens) {
        if (targetTokens.includes(token)) score += 18;
        else if (target.includes(token)) score += 10;
    }
    for (const token of targetTokens) {
        if (sourceTokens.includes(token)) score += 6;
    }

    return score;
}

function suggestTrendyolCategory(sourceCategory, categories) {
    const directCategoryId = getTrendyolCategoryByName(sourceCategory);
    if (directCategoryId) {
        const directMatch = categories.find(c => c.id === directCategoryId);
        if (directMatch) {
            return { category: directMatch, score: 100, method: 'rule' };
        }
    }

    let best = null;
    for (const category of categories) {
        const score = scoreCategoryMatch(sourceCategory, category.name);
        if (!best || score > best.score) best = { category, score, method: 'similarity' };
    }

    return best && best.score >= 24 ? best : null;
}

function getTrendyolCategoryByName(...categoryNames) {
    for (const rawName of categoryNames.flat().filter(Boolean)) {
        const normalized = normalizeCategoryText(rawName);
        if (!normalized) continue;

        if (NORMALIZED_TRENDYOL_CATEGORY_NAME_MAP[normalized]) {
            return NORMALIZED_TRENDYOL_CATEGORY_NAME_MAP[normalized];
        }

        if (normalized.includes('banyo seti') || normalized.includes('banyo set')) return 1830;
        if (normalized.includes('banyo duzen')) return 1828;
        if (normalized.includes('banyo raf')) return 1827;
        if (normalized.includes('banyo aksesuar')) return 4898;
        if (normalized.includes('cop')) return 2188;
        if (normalized.includes('tuvalet fircasi')) return 1830;
        if (normalized.includes('mutfak saklama') || normalized.includes('saklama kabi')) return 2188;
        if (normalized.includes('mutfak duzenleyici') || normalized.includes('organizer')) return 4458;
        if (normalized.includes('supurge')) return 873;
        if (normalized.includes('kulaklik')) return normalized.includes('oyuncu') ? 2700 : 1058;
        if (normalized.includes('akilli saat') || normalized.includes('smartwatch')) return 1890;
        if (normalized.includes('nemlendirici')) return 3013;
        if (normalized.includes('epilator')) return 867;
        if (normalized.includes('masaj tabancasi')) return 4675;
        if (normalized.includes('masaj yastigi')) return 4610;
        if (normalized.includes('masaj')) return 3550;
        if (normalized.includes('fener')) return 2060;
        if (normalized.includes('yastik')) return 1850;
        if (normalized.includes('yagmurluk')) return 541;
        if (normalized.includes('spor malzemesi')) return 827;
        if (normalized.includes('sporcu aksesuari')) return 826;
        if (normalized.includes('pil')) return 1841;
        if (normalized.includes('sarj kablosu') || normalized.includes('kablo')) return 5504;
        if (normalized.includes('sarj cihazi')) return 5499;
        if (normalized.includes('powerbank')) return 771;
        if (normalized.includes('telefon tutucu')) return 1056;
        if (normalized.includes('arac ici kamera')) return 1949;
        if (normalized.includes('arka gorus')) return 1952;
        if (normalized.includes('banyo')) return 4898;
        if (normalized.includes('mutfak')) return 2188;
    }
    // Önce alt kategori adına bak
    return null;
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
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            const updateTrendyolStatus = db.prepare("UPDATE dealer_products SET trendyol_status = ?, updated_at = datetime('now') WHERE dealer_id = ? AND barcode = ?");
            const getUploadCategoryMapping = db.prepare(`
                SELECT trendyol_category_id, attribute_values
                FROM category_mappings
                WHERE dealer_id = ? AND source_category = ? AND (xml_feed_id = ? OR xml_feed_id IS NULL)
                ORDER BY CASE WHEN xml_feed_id = ? THEN 0 ELSE 1 END
                LIMIT 1
            `);
            const defaultAttributes = [
                { attributeId: 1192, attributeValueId: 10633874 },
                { attributeId: 47, customAttributeValue: 'Çok Renkli' },
                { attributeId: 348, attributeValueId: 686230 }
            ];

            async function fetchBatchResult(batchRequestId) {
                const batchUrl = `https://apigw.trendyol.com/integration/product/sellers/${store.supplier_id}/products/batch-requests/${batchRequestId}`;

                for (let attempt = 1; attempt <= 8; attempt++) {
                    await sleep(4000);

                    const batchRes = await axios.get(batchUrl, {
                        headers: {
                            'Authorization': `Basic ${authString}`,
                            'User-Agent': `${store.supplier_id} - SelfIntegration`
                        }
                    });

                    const batchData = batchRes.data || {};
                    if (batchData.status === 'COMPLETED' || batchData.status === 'FAILED') {
                        return batchData;
                    }
                }

                return null;
            }

            let totalSucceeded = 0;
            let totalFailed = 0;
            let totalQueued = 0;

            for (let i = 0; i < products.length; i += BATCH_SIZE) {
                const batch = products.slice(i, i + BATCH_SIZE)
                    .filter(p => p.barcode && p.barcode.length >= 2 && p.barcode.length <= 40);

                if (!batch.length) continue;
                totalQueued += batch.length;

                const items = batch.map(p => {
                    const rawUrls = (p.image_url || '').split(',').map(u => u.trim()).filter(u => isValidImageUrl(u));
                    const imageUrls = rawUrls.length > 0 ? rawUrls.slice(0, 8) : [PLACEHOLDER_IMAGE];
                    const savedMapping = getUploadCategoryMapping.get(dealerId, p.category, p.xml_feed_id || null, p.xml_feed_id || null);
                    let mappedAttributes = [];
                    try {
                        const attrMap = JSON.parse(savedMapping?.attribute_values || '{}');
                        mappedAttributes = Object.entries(attrMap).map(([attributeId, rawValue]) => {
                            const strValue = String(rawValue ?? '').trim();
                            const numericValue = Number(strValue);
                            return Number.isFinite(numericValue) && strValue !== ''
                                ? { attributeId: Number(attributeId), attributeValueId: numericValue }
                                : { attributeId: Number(attributeId), customAttributeValue: strValue };
                        }).filter(a => a.attributeId);
                    } catch (e) { }

                    const mergedAttributes = [...defaultAttributes];
                    for (const attr of mappedAttributes) {
                        const idx = mergedAttributes.findIndex(a => a.attributeId === attr.attributeId);
                        if (idx >= 0) mergedAttributes[idx] = attr;
                        else mergedAttributes.push(attr);
                    }
                    // Önce XML'den gelen kategori ID'yi kullan, yoksa keyword eşleştirmeye düş
                    const finalCategoryId =
                        (p.xml_category_id && p.xml_category_id > 0)
                            ? p.xml_category_id
                            : (savedMapping?.trendyol_category_id || getTrendyolCategoryByName(p.category, p.title) || getCategoryId(`${p.category || ''} ${p.title || ''}`));
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
                        attributes: mergedAttributes /*
                            { attributeId: 47, customAttributeValue: 'Çok Renkli' },
                        ] */,
                    };
                });

                try {
                    const uploadRes = await axios.post(API_URL, { items }, {
                        headers: {
                            'Authorization': `Basic ${authString}`,
                            'Content-Type': 'application/json',
                            'User-Agent': `${store.supplier_id} - SelfIntegration`
                        }
                    });
                    const batchNo = Math.floor(i / BATCH_SIZE) + 1;
                    const batchRequestId = uploadRes.data?.batchRequestId;

                    if (!batchRequestId) {
                        totalFailed += batch.length;
                        for (const product of batch) updateTrendyolStatus.run('batch_id_missing', dealerId, product.barcode);
                        addLog('error', `Batch ${batchNo}: Trendyol batchRequestId döndürmedi`, dealerId);
                        continue;
                    }

                    addLog('info', `Batch ${batchNo}: istek kabul edildi, batchRequestId=${batchRequestId}`, dealerId);

                    const batchResult = await fetchBatchResult(batchRequestId);
                    if (!batchResult) {
                        for (const product of batch) updateTrendyolStatus.run('processing', dealerId, product.barcode);
                        addLog('info', `Batch ${batchNo}: Trendyol sonucu henüz tamamlanmadı (batchRequestId=${batchRequestId})`, dealerId);
                        continue;
                    }

                    let batchSucceeded = 0;
                    let batchFailed = 0;

                    for (const resultItem of batchResult.items || []) {
                        const barcode = resultItem?.requestItem?.barcode || resultItem?.requestItem?.product?.barcode;
                        const status = resultItem?.status || 'UNKNOWN';
                        const failureReasons = Array.isArray(resultItem?.failureReasons) ? resultItem.failureReasons : [];

                        if (!barcode) continue;

                        if (status === 'SUCCESS') {
                            batchSucceeded += 1;
                            updateTrendyolStatus.run('uploaded', dealerId, barcode);
                        } else {
                            batchFailed += 1;
                            updateTrendyolStatus.run('failed', dealerId, barcode);
                            const shortReason = failureReasons.join(' | ').substring(0, 400) || 'Bilinmeyen hata';
                            addLog('error', `Batch ${batchNo} ürün hatası [${barcode}]: ${shortReason}`, dealerId);
                        }
                    }

                    totalSucceeded += batchSucceeded;
                    totalFailed += batchFailed;
                    addLog(
                        batchFailed > 0 ? 'error' : 'success',
                        `Batch ${batchNo} doğrulandı: başarılı=${batchSucceeded}, hatalı=${batchFailed}, batchRequestId=${batchRequestId}`,
                        dealerId
                    );
                    addLog('info', `Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} ürün gönderildi`, dealerId);
                } catch (err) {
                    const errorDetail = err.response?.data ? JSON.stringify(err.response.data).substring(0, 500) : err.message;
                    totalFailed += batch.length;
                    for (const product of batch) updateTrendyolStatus.run('failed', dealerId, product.barcode);
                    addLog('error', `Trendyol upload batch hatası (${err.message}): ${errorDetail}`, dealerId);
                }
                await sleep(2000);
            }
            addLog('success', `Trendyol yükleme tamamlandı: ${products.length} ürün`, dealerId);
            const finalLevel = totalFailed > 0 ? 'error' : 'success';
            addLog(finalLevel, `Trendyol yükleme özeti: kuyruğa alınan=${totalQueued}, başarılı=${totalSucceeded}, hatalı=${totalFailed}`, dealerId);
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

startQuestionsCron();
startOrdersCron(syncDealerOrders);

app.listen(PORT, () => {
    console.log(`✅ Sunucu http://localhost:${PORT} üzerinde çalışıyor.`);
    console.log(`📦 Admin Panel: http://localhost:${PORT}/admin (Şifre: ${ADMIN_PASSWORD})`);
});
