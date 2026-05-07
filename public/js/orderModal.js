(function () {
  'use strict';

  // ── CSS ─────────────────────────────────────────────────────
  const STYLE = `
    #om-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.45);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; padding: 16px;
    }
    #om-card {
      background: #fff; border-radius: 16px; width: 100%;
      max-width: 680px; max-height: 90vh; overflow-y: auto;
      box-shadow: 0 8px 40px rgba(0,0,0,.18); display: flex; flex-direction: column;
    }
    #om-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 24px 16px; border-bottom: 1px solid #e2e8f0;
    }
    #om-header h3 { font-size: 16px; font-weight: 700; color: #1e293b; margin: 0; }
    #om-close {
      background: none; border: none; font-size: 20px; cursor: pointer;
      color: #64748b; padding: 4px 8px; border-radius: 6px; line-height: 1;
    }
    #om-close:hover { background: #f1f5f9; }
    #om-body { padding: 20px 24px; flex: 1; }
    #om-spinner { text-align: center; padding: 48px; color: #64748b; font-size: 14px; }
    .om-meta-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;
    }
    .om-meta-item { display: flex; flex-direction: column; gap: 2px; }
    .om-meta-label { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
    .om-meta-value { font-size: 13px; color: #1e293b; font-weight: 500; }
    .om-section-title {
      font-size: 12px; font-weight: 700; color: #64748b;
      text-transform: uppercase; letter-spacing: .5px;
      margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0;
    }
    .om-lines { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
    .om-line {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; background: #f8fafc; border-radius: 10px;
    }
    .om-line-img {
      width: 44px; height: 44px; border-radius: 8px; object-fit: cover;
      background: #e2e8f0; flex-shrink: 0; font-size: 18px;
      display: flex; align-items: center; justify-content: center;
    }
    .om-line-img img { width: 100%; height: 100%; border-radius: 8px; object-fit: cover; }
    .om-line-info { flex: 1; min-width: 0; }
    .om-line-title { font-size: 13px; font-weight: 500; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .om-line-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    .om-line-price { font-size: 13px; font-weight: 600; color: #1e293b; white-space: nowrap; }
    #om-footer {
      display: flex; gap: 10px; padding: 16px 24px;
      border-top: 1px solid #e2e8f0; justify-content: flex-end;
    }
    .om-btn {
      padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; border: 1px solid #e2e8f0; background: #f8fafc;
      color: #1e293b; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
    }
    .om-btn:hover { background: #f1f5f9; }
    .om-btn-primary { background: #6c63ff; color: #fff; border-color: #6c63ff; }
    .om-btn-primary:hover { background: #5b52e0; }
    .om-btn:disabled { opacity: .45; cursor: not-allowed; pointer-events: none; }
    @media (max-width: 540px) { .om-meta-grid { grid-template-columns: 1fr; } }
  `;

  function injectStyle() {
    if (document.getElementById('om-style')) return;
    const el = document.createElement('style');
    el.id = 'om-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  // ── YARDIMCILAR ─────────────────────────────────────────────
  function esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtMoney(val) {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(val || 0));
  }

  function fmtDate(val) {
    if (!val) return '-';
    const d = new Date(val);
    return isNaN(d) ? '-' : d.toLocaleDateString('tr-TR');
  }

  function avatarHtml(name) {
    const text = String(name || '?').trim();
    const initials = text.split(/\s+/).slice(0,2).map(p => p[0] || '').join('').toUpperCase() || '?';
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = text.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `<div class="om-line-img" style="background:hsl(${hue} 65% 88%);color:hsl(${hue} 55% 36%);font-size:12px;font-weight:700">${initials}</div>`;
  }

  // ── KARGO TAKİP URL ──────────────────────────────────────────
  function buildTrackingUrl(cargoCompany, trackingNumber) {
    if (!trackingNumber) return null;
    // Sayıya çevrilmeden string olarak kullan (scientific notation önlemi)
    const num = String(trackingNumber).trim();
    if (!num) return null;
    const company = String(cargoCompany || '').toLowerCase();
    if (company.includes('sürat') || company.includes('surat')) {
      return `https://www.suratkargo.com.tr/KargoTakip/?kargotakipno=${encodeURIComponent(num)}`;
    }
    if (company.includes('yurtiçi') || company.includes('yurtici')) {
      return `https://www.yurticikargo.com/tr/online-islemler/gonderi-sorgula?code=${encodeURIComponent(num)}`;
    }
    if (company.includes('mng')) {
      return `https://www.mngkargo.com.tr/gonderi-sorgula?trackingNo=${encodeURIComponent(num)}`;
    }
    if (company.includes('aras')) {
      return `https://kargotakip.araskargo.com.tr/?trackingNumber=${encodeURIComponent(num)}`;
    }
    return null;
  }

  // ── MODAL OLUŞTUR ────────────────────────────────────────────
  function createOverlay() {
    const div = document.createElement('div');
    div.id = 'om-overlay';
    div.innerHTML = `
      <div id="om-card">
        <div id="om-header">
          <h3 id="om-title">Sipariş Detayı</h3>
          <button id="om-close" title="Kapat">×</button>
        </div>
        <div id="om-body"><div id="om-spinner">Yükleniyor…</div></div>
        <div id="om-footer"></div>
      </div>`;
    return div;
  }

  function closeModal() {
    const el = document.getElementById('om-overlay');
    if (el) el.remove();
  }

  function renderModal(order) {
    document.getElementById('om-title').textContent = `Sipariş #${order.order_number}`;

    const linesHtml = (order.lines || []).map(line => {
      const imgHtml = line.image_url
        ? `<div class="om-line-img"><img src="${esc(line.image_url)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='📦'"></div>`
        : avatarHtml(line.title);
      const stockLabel = line.local_stock != null ? ` · Stok: ${line.local_stock}` : '';
      return `
        <div class="om-line">
          ${imgHtml}
          <div class="om-line-info">
            <div class="om-line-title">${esc(line.title || '-')}</div>
            <div class="om-line-sub">${esc(line.barcode || '-')}${stockLabel}</div>
          </div>
          <div class="om-line-price">${esc(String(line.quantity || 1))} × ${fmtMoney(line.price)}</div>
        </div>`;
    }).join('');

    document.getElementById('om-body').innerHTML = `
      <div class="om-meta-grid">
        <div class="om-meta-item">
          <span class="om-meta-label">Müşteri</span>
          <span class="om-meta-value">${esc(order.customer_name || '-')}</span>
        </div>
        <div class="om-meta-item">
          <span class="om-meta-label">Tarih</span>
          <span class="om-meta-value">${fmtDate(order.order_date)}</span>
        </div>
        <div class="om-meta-item">
          <span class="om-meta-label">Adres</span>
          <span class="om-meta-value">${esc(order.shipping_address || '-')}</span>
        </div>
        <div class="om-meta-item">
          <span class="om-meta-label">Kargo</span>
          <span class="om-meta-value">${esc(order.cargo_company || '-')} · ${esc(order.tracking_number || '-')}</span>
        </div>
        <div class="om-meta-item">
          <span class="om-meta-label">Toplam</span>
          <span class="om-meta-value">${fmtMoney(order.total_price)}</span>
        </div>
        <div class="om-meta-item">
          <span class="om-meta-label">Net</span>
          <span class="om-meta-value" style="color:#16a34a;font-weight:700">${fmtMoney(order.net_price)}</span>
        </div>
      </div>
      <div class="om-section-title">Ürünler</div>
      <div class="om-lines">${linesHtml || '<div style="color:#64748b;font-size:13px">Ürün satırı bulunamadı.</div>'}</div>`;

    const trackingUrl = buildTrackingUrl(order.cargo_company, order.tracking_number);
    const trackBtn = trackingUrl
      ? `<a href="${esc(trackingUrl)}" target="_blank" rel="noopener" class="om-btn">📦 Kargo Takip</a>`
      : `<button class="om-btn" disabled>📦 Kargo Takip</button>`;

    document.getElementById('om-footer').innerHTML = `
      ${trackBtn}
      <a href="${esc(order.trendyol_url)}" target="_blank" rel="noopener" class="om-btn om-btn-primary">🔗 Trendyol'da Aç</a>`;
  }

  // ── MODAL AÇ ─────────────────────────────────────────────────
  async function openModal(orderNumber) {
    closeModal();
    injectStyle();

    const overlay = createOverlay();
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.getElementById('om-close').addEventListener('click', closeModal);

    const token = localStorage.getItem('dealer_token') || sessionStorage.getItem('dealer_token') || '';

    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        document.getElementById('om-body').innerHTML =
          `<div style="color:#dc2626;padding:24px;font-size:13px">Hata: ${esc(data.error || 'Bilinmeyen hata')}</div>`;
        document.getElementById('om-footer').innerHTML = '';
        return;
      }
      renderModal(data);
    } catch (err) {
      document.getElementById('om-body').innerHTML =
        `<div style="color:#dc2626;padding:24px;font-size:13px">Bağlantı hatası: ${esc(err.message)}</div>`;
      document.getElementById('om-footer').innerHTML = '';
    }
  }

  // ── ESCAPE TUŞU ──────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // ── EVENT DELEGATION — ORDERS TBODY ──────────────────────────
  function bindOrdersTable() {
    const tbody = document.getElementById('orders-tbody');
    if (!tbody) return;
    tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-order-number]');
      if (!tr) return;
      openModal(tr.dataset.orderNumber);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOrdersTable);
  } else {
    bindOrdersTable();
  }

})();