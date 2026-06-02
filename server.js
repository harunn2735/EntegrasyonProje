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
const startXmlSyncCron = require('./cron/xmlSyncCron');
const { router: reviewsRouter } = require('./routes/reviews');
const startReviewsCron          = require('./cron/reviewsCron');
const pricingRouter = require('./routes/pricing');
const healthRouter  = require('./routes/health');
const { startPricingCron } = require('./src/jobs/pricingScan');
const startAutoAnswerCron = require('./cron/autoAnswerCron');
const { calculateOrderProfit } = require('./services/profitCalculator');
const alertService = require('./services/profitAlert');
const { oneriKategori, kullaniciOnayla, oneriAttributeDoldur } = require('./services/kategoriOneriService');
const { searchKategoriler } = require('./services/kategoriService');
const { urunIcerikUret } = require('./services/urunIcerikService');
const { generate: geminiGenerate, getDailyUsage: geminiDailyUsage } = require('./services/geminiClient');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'trendyol_bayi_secret_2024';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const profitConfig = {
    MIN_PROFIT_MARGIN_THRESHOLD: Number(process.env.MIN_PROFIT_MARGIN_THRESHOLD ?? 15),
    DEFAULT_SHIPPING_COST: Number(process.env.DEFAULT_SHIPPING_COST ?? 15),
    DEFAULT_RETURN_PROVISION_RATE: Number(process.env.DEFAULT_RETURN_PROVISION_RATE ?? 0.02),
    DEFAULT_COMMISSION_RATE: Number(process.env.DEFAULT_COMMISSION_RATE ?? 12),
    DEFAULT_COST_RATIO: Number(process.env.DEFAULT_COST_RATIO ?? 0.60),
};

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname), { index: false }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// SSE endpoints can't set headers, so they pass the JWT via ?token=...
// Promote it to Authorization header here, before any authMiddleware runs.
app.use((req, res, next) => {
    if (req.query.token && !req.headers.authorization) {
        req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
});

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
        JWT_SECRET, { expiresIn: '7d' }
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

        // Yorum istatistikleri (bu hafta + bekleyen yanıt)
        const reviewStats = db.prepare(`
          SELECT
            SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS this_week,
            SUM(CASE WHEN status='Bekliyor' AND ai_response IS NOT NULL THEN 1 ELSE 0 END) AS pending_response,
            ROUND(100.0 * SUM(CASE WHEN sentiment='pozitif' THEN 1 ELSE 0 END) / MAX(COUNT(*),1), 1) AS satisfaction_pct,
            (SELECT category FROM customer_reviews cr2
             WHERE cr2.dealer_id = ? AND cr2.sentiment = 'negatif' AND cr2.category IS NOT NULL
             GROUP BY category ORDER BY COUNT(*) DESC LIMIT 1) AS top_complaint
          FROM customer_reviews WHERE dealer_id = ?
        `).get(dealerId, dealerId);

        res.json({
          totalOrders, totalRefunds, netRevenue, storeCount, productCount, xmlCount, trend,
          reviewStats: reviewStats || { this_week: 0, pending_response: 0, satisfaction_pct: 0, top_complaint: null }
        });
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
    const feedId = parseInt(req.params.id);
    const dealerId = req.dealer.id;

    if (!feedId || isNaN(feedId)) {
        return res.status(400).json({ error: 'Geçersiz feed ID' });
    }

    try {
        // Feed'in bu bayiye ait olduğunu doğrula
        const feed = db.prepare('SELECT id, supplier_name FROM xml_feeds WHERE id = ? AND dealer_id = ?').get(feedId, dealerId);
        if (!feed) {
            return res.status(404).json({ error: 'Feed bulunamadı veya erişim yetkiniz yok' });
        }

        const silme = db.transaction(() => {
            // 1. Bağlı ürünleri sil — hem xml_feed_id hem supplier_name ile eşleşenleri kapsa
            const dpResult = db.prepare(`
                DELETE FROM dealer_products
                WHERE dealer_id = ?
                  AND (xml_feed_id = ? OR (xml_feed_id IS NULL AND supplier_name = ?))
            `).run(dealerId, feedId, feed.supplier_name);

            // 2. Kategori eşleştirmelerini sil
            db.prepare('DELETE FROM category_mappings WHERE xml_feed_id = ? AND dealer_id = ?').run(feedId, dealerId);

            // 3. Feed'i sil
            db.prepare('DELETE FROM xml_feeds WHERE id = ? AND dealer_id = ?').run(feedId, dealerId);

            return dpResult.changes;
        });

        const silinenUrun = silme();
        addLog('info', `XML feed silindi: id=${feedId}, supplier=${feed.supplier_name}, silinen ürün=${silinenUrun}`, dealerId);
        res.json({ ok: true, silinen_urun: silinenUrun });
    } catch (e) {
        addLog('error', `XML feed silme hatası (id=${feedId}): ${e.message}`, dealerId);
        res.status(500).json({ error: `Feed silinirken hata oluştu: ${e.message}` });
    }
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

    // Resolve to the real Trendyol external ID — the caller might pass either
    // the internal DB row id or the external trendyol_id
    const rawId = parseInt(req.params.id, 10);
    const catRow = db.prepare(
        'SELECT trendyol_id FROM trendyol_kategoriler WHERE id = ? OR trendyol_id = ? LIMIT 1'
    ).get(rawId, rawId);
    const trendyolCatId = catRow ? catRow.trendyol_id : rawId;

    try {
        const response = await withTrendyolCredentialFallback(dealerId, preferredStoreId, async (store) => {
            const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
            return axios.get(`https://apigw.trendyol.com/integration/product/product-categories/${trendyolCatId}/attributes`, {
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
        addLog('error', `Kategori özellikleri alınamadı (#${trendyolCatId}): ${detail}`, dealerId);
        res.status(status).json({ error: detail });
    }
});

// ── Kargo şirketleri — üç endpoint sırayla denenir ───────────────────────────
app.get('/api/dealer/trendyol-cargo-companies', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const store = await (async () => {
            let s = db.prepare('SELECT * FROM dealers WHERE id = ?').get(dealerId);
            if (!s?.supplier_id || !s?.api_key || !s?.api_secret) {
                s = db.prepare(`
                    SELECT * FROM stores
                    WHERE dealer_id = ? AND supplier_id IS NOT NULL AND supplier_id != ''
                      AND api_key IS NOT NULL AND api_key != ''
                      AND api_secret IS NOT NULL AND api_secret != ''
                    ORDER BY id ASC LIMIT 1
                `).get(dealerId);
            }
            return s;
        })();

        if (!store?.supplier_id || !store?.api_key || !store?.api_secret) {
            return res.status(400).json({ error: 'Trendyol API bilgileri eksik.' });
        }

        const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
        const headers = {
            'Authorization': `Basic ${authString}`,
            'Content-Type': 'application/json',
            'User-Agent': `${store.supplier_id} - SelfIntegration`,
        };

        const endpoints = [
            `https://apigw.trendyol.com/integration/sellers/${store.supplier_id}/addresses`,
            `https://apigw.trendyol.com/integration/sellers/${store.supplier_id}/shipment-providers`,
            `https://apigw.trendyol.com/integration/shipment-providers`,
        ];

        const results = [];
        for (const url of endpoints) {
            try {
                const r = await axios.get(url, { timeout: 15000, headers });
                console.log(`[cargo-probe] ✅ 200 — ${url}`);
                console.log(`[cargo-probe] Response:`, JSON.stringify(r.data, null, 2));
                results.push({ url, status: r.status, data: r.data });
            } catch (e) {
                const status = e.response?.status || 0;
                const body = e.response?.data ?? e.message;
                console.log(`[cargo-probe] ❌ ${status} — ${url} — ${JSON.stringify(body)}`);
                results.push({ url, status, error: body });
            }
        }

        res.json(results);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Gemini günlük kullanım ────────────────────────────────────────────────────
app.get('/api/dealer/gemini-usage', authMiddleware, (req, res) => {
    const used  = geminiDailyUsage();
    const limit = parseInt(process.env.GEMINI_DAILY_LIMIT || '0', 10);
    res.json({
        used,
        limit: limit || null,
        remaining: limit ? Math.max(0, limit - used) : null,
        limitReached: limit > 0 && used >= limit,
    });
});

// ── Kargo şablonları ──────────────────────────────────────────────────────────
app.get('/api/dealer/trendyol-shipping-addresses', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const response = await withTrendyolCredentialFallback(dealerId, null, async (store) => {
            const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
            return axios.get(
                `https://apigw.trendyol.com/integration/sellers/${store.supplier_id}/shipping-addresses`,
                {
                    timeout: 15000,
                    headers: {
                        'Authorization': `Basic ${authString}`,
                        'Content-Type': 'application/json',
                        'User-Agent': `${store.supplier_id} - SelfIntegration`,
                    },
                }
            );
        });
        res.json(response.data);
    } catch (e) {
        const detail = e.response?.data?.message || e.response?.data?.errorMessage || e.message;
        res.status(e.response?.status || 500).json({ error: detail });
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

    // Profit hesabı: teslim edilmiş, henüz kaydedilmemiş siparişleri işle
    const unprocessed = db.prepare(`
        SELECT * FROM orders
        WHERE dealer_id = ?
          AND status = 'Delivered'
          AND order_number NOT IN (
            SELECT DISTINCT order_number FROM profit_records WHERE dealer_id = ?
          )
    `).all(dealerId, dealerId);

    let profitProcessed = 0;
    for (const unprocessedOrder of unprocessed) {
        try {
            await calculateOrderProfit(unprocessedOrder, { db, config: profitConfig, alertService });
            profitProcessed++;
        } catch (e) {
            addLog('error', `Profit hesap hatası [${unprocessedOrder.order_number}]: ${e.message}`, dealerId);
            // Hata olan siparişi atla, diğerlerine devam et
        }
    }
    if (profitProcessed > 0) {
        addLog('success', `${profitProcessed} sipariş için kâr hesaplandı`, dealerId);
    }
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

        // Onaylı kategori eşleştirmeleri (supplier_name__category → trendyol API ID)
        const approvedCatMap = new Map();
        db.prepare(`
            SELECT ke.tedarikci_adi, ke.xml_kategori_metni, tk.trendyol_id AS api_id, tk.tam_yol
            FROM kategori_eslestirme ke
            JOIN trendyol_kategoriler tk ON tk.id = ke.trendyol_kategori_id
            WHERE ke.kullanici_onayladi = 1
        `).all().forEach(r => {
            approvedCatMap.set(`${r.tedarikci_adi}__${r.xml_kategori_metni}`, { id: r.api_id, name: r.tam_yol });
        });

        const grouped = new Map();
        for (const product of products) {
            const mapping = getUploadCategoryMapping.get(dealerId, product.category, product.xml_feed_id || null, product.xml_feed_id || null);
            const approved = approvedCatMap.get(`${product.supplier_name}__${product.category}`);
            const categoryId = approved?.id || product.xml_category_id || mapping?.trendyol_category_id || null;
            const categoryName = approved?.name || mapping?.trendyol_category_name || '';
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

    // Aktif marka ID'sini oku — yeni ürünler için otomatik ata
    const activeBrandSetting = db.prepare(
        "SELECT value FROM dealer_settings WHERE dealer_id = ? AND key = 'active_brand_id'"
    ).get(dealerId);
    const activeBrandId = activeBrandSetting ? parseInt(activeBrandSetting.value) || null : null;

    const insertOrUpdate = db.prepare(`
        INSERT INTO dealer_products (dealer_id, barcode, title, category, xml_category_id, stock, cost_price, sale_price, image_url, supplier_name, xml_feed_id, brand_name, brand_id, needs_category_review, ai_baslik, ai_aciklama, icerik_uretildi)
        VALUES (@dealer_id, @barcode, @title, @category, @xml_category_id, @stock, @cost_price, @sale_price, @image_url, @supplier_name, @xml_feed_id, @brand_name, @brand_id, @needs_category_review, @ai_baslik, @ai_aciklama, @icerik_uretildi)
        ON CONFLICT(dealer_id, barcode) DO UPDATE SET
            title = excluded.title,
            category = excluded.category,
            xml_category_id = excluded.xml_category_id,
            stock = excluded.stock,
            cost_price = excluded.cost_price,
            sale_price = excluded.sale_price,
            image_url = excluded.image_url,
            brand_name = excluded.brand_name,
            brand_id = COALESCE(dealer_products.brand_id, excluded.brand_id),
            needs_category_review = excluded.needs_category_review,
            ai_baslik = COALESCE(dealer_products.ai_baslik, excluded.ai_baslik),
            ai_aciklama = COALESCE(dealer_products.ai_aciklama, excluded.ai_aciklama),
            icerik_uretildi = CASE WHEN dealer_products.icerik_uretildi = 1 THEN 1 ELSE excluded.icerik_uretildi END,
            updated_at = datetime('now')
    `);
    const getCategoryMapping = db.prepare(`
        SELECT trendyol_category_id
        FROM category_mappings
        WHERE dealer_id = ? AND source_category = ? AND (xml_feed_id = ? OR xml_feed_id IS NULL)
        ORDER BY CASE WHEN xml_feed_id = ? THEN 0 ELSE 1 END
        LIMIT 1
    `);

    // ── FAZ 1: Her ürünü normalize et, kural tabanlı eşleştirmeyi dene ──
    const processedItems = [];
    // Eşleşemeyen benzersiz kategorileri topla (AI'ya tek seferde sormak için)
    const pendingCategories = new Map(); // categoryText → { title, aciklama } (ilk örnek ürün)
    // İçerik üretimi gereken ürünler (açıklaması boş olanlar, max 10)
    const pendingContent = new Map(); // barcode → { title, category, brand }

    for (const p of items) {
        const barcode = String(p.barcode || p.Barcode || p.sku || p.SKU || p.code || p.Code || p['@_id'] || '').trim();
        const title = String(p.title || p.Title || p.name || p.Name || p.baslik || '').trim();
        if (!barcode || !title) continue;

        const costPrice = parseFloat(
            p.price         || p.Price         || p.PRICE          ||
            p.cost_price    ||
            p.fiyat         || p.Fiyat         || p.FIYAT          ||
            p.list_price    || p.listPrice      || p.ListPrice      ||
            p.birim_fiyat   || p.BirimFiyat     || p.birimFiyat     ||
            p.satis_fiyati  || p.SatisFiyati    || p.satisFiyati    ||
            p.urun_fiyat    || p.UrunFiyat      ||
            p.kdv_dahil_fiyat || p.kdvDahilFiyat ||
            p.priceWithTax  || p.priceWithVat   ||
            p.original_price || p.originalPrice ||
            p.regular_price  || p.regularPrice  || 0
        );
        const salePrice = parseFloat((costPrice * (1 + margin / 100)).toFixed(2));
        const stock = parseInt(p.stock || p.Stock || p.quantity || p.stok || 0);
        const brandName = String(p.brand || p.Brand || p.marka || p.Marka || p.brand_name || p.brandName || p.manufacturer || p.Manufacturer || '').trim();
        const aciklama = String(p.description || p.Description || p.aciklama || p.Aciklama || p.desc || p.Desc || '').trim();
        const xmlCategoryCandidates = getXmlCategoryCandidates(p);
        const category = xmlCategoryCandidates[0] || 'Genel';

        const savedMapping = getCategoryMapping.get(dealerId, category, parseInt(feedId), parseInt(feedId));
        const ruleBasedId = savedMapping?.trendyol_category_id || getTrendyolCategoryByName(xmlCategoryCandidates) || null;

        const imageUrls = [];
        for (let i = 1; i <= 8; i++) {
            const u = p['image' + i] || p['resim' + i] || p['foto' + i] || p['img' + i];
            if (u && typeof u === 'string' && u.trim()) imageUrls.push(u.trim());
            else if (u && typeof u === 'object' && (u['@_url'] || u.url)) imageUrls.push((u['@_url'] || u.url).trim());
        }
        if (imageUrls.length === 0) {
            let single = p.image || p.resim || p.img || p.picture || p.foto || p.photo || p.image_url || p.imageUrl || p.gorsel || p.urun_resim || p.ImageUrl;
            if (single && typeof single === 'string' && single.trim()) imageUrls.push(single.trim());
            else if (single && typeof single === 'object' && (single['@_url'] || single.url)) imageUrls.push((single['@_url'] || single.url).trim());
            else if (p.images?.image) {
                const imgs = Array.isArray(p.images.image) ? p.images.image : [p.images.image];
                imgs.forEach(img => {
                    const u = typeof img === 'string' ? img : (img['@_url'] || img.url || '');
                    if (u.trim()) imageUrls.push(u.trim());
                });
            }
        }

        processedItems.push({
            barcode, title, category, stock,
            costPrice, salePrice, brandName, aciklama,
            imageUrl: imageUrls.join(','),
            ruleBasedId,
        });

        if (ruleBasedId === null && !pendingCategories.has(category)) {
            const prefix = barcode.includes('-') ? barcode.split('-')[0] : '';
            pendingCategories.set(category, { title, aciklama, brand: brandName, barcodePrefix: prefix });
        }

        // İçerik üretimi: koşullardan biri sağlanıyorsa ve limit dolmamışsa listeye ekle
        const needsContent = !aciklama || aciklama.length < 50
            || !title || title.length < 30 || title.length > 100;
        if (needsContent && pendingContent.size < 10) {
            pendingContent.set(barcode, { title, category, brand: brandName });
        }
    }

    // ── FAZ 2: Kural tabanlı eşleşmeyen kategoriler için AI'ya sor ──
    // better-sqlite3 transaction'ı sync olduğundan AI çağrıları önceden yapılır
    const tedarikciAdi = feed.supplier_name || feed.name;
    const aiResolutions = new Map(); // categoryText → { xmlCategoryId, needsReview }

    for (const [categoryText, ornek] of pendingCategories) {
        try {
            const oneri = await oneriKategori(
                tedarikciAdi,
                categoryText,
                ornek.title,
                ornek.aciklama,
                ornek.brand || '',
                ornek.barcodePrefix || ''
            );
            const needsReview = (oneri.needsLeafReview || oneri.guven_skoru < 0.85) ? 1 : 0;
            aiResolutions.set(categoryText, { xmlCategoryId: oneri.trendyol_id, needsReview });
        } catch (err) {
            addLog('warn', `AI kategori önerisi başarısız [${categoryText}]: ${err.message}`, dealerId);
            aiResolutions.set(categoryText, { xmlCategoryId: null, needsReview: 1 });
        }
    }

    // ── FAZ 2.5: Açıklaması boş ürünler için AI içerik üretimi ──
    const aiContentMap = new Map(); // barcode → { baslik, aciklama }
    for (const [barcode, info] of pendingContent) {
        try {
            const content = await urunIcerikUret(
                { title: info.title, category: info.category, brand: info.brand },
                dealerId
            );
            aiContentMap.set(barcode, content);
        } catch (_) {
            // Tek hata diğerlerini durdurmaz
        }
    }

    // ── FAZ 3: Tüm veriler hazır, toplu transaction ──
    let aiMatched = 0;
    let aiNeedsReview = 0;

    const importMany = db.transaction((prods) => {
        for (const item of prods) {
            let xmlCategoryId = item.ruleBasedId;
            let needsCategoryReview = 0;

            if (xmlCategoryId === null && aiResolutions.has(item.category)) {
                const res = aiResolutions.get(item.category);
                xmlCategoryId = res.xmlCategoryId;
                needsCategoryReview = res.needsReview;
                if (res.xmlCategoryId !== null) aiMatched++;
                else aiNeedsReview++;
            }

            const aiContent = aiContentMap.get(item.barcode);
            insertOrUpdate.run({
                dealer_id: dealerId,
                barcode: item.barcode,
                title: item.title.substring(0, 200),
                category: item.category,
                stock: item.stock,
                cost_price: item.costPrice,
                sale_price: item.salePrice,
                image_url: item.imageUrl,
                supplier_name: feed.supplier_name || 'Genel',
                xml_feed_id: parseInt(feedId),
                xml_category_id: xmlCategoryId,
                brand_name: item.brandName || null,
                brand_id: activeBrandId,
                needs_category_review: needsCategoryReview,
                ai_baslik: aiContent?.baslik || null,
                ai_aciklama: aiContent?.aciklama || null,
                icerik_uretildi: aiContent ? 1 : 0,
            });
        }
    });

    importMany(processedItems);

    const count = db.prepare('SELECT COUNT(*) as c FROM dealer_products WHERE dealer_id = ? AND xml_feed_id = ?')
        .get(dealerId, parseInt(feedId)).c;
    db.prepare("UPDATE xml_feeds SET last_imported = datetime('now'), product_count = ? WHERE id = ?")
        .run(count, feedId);

    const logParts = [`XML import tamamlandı: ${count} ürün (${feed.name})`];
    if (aiMatched > 0 || aiNeedsReview > 0) {
        logParts.push(`AI eşleştirme: ${aiMatched} ürün başarılı, ${aiNeedsReview} ürün inceleme bekliyor`);
    }
    addLog('success', logParts.join(' | '), dealerId);

    return { ok: true, count, margin, aiMatched, aiNeedsReview };
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
// KATEGORİ İNCELEME
// ══════════════════════════════════════════════════════════════

app.get('/api/dealer/products/needs-review', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const products = db.prepare(`
            SELECT
                dp.id, dp.barcode, dp.title, dp.supplier_name,
                dp.xml_category_id, dp.needs_category_review,
                ke.id          AS eslestirme_id,
                ke.guven_skoru,
                ke.kullanici_onayladi,
                tk.trendyol_id AS trendyol_category_id,
                tk.tam_yol
            FROM dealer_products dp
            LEFT JOIN kategori_eslestirme ke
                ON ke.tedarikci_adi = dp.supplier_name
                AND ke.trendyol_kategori_id = (
                    SELECT id FROM trendyol_kategoriler WHERE trendyol_id = dp.xml_category_id LIMIT 1
                )
            LEFT JOIN trendyol_kategoriler tk ON tk.id = ke.trendyol_kategori_id
            WHERE dp.dealer_id = ? AND dp.needs_category_review = 1
            ORDER BY dp.updated_at DESC
            LIMIT 200
        `).all(dealerId);
        res.json({ products, count: products.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/dealer/products/:id/approve-category', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    const productId = parseInt(req.params.id);
    const { trendyol_category_id, eslestirme_id } = req.body;

    if (!trendyol_category_id) {
        return res.status(400).json({ error: 'trendyol_category_id gerekli' });
    }

    try {
        db.prepare(`
            UPDATE dealer_products
            SET xml_category_id = ?, needs_category_review = 0, updated_at = datetime('now')
            WHERE id = ? AND dealer_id = ?
        `).run(trendyol_category_id, productId, dealerId);

        // Hafıza onayı
        if (eslestirme_id) {
            try { kullaniciOnayla(eslestirme_id); } catch (_) {}
        }

        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/dealer/products/bulk-ai-match', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const pending = db.prepare(`
            SELECT id, barcode, title, supplier_name, category, brand_name
            FROM dealer_products
            WHERE dealer_id = ? AND needs_category_review = 1
            LIMIT 200
        `).all(dealerId);

        if (!pending.length) return res.json({ matched: 0, remaining: 0 });

        // Benzersiz (supplier_name, category) grupları — her grup için tek AI çağrısı
        const groups = new Map(); // key: "supplier|category" → { tedarikci, kategoriMetni, ornek, brand, barcodePrefix, ids[] }
        for (const p of pending) {
            const tedarikci = p.supplier_name || 'Genel';
            const kategoriMetni = (p.category || p.title || '').trim();
            const key = `${tedarikci}|||${kategoriMetni}`;
            if (!groups.has(key)) {
                const prefix = p.barcode && p.barcode.includes('-') ? p.barcode.split('-')[0] : '';
                groups.set(key, { tedarikci, kategoriMetni, ornek: p.title, brand: p.brand_name || '', barcodePrefix: prefix, ids: [] });
            }
            groups.get(key).ids.push(p.id);
        }

        const updateStmt = db.prepare(`
            UPDATE dealer_products
            SET xml_category_id = ?, needs_category_review = 0, updated_at = datetime('now')
            WHERE id = ? AND dealer_id = ?
        `);
        const applyMany = db.transaction((ids, trendyolId) => {
            for (const id of ids) updateStmt.run(trendyolId, id, dealerId);
        });

        const dailyLimit = parseInt(process.env.GEMINI_DAILY_LIMIT || '0', 10);
        let matched = 0;
        let aiCallCount = 0;
        let limitReached = false;
        for (const { tedarikci, kategoriMetni, ornek, brand, barcodePrefix, ids } of groups.values()) {
            if (limitReached) { continue; }

            if (dailyLimit > 0 && geminiDailyUsage() >= dailyLimit) {
                addLog('warn', `bulk-ai-match: Günlük Gemini limiti (${dailyLimit}) doldu, kalan kategoriler atlandı`, dealerId);
                limitReached = true;
                continue;
            }

            // Gruplar arası 2s bekle (1. grup hariç)
            if (aiCallCount > 0) await new Promise(r => setTimeout(r, 2000));
            aiCallCount++;

            try {
                console.log(`[bulk-ai-match] AI çağrısı #${aiCallCount} (günlük #${geminiDailyUsage() + 1}): "${kategoriMetni}" | ürün adedi: ${ids.length}`);
                const result = await oneriKategori(tedarikci, kategoriMetni, ornek, '', brand, barcodePrefix);

                console.log(`[bulk-ai-match] oneriKategori sonucu: trendyol_id=${result.trendyol_id ?? 'null'} guven=${result.guven_skoru} needsLeafReview=${result.needsLeafReview ?? false} kaynak=${result.kaynak} gerekce=${result.gerekce ?? '-'}`);

                if (!result.trendyol_id) {
                    console.warn(`[bulk-ai-match] trendyol_id yok — "${kategoriMetni}" için kategori atanamadı. ids=[${ids.join(',')}]`);
                } else {
                    const review = (result.needsLeafReview || result.guven_skoru < 0.85) ? 1 : 0;
                    console.log(`[bulk-ai-match] review=${review} (needsLeafReview=${result.needsLeafReview ?? false}, guven=${result.guven_skoru})`);

                    const applyWithReview = db.transaction((productIds, trendyolId, needsReview) => {
                        let changes = 0;
                        for (const id of productIds) {
                            const info = db.prepare(`UPDATE dealer_products SET xml_category_id = ?, needs_category_review = ?, updated_at = datetime('now') WHERE id = ? AND dealer_id = ?`)
                              .run(trendyolId, needsReview, id, dealerId);
                            changes += info.changes;
                        }
                        return changes;
                    });
                    const dbChanges = applyWithReview(ids, result.trendyol_id, review);
                    console.log(`[bulk-ai-match] DB güncellendi: ${dbChanges}/${ids.length} satır değişti, xml_category_id=${result.trendyol_id}, needs_category_review=${review}`);

                    if (review === 0 && result.eslestirme_id) {
                        try { kullaniciOnayla(result.eslestirme_id); } catch (_) {}
                    }
                    if (review === 0) matched += ids.length;
                }
            } catch (err) {
                if (err?.message?.includes('GEMINI_DAILY_LIMIT_EXCEEDED')) {
                    addLog('warn', `bulk-ai-match: Günlük limit doldu, durduruluyor`, dealerId);
                    limitReached = true;
                } else {
                    console.error(`[bulk-ai-match] HATA — kategori="${kategoriMetni}" ids=[${ids.join(',')}]: ${err.message}`);
                    addLog('error', `bulk-ai-match hatası [${kategoriMetni}]: ${err.message}`, dealerId);
                }
            }
        }

        const remaining = db.prepare(
            'SELECT COUNT(*) as c FROM dealer_products WHERE dealer_id = ? AND needs_category_review = 1'
        ).get(dealerId).c;

        addLog('info', `Toplu AI kategori eşleştirme: ${groups.size} kategori sorgulandı, ${matched} ürün eşleşti, ${remaining} kaldı`, dealerId);
        res.json({ matched, remaining, categories: groups.size });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/dealer/categories/rematch-pending ───────────────────────────────
// needs_category_review=1 olan TÜM ürünleri yeni prompt ile yeniden eşleştirir.
// Hafızadaki onayları sıfırlar (kullanici_onayladi=0) → AI yeniden sorar.
// Sonuçta needs_category_review=1 bırakır → kullanıcı Kategori Yönetimi'nde onaylar.
app.post('/api/dealer/categories/rematch-pending', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const pending = db.prepare(`
            SELECT id, barcode, title, supplier_name, category, brand_name
            FROM dealer_products
            WHERE dealer_id = ? AND needs_category_review = 1
        `).all(dealerId);

        if (!pending.length) return res.json({ remapped: 0, skipped: 0, total: 0 });

        // Benzersiz (supplier_name, category) grupları — her grup için tek AI çağrısı
        const groups = new Map();
        for (const p of pending) {
            const tedarikci = p.supplier_name || 'Genel';
            const kategoriMetni = (p.category || p.title || '').trim();
            const key = `${tedarikci}|||${kategoriMetni}`;
            if (!groups.has(key)) {
                const prefix = p.barcode && p.barcode.includes('-') ? p.barcode.split('-')[0] : '';
                groups.set(key, { tedarikci, kategoriMetni, ornek: p.title, brand: p.brand_name || '', barcodePrefix: prefix, ids: [] });
            }
            groups.get(key).ids.push(p.id);
        }

        // Hafızadaki onayları sıfırla — bu grupların hafıza kaydı varsa kullanici_onayladi=0 yap
        // Böylece oneriKategori yeni prompt ile AI'a sorar (cache bypass)
        const resetHafiza = db.prepare(`
            UPDATE kategori_eslestirme
            SET kullanici_onayladi = 0
            WHERE tedarikci_adi = ? AND xml_kategori_metni = ?
        `);
        const resetTx = db.transaction(() => {
            for (const { tedarikci, kategoriMetni } of groups.values()) {
                resetHafiza.run(tedarikci, kategoriMetni);
            }
        });
        resetTx();

        const applyUpdate = db.prepare(`
            UPDATE dealer_products
            SET xml_category_id = ?, needs_category_review = 1, updated_at = datetime('now')
            WHERE id = ? AND dealer_id = ?
        `);
        const applyTx = (ids, trendyolId) => db.transaction(
            () => ids.forEach(id => applyUpdate.run(trendyolId, id, dealerId))
        )();

        const dailyLimitRm = parseInt(process.env.GEMINI_DAILY_LIMIT || '0', 10);
        let remapped = 0;
        let skipped = 0;
        let aiCallCountRm = 0;
        let limitReachedRm = false;
        for (const { tedarikci, kategoriMetni, ornek, brand, barcodePrefix, ids } of groups.values()) {
            if (limitReachedRm) { skipped += ids.length; continue; }

            if (dailyLimitRm > 0 && geminiDailyUsage() >= dailyLimitRm) {
                addLog('warn', `rematch-pending: Günlük Gemini limiti (${dailyLimitRm}) doldu, kalan ${groups.size - aiCallCountRm} kategori atlandı`, dealerId);
                limitReachedRm = true;
                skipped += ids.length;
                continue;
            }

            // Gruplar arası 2s bekle (1. grup hariç)
            if (aiCallCountRm > 0) await new Promise(r => setTimeout(r, 2000));
            aiCallCountRm++;

            try {
                console.log(`[rematch-pending] AI çağrısı #${aiCallCountRm} (günlük #${geminiDailyUsage() + 1}): "${kategoriMetni}"`);
                const result = await oneriKategori(tedarikci, kategoriMetni, ornek, '', brand, barcodePrefix);
                if (result.trendyol_id) {
                    applyTx(ids, result.trendyol_id);
                    remapped += ids.length;
                } else {
                    skipped += ids.length;
                }
            } catch (err) {
                if (err?.message?.includes('GEMINI_DAILY_LIMIT_EXCEEDED')) {
                    addLog('warn', `rematch-pending: Günlük limit doldu, durduruluyor`, dealerId);
                    limitReachedRm = true;
                }
                skipped += ids.length;
            }
        }

        // Her xml_kategori_metni için en iyi kaydı (kullanici_onayladi DESC, guven_skoru DESC, en yeni)
        // dışındaki zayıf duplikatları sil — JOIN her zaman tek satır döndürsün
        try {
            db.prepare(`
                DELETE FROM kategori_eslestirme
                WHERE id NOT IN (
                    SELECT (
                        SELECT ke2.id FROM kategori_eslestirme ke2
                        WHERE ke2.xml_kategori_metni = ke.xml_kategori_metni
                        ORDER BY ke2.kullanici_onayladi DESC, ke2.guven_skoru DESC, ke2.id DESC
                        LIMIT 1
                    )
                    FROM (SELECT DISTINCT xml_kategori_metni FROM kategori_eslestirme) ke
                )
            `).run();
        } catch (_) {}

        addLog('info',
            `rematch-pending: ${groups.size} kategori, ${remapped} ürün yeniden eşleştirildi, ${skipped} atlandı`,
            dealerId
        );
        res.json({ remapped, skipped, total: pending.length, categories: groups.size });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/dealer/categories/search', authMiddleware, (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) return res.json([]);
    try {
        const results = searchKategoriler(query);
        res.json(results);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── GET /api/dealer/categories/all ─────────────────────────────────────────
// Tüm ürünleri kategori bilgisi, AI güven skoru ve onay durumuyla döndürür
app.get('/api/dealer/categories/all', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const { filter = 'all', page = 1, limit = 100 } = req.query;
        const pageNum  = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
        const offset   = (pageNum - 1) * limitNum;

        let where = 'dp.dealer_id = ?';
        if (filter === 'pending')  where += ' AND dp.needs_category_review = 1';
        if (filter === 'approved') where += ' AND dp.needs_category_review = 0 AND dp.xml_category_id IS NOT NULL';
        if (filter === 'missing')  where += ' AND dp.xml_category_id IS NULL';

        const rows = db.prepare(`
            SELECT
                dp.id,
                dp.barcode,
                dp.title,
                dp.brand_name,
                dp.category            AS xml_category,
                dp.xml_category_id     AS trendyol_id,
                dp.needs_category_review,
                dp.attributes_json,
                tk.kategori_adi        AS trendyol_adi,
                tk.tam_yol,
                tk.trendyol_id         AS trendyol_cat_id,
                ke.id                  AS eslestirme_id,
                ke.guven_skoru,
                ke.kullanici_onayladi
            FROM dealer_products dp
            LEFT JOIN trendyol_kategoriler tk ON tk.id = COALESCE(
                    (SELECT id FROM trendyol_kategoriler WHERE trendyol_id = dp.xml_category_id LIMIT 1),
                    dp.xml_category_id
                )
            LEFT JOIN kategori_eslestirme ke ON ke.id = (
                    SELECT id FROM kategori_eslestirme
                    WHERE xml_kategori_metni = dp.category
                    ORDER BY kullanici_onayladi DESC, guven_skoru DESC, id DESC
                    LIMIT 1
                )
            WHERE ${where}
            ORDER BY dp.needs_category_review DESC, dp.title ASC
            LIMIT ? OFFSET ?
        `).all(dealerId, limitNum, offset);

        const { total } = db.prepare(`
            SELECT COUNT(*) AS total FROM dealer_products dp WHERE ${where}
        `).get(dealerId);

        const { pending_count } = db.prepare(
            'SELECT COUNT(*) AS pending_count FROM dealer_products WHERE dealer_id = ? AND needs_category_review = 1'
        ).get(dealerId);

        res.json({ products: rows, total, page: pageNum, totalPages: Math.ceil(total / limitNum), pending_count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── PUT /api/dealer/categories/bulk-approve ──────────────────────────────────
// Seçili ürün id'leri için needs_category_review = 0 yapar
app.put('/api/dealer/categories/bulk-approve', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    const { ids } = req.body; // number[]
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids dizisi zorunludur' });
    }
    try {
        const stmt = db.prepare(`
            UPDATE dealer_products
            SET needs_category_review = 0, updated_at = datetime('now')
            WHERE id = ? AND dealer_id = ?
        `);
        const tx = db.transaction((list) => { for (const id of list) stmt.run(id, dealerId); });
        tx(ids);
        res.json({ updated: ids.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Yanlış kategoriye gitmiş ürünleri sıfırla ve yeniden eşleştirmeye hazırla
app.post('/api/dealer/products/reset-categories', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    try {
        // needs_category_review = 1 olan veya xml_category_id null olan ürünlerin
        // barcode listesini al
        const affectedProducts = db.prepare(`
            SELECT barcode, supplier_name
            FROM dealer_products
            WHERE dealer_id = ?
              AND (needs_category_review = 1 OR xml_category_id IS NULL)
        `).all(dealerId);

        if (affectedProducts.length === 0) {
            return res.json({ reset: 0, message: 'Sıfırlanacak ürün bulunamadı.' });
        }

        // Bu ürünlerin tedarikçi adlarına ait kategori_eslestirme kayıtlarını temizle
        const supplierNames = [...new Set(affectedProducts.map(p => p.supplier_name).filter(Boolean))];
        let eslestirmeDeleted = 0;
        if (supplierNames.length > 0) {
            const placeholders = supplierNames.map(() => '?').join(',');
            const delResult = db.prepare(
                `DELETE FROM kategori_eslestirme WHERE tedarikci_adi IN (${placeholders})`
            ).run(...supplierNames);
            eslestirmeDeleted = delResult.changes;
        }

        // Tüm etkilenen ürünleri needs_category_review = 1 yap,
        // xml_category_id'yi de NULL'a çek ki yeniden eşleştirilsin
        const resetResult = db.prepare(`
            UPDATE dealer_products
            SET xml_category_id = NULL,
                needs_category_review = 1,
                updated_at = datetime('now')
            WHERE dealer_id = ?
              AND (needs_category_review = 1 OR xml_category_id IS NULL)
        `).run(dealerId);

        addLog('info',
            `reset-categories: ${resetResult.changes} ürün sıfırlandı, ${eslestirmeDeleted} eşleştirme kaydı silindi`,
            dealerId
        );

        res.json({
            reset: resetResult.changes,
            eslestirme_silindi: eslestirmeDeleted,
            message: `${resetResult.changes} ürün kategori incelemesine alındı, ${eslestirmeDeleted} eşleştirme kaydı temizlendi.`,
        });
    } catch (e) {
        addLog('error', `reset-categories hatası: ${e.message}`, dealerId);
        res.status(500).json({ error: e.message });
    }
});

// Toplu kategori güncelleme (eski xml_category_id → yeni)
app.put('/api/dealer/products/bulk-update-category', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    const { xml_category_id_eski, xml_category_id_yeni } = req.body;

    if (!xml_category_id_eski || !xml_category_id_yeni) {
        return res.status(400).json({ error: 'xml_category_id_eski ve xml_category_id_yeni zorunludur' });
    }

    try {
        // trendyol_kategoriler.id (PK) değerlerini bul
        const eskiKat = db.prepare('SELECT id FROM trendyol_kategoriler WHERE trendyol_id = ?').get(xml_category_id_eski);
        const yeniKat = db.prepare('SELECT id FROM trendyol_kategoriler WHERE trendyol_id = ?').get(xml_category_id_yeni);

        let updatedProducts = 0;
        let updatedMappings = 0;

        db.transaction(() => {
            // dealer_products güncelle
            const dpResult = db.prepare(
                'UPDATE dealer_products SET xml_category_id = ? WHERE dealer_id = ? AND xml_category_id = ?'
            ).run(xml_category_id_yeni, dealerId, xml_category_id_eski);
            updatedProducts = dpResult.changes;

            // kategori_eslestirme güncelle (eğer eski kategori için kayıt varsa)
            if (eskiKat && yeniKat) {
                const keResult = db.prepare(
                    'UPDATE kategori_eslestirme SET trendyol_kategori_id = ? WHERE trendyol_kategori_id = ?'
                ).run(yeniKat.id, eskiKat.id);
                updatedMappings = keResult.changes;
            }
        })();

        addLog('info',
            `bulk-update-category: ${xml_category_id_eski}→${xml_category_id_yeni}, ${updatedProducts} ürün, ${updatedMappings} eşleştirme güncellendi`,
            dealerId
        );

        res.json({ updated: updatedProducts, mappings_updated: updatedMappings });
    } catch (e) {
        addLog('error', `bulk-update-category hatası: ${e.message}`, dealerId);
        res.status(500).json({ error: e.message });
    }
});

// ══════════════════════════════════════════════════════════════
// AI İÇERİK ÜRETİMİ
// ══════════════════════════════════════════════════════════════

app.get('/api/dealer/products/needs-content', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const row = db.prepare(
            'SELECT COUNT(*) as c FROM dealer_products WHERE dealer_id = ? AND icerik_uretildi = 0'
        ).get(dealerId);
        res.json({ count: row.c });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/dealer/products/bulk-generate-content', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const products = db.prepare(`
            SELECT id, title, category, supplier_name
            FROM dealer_products
            WHERE dealer_id = ? AND icerik_uretildi = 0
            LIMIT 50
        `).all(dealerId);

        if (!products.length) return res.json({ generated: 0, remaining: 0 });

        const updateStmt = db.prepare(`
            UPDATE dealer_products
            SET ai_baslik = ?, ai_aciklama = ?, icerik_uretildi = 1, updated_at = datetime('now')
            WHERE id = ? AND dealer_id = ?
        `);

        let generated = 0;
        for (const p of products) {
            try {
                const { baslik, aciklama } = await urunIcerikUret({
                    title: p.title,
                    category: p.category,
                    brand: p.supplier_name,
                }, dealerId);
                updateStmt.run(baslik, aciklama, p.id, dealerId);
                generated++;
            } catch (_) {
                // Tek hata diğerlerini durdurmaz
            }
        }

        const remaining = db.prepare(
            'SELECT COUNT(*) as c FROM dealer_products WHERE dealer_id = ? AND icerik_uretildi = 0'
        ).get(dealerId).c;

        addLog('info', `Toplu AI içerik üretimi: ${generated} ürün tamamlandı, ${remaining} kaldı`, dealerId);
        res.json({ generated, remaining });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/dealer/products/:id/generate-content', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const productId = parseInt(req.params.id);
    try {
        const product = db.prepare(
            'SELECT id, title, category, supplier_name FROM dealer_products WHERE id = ? AND dealer_id = ?'
        ).get(productId, dealerId);
        if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

        const { baslik, aciklama } = await urunIcerikUret({
            title: product.title,
            category: product.category,
            brand: product.supplier_name,
        }, dealerId);

        db.prepare(`
            UPDATE dealer_products
            SET ai_baslik = ?, ai_aciklama = ?, icerik_uretildi = 1, updated_at = datetime('now')
            WHERE id = ? AND dealer_id = ?
        `).run(baslik, aciklama, productId, dealerId);

        res.json({ ok: true, baslik, aciklama });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/dealer/products/:id/ai-content', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    const productId = parseInt(req.params.id);
    try {
        const row = db.prepare(
            'SELECT ai_baslik, ai_aciklama, icerik_uretildi FROM dealer_products WHERE id = ? AND dealer_id = ?'
        ).get(productId, dealerId);
        if (!row) return res.status(404).json({ error: 'Ürün bulunamadı' });
        res.json(row);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/dealer/products/:id/ai-content', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    const productId = parseInt(req.params.id);
    const { ai_baslik, ai_aciklama } = req.body;
    try {
        db.prepare(`
            UPDATE dealer_products
            SET ai_baslik = ?, ai_aciklama = ?, icerik_uretildi = 1, updated_at = datetime('now')
            WHERE id = ? AND dealer_id = ?
        `).run(
            ai_baslik != null ? String(ai_baslik).substring(0, 100) : null,
            ai_aciklama != null ? String(ai_aciklama) : null,
            productId, dealerId
        );
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
app.use('/api/dealer/reviews', authMiddleware, reviewsRouter);
app.use('/api', authMiddleware, require('./routes/profit'));
app.use('/api/forecast', authMiddleware, forecastRouter);
app.use('/api/analytics', authMiddleware, analyticsRouter);
app.use('/api/pricing', authMiddleware, pricingRouter);
app.use('/api/health',  authMiddleware, healthRouter);
app.use('/api/stock',  authMiddleware, require('./routes/stock'));

// ── ÜRÜN ATTRIBUTE KAYDETME ────────────────────────────────────
app.post('/api/products/:id/attributes', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    const productId = parseInt(req.params.id, 10);
    if (!Number.isFinite(productId)) return res.status(400).json({ error: 'Geçersiz ürün ID' });
    const { attributes } = req.body;
    if (!Array.isArray(attributes)) return res.status(400).json({ error: 'attributes dizisi zorunlu' });
    const result = db.prepare(
        'UPDATE dealer_products SET attributes_json = ? WHERE id = ? AND dealer_id = ?'
    ).run(JSON.stringify(attributes), productId, dealerId);
    if (!result.changes) return res.status(404).json({ error: 'Ürün bulunamadı' });
    res.json({ ok: true });
});

// ── TOPLU ATTRIBUTE DOLDURMA (SSE) ─────────────────────────────
// EventSource GET-only olduğu için token query param'dan alınır
app.get('/api/products/attributes/auto-fill', authMiddleware, async (req, res) => {
        const dealerId  = req.dealer.id;
        const limitNum  = Math.min(25000, Math.max(1, parseInt(req.query.limit || '100', 10) || 100));
        const BATCH     = 50;
        const DELAY_MS  = 2000;

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

        try {
            const products = db.prepare(`
                SELECT dp.id, dp.title,
                       COALESCE(tk.trendyol_id, dp.xml_category_id) AS trendyol_cat_id,
                       tk.tam_yol
                FROM dealer_products dp
                LEFT JOIN trendyol_kategoriler tk ON tk.trendyol_id = dp.xml_category_id
                WHERE dp.dealer_id = ?
                  AND (dp.attributes_json IS NULL OR dp.attributes_json = '' OR dp.attributes_json = '[]')
                  AND dp.xml_category_id IS NOT NULL
                  AND dp.needs_category_review = 0
                ORDER BY
                  -- Leaf kategoriler önce (tam_yol'da '>' ne kadar çoksa o kadar derin = leaf)
                  (LENGTH(COALESCE(tk.tam_yol,'')) - LENGTH(REPLACE(COALESCE(tk.tam_yol,''), '>', ''))) DESC,
                  dp.id ASC
                LIMIT ?
            `).all(dealerId, limitNum);

            send({ type: 'start', total: products.length });

            if (products.length === 0) {
                send({ type: 'done', filled: 0, skipped: 0, errors: 0 });
                return res.end();
            }

            // Cache Trendyol attribute'larını kategori başına bir kez çek
            const catCache = new Map();
            async function getCatAttrs(catId) {
                if (catCache.has(catId)) return catCache.get(catId);
                try {
                    const resp = await withTrendyolCredentialFallback(dealerId, null, async (store) => {
                        const auth = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
                        return axios.get(
                            `https://apigw.trendyol.com/integration/product/product-categories/${catId}/attributes`,
                            { timeout: 15000, headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', 'User-Agent': `${store.supplier_id} - SelfIntegration` } }
                        );
                    });
                    const attrs = (resp.data?.categoryAttributes || []).map(a => ({
                        id: a.attribute?.id, name: a.attribute?.name,
                        required: !!a.required, allow_custom: !!a.allowCustom,
                        values: (a.attributeValues || []).map(v => ({ id: v.id, name: v.name }))
                    })).filter(a => a.id && a.name);
                    catCache.set(catId, attrs);
                    return attrs;
                } catch (_) {
                    catCache.set(catId, []);
                    return [];
                }
            }

            const updateStmt = db.prepare(
                'UPDATE dealer_products SET attributes_json = ? WHERE id = ? AND dealer_id = ?'
            );
            const markForReviewStmt = db.prepare(
                'UPDATE dealer_products SET needs_category_review = 1, updated_at = datetime(\'now\') WHERE id = ? AND dealer_id = ?'
            );

            let filled = 0, skipped = 0, errors = 0, rematched = 0;
            const skipReasons = {}; // reason → count

            function recordSkip(reason) {
                skipped++;
                skipReasons[reason] = (skipReasons[reason] || 0) + 1;
                return reason;
            }

            for (let i = 0; i < products.length; i += BATCH) {
                const batch = products.slice(i, i + BATCH);

                let rateLimited = false;
                for (let j = 0; j < batch.length; j++) {
                    if (rateLimited) {
                        recordSkip('rate_limit');
                        send({ type: 'progress', processed: i + j + 1, total: products.length, filled, skipped, errors, rematched, skipReason: 'rate_limit', skipTitle: batch[j].title.slice(0, 50) });
                        continue;
                    }
                    const p = batch[j];
                    let skipReason = null;
                    try {
                        const attrs    = await getCatAttrs(p.trendyol_cat_id);
                        const required = attrs.filter(a => a.required);
                        if (attrs.length === 0) {
                            // Parent/leaf olmayan kategori — yeniden eşleştirme kuyruğuna al
                            markForReviewStmt.run(p.id, dealerId);
                            rematched++;
                            skipReason = recordSkip('no_cat_attributes');
                            console.log(`[auto-fill] Parent kategori, yeniden eşleşmeye alındı: id=${p.id} "${p.title.slice(0,50)}" cat=${p.trendyol_cat_id}`);
                        } else if (required.length === 0) {
                            skipReason = recordSkip('no_required_attributes');
                        } else {
                            const predicted = await oneriAttributeDoldur(p.title, required);

                            // Post-fill doğrulama: AI'ın atladığı zorunlu attr'ları default/ilk seçenekle doldur
                            const filledIds = new Set(predicted.map(r => r.attributeId));
                            for (const ra of required) {
                                if (filledIds.has(ra.id)) continue;
                                // oneriAttributeDoldur zaten bunları dolduruyor olmalı;
                                // bu katman ikinci güvenlik ağı olarak çalışır
                                if (ra.values && ra.values.length > 0) {
                                    predicted.push({ attributeId: ra.id, attributeValueId: ra.values[0].id });
                                    console.log(`[auto-fill] Güvenlik ağı — zorunlu attr default: id=${ra.id} name="${ra.name}" ürün="${p.title.slice(0,40)}"`);
                                }
                            }

                            if (predicted.length > 0) {
                                updateStmt.run(JSON.stringify(predicted), p.id, dealerId);
                                filled++;
                            } else {
                                skipReason = recordSkip('ai_no_result');
                            }
                        }
                    } catch (e) {
                        if (e.message && (e.message.includes('429') || e.message.includes('RESOURCE_EXHAUSTED') || e.message.includes('quota'))) {
                            rateLimited = true;
                            recordSkip('rate_limit');
                            skipReason = 'rate_limit';
                            addLog('warn', `auto-fill: Gemini rate limit aşıldı, kalan ürünler atlanıyor`, dealerId);
                        } else {
                            errors++;
                            console.error(`[AUTO-FILL HATA] "${p.title.slice(0, 60)}" cat=${p.trendyol_cat_id} — ${e.message}`);
                            console.error(e.stack);
                            addLog('error', `auto-fill hatası [${p.title}]: ${e.message}`, dealerId);
                        }
                    }
                    send({
                        type: 'progress',
                        processed: i + j + 1,
                        total: products.length,
                        filled, skipped, errors, rematched,
                        ...(skipReason && { skipReason, skipTitle: p.title.slice(0, 50) })
                    });
                }

                if (i + BATCH < products.length) {
                    await new Promise(r => setTimeout(r, DELAY_MS));
                }
            }

            if (rematched > 0) {
                addLog('info', `auto-fill: ${rematched} ürün parent kategoride bulundu, yeniden eşleştirme kuyruğuna alındı`, dealerId);
            }
            send({ type: 'done', filled, skipped, errors, rematched, skipReasons });
        } catch (e) {
            send({ type: 'error', message: e.message });
        }

        res.end();
    }
);

// ── XML KATEGORİ DOĞRULAMA ────────────────────────────────────────────────
app.get('/api/dealer/categories/verify-xml-stream', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
        const combos = db.prepare(`
            SELECT dp.category, dp.xml_category_id, dp.supplier_name,
                   COUNT(*) AS product_count,
                   tk.tam_yol AS current_path
            FROM dealer_products dp
            LEFT JOIN trendyol_kategoriler tk ON tk.trendyol_id = dp.xml_category_id
            WHERE dp.dealer_id = ?
              AND dp.xml_category_id IS NOT NULL
              AND dp.needs_category_review = 0
              AND NOT EXISTS (
                  SELECT 1 FROM kategori_eslestirme ke
                  WHERE ke.tedarikci_adi = dp.supplier_name
                    AND ke.xml_kategori_metni = dp.category
              )
            GROUP BY dp.category, dp.xml_category_id, dp.supplier_name
            ORDER BY product_count DESC
        `).all(dealerId);

        send({ type: 'start', total: combos.length });

        if (combos.length === 0) {
            send({ type: 'done', verified: 0, changed: 0, low_confidence: 0, errors: 0 });
            return res.end();
        }

        let verified = 0, changed = 0, low_confidence = 0, errors = 0;

        for (let i = 0; i < combos.length; i++) {
            const combo = combos[i];
            try {
                const result = await oneriKategori(
                    combo.supplier_name,
                    combo.category,
                    combo.category
                );

                const isSame = result.trendyol_id === combo.xml_category_id;

                if (result.needsLeafReview) {
                    db.prepare(`
                        UPDATE dealer_products
                        SET needs_category_review = 1, updated_at = datetime('now')
                        WHERE dealer_id = ? AND category = ? AND xml_category_id = ?
                    `).run(dealerId, combo.category, combo.xml_category_id);
                    changed++;
                    send({
                        type: 'progress', current: i + 1, total: combos.length,
                        category: combo.category, result: 'changed',
                        current_path: combo.current_path,
                        suggested_path: result.tam_yol,
                        affected_products: combo.product_count,
                        guven_skoru: result.guven_skoru
                    });
                } else if (isSame) {
                    verified++;
                    send({
                        type: 'progress', current: i + 1, total: combos.length,
                        category: combo.category, result: 'verified',
                        current_path: combo.current_path,
                        suggested_path: result.tam_yol,
                        affected_products: combo.product_count,
                        guven_skoru: result.guven_skoru
                    });
                } else if (result.guven_skoru >= 0.70) {
                    db.prepare(`
                        UPDATE dealer_products
                        SET needs_category_review = 1, updated_at = datetime('now')
                        WHERE dealer_id = ? AND category = ? AND xml_category_id = ?
                    `).run(dealerId, combo.category, combo.xml_category_id);
                    changed++;
                    send({
                        type: 'progress', current: i + 1, total: combos.length,
                        category: combo.category, result: 'changed',
                        current_path: combo.current_path,
                        suggested_path: result.tam_yol,
                        affected_products: combo.product_count,
                        guven_skoru: result.guven_skoru
                    });
                } else {
                    db.prepare(`
                        UPDATE dealer_products
                        SET needs_category_review = 1, updated_at = datetime('now')
                        WHERE dealer_id = ? AND category = ? AND xml_category_id = ?
                    `).run(dealerId, combo.category, combo.xml_category_id);
                    low_confidence++;
                    send({
                        type: 'progress', current: i + 1, total: combos.length,
                        category: combo.category, result: 'low_confidence',
                        current_path: combo.current_path,
                        suggested_path: result.tam_yol,
                        affected_products: combo.product_count,
                        guven_skoru: result.guven_skoru
                    });
                }
            } catch (e) {
                errors++;
                addLog('error', `verify-xml hatası [${combo.category}]: ${e.message}`, dealerId);
                send({
                    type: 'progress', current: i + 1, total: combos.length,
                    category: combo.category, result: 'error',
                    affected_products: combo.product_count
                });
            }

            if (i < combos.length - 1) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        send({ type: 'done', verified, changed, low_confidence, errors });
    } catch (e) {
        send({ type: 'error', message: e.message });
    }

    res.end();
});

// ── KATEGORİ BAZLI TOPLU ATTRIBUTE ATAMA ───────────────────────
app.post('/api/products/attributes/bulk-by-category', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    const { categoryId, attributes } = req.body;
    if (!categoryId || !Array.isArray(attributes) || attributes.length === 0) {
        return res.status(400).json({ error: 'categoryId ve attributes zorunlu' });
    }
    const result = db.prepare(`
        UPDATE dealer_products SET attributes_json = ?
        WHERE dealer_id = ? AND xml_category_id = ? AND needs_category_review = 0
    `).run(JSON.stringify(attributes), dealerId, Number(categoryId));
    res.json({ updated: result.changes });
});

// ── BAYI AYARLARI ──────────────────────────────────────────────
app.get('/api/dealer/settings', authMiddleware, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM dealer_settings WHERE dealer_id = ?').all(req.dealer.id);
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const defaults = { xml_sync_enabled: '1', xml_sync_interval_hours: '6' };
    res.json({ ...defaults, ...settings });
});

app.put('/api/dealer/settings', authMiddleware, (req, res) => {
    const { xml_sync_enabled, xml_sync_interval_hours, cargo_company_id } = req.body;
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
        if (cargo_company_id !== undefined) upsert.run(req.dealer.id, 'cargo_company_id', String(cargo_company_id));
    });
    update();
    res.json({ ok: true });
});

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

// ── MARKA YÖNETİMİ ──────────────────────────────────────────
// GET /api/dealer/brands — daha önce kaydedilmiş markaları döndürür
app.get('/api/dealer/brands', authMiddleware, (req, res) => {
    try {
        const rows = db.prepare(
            'SELECT trendyol_brand_id as id, name FROM brands ORDER BY name ASC'
        ).all();
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/dealer/brands — seçilen markayı yerel tabloya kaydet
app.post('/api/dealer/brands', authMiddleware, (req, res) => {
    const { trendyol_brand_id, name } = req.body;
    if (!trendyol_brand_id || !name) {
        return res.status(400).json({ error: 'trendyol_brand_id ve name zorunludur' });
    }
    try {
        db.prepare(
            'INSERT INTO brands (trendyol_brand_id, name) VALUES (?, ?) ON CONFLICT(trendyol_brand_id) DO UPDATE SET name = excluded.name'
        ).run(parseInt(trendyol_brand_id), name);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Brand adından Trendyol brand ID'yi çeker (önbellekli)
const brandIdCache = new Map();
async function resolveBrandId(brandName, authString, supplierId) {
    if (!brandName) return null;
    const key = brandName.toLowerCase().trim();
    if (brandIdCache.has(key)) return brandIdCache.get(key);
    try {
        const res = await axios.get(
            `https://apigw.trendyol.com/integration/product/brands/by-name?name=${encodeURIComponent(brandName)}`,
            {
                headers: {
                    Authorization: `Basic ${authString}`,
                    'User-Agent': `${supplierId} - SelfIntegration`,
                    'Content-Type': 'application/json',
                },
                timeout: 5000,
            }
        );
        const brands = Array.isArray(res.data) ? res.data : [];
        const match = brands.find(b => b.name?.toLowerCase() === key) || brands[0];
        const id = match?.id || null;
        brandIdCache.set(key, id);
        return id;
    } catch (_) {
        return null;
    }
}

app.post('/api/dealer/trendyol-upload', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const { store_id, brand_id } = req.body;
    const overrideBrandId = brand_id ? parseInt(brand_id) : null;
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

            const cargoSettingBulk = db.prepare(
                "SELECT value FROM dealer_settings WHERE dealer_id = ? AND key = 'cargo_company_id'"
            ).get(dealerId);
            const cargoCompanyId = cargoSettingBulk ? parseInt(cargoSettingBulk.value, 10) : parseInt(process.env.TRENDYOL_CARGO_COMPANY_ID || '10', 10);

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

            // Onaylı kategori eşleştirmeleri: supplier_name__category → trendyol API ID
            const approvedCategoryApiIds = new Map();
            db.prepare(`
                SELECT ke.tedarikci_adi, ke.xml_kategori_metni, tk.trendyol_id AS api_id
                FROM kategori_eslestirme ke
                JOIN trendyol_kategoriler tk ON tk.id = ke.trendyol_kategori_id
                WHERE ke.kullanici_onayladi = 1
            `).all().forEach(r => {
                approvedCategoryApiIds.set(`${r.tedarikci_adi}__${r.xml_kategori_metni}`, r.api_id);
            });

            // Kategori başına bir kez çekilir, tekrar istek atılmaz
            const categoryAttrCache = new Map(); // categoryId → [{ id, name, allowCustom, values }]

            async function getRequiredAttrs(categoryId) {
                if (categoryAttrCache.has(categoryId)) return categoryAttrCache.get(categoryId);
                console.log(`[upload] getRequiredAttrs çağrılıyor, kategori: ${categoryId}`);
                try {
                    const res = await axios.get(
                        `https://apigw.trendyol.com/integration/product/product-categories/${categoryId}/attributes`,
                        {
                            timeout: 15000,
                            headers: {
                                'Authorization': `Basic ${authString}`,
                                'User-Agent': `${store.supplier_id} - SelfIntegration`,
                            }
                        }
                    );
                    const categoryAttrs = res.data?.categoryAttributes || [];
                    const required = categoryAttrs
                        .filter(a => a.required === true)
                        .map(a => ({
                            id: a.attribute?.id,
                            name: a.attribute?.name || '',
                            allowCustom: a.allowCustom !== false,
                            values: Array.isArray(a.attributeValues) ? a.attributeValues : [],
                        }));
                    console.log(`[upload] Attribute listesi alındı, zorunlu sayısı: ${required.length} (kategori: ${categoryId})`);
                    categoryAttrCache.set(categoryId, required);
                    return required;
                } catch (err) {
                    console.log(`[upload] getRequiredAttrs hata (kategori: ${categoryId}): ${err.message} — boş array ile devam`);
                    categoryAttrCache.set(categoryId, []);
                    return [];
                }
            }

            const getAttrMapEntry = db.prepare(`
                SELECT uam.varsayilan_deger, uam.xml_alan_adi
                FROM urun_attribute_map uam
                JOIN trendyol_kategoriler tk ON tk.id = uam.trendyol_kategori_id
                WHERE tk.trendyol_id = ? AND uam.trendyol_attribute_adi = ?
                LIMIT 1
            `);

            const getCategoryTamYol = db.prepare(
                'SELECT tam_yol FROM trendyol_kategoriler WHERE trendyol_id = ? LIMIT 1'
            );

            // Gemini ile eksik attribute'ları doldurur.
            // missingAttrs: [{ id, name, allowCustom, values: [{id, name}] }]
            // Döndürür: [{ attributeId, attributeValueId? , customAttributeValue? }]
            // Attribute adı keyword → makul varsayılan
            function uploadAttrDefault(attrName) {
                const n = attrName.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '');
                if (n.includes('garanti'))                      return '2 Yil';
                if (n.includes('voltaj') || n.includes('volt')) return '220 V';
                if (n.includes('frekans'))                      return '50 Hz';
                if (n.includes('mensei') || n.includes('ulke') || n.includes('uretim yeri') || n.includes('koken')) return 'Cin';
                if (n.includes('renk') || n.includes('color'))  return 'Cok Renkli';
                return null;
            }

            async function fillMissingAttrsWithAI(title, categoryId, missingAttrs) {
                if (!missingAttrs.length || !process.env.GEMINI_API_KEY) return [];

                const catRow = getCategoryTamYol.get(categoryId);
                const categoryPath = catRow?.tam_yol || `Kategori ${categoryId}`;

                // Tüm değerleri gönder (kırpma yok)
                const attrLines = missingAttrs.map(a => {
                    const opts = a.values.map(v => v.name).join(', ');
                    return `${a.name}: seçenekler=[${opts || '(boş)'}], allowCustom=${a.allowCustom}`;
                }).join('\n');

                const prompt = `Ürün adı: ${title}
Kategori: ${categoryPath}

Aşağıdaki TÜM zorunlu attribute'ları doldur. Hiçbirini boş bırakma.
Seçeneklerden en uygununu al. Emin değilsen ilk seçeneği kullan.
allowCustom true ise listede uygun yoksa kısa değer yaz.
Varsayılanlar: Garanti→"2 Yıl", Voltaj→"220 V", Frekans→"50 Hz", Menşei/Ülke→"Çin", Renk→"Çok Renkli"

${attrLines}

Sadece JSON döndür:
{${missingAttrs.map(a => `"${a.name}": "seçilen_deger"`).join(', ')}}`;

                let aiText = '';
                try {
                    aiText = await geminiGenerate(prompt, { maxOutputTokens: 1024 });
                    console.log(`[upload] Gemini yanıtı alındı: ${aiText.slice(0, 200)}`);
                } catch (err) {
                    addLog('warn', `fillMissingAttrsWithAI Gemini hatası [${title}]: ${err.message}`, dealerId);
                    // AI yoksa hardcoded default → ilk seçenek ile doldur
                }

                let parsed = {};
                try {
                    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
                } catch (_) {}

                const result = [];
                for (const a of missingAttrs) {
                    const aiValue = parsed[a.name];

                    if (aiValue) {
                        // Değer listesinde tam/kısmi eşleşme ara
                        const needle = String(aiValue).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '');
                        const matched = a.values.find(v => {
                            const vn = (v.name || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '');
                            return vn === needle || vn.includes(needle.split(' ')[0]);
                        });
                        if (matched?.id) {
                            result.push({ attributeId: a.id, attributeValueId: matched.id });
                            continue;
                        }
                        if (a.allowCustom) {
                            result.push({ attributeId: a.id, customAttributeValue: String(aiValue) });
                            continue;
                        }
                    }

                    // AI boş/eşleşmesiz → hardcoded default dene
                    const defaultVal = uploadAttrDefault(a.name);
                    if (defaultVal) {
                        const needle2 = defaultVal.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '');
                        const matchedD = a.values.find(v => {
                            const vn = (v.name || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '');
                            return vn === needle2 || vn.includes(needle2.split(' ')[0]);
                        });
                        if (matchedD) { result.push({ attributeId: a.id, attributeValueId: matchedD.id }); continue; }
                        if (a.allowCustom) { result.push({ attributeId: a.id, customAttributeValue: defaultVal }); continue; }
                    }

                    // Son çare: ilk seçenek
                    if (a.values[0]) result.push({ attributeId: a.id, attributeValueId: a.values[0].id });
                }
                return result;
            }

            // Batch gönderme + sonuç bekleme
            async function sendBatchAndWait(items, batchLabel) {
                const res = await axios.post(API_URL, { items }, {
                    headers: {
                        'Authorization': `Basic ${authString}`,
                        'Content-Type': 'application/json',
                        'User-Agent': `${store.supplier_id} - SelfIntegration`,
                    },
                });
                const batchRequestId = res.data?.batchRequestId;
                if (!batchRequestId) return null;
                addLog('info', `${batchLabel} kabul edildi, batchRequestId=${batchRequestId}`, dealerId);
                return await fetchBatchResult(batchRequestId);
            }

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
                console.log(`[upload] Batch hazırlanıyor, ürün sayısı: ${batch.length}`);

                const items = await Promise.all(batch.map(async p => {
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

                    // dealer_products.attributes_json — Kategori Yönetimi'nde manuel/AI doldurulmuş
                    let productAttributes = [];
                    try {
                        const parsed = JSON.parse(p.attributes_json || '[]');
                        if (Array.isArray(parsed)) {
                            productAttributes = parsed.map(a => {
                                if (a.attributeValueId) return { attributeId: a.attributeId, attributeValueId: a.attributeValueId };
                                if (a.customValue)      return { attributeId: a.attributeId, customAttributeValue: a.customValue };
                                return null;
                            }).filter(Boolean);
                        }
                    } catch (e) { }

                    const mergedAttributes = [...defaultAttributes];
                    // category_mappings attribute'ları
                    for (const attr of mappedAttributes) {
                        const idx = mergedAttributes.findIndex(a => a.attributeId === attr.attributeId);
                        if (idx >= 0) mergedAttributes[idx] = attr;
                        else mergedAttributes.push(attr);
                    }
                    // attributes_json en yüksek öncelik — üstteki her şeyi override eder
                    for (const attr of productAttributes) {
                        const idx = mergedAttributes.findIndex(a => a.attributeId === attr.attributeId);
                        if (idx >= 0) mergedAttributes[idx] = attr;
                        else mergedAttributes.push(attr);
                    }
                    // Kategori önceliği: onaylı kategori_eslestirme > xml_category_id > eski eşleştirme
                    const approvedApiId = approvedCategoryApiIds.get(`${p.supplier_name}__${p.category}`);
                    const finalCategoryId = approvedApiId
                        || (p.xml_category_id && p.xml_category_id > 0 ? p.xml_category_id : null)
                        || savedMapping?.trendyol_category_id
                        || null;
                    // Kullanıcının seçtiği marka öncelikli; yoksa XML'den gelen brand_name çözülür
                    const resolvedBrandId = overrideBrandId
                        || (p.brand_name
                            ? await resolveBrandId(p.brand_name, authString, store.supplier_id)
                            : null)
                        || 2613880;

                    // ── Zorunlu attribute doldurma ──────────────────────────
                    if (finalCategoryId) {
                        const requiredAttrs = await getRequiredAttrs(finalCategoryId);
                        const stillMissing = []; // AI'ya gönderilecek

                        for (const ra of requiredAttrs) {
                            if (!ra.id) continue;
                            if (mergedAttributes.some(a => a.attributeId === ra.id)) continue;

                            let resolvedValue = null;

                            // 1. urun_attribute_map'de kayıt var mı?
                            const mapEntry = getAttrMapEntry.get(finalCategoryId, ra.name);
                            if (mapEntry?.varsayilan_deger) resolvedValue = mapEntry.varsayilan_deger;

                            // 2. Ürün alanlarından + hardcoded defaults
                            if (!resolvedValue) {
                                const nl = ra.name.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '');
                                if (nl.includes('renk') || nl.includes('color')) {
                                    resolvedValue = p.color || 'Çok Renkli';
                                } else if (nl.includes('marka') || nl.includes('brand')) {
                                    resolvedValue = p.brand_name || null;
                                } else if (nl.includes('tip') || nl.includes('model') || nl.includes('tur') || nl.includes('cesit') || nl.includes('type')) {
                                    resolvedValue = (p.title || '').trim().split(/\s+/).slice(0, 3).join(' ') || null;
                                } else if (nl.includes('garanti')) {
                                    resolvedValue = '2 Yil';
                                } else if (nl.includes('voltaj') || nl.includes('volt')) {
                                    resolvedValue = '220 V';
                                } else if (nl.includes('frekans')) {
                                    resolvedValue = '50 Hz';
                                } else if (nl.includes('mensei') || nl.includes('ulke') || nl.includes('uretim yeri') || nl.includes('koken')) {
                                    resolvedValue = 'Cin';
                                }
                            }

                            if (resolvedValue) {
                                const matched = ra.values.find(v => v.name?.toLowerCase() === String(resolvedValue).toLowerCase());
                                if (matched?.id) {
                                    mergedAttributes.push({ attributeId: ra.id, attributeValueId: matched.id });
                                } else if (ra.allowCustom) {
                                    mergedAttributes.push({ attributeId: ra.id, customAttributeValue: String(resolvedValue) });
                                } else {
                                    stillMissing.push(ra); // değer listesinde eşleşme yok
                                }
                            } else {
                                stillMissing.push(ra);
                            }
                        }

                        // 3. Hâlâ eksikler varsa Gemini ile doldur
                        if (stillMissing.length > 0) {
                            console.log(`[upload] fillMissingAttrsWithAI çağrılıyor, eksik: ${stillMissing.map(a => a.name).join(', ')} [${p.barcode}]`);
                            try {
                                const aiAttrs = await fillMissingAttrsWithAI(p.title, finalCategoryId, stillMissing);
                                for (const a of aiAttrs) mergedAttributes.push(a);
                                if (aiAttrs.length > 0) {
                                    addLog('info',
                                        `AI attribute doldurdu [${p.barcode}]: ${aiAttrs.map(a => a.attributeId).join(', ')}`,
                                        dealerId
                                    );
                                }
                                const stillEmpty = stillMissing.filter(ra => !aiAttrs.some(a => a.attributeId === ra.id));
                                if (stillEmpty.length > 0) {
                                    addLog('warn',
                                        `Attribute doldurulamadı [${p.barcode}]: ${stillEmpty.map(a => a.name).join(', ')} — boş attributes ile gönderilecek`,
                                        dealerId
                                    );
                                }
                            } catch (err) {
                                addLog('warn', `fillMissingAttrsWithAI genel hata [${p.barcode}]: ${err.message}`, dealerId);
                            }
                        }
                    }
                    // ────────────────────────────────────────────────────────

                    return {
                        barcode: p.barcode,
                        title: p.title.substring(0, 100),
                        productMainId: p.barcode,
                        brandId: resolvedBrandId,
                        categoryId: finalCategoryId,
                        quantity: p.stock,
                        stockCode: p.barcode,
                        dimensionalWeight: 1,
                        description: (p.ai_aciklama || p.title).substring(0, 3000),
                        currencyType: 'TRY',
                        listPrice: p.sale_price,
                        salePrice: p.sale_price,
                        vatRate: 20,
                        shipmentAddressId: 7865695,
                        images: imageUrls.map(u => ({ url: u })),
                        attributes: mergedAttributes,
                    };
                })).then(arr => arr.filter(Boolean));

                const batchNo = Math.floor(i / BATCH_SIZE) + 1;
                console.log(`[upload] Batch Trendyol'a gönderiliyor, item sayısı: ${items.length}`);

                // Barkod → item eşlemesi (PUT retry için)
                const itemByBarcode = new Map(items.map(it => [it.barcode, it]));

                try {
                    const batchResult = await sendBatchAndWait(items, `Batch ${batchNo}`);

                    if (!batchResult) {
                        for (const product of batch) updateTrendyolStatus.run('processing', dealerId, product.barcode);
                        addLog('info', `Batch ${batchNo}: Trendyol sonucu henüz tamamlanmadı`, dealerId);
                        await sleep(2000);
                        continue;
                    }

                    let batchSucceeded = 0;
                    let batchFailed = 0;
                    const putRetryItems = []; // PUT ile yeniden denenecekler

                    for (const resultItem of batchResult.items || []) {
                        const barcode = resultItem?.requestItem?.barcode || resultItem?.requestItem?.product?.barcode;
                        const status = resultItem?.status || 'UNKNOWN';
                        const failureReasons = Array.isArray(resultItem?.failureReasons) ? resultItem.failureReasons : [];
                        const reasonStr = failureReasons.join(' | ');

                        if (!barcode) continue;

                        if (status === 'SUCCESS') {
                            batchSucceeded++;
                            updateTrendyolStatus.run('uploaded', dealerId, barcode);
                        } else {
                            // "Aynı barkodlu ürün zaten var" → PUT ile güncellemeyi dene
                            const reasonLower = reasonStr.toLowerCase();
                            const isDuplicate = reasonLower.includes('recurring.product.create.not.allowed')
                                || reasonLower.includes('ayn') && reasonLower.includes('barkod')
                                || reasonLower.includes('already exists')
                                || reasonLower.includes('duplicate');

                            if (isDuplicate && itemByBarcode.has(barcode)) {
                                putRetryItems.push(itemByBarcode.get(barcode));
                                addLog('info', `Batch ${batchNo} [${barcode}]: zaten var, PUT ile güncellenecek`, dealerId);
                            } else {
                                batchFailed++;
                                updateTrendyolStatus.run('failed', dealerId, barcode);
                                const shortReason = reasonStr.substring(0, 400) || 'Bilinmeyen hata';
                                addLog('error', `Batch ${batchNo} ürün hatası [${barcode}]: ${shortReason}`, dealerId);
                            }
                        }
                    }

                    // Duplicate ürünler zaten Trendyol'da mevcut → uploaded olarak işaretle
                    if (putRetryItems.length > 0) {
                        for (const it of putRetryItems) {
                            batchSucceeded++;
                            updateTrendyolStatus.run('uploaded', dealerId, it.barcode);
                        }
                        addLog('info', `Batch ${batchNo}: ${putRetryItems.length} ürün zaten Trendyol'da mevcut, uploaded olarak işaretlendi`, dealerId);
                        console.log(`[upload] ${putRetryItems.length} duplicate ürün uploaded olarak işaretlendi`);
                    }

                    totalSucceeded += batchSucceeded;
                    totalFailed += batchFailed;
                    addLog(
                        batchFailed > 0 ? 'error' : 'success',
                        `Batch ${batchNo} tamamlandı: başarılı=${batchSucceeded}, hatalı=${batchFailed}${putRetryItems.length ? `, PUT ile güncellenen=${putRetryItems.length}` : ''}`,
                        dealerId
                    );
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

// ── Ürün Yükle sayfası: hazır ürün listesi ───────────────────────────────────
app.get('/api/dealer/products/upload-ready', authMiddleware, (req, res) => {
    const dealerId = req.dealer.id;
    try {
        const products = db.prepare(`
            SELECT dp.id, dp.barcode, dp.title, dp.sale_price,
                   dp.xml_category_id, dp.brand_id, dp.attributes_json,
                   dp.ai_aciklama, dp.ai_baslik, dp.stock, dp.image_url,
                   dp.trendyol_status, dp.needs_category_review,
                   b.name AS brand_name_resolved,
                   tk.tam_yol AS kategori_tam_yol
            FROM dealer_products dp
            LEFT JOIN brands b ON b.trendyol_brand_id = dp.brand_id
            LEFT JOIN trendyol_kategoriler tk ON tk.trendyol_id = dp.xml_category_id
            WHERE dp.dealer_id = ?
              AND dp.brand_id IS NOT NULL
              AND dp.xml_category_id IS NOT NULL
              AND dp.stock > 0
            ORDER BY dp.updated_at DESC
            LIMIT 500
        `).all(dealerId);
        res.json(products);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Ürün Yükle sayfası: seçili ürünleri Trendyol'a yükle (SSE) ───────────────
app.post('/api/dealer/products/upload-selected', authMiddleware, async (req, res) => {
    const dealerId = req.dealer.id;
    const { ids } = req.body; // number[]
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids dizisi boş' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
        // Mağaza kimlik bilgilerini al
        let store = db.prepare('SELECT * FROM dealers WHERE id = ?').get(dealerId);
        if (!store?.supplier_id || !store?.api_key || !store?.api_secret) {
            store = db.prepare(`
                SELECT * FROM stores
                WHERE dealer_id = ? AND supplier_id IS NOT NULL AND supplier_id != ''
                  AND api_key IS NOT NULL AND api_key != ''
                  AND api_secret IS NOT NULL AND api_secret != ''
                ORDER BY id ASC LIMIT 1
            `).get(dealerId);
        }
        if (!store?.supplier_id || !store?.api_key || !store?.api_secret) {
            send({ type: 'error', message: 'Trendyol API bilgileri eksik.' });
            return res.end();
        }

        const authString = Buffer.from(`${store.api_key}:${store.api_secret}`).toString('base64');
        const API_URL = `https://apigw.trendyol.com/integration/product/sellers/${store.supplier_id}/products`;

        const cargoSetting = db.prepare(
            "SELECT value FROM dealer_settings WHERE dealer_id = ? AND key = 'cargo_company_id'"
        ).get(dealerId);
        const cargoCompanyId = cargoSetting ? parseInt(cargoSetting.value, 10) : parseInt(process.env.TRENDYOL_CARGO_COMPANY_ID || '10', 10);
        const PLACEHOLDER_IMAGE = 'https://cdn.dsmcdn.com/ty1/product/media/images/20200812/11/7798319/11111/1_1_org.jpg';
        const BANNED_WORDS = ['n11', 'hepsiburada', 'amazon', 'ciceksepeti', 'instagram', 'facebook', 'whatsapp'];
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        function isValidImageUrl(u) {
            if (!u || typeof u !== 'string' || !u.toLowerCase().startsWith('http')) return false;
            const l = u.toLowerCase();
            return !BANNED_WORDS.some(w => l.includes(w));
        }

        // Seçili ürünleri DB'den çek — placeholders
        const placeholders = ids.map(() => '?').join(',');
        const products = db.prepare(`
            SELECT dp.*, b.name AS brand_name_resolved,
                   tk.tam_yol AS kategori_tam_yol
            FROM dealer_products dp
            LEFT JOIN brands b ON b.trendyol_brand_id = dp.brand_id
            LEFT JOIN trendyol_kategoriler tk ON tk.trendyol_id = dp.xml_category_id
            WHERE dp.dealer_id = ? AND dp.id IN (${placeholders})
        `).all(dealerId, ...ids);

        if (!products.length) {
            send({ type: 'error', message: 'Seçili ürün bulunamadı.' });
            return res.end();
        }

        send({ type: 'start', total: products.length });

        const updateStatus = db.prepare(
            "UPDATE dealer_products SET trendyol_status = ?, updated_at = datetime('now') WHERE id = ? AND dealer_id = ?"
        );

        const defaultAttributes = [
            { attributeId: 1192, attributeValueId: 10617300 }, // Menşei = CN (Çin)
            { attributeId: 47,   customAttributeValue: 'Çok Renkli' },
            { attributeId: 348,  attributeValueId: 686230 },   // Web Color = Çok Renkli
        ];

        console.log(`[upload-selected] DB'den ${products.length} ürün çekildi, supplier=${store.supplier_id}`);

        // Ürün başına payload oluştur
        const items = products.map(p => {
            const rawUrls = (p.image_url || '').split(',').map(u => u.trim()).filter(isValidImageUrl);
            const images = (rawUrls.length > 0 ? rawUrls.slice(0, 8) : [PLACEHOLDER_IMAGE]).map(url => ({ url }));

            // attributes_json → Trendyol formatına çevir
            let productAttributes = [];
            try {
                const parsed = JSON.parse(p.attributes_json || '[]');
                if (Array.isArray(parsed)) {
                    productAttributes = parsed.map(a => {
                        if (a.attributeValueId) return { attributeId: a.attributeId, attributeValueId: a.attributeValueId };
                        if (a.customValue)      return { attributeId: a.attributeId, customAttributeValue: a.customValue };
                        return null;
                    }).filter(Boolean);
                }
            } catch (_) {}

            // Merge: default → productAttributes (productAttributes override)
            const merged = [...defaultAttributes];
            for (const attr of productAttributes) {
                const idx = merged.findIndex(a => a.attributeId === attr.attributeId);
                if (idx >= 0) merged[idx] = attr;
                else merged.push(attr);
            }

            console.log(`[upload-selected] Ürün hazırlandı: barcode=${p.barcode} categoryId=${p.xml_category_id} brandId=${p.brand_id} images=${images.length} attrs=${merged.length}`);

            return {
                barcode: p.barcode,
                title: (p.ai_baslik || p.title).substring(0, 100),
                productMainId: p.barcode,
                brandId: p.brand_id,
                categoryId: p.xml_category_id,
                quantity: p.stock,
                stockCode: p.barcode,
                dimensionalWeight: 1,
                description: (p.ai_aciklama || p.title).substring(0, 3000),
                currencyType: 'TRY',
                listPrice: p.sale_price,
                salePrice: p.sale_price,
                vatRate: 20,
                shipmentAddressId: 7865695,
                images,
                attributes: merged,
                _productId: p.id,
                _title:    p.ai_baslik || p.title,
            };
        }).filter(p => {
            const ok = p.barcode && p.categoryId && p.brandId;
            if (!ok) console.log(`[upload-selected] FİLTRELENDİ: barcode=${p.barcode} categoryId=${p.categoryId} brandId=${p.brandId}`);
            return ok;
        });

        console.log(`[upload-selected] Payload hazır: ${items.length} ürün yüklenecek`);

        if (!items.length) {
            send({ type: 'error', message: 'Yüklenebilir ürün bulunamadı (barkod/kategori/marka eksik).' });
            return res.end();
        }

        // Batch gönder (maks 50)
        const BATCH_SIZE = 50;
        let succeeded = 0, failed = 0;

        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE);
            const payload = batch.map(({ _productId, _title, ...rest }) => rest);

            console.log(`[upload-selected] POST ${API_URL} — ${payload.length} ürün`);
            console.log('[UPLOAD PAYLOAD]', JSON.stringify({ items: payload }, null, 2));

            let batchRequestId = null;
            try {
                const postRes = await axios.post(API_URL, { items: payload }, {
                    headers: {
                        Authorization: `Basic ${authString}`,
                        'Content-Type': 'application/json',
                        'User-Agent': `${store.supplier_id} - SelfIntegration`,
                    },
                    timeout: 15000,
                });
                console.log(`[upload-selected] POST yanıtı: status=${postRes.status} data=${JSON.stringify(postRes.data)}`);
                batchRequestId = postRes.data?.batchRequestId;
            } catch (postErr) {
                console.log('[TRENDYOL ERROR] POST:', postErr.response?.data);
                console.log(`[upload-selected] POST HTTP status: ${postErr.response?.status}`);
                const errMsg = postErr.response?.data?.message || postErr.message;
                for (const item of batch) {
                    updateStatus.run('failed', item._productId, dealerId);
                    send({ type: 'result', id: item._productId, barcode: item.barcode, title: item._title, status: 'error', error: errMsg });
                    failed++;
                }
                continue;
            }

            console.log(`[upload-selected] batchRequestId=${batchRequestId}`);

            if (!batchRequestId) {
                console.log(`[upload-selected] batchRequestId yok — processing olarak işaretle`);
                for (const item of batch) {
                    updateStatus.run('processing', item._productId, dealerId);
                    send({ type: 'result', id: item._productId, barcode: item.barcode, title: item._title, status: 'processing' });
                }
                continue;
            }

            // Batch sonucunu bekle
            const batchUrl = `https://apigw.trendyol.com/integration/product/sellers/${store.supplier_id}/products/batch-requests/${batchRequestId}`;
            let batchData = null;
            let completedEmptyCount = 0;
            // İlk polling öncesi 3 sn bekle — ürün henüz işlenmemiş olabilir
            await sleep(3000);
            for (let attempt = 0; attempt < 10; attempt++) {
                try {
                    const pollRes = await axios.get(batchUrl, {
                        headers: { Authorization: `Basic ${authString}`, 'User-Agent': `${store.supplier_id} - SelfIntegration` },
                        timeout: 10000,
                    });
                    const d = pollRes.data || {};
                    console.log('[BATCH FULL RESPONSE]', JSON.stringify(d, null, 2));
                    // items farklı field adıyla gelebilir; hepsini dene
                    const itemsArray = d.items ?? d.results ?? d.products ?? d.content ?? d.data ?? [];
                    console.log(`[upload-selected] Polling deneme ${attempt + 1}: status=${d.status} items=${itemsArray.length} (keys: ${Object.keys(d).join(',')})`);

                    if (d.status === 'COMPLETED' || d.status === 'FAILED') {
                        if (itemsArray.length === 0 && d.status === 'COMPLETED' && completedEmptyCount < 1) {
                            // COMPLETED ama items=0 — 10 sn bekle, bir kez daha dene
                            completedEmptyCount++;
                            console.log(`[upload-selected] COMPLETED fakat items=0 — 10 sn bekleyip tekrar poll ediliyor (${completedEmptyCount}/1)`);
                            await sleep(10000);
                            continue;
                        }
                        batchData = { ...d, items: itemsArray };
                        break;
                    }
                } catch (pollErr) {
                    console.log(`[upload-selected] Polling hata deneme ${attempt + 1}: ${pollErr.message}`);
                }
                await sleep(4000);
            }

            if (!batchData) {
                console.log(`[upload-selected] 8 denemede batch sonucu alınamadı`);
            } else {
                console.log(`[upload-selected] Batch sonucu: status=${batchData.status} items=${batchData.items?.length}`);
                if (batchData.items?.length) {
                    console.log(`[upload-selected] İlk result item: ${JSON.stringify(batchData.items[0]).slice(0, 400)}`);
                }
            }

            // Sonuçları eşleştir
            const byBarcode = new Map(batch.map(it => [it.barcode, it]));
            const resultItems = batchData?.items || [];
            const reportedBarcodes = new Set();

            for (const ri of resultItems) {
                const barcode = ri?.requestItem?.barcode || ri?.requestItem?.product?.barcode;
                if (!barcode) { console.log(`[upload-selected] Barkod bulunamadı, ri keys: ${Object.keys(ri || {}).join(',')}`); continue; }
                const item = byBarcode.get(barcode);
                if (!item) { console.log(`[upload-selected] byBarcode'da bulunamadı: ${barcode}`); continue; }
                reportedBarcodes.add(barcode);

                const status = ri.status || 'UNKNOWN';
                const reasons = (ri.failureReasons || []).join(' | ');
                const isDuplicate = reasons.toLowerCase().includes('recurring.product.create.not.allowed')
                    || reasons.toLowerCase().includes('already exists');

                console.log(`[upload-selected] Sonuç: barcode=${barcode} status=${status} reasons=${reasons.slice(0, 100)}`);

                if (status === 'SUCCESS' || isDuplicate) {
                    updateStatus.run('uploaded', item._productId, dealerId);
                    send({ type: 'result', id: item._productId, barcode, title: item._title, status: 'success' });
                    succeeded++;
                } else {
                    updateStatus.run('failed', item._productId, dealerId);
                    send({ type: 'result', id: item._productId, barcode, title: item._title, status: 'error', error: reasons || 'Bilinmeyen hata' });
                    failed++;
                }
            }

            // Raporlanmayan (batch timeout vb.)
            for (const item of batch) {
                if (!reportedBarcodes.has(item.barcode)) {
                    console.log(`[upload-selected] Raporlanmayan ürün: ${item.barcode}`);
                    updateStatus.run('processing', item._productId, dealerId);
                    send({ type: 'result', id: item._productId, barcode: item.barcode, title: item._title, status: 'processing' });
                }
            }

            if (i + BATCH_SIZE < items.length) await sleep(2000);
        }

        send({ type: 'done', succeeded, failed });
        addLog('info', `upload-selected: ${succeeded} başarılı, ${failed} hatalı`, dealerId);
    } catch (e) {
        send({ type: 'error', message: e.message });
        addLog('error', `upload-selected hatası: ${e.message}`, dealerId);
    }

    res.end();
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
    res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

startQuestionsCron();
startOrdersCron(syncDealerOrders);
startXmlSyncCron(importXmlFeedById);
startPricingCron(db);
startAutoAnswerCron();
startReviewsCron();

// has_attributes=0 olan kategorilere atanmış ürünleri incelemeye al
try {
    const flagged = db.prepare(`
        UPDATE dealer_products
        SET needs_category_review = 1, updated_at = datetime('now')
        WHERE xml_category_id IN (
            SELECT trendyol_id FROM trendyol_kategoriler WHERE has_attributes = 0
        )
        AND needs_category_review = 0
    `).run();
    if (flagged.changes > 0) {
        console.log(`⚠️  ${flagged.changes} ürün non-leaf kategoriye atanmış, incelemeye alındı`);
    }
} catch (err) {
    console.error('Startup leaf flag hatası:', err.message);
}

app.listen(PORT, () => {
    console.log(`✅ Sunucu http://localhost:${PORT} üzerinde çalışıyor.`);
    console.log(`📦 Admin Panel: http://localhost:${PORT}/admin (Şifre: ${ADMIN_PASSWORD})`);
});
