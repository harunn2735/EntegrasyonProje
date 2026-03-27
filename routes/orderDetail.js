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
    const detail = err.response?.data?.message || 'API isteği başarısız';
    return { error: 'Trendyol API hatası', detail, status: 502 };
  }

  const items = response.data?.content || [];
  if (!items.length) return null;

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

// ── GET /api/orders/:orderNumber ──────────────────────────────
router.get('/:orderNumber', async (req, res) => {
  const dealerId = req.dealer.id;
  const { orderNumber } = req.params;

  if (!/^\d{1,20}$/.test(orderNumber)) {
    return res.status(400).json({ error: 'Geçersiz sipariş numarası' });
  }

  try {
    // 1. Local DB'den dene
    const local = fetchFromLocal(dealerId, orderNumber);
    if (local) {
      const tracking_url  = getTrackingUrl(local.cargo_company, local.tracking_number);
      const trendyol_url  = `https://partner.trendyol.com/orders/${orderNumber}`;
      return res.json({ ...local, tracking_url, trendyol_url });
    }

    // 2. Trendyol API'dan dene
    const remote = await fetchFromTrendyol(dealerId, orderNumber);

    if (!remote) {
      return res.status(404).json({ error: 'Sipariş bulunamadı' });
    }

    if (remote.error) {
      return res.status(remote.status || 502).json({ error: remote.error, detail: remote.detail });
    }

    const tracking_url = getTrackingUrl(remote.cargo_company, remote.tracking_number);
    const trendyol_url = `https://partner.trendyol.com/orders/${orderNumber}`;
    return res.json({ ...remote, tracking_url, trendyol_url });
  } catch (err) {
    return res.status(500).json({ error: 'Sunucu hatası', detail: err.message });
  }
});

module.exports = router;
