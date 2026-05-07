// public/js/stockAlertsPage.js
// Stok Uyarı Sistemi sayfası — SPA IIFE modülü.
(function () {
  'use strict';

  // ── Stiller ──────────────────────────────────────────────────────────────────
  const STYLE = `
    #page-stock {
      padding: 8px 0 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }
    .sa-shell {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
      max-width: 1180px;
      margin: 0 auto;
    }

    /* Toolbar */
    .sa-toolbar {
      background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,255,255,.92));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: var(--shadow);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .sa-toolbar-title { font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
    .sa-toolbar-sub   { font-size: 13px; color: var(--muted); }

    /* Loading / Error */
    .sa-loading { text-align: center; padding: 56px 20px; color: var(--muted); font-size: 14px; }
    .sa-error   { text-align: center; padding: 56px 20px; color: var(--red);   font-size: 14px; }
    .sa-retry-btn {
      margin-left: 10px; padding: 6px 14px;
      background: var(--bg3); border: 1px solid var(--border);
      border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; font-family: inherit; color: var(--text);
    }
    .sa-retry-btn:hover { background: var(--border); }

    /* KPI satırı */
    .sa-kpi-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }
    .sa-kpi {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px;
      position: relative;
      overflow: hidden;
    }
    .sa-kpi-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
    .sa-kpi-val   { font-size: 26px; font-weight: 700; }
    .sa-kpi-sub   { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .sa-kpi-glow  { position: absolute; top: -24px; right: -24px; width: 80px; height: 80px; border-radius: 50%; opacity: .09; }

    /* Ayarlar paneli */
    .sa-settings-panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .sa-settings-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
      border-bottom: 1px solid var(--border);
      user-select: none;
    }
    .sa-settings-head:hover { background: var(--bg3); }
    .sa-settings-body {
      padding: 20px;
      display: none;
    }
    .sa-settings-body.open { display: block; }
    .sa-slider-row {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 16px;
    }
    .sa-slider-label { font-size: 13px; color: var(--text); min-width: 120px; font-weight: 500; }
    .sa-slider { flex: 1; cursor: pointer; accent-color: var(--accent); }
    .sa-slider-val {
      font-size: 13px; font-weight: 700; min-width: 40px;
      text-align: right; color: var(--accent);
    }
    .sa-settings-preview {
      font-size: 12px; color: var(--muted);
      background: var(--bg3); border-radius: 8px;
      padding: 10px 14px; margin-bottom: 16px;
      line-height: 1.6;
    }
    .sa-save-btn {
      padding: 8px 20px; background: var(--accent);
      color: #fff; border: none; border-radius: 8px;
      font-size: 13px; font-weight: 600;
      cursor: pointer; font-family: inherit;
    }
    .sa-save-btn:hover { opacity: .88; }
    .sa-save-btn:disabled { opacity: .45; cursor: not-allowed; }

    /* Filtre bar */
    .sa-filter-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .sa-filter-btn {
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--card);
      font-size: 12px; font-weight: 600;
      cursor: pointer; font-family: inherit; color: var(--muted);
      transition: all .15s;
    }
    .sa-filter-btn:hover { background: var(--border); color: var(--text); }
    .sa-filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }

    /* Ürün kartı */
    .sa-card-list { display: flex; flex-direction: column; gap: 10px; }
    .sa-product-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 14px 18px;
    }
    .sa-product-card.critical { border-left: 4px solid #ef4444; }
    .sa-product-card.warning  { border-left: 4px solid #f59e0b; }
    .sa-product-card.ok       { border-left: 4px solid #10b981; }
    .sa-card-top {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .sa-card-badge {
      font-size: 18px;
      flex-shrink: 0;
    }
    .sa-card-title {
      flex: 1; min-width: 0;
      font-size: 14px; font-weight: 600; color: var(--text);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .sa-card-pct {
      font-size: 14px; font-weight: 700; white-space: nowrap;
    }
    .sa-card-pct.critical { color: #ef4444; }
    .sa-card-pct.warning  { color: #f59e0b; }
    .sa-card-pct.ok       { color: #10b981; }
    .sa-bar-wrap {
      height: 8px; background: var(--bg3);
      border-radius: 99px; overflow: hidden;
      margin-bottom: 10px;
    }
    .sa-bar {
      height: 100%; border-radius: 99px;
      transition: width .4s ease;
    }
    .sa-card-meta {
      display: flex; gap: 20px; flex-wrap: wrap;
      font-size: 12px; color: var(--muted);
    }
    .sa-card-meta span { white-space: nowrap; }

    /* Boş durum */
    .sa-empty {
      text-align: center; padding: 40px 20px;
      color: var(--muted); font-size: 13px;
    }

    @media (max-width: 768px) {
      .sa-kpi-row { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 480px) {
      .sa-kpi-row { grid-template-columns: 1fr; }
    }
  `;

  let styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    const el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
    styleInjected = true;
  }

  // ── Durum ─────────────────────────────────────────────────────────────────
  let _data        = null;   // getStockAlerts API yanıtı
  let _settings    = null;   // getStockSettings API yanıtı
  let _activeFilter = 'all';

  // ── Yardımcılar ──────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function barColor(pct, criticalPct, warningPct) {
    if (pct <= criticalPct) return '#ef4444';
    if (pct <= warningPct)  return '#f59e0b';
    return '#10b981';
  }

  function statusBadge(status) {
    return status === 'critical' ? '🔴' : status === 'warning' ? '🟡' : '🟢';
  }

  function timeAgo(isoStr) {
    if (!isoStr) return 'Bilinmiyor';
    const diffMs  = Date.now() - new Date(isoStr).getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin <  1)  return 'Az önce';
    if (diffMin < 60)  return `${diffMin} dakika önce`;
    const diffH = Math.round(diffMin / 60);
    if (diffH   < 24)  return `${diffH} saat önce`;
    return `${Math.round(diffH / 24)} gün önce`;
  }

  function previewText(criticalPct, warningPct) {
    if (!_data) return '';
    const all    = [..._data.critical, ..._data.warning, ..._data.ok];
    const newCrit = all.filter(p => p.stockPct <= criticalPct).length;
    const newWarn = all.filter(p => p.stockPct > criticalPct && p.stockPct <= warningPct).length;
    return `Bu ayarla <strong>${newCrit}</strong> ürün kritik, <strong>${newWarn}</strong> ürün uyarıda görünür.`;
  }

  // ── Render: KPI ──────────────────────────────────────────────────────────
  function renderKPIs(summary) {
    return `
      <div class="sa-kpi-row">
        <div class="sa-kpi">
          <div class="sa-kpi-label">Toplam Ürün</div>
          <div class="sa-kpi-val">${summary.totalProducts}</div>
          <div class="sa-kpi-sub">Takipte</div>
          <div class="sa-kpi-glow" style="background:var(--accent)"></div>
        </div>
        <div class="sa-kpi">
          <div class="sa-kpi-label">🔴 Kritik</div>
          <div class="sa-kpi-val" style="color:#ef4444">${summary.criticalCount}</div>
          <div class="sa-kpi-sub">Acil müdahale gerekiyor</div>
          <div class="sa-kpi-glow" style="background:#ef4444"></div>
        </div>
        <div class="sa-kpi">
          <div class="sa-kpi-label">🟡 Uyarı</div>
          <div class="sa-kpi-val" style="color:#f59e0b">${summary.warningCount}</div>
          <div class="sa-kpi-sub">Yakın takipte tut</div>
          <div class="sa-kpi-glow" style="background:#f59e0b"></div>
        </div>
        <div class="sa-kpi">
          <div class="sa-kpi-label">🟢 Normal</div>
          <div class="sa-kpi-val" style="color:#10b981">${summary.okCount}</div>
          <div class="sa-kpi-sub">Son sync: ${timeAgo(summary.lastSyncAt)}</div>
          <div class="sa-kpi-glow" style="background:#10b981"></div>
        </div>
      </div>`;
  }

  // ── Render: Ayarlar paneli ────────────────────────────────────────────────
  function renderSettings() {
    const cPct = _settings ? _settings.criticalPct : 10;
    const wPct = _settings ? _settings.warningPct  : 20;
    return `
      <div class="sa-settings-panel">
        <div class="sa-settings-head" onclick="window._saToggleSettings()">
          ⚙️ Eşik Ayarları
          <span id="sa-settings-arrow">▼</span>
        </div>
        <div class="sa-settings-body" id="sa-settings-body">
          <div class="sa-slider-row">
            <span class="sa-slider-label">Kritik eşik</span>
            <input type="range" class="sa-slider" id="sa-slider-critical"
              min="1" max="99" value="${cPct}"
              oninput="window._saSliderChange()">
            <span class="sa-slider-val" id="sa-val-critical">%${cPct}</span>
          </div>
          <div class="sa-slider-row">
            <span class="sa-slider-label">Uyarı eşiği</span>
            <input type="range" class="sa-slider" id="sa-slider-warning"
              min="2" max="50" value="${wPct}"
              oninput="window._saSliderChange()">
            <span class="sa-slider-val" id="sa-val-warning">%${wPct}</span>
          </div>
          <div class="sa-settings-preview" id="sa-settings-preview">
            ${previewText(cPct, wPct)}
          </div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:12px">
            📊 Referans: XML feed'indeki maksimum stok değeri
          </div>
          <button class="sa-save-btn" id="sa-save-btn" onclick="window._saSaveSettings()">
            💾 Kaydet
          </button>
        </div>
      </div>`;
  }

  // ── Render: Ürün kartı ────────────────────────────────────────────────────
  function renderCard(product) {
    const { criticalPct, warningPct } = _settings || { criticalPct: 10, warningPct: 20 };
    const color  = barColor(product.stockPct, criticalPct, warningPct);
    const barPct = Math.min(product.stockPct, 100);
    return `
      <div class="sa-product-card ${product.status}">
        <div class="sa-card-top">
          <span class="sa-card-badge">${statusBadge(product.status)}</span>
          <span class="sa-card-title" title="${esc(product.title)}">${esc(product.title)}</span>
          <span class="sa-card-pct ${product.status}">%${product.stockPct}</span>
        </div>
        <div class="sa-bar-wrap">
          <div class="sa-bar" style="width:${barPct}%;background:${color}"></div>
        </div>
        <div class="sa-card-meta">
          <span>📦 Stok: <strong>${product.currentStock.toLocaleString('tr')}</strong> / Referans: ${(product.refStock || 0).toLocaleString('tr')}</span>
          ${product.supplierName ? `<span>🏭 ${esc(product.supplierName)}</span>` : ''}
          ${product.feedName     ? `<span>🔗 ${esc(product.feedName)}</span>`     : ''}
          <span>🕐 ${timeAgo(product.updatedAt)}</span>
        </div>
      </div>`;
  }

  // ── Render: Ürün listesi ──────────────────────────────────────────────────
  function renderProductList() {
    if (!_data) return '';

    let list;
    if      (_activeFilter === 'critical') list = _data.critical;
    else if (_activeFilter === 'warning')  list = _data.warning;
    else if (_activeFilter === 'ok')       list = _data.ok;
    else                                   list = [..._data.critical, ..._data.warning, ..._data.ok];

    const filterBar = `
      <div class="sa-filter-bar">
        <button class="sa-filter-btn ${_activeFilter === 'all'      ? 'active' : ''}" onclick="window._saFilter('all')">Tümü (${_data.summary.totalProducts})</button>
        <button class="sa-filter-btn ${_activeFilter === 'critical' ? 'active' : ''}" onclick="window._saFilter('critical')">🔴 Kritik (${_data.summary.criticalCount})</button>
        <button class="sa-filter-btn ${_activeFilter === 'warning'  ? 'active' : ''}" onclick="window._saFilter('warning')">🟡 Uyarı (${_data.summary.warningCount})</button>
        <button class="sa-filter-btn ${_activeFilter === 'ok'       ? 'active' : ''}" onclick="window._saFilter('ok')">🟢 Normal (${_data.summary.okCount})</button>
      </div>`;

    const cards = list.length
      ? `<div class="sa-card-list">${list.map(renderCard).join('')}</div>`
      : `<div class="sa-empty">Bu filtreye uyan ürün bulunamadı.</div>`;

    return filterBar + cards;
  }

  // ── Sayfa iskeleti ────────────────────────────────────────────────────────
  function renderShell() {
    return `
      <div class="sa-shell">
        <div class="sa-toolbar">
          <div>
            <h2 class="sa-toolbar-title">📦 Stok Uyarıları</h2>
            <p class="sa-toolbar-sub">XML feed'den gelen anlık stok durumu</p>
          </div>
        </div>
        <div id="sa-body">
          <div class="sa-loading">⏳ Veriler yükleniyor...</div>
        </div>
      </div>`;
  }

  // ── Tam sayfa render ──────────────────────────────────────────────────────
  function renderAll() {
    const body = document.getElementById('sa-body');
    if (!body || !_data || !_settings) return;
    body.innerHTML =
      renderKPIs(_data.summary) +
      renderSettings() +
      renderProductList();
  }

  // ── Global handler'lar ────────────────────────────────────────────────────
  window._saFilter = function (filter) {
    _activeFilter = filter;
    const body = document.getElementById('sa-body');
    if (!body) return;
    // Sadece filtre bar + liste bölümünü güncelle
    const listEl = document.getElementById('sa-list-section');
    if (listEl) {
      listEl.innerHTML = renderProductList();
    } else {
      renderAll();
    }
    renderAll();
  };

  window._saToggleSettings = function () {
    const panel = document.getElementById('sa-settings-body');
    const arrow = document.getElementById('sa-settings-arrow');
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    if (arrow) arrow.textContent = isOpen ? '▲' : '▼';
  };

  window._saSliderChange = function () {
    const cEl = document.getElementById('sa-slider-critical');
    const wEl = document.getElementById('sa-slider-warning');
    const cValEl = document.getElementById('sa-val-critical');
    const wValEl = document.getElementById('sa-val-warning');
    const previewEl = document.getElementById('sa-settings-preview');
    if (!cEl || !wEl) return;

    let cPct = Number(cEl.value);
    let wPct = Number(wEl.value);

    // Kritik uyarıdan büyük olmasın
    if (cPct >= wPct) {
      wPct = cPct + 1;
      wEl.value = wPct;
    }

    if (cValEl) cValEl.textContent = `%${cPct}`;
    if (wValEl) wValEl.textContent = `%${wPct}`;
    if (previewEl) previewEl.innerHTML = previewText(cPct, wPct);
  };

  window._saSaveSettings = async function () {
    const cEl = document.getElementById('sa-slider-critical');
    const wEl = document.getElementById('sa-slider-warning');
    const btn = document.getElementById('sa-save-btn');
    if (!cEl || !wEl || !btn) return;

    const criticalPct = Number(cEl.value);
    const warningPct  = Number(wEl.value);

    btn.disabled = true;
    btn.textContent = '⏳ Kaydediliyor...';
    try {
      const result = await window.api('/api/stock/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criticalPct, warningPct }),
      });
      if (!result) return;
      _settings.criticalPct = criticalPct;
      _settings.warningPct  = warningPct;
      window.toast('✅ Ayarlar kaydedildi', 'success');
      renderAll();
    } catch (e) {
      window.toast('❌ Kayıt hatası: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Kaydet'; }
    }
  };

  // ── Veri yükle ───────────────────────────────────────────────────────────
  async function loadData() {
    const body = document.getElementById('sa-body');
    if (!body) return;

    try {
      const [alerts, settings] = await Promise.all([
        window.api('/api/stock/alerts'),
        window.api('/api/stock/settings'),
      ]);
      if (!alerts || !settings) return;

      _data        = alerts;
      _settings    = settings;
      _activeFilter = 'all';

      renderAll();
    } catch (e) {
      body.innerHTML = `
        <div class="sa-error">
          ❌ Veriler yüklenemedi: ${esc(e.message)}
          <button class="sa-retry-btn" onclick="window.loadStockAlertsPage()">Tekrar Dene</button>
        </div>`;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectStyle();
    const container = document.getElementById('page-stock');
    if (!container) return;
    container.innerHTML = renderShell();
    loadData();
  }

  window.loadStockAlertsPage = init;

})();
