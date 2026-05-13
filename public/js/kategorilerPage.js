// public/js/kategorilerPage.js
(function () {
  'use strict';

  const STYLE = `
    #page-categories {
      padding: 8px 0 0;
    }
    .km-shell {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 1180px;
      margin: 0 auto;
    }
    .km-toolbar {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: var(--shadow);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    .km-filter-tabs {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .km-filter-btn {
      padding: 7px 16px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: var(--muted);
      font-family: inherit;
      transition: .15s ease;
    }
    .km-filter-btn:hover { color: var(--text); }
    .km-filter-btn.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .km-filter-btn.badge-yellow.active {
      background: var(--yellow);
      border-color: var(--yellow);
    }
    .km-toolbar-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .km-selection-info {
      font-size: 13px;
      color: var(--muted);
      min-width: 120px;
    }
    .km-card {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .km-table-wrap {
      overflow-x: auto;
    }
    .km-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .km-table th {
      background: var(--bg3);
      padding: 12px 14px;
      text-align: left;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    .km-table td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    .km-table tr:last-child td { border-bottom: none; }
    .km-table tr:hover td { background: var(--bg3); }
    .km-table tr.km-pending td { background: rgba(234,179,8,0.05); }
    .km-table tr.km-pending:hover td { background: rgba(234,179,8,0.1); }
    .km-product-title {
      font-weight: 600;
      color: var(--text);
      margin-bottom: 2px;
      line-height: 1.3;
    }
    .km-product-meta {
      font-size: 11px;
      color: var(--muted);
    }
    .km-cat-path {
      font-size: 12px;
      color: var(--text);
      line-height: 1.4;
    }
    .km-cat-missing {
      font-size: 12px;
      color: var(--red);
      font-style: italic;
    }
    .km-conf-bar-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 100px;
    }
    .km-conf-bar {
      flex: 1;
      height: 6px;
      background: var(--bg3);
      border-radius: 3px;
      overflow: hidden;
    }
    .km-conf-fill {
      height: 100%;
      border-radius: 3px;
      transition: width .3s;
    }
    .km-conf-val {
      font-size: 11px;
      font-weight: 600;
      min-width: 30px;
      text-align: right;
    }
    .km-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 9px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .km-badge-pending { background: rgba(234,179,8,0.15); color: var(--yellow); }
    .km-badge-approved { background: rgba(22,163,74,0.12); color: var(--green); }
    .km-badge-missing { background: rgba(220,38,38,0.12); color: var(--red); }
    .km-actions { white-space: nowrap; }
    .km-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      border-top: 1px solid var(--border);
      background: var(--bg3);
      font-size: 13px;
      color: var(--muted);
    }
    .km-pagination {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .km-page-btn {
      padding: 5px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--bg2);
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      font-family: inherit;
      transition: .15s;
    }
    .km-page-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
    .km-page-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .km-page-btn:disabled { opacity: .4; cursor: not-allowed; }
    .km-empty {
      text-align: center;
      padding: 48px 24px;
      color: var(--muted);
    }
    .km-empty .km-empty-icon { font-size: 40px; margin-bottom: 12px; }
    .km-summary-bar {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    .km-summary-item {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .km-summary-num {
      font-size: 22px;
      font-weight: 700;
    }
    .km-summary-label {
      font-size: 11px;
      color: var(--muted);
      font-weight: 500;
    }

    /* ── Attribute Modal ── */
    .km-attr-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.4);
      z-index: 300;
      display: none;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(4px);
    }
    .km-attr-modal {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      width: 90%;
      max-width: 560px;
      max-height: 85vh;
      overflow-y: auto;
      box-shadow: 0 8px 40px rgba(0,0,0,.18);
    }
    .km-attr-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }
    .km-attr-title { font-size: 15px; font-weight: 700; color: var(--text); }
    .km-attr-subtitle { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .km-attr-close {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 18px;
      color: var(--muted);
      padding: 4px 6px;
      border-radius: 6px;
      line-height: 1;
    }
    .km-attr-close:hover { background: var(--bg3); }
    .km-attr-field { margin-bottom: 14px; }
    .km-attr-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 5px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .km-attr-required { color: var(--red); font-size: 13px; }
    .km-attr-select, .km-attr-input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg3);
      color: var(--text);
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border-color .15s;
      box-sizing: border-box;
    }
    .km-attr-select:focus, .km-attr-input:focus { border-color: var(--accent); }
    .km-attr-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .km-attr-count {
      font-size: 11px;
      color: var(--accent);
      font-weight: 600;
      margin-left: 4px;
    }
    /* ── Auto-fill Modal ── */
    .km-af-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.4);
      z-index: 400;
      display: none;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(4px);
    }
    .km-af-modal {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px;
      width: 90%;
      max-width: 560px;
      box-shadow: 0 8px 40px rgba(0,0,0,.18);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .km-af-progress-wrap {
      background: var(--bg3);
      border-radius: 8px;
      height: 10px;
      overflow: hidden;
    }
    .km-af-progress-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--accent2));
      border-radius: 8px;
      transition: width .4s ease;
      width: 0%;
    }
    .km-af-log {
      max-height: 180px;
      overflow-y: auto;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.7;
      font-family: monospace;
    }
  `;

  let kFilter = 'all';
  let kPage = 1;
  let kTotal = 0;
  let kTotalPages = 1;
  let kSelectedIds = new Set();
  let kData = [];
  let kPendingCount = 0;
  let kStyleInjected = false;

  // Attribute modal state
  let kmAttrProductId = null;
  let kmAttrCategoryId = null;
  let kmAttrList = [];
  let kmAttrCurrentJson = [];

  function injectStyle() {
    if (kStyleInjected) return;
    const el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
    kStyleInjected = true;
  }

  function esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function confColor(score) {
    const pct = Math.round((score || 0) * 100);
    if (pct >= 75) return 'var(--green)';
    if (pct >= 50) return 'var(--yellow)';
    return 'var(--red)';
  }

  function renderStatusBadge(row) {
    if (row.trendyol_id == null) {
      return `<span class="km-badge km-badge-missing">❌ Eksik</span>`;
    }
    if (row.needs_category_review) {
      return `<span class="km-badge km-badge-pending">⏳ Onay Bekliyor</span>`;
    }
    return `<span class="km-badge km-badge-approved">✅ Onaylandı</span>`;
  }

  function renderConfidence(row) {
    if (row.guven_skoru == null) {
      if (!row.needs_category_review && row.trendyol_id != null) {
        return '<span style="font-size:11px;color:var(--muted);background:var(--bg2);padding:2px 6px;border-radius:4px">Manuel</span>';
      }
      return '<span style="font-size:12px;color:var(--muted)">—</span>';
    }
    const pct = Math.round((row.guven_skoru) * 100);
    const color = confColor(row.guven_skoru);
    return `
      <div class="km-conf-bar-wrap">
        <div class="km-conf-bar"><div class="km-conf-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="km-conf-val" style="color:${color}">%${pct}</div>
      </div>`;
  }

  function renderCategoryPath(row) {
    if (row.tam_yol) return `<div class="km-cat-path">${esc(row.tam_yol)}</div>`;
    if (row.trendyol_id) return `<div class="km-cat-path" style="color:var(--muted);font-style:italic">ID: ${row.trendyol_id}</div>`;
    return `<div class="km-cat-missing">Kategori yok</div>`;
  }

  function renderRows() {
    if (!kData.length) {
      return `<tr><td colspan="7"><div class="km-empty"><div class="km-empty-icon">📂</div><div>Bu filtreye ait ürün bulunamadı</div></div></td></tr>`;
    }
    return kData.map(row => {
      const checked = kSelectedIds.has(row.id) ? 'checked' : '';
      const pendingClass = row.needs_category_review ? ' km-pending' : '';
      const catId = row.trendyol_cat_id || row.trendyol_id;
      const attrCount = (() => { try { return JSON.parse(row.attributes_json || '[]').length; } catch(_) { return 0; } })();
      const attrLabel = attrCount > 0 ? `📋<span class="km-attr-count">${attrCount}</span>` : '📋';
      const attrBtn = (!row.needs_category_review && catId)
        ? ` <button class="btn btn-sm btn-ghost" onclick="kmOpenAttrModal(${row.id}, ${catId})" title="Attribute düzenle" style="gap:3px">${attrLabel}</button>`
        : '';
      const actionBtns = row.needs_category_review
        ? `<button class="btn btn-sm" style="background:var(--yellow);color:#000;border:none" onclick="kmOpenApprove(${row.id})">✅ Onayla</button>`
        : `<button class="btn btn-sm btn-ghost" onclick="kmOpenApprove(${row.id})">✏️ Değiştir</button>${attrBtn}`;
      return `
        <tr class="${pendingClass}">
          <td style="width:36px"><input type="checkbox" class="km-checkbox" data-id="${row.id}" ${checked} onchange="kmToggleSelect(${row.id}, this.checked)" style="cursor:pointer;width:16px;height:16px"></td>
          <td style="max-width:260px">
            <div class="km-product-title">${esc(row.title)}</div>
            <div class="km-product-meta">${esc(row.barcode)}${row.brand_name ? ' · ' + esc(row.brand_name) : ''}</div>
          </td>
          <td style="max-width:280px">${renderCategoryPath(row)}</td>
          <td>${renderConfidence(row)}</td>
          <td>${renderStatusBadge(row)}</td>
          <td class="km-actions">${actionBtns}</td>
        </tr>`;
    }).join('');
  }

  function renderPagination() {
    if (kTotalPages <= 1) return '';
    const pages = [];
    const start = Math.max(1, kPage - 2);
    const end = Math.min(kTotalPages, kPage + 2);
    for (let i = start; i <= end; i++) {
      pages.push(`<button class="km-page-btn${i === kPage ? ' active' : ''}" onclick="kmGoPage(${i})">${i}</button>`);
    }
    return `
      <div class="km-pagination">
        <button class="km-page-btn" onclick="kmGoPage(${kPage - 1})" ${kPage === 1 ? 'disabled' : ''}>‹</button>
        ${pages.join('')}
        <button class="km-page-btn" onclick="kmGoPage(${kPage + 1})" ${kPage === kTotalPages ? 'disabled' : ''}>›</button>
      </div>`;
  }

  function renderPage() {
    const el = document.getElementById('page-categories');
    if (!el) return;
    const allSelected = kData.length > 0 && kData.every(r => kSelectedIds.has(r.id));
    const selCount = kSelectedIds.size;
    el.innerHTML = `
      <div class="content">
        <div class="km-shell">
          <div class="km-toolbar">
            <div>
              <div class="km-filter-tabs">
                <button class="km-filter-btn${kFilter === 'all' ? ' active' : ''}" onclick="kmSetFilter('all')">Tümü (${kTotal > 0 && kFilter === 'all' ? kTotal : '…'})</button>
                <button class="km-filter-btn badge-yellow${kFilter === 'pending' ? ' active' : ''}" onclick="kmSetFilter('pending')">⏳ Onay Bekliyor${kPendingCount > 0 ? ' (' + kPendingCount + ')' : ''}</button>
                <button class="km-filter-btn${kFilter === 'approved' ? ' active' : ''}" onclick="kmSetFilter('approved')">✅ Onaylandı</button>
                <button class="km-filter-btn${kFilter === 'missing' ? ' active' : ''}" onclick="kmSetFilter('missing')">❌ Eksik</button>
              </div>
            </div>
            <div class="km-toolbar-right">
              <div class="km-selection-info">${selCount > 0 ? selCount + ' ürün seçildi' : ''}</div>
              <button class="btn btn-success btn-sm" onclick="kmBulkApprove()" ${selCount === 0 ? 'disabled style="opacity:.5;cursor:not-allowed"' : ''}>
                ✅ Seçilenleri Onayla
              </button>
              <button class="btn btn-ghost btn-sm" onclick="kmBulkAiMatch()" title="Seçilenleri AI ile yeniden eşleştir">🤖 Seçilenleri Eşleştir</button>
              <button class="btn btn-ghost btn-sm" id="km-rematch-btn" onclick="kmRematchAll()" title="Onay bekleyen tüm ürünleri yeni prompt ile yeniden eşleştir">🔄 Tümünü Yeniden Eşleştir${kPendingCount > 0 ? ' (' + kPendingCount + ')' : ''}</button>
              <button class="btn btn-ghost btn-sm" onclick="kmOpenAutoFill()" title="AI ile attribute_json boş ürünleri toplu doldur" style="color:var(--accent)">📋 Toplu AI Doldur</button>
              <button class="btn btn-ghost btn-sm" onclick="kmOpenVerifyXml()" title="XML'den gelen kategorileri AI ile doğrulat" style="color:var(--accent)">🔍 XML Doğrulat</button>
            </div>
          </div>

          <div class="km-card">
            <div class="km-table-wrap">
              <table class="km-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" id="km-select-all" ${allSelected ? 'checked' : ''} onchange="kmToggleAll(this.checked)" style="cursor:pointer;width:16px;height:16px"></th>
                    <th>Ürün</th>
                    <th>Trendyol Kategorisi</th>
                    <th>Güven</th>
                    <th>Durum</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>${renderRows()}</tbody>
              </table>
            </div>
            <div class="km-footer">
              <div>Toplam <b>${kTotal}</b> ürün${kPendingCount > 0 ? ` · <span style="color:var(--yellow);font-weight:600">${kPendingCount} onay bekliyor</span>` : ''}</div>
              ${renderPagination()}
            </div>
          </div>
        </div>
      </div>`;
  }

  async function kLoadData() {
    const el = document.getElementById('page-categories');
    if (!el) return;
    el.innerHTML = '<div class="content" style="text-align:center;padding:60px;color:var(--muted)">Yükleniyor…</div>';
    try {
      const d = await api(`/api/dealer/categories/all?filter=${kFilter}&page=${kPage}&limit=50`);
      kData = d.products || [];
      kTotal = d.total || 0;
      kTotalPages = d.totalPages || 1;
      kPendingCount = d.pending_count || 0;
      // Remove selected IDs that are no longer in current data set
      const currentIds = new Set(kData.map(r => r.id));
      for (const id of kSelectedIds) {
        if (!currentIds.has(id)) kSelectedIds.delete(id);
      }
      renderPage();
    } catch (e) {
      if (el) el.innerHTML = `<div class="content" style="color:var(--red);padding:40px">${e.message}</div>`;
    }
  }

  // ── Public API ──────────────────────────────────────────────
  window.loadKategorilerPage = function () {
    injectStyle();
    kmInjectAttrModal();
    kmInjectAutoFillModal();
    kmInjectVerifyXmlModal();
    kPage = 1;
    kSelectedIds = new Set();
    kLoadData();
    // Set callback so camApprove refreshes this page when called from here
    window._postCatApprove = function () { kLoadData(); };
  };

  window.kmSetFilter = function (f) {
    kFilter = f;
    kPage = 1;
    kSelectedIds = new Set();
    kLoadData();
  };

  window.kmGoPage = function (p) {
    if (p < 1 || p > kTotalPages) return;
    kPage = p;
    kLoadData();
  };

  window.kmToggleSelect = function (id, checked) {
    if (checked) kSelectedIds.add(id);
    else kSelectedIds.delete(id);
    // Update select-all checkbox state
    const selectAll = document.getElementById('km-select-all');
    if (selectAll) selectAll.checked = kData.length > 0 && kData.every(r => kSelectedIds.has(r.id));
    // Update toolbar selection count
    const info = document.querySelector('.km-selection-info');
    if (info) info.textContent = kSelectedIds.size > 0 ? kSelectedIds.size + ' ürün seçildi' : '';
    const bulkBtn = document.querySelector('.km-toolbar-right .btn-success');
    if (bulkBtn) {
      bulkBtn.disabled = kSelectedIds.size === 0;
      bulkBtn.style.opacity = kSelectedIds.size === 0 ? '.5' : '1';
      bulkBtn.style.cursor = kSelectedIds.size === 0 ? 'not-allowed' : 'pointer';
    }
  };

  window.kmToggleAll = function (checked) {
    kData.forEach(r => {
      if (checked) kSelectedIds.add(r.id);
      else kSelectedIds.delete(r.id);
    });
    document.querySelectorAll('.km-checkbox').forEach(cb => { cb.checked = checked; });
    const info = document.querySelector('.km-selection-info');
    if (info) info.textContent = kSelectedIds.size > 0 ? kSelectedIds.size + ' ürün seçildi' : '';
    const bulkBtn = document.querySelector('.km-toolbar-right .btn-success');
    if (bulkBtn) {
      bulkBtn.disabled = kSelectedIds.size === 0;
      bulkBtn.style.opacity = kSelectedIds.size === 0 ? '.5' : '1';
      bulkBtn.style.cursor = kSelectedIds.size === 0 ? 'not-allowed' : 'pointer';
    }
  };

  window.kmBulkApprove = async function () {
    if (kSelectedIds.size === 0) return;
    const ids = Array.from(kSelectedIds);
    try {
      const btn = document.querySelector('.km-toolbar-right .btn-success');
      if (btn) { btn.disabled = true; btn.textContent = 'Onaylanıyor…'; }
      await api('/api/dealer/categories/bulk-approve', {
        method: 'PUT',
        body: JSON.stringify({ ids })
      });
      kSelectedIds.clear();
      toast(`${ids.length} ürün kategorisi onaylandı`, 'success');
      kLoadData();
    } catch (e) {
      toast(e.message, 'error');
      kLoadData();
    }
  };

  window.kmBulkAiMatch = async function () {
    if (kSelectedIds.size === 0) { toast('Önce ürün seçin', 'info'); return; }
    const ids = Array.from(kSelectedIds);
    try {
      const btn = document.querySelector('.km-toolbar-right .btn-ghost');
      if (btn) { btn.disabled = true; btn.textContent = '🤖 Eşleştiriliyor…'; }
      await api('/api/dealer/products/bulk-ai-match', {
        method: 'POST',
        body: JSON.stringify({ productIds: ids })
      });
      kSelectedIds.clear();
      toast('AI eşleştirme tamamlandı', 'success');
      kLoadData();
    } catch (e) {
      toast(e.message, 'error');
      kLoadData();
    }
  };

  window.kmRematchAll = async function () {
    if (kPendingCount === 0) { toast('Onay bekleyen ürün yok', 'info'); return; }
    const btn = document.getElementById('km-rematch-btn');
    if (btn) { btn.disabled = true; btn.textContent = '🔄 Eşleştiriliyor…'; }
    try {
      const d = await api('/api/dealer/categories/rematch-pending', { method: 'POST' });
      toast(`${d.remapped} ürün yeniden eşleştirildi (${d.categories} kategori sorgulandı). Sonuçları gözden geçirin.`, 'success');
      kFilter = 'pending';
      kPage = 1;
      kSelectedIds.clear();
      kLoadData();
    } catch (e) {
      toast(e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Tümünü Yeniden Eşleştir'; }
    }
  };

  window.kmOpenApprove = function (productId) {
    const row = kData.find(r => r.id === productId);
    if (!row) return;
    // Map API field names to what openCatApproveModal expects
    const productData = {
      eslestirme_id: row.eslestirme_id,
      title: row.title,
      barcode: row.barcode,
      tam_yol: row.tam_yol,
      guven_skoru: row.guven_skoru,
      trendyol_category_id: row.trendyol_id
    };
    // Set callback so camApprove refreshes this page
    window._postCatApprove = function () { kLoadData(); };
    openCatApproveModal(productId, productData);
  };

  // ── Attribute Modal ────────────────────────────────────────────

  function kmInjectAttrModal() {
    if (document.getElementById('km-attr-overlay')) return;
    const el = document.createElement('div');
    el.id = 'km-attr-overlay';
    el.className = 'km-attr-overlay';
    el.innerHTML = `
      <div class="km-attr-modal" id="km-attr-modal">
        <div class="km-attr-header">
          <span id="km-attr-title" class="km-attr-title">Attribute Düzenle</span>
          <button class="btn btn-ghost btn-sm" onclick="kmCloseAttrModal()">✕</button>
        </div>
        <div id="km-attr-body">
          <div style="text-align:center;color:var(--muted);font-size:13px;padding:40px 0">Yükleniyor…</div>
        </div>
        <div class="km-attr-footer">
          <button class="btn btn-ghost btn-sm" onclick="kmCloseAttrModal()">İptal</button>
          <button class="btn btn-primary btn-sm" onclick="kmSaveAttributes()">💾 Kaydet</button>
        </div>
      </div>`;
    el.addEventListener('click', function (e) { if (e.target === el) kmCloseAttrModal(); });
    document.body.appendChild(el);
  }

  window.kmOpenAttrModal = async function (productId, trendyolCategoryId) {
    kmAttrProductId = productId;
    kmAttrCategoryId = trendyolCategoryId;
    const row = kData.find(r => r.id === productId);
    try { kmAttrCurrentJson = JSON.parse(row?.attributes_json || '[]'); } catch (_) { kmAttrCurrentJson = []; }

    const overlay = document.getElementById('km-attr-overlay');
    if (!overlay) return;
    const titleEl = document.getElementById('km-attr-title');
    if (titleEl) titleEl.textContent = `Attribute Düzenle — ${row?.title || ''}`;
    const body = document.getElementById('km-attr-body');
    if (body) body.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:40px 0">Yükleniyor…</div>';
    overlay.style.display = 'flex';

    try {
      const token = localStorage.getItem('dealer_token') || localStorage.getItem('token');
      const r = await fetch(`/api/dealer/trendyol-categories/${trendyolCategoryId}/attributes-v2`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) throw new Error(`Sunucu hatası (${r.status})`);
      kmAttrList = await r.json();
      kmRenderAttrForm();
    } catch (err) {
      if (body) body.innerHTML = `<div style="color:var(--red);font-size:13px;padding:20px">⚠️ ${err.message}</div>`;
    }
  };

  function kmRenderAttrForm() {
    const body = document.getElementById('km-attr-body');
    if (!body) return;
    if (!kmAttrList.length) {
      body.innerHTML = `<div style="color:var(--muted);font-size:13px;text-align:center;padding:40px 0;line-height:1.7">
        Trendyol bu kategori için attribute tanımlamıyor.<br>
        <span style="font-size:12px">Bu genellikle üst (geniş) kategorilerde görülür.<br>Ürünü daha spesifik bir alt kategoriye taşımayı deneyin.</span>
      </div>`;
      return;
    }

    const savedMap = {};
    kmAttrCurrentJson.forEach(a => {
      savedMap[a.attributeId] = { valueId: a.attributeValueId, custom: a.customValue };
    });

    body.innerHTML = kmAttrList.map(attr => {
      const isRequired = attr.required ? ' <span style="color:var(--red)">*</span>' : '';
      const savedEntry = savedMap[attr.id];

      if (attr.values && attr.values.length > 0) {
        const savedVal = String(savedEntry?.valueId ?? '');
        const opts = attr.values.map(v =>
          `<option value="${v.id}" ${savedVal === String(v.id) ? 'selected' : ''}>${v.name}</option>`
        ).join('');
        return `
          <div class="km-attr-field">
            <label class="km-attr-label">${attr.name}${isRequired}</label>
            <select class="km-attr-select" data-attr-id="${attr.id}" data-required="${attr.required ? 1 : 0}">
              <option value="">-- Seçiniz --</option>
              ${opts}
            </select>
          </div>`;
      }

      const savedCustom = String(savedEntry?.custom ?? '').replace(/"/g, '&quot;');
      return `
        <div class="km-attr-field">
          <label class="km-attr-label">${attr.name}${isRequired}</label>
          <input class="km-attr-input" type="text" data-attr-id="${attr.id}" data-required="${attr.required ? 1 : 0}"
            value="${savedCustom}" placeholder="${attr.name} giriniz…" />
        </div>`;
    }).join('');
  }

  window.kmSaveAttributes = async function () {
    const body = document.getElementById('km-attr-body');
    if (!body) return;

    const fields = body.querySelectorAll('[data-attr-id]');
    const attributes = [];
    let missing = [];

    fields.forEach(el => {
      const attrId = Number(el.dataset.attrId);
      const isRequired = el.dataset.required === '1';
      const val = el.value.trim();
      if (!val) {
        if (isRequired) missing.push(attrId);
        return;
      }
      const isSelect = el.tagName === 'SELECT';
      if (isSelect) {
        attributes.push({ attributeId: attrId, attributeValueId: Number(val) });
      } else {
        attributes.push({ attributeId: attrId, customValue: val });
      }
    });

    if (missing.length) {
      const names = missing.map(id => {
        const a = kmAttrList.find(x => x.id === id);
        return a ? a.name : id;
      });
      toast(`Zorunlu alanlar eksik: ${names.join(', ')}`, 'error');
      return;
    }

    try {
      const token = localStorage.getItem('dealer_token') || localStorage.getItem('token');
      const r = await fetch(`/api/products/${kmAttrProductId}/attributes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes })
      });
      if (!r.ok) throw new Error((await r.json()).error || `Hata (${r.status})`);
      toast('Attribute\'lar kaydedildi', 'success');
      kmAttrCurrentJson = attributes;
      // Update local kData so button badge refreshes on re-render
      const row = kData.find(r => r.id === kmAttrProductId);
      if (row) row.attributes_json = JSON.stringify(attributes);
      kmCloseAttrModal();
      kLoadData();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  window.kmCloseAttrModal = function () {
    const overlay = document.getElementById('km-attr-overlay');
    if (overlay) overlay.style.display = 'none';
    kmAttrProductId = null;
    kmAttrCategoryId = null;
    kmAttrList = [];
    kmAttrCurrentJson = [];
  };

  // ── Auto-fill Modal ────────────────────────────────────────────

  let kmAfEs = null; // active EventSource

  function kmInjectAutoFillModal() {
    if (document.getElementById('km-af-overlay')) return;
    const el = document.createElement('div');
    el.id = 'km-af-overlay';
    el.className = 'km-af-overlay';
    el.innerHTML = `
      <div class="km-af-modal">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:15px;font-weight:700;color:var(--text)">📋 Toplu AI Attribute Doldur</span>
          <button class="btn btn-ghost btn-sm" onclick="kmCloseAutoFill()">✕</button>
        </div>
        <div id="km-af-controls" style="display:flex;flex-direction:column;gap:12px">
          <div style="font-size:13px;color:var(--muted)">
            <b>attributes_json</b> boş olan onaylanmış ürünleri AI ile otomatik doldurur.<br>
            Her kategori için Trendyol'dan zorunlu attribute'lar çekilir, ürün adına göre değer tahmin edilir.
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <label style="font-size:12px;color:var(--muted);white-space:nowrap">Ürün limiti:</label>
            <input id="km-af-limit" type="number" value="5" min="1" max="25000"
              class="km-attr-input" style="width:90px;padding:6px 10px">
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" onclick="kmStartAutoFill(5)">🧪 Test (5 Ürün)</button>
            <button class="btn btn-primary btn-sm" id="km-af-start-btn" onclick="kmStartAutoFill()">▶ Başlat</button>
          </div>
        </div>
        <div id="km-af-run" style="display:none;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)">
            <span id="km-af-label">Başlıyor…</span>
            <span id="km-af-pct">0%</span>
          </div>
          <div class="km-af-progress-wrap">
            <div id="km-af-bar" class="km-af-progress-bar"></div>
          </div>
          <div style="display:flex;gap:20px;font-size:12px">
            <span style="color:var(--green)">✅ <b id="km-af-filled">0</b> dolduruldu</span>
            <span style="color:var(--muted)">⏭ <b id="km-af-skipped">0</b> atlandı</span>
            <span style="color:var(--red)">❌ <b id="km-af-errors">0</b> hata</span>
          </div>
          <div id="km-af-log" class="km-af-log"></div>
        </div>
        <div style="display:flex;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" id="km-af-close-btn" onclick="kmCloseAutoFill()">Kapat</button>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  window.kmOpenAutoFill = function () {
    const overlay = document.getElementById('km-af-overlay');
    if (!overlay) return;
    document.getElementById('km-af-controls').style.display = 'flex';
    document.getElementById('km-af-run').style.display = 'none';
    document.getElementById('km-af-log').innerHTML = '';
    document.getElementById('km-af-bar').style.width = '0%';
    document.getElementById('km-af-pct').textContent = '0%';
    document.getElementById('km-af-label').textContent = 'Başlamadı';
    ['km-af-filled', 'km-af-skipped', 'km-af-errors'].forEach(id => {
      document.getElementById(id).textContent = '0';
    });
    document.getElementById('km-af-close-btn').textContent = 'Kapat';
    overlay.style.display = 'flex';
  };

  window.kmStartAutoFill = function (fixedLimit) {
    const limit = fixedLimit || parseInt(document.getElementById('km-af-limit')?.value || '5', 10);
    const token = localStorage.getItem('dealer_token') || localStorage.getItem('token');

    document.getElementById('km-af-controls').style.display = 'none';
    document.getElementById('km-af-run').style.display = 'flex';
    document.getElementById('km-af-close-btn').textContent = 'İptal';

    const logEl     = document.getElementById('km-af-log');
    const bar       = document.getElementById('km-af-bar');
    const labelEl   = document.getElementById('km-af-label');
    const pctEl     = document.getElementById('km-af-pct');
    const filledEl  = document.getElementById('km-af-filled');
    const skippedEl = document.getElementById('km-af-skipped');
    const errorsEl  = document.getElementById('km-af-errors');

    function afLog(msg) {
      logEl.innerHTML += `<div>${msg}</div>`;
      logEl.scrollTop = logEl.scrollHeight;
    }

    if (kmAfEs) { kmAfEs.close(); kmAfEs = null; }

    kmAfEs = new EventSource(`/api/products/attributes/auto-fill?limit=${limit}&token=${encodeURIComponent(token)}`);

    kmAfEs.onmessage = function (e) {
      const d = JSON.parse(e.data);

      if (d.type === 'start') {
        afLog(`⏳ ${d.total} ürün işlenecek…`);
        labelEl.textContent = `0 / ${d.total}`;
      } else if (d.type === 'progress') {
        const pct = d.total > 0 ? Math.round(d.processed / d.total * 100) : 0;
        bar.style.width = pct + '%';
        labelEl.textContent = `${d.processed} / ${d.total}`;
        pctEl.textContent = pct + '%';
        filledEl.textContent  = d.filled;
        skippedEl.textContent = d.skipped;
        errorsEl.textContent  = d.errors;
        if (d.skipReason) {
          const reasonMap = {
            no_cat_attributes:    '⚠️ Parent kategori — Trendyol attribute döndürmüyor (leaf kategoriye yeniden eşleştir)',
            no_required_attributes: '⚠️ Zorunlu attribute yok — kategori tanımlı ama gerekli alan yok',
            ai_no_result:         '⚠️ AI eşleşme bulamadı',
          };
          const msg = reasonMap[d.skipReason] || `⚠️ ${d.skipReason}`;
          afLog(`⏭ "${d.skipTitle}" → ${msg}`);
        } else if (d.processed % 10 === 0) {
          afLog(`🔄 ${d.processed}/${d.total} — ✅${d.filled} ⏭${d.skipped} ❌${d.errors}`);
        }
      } else if (d.type === 'done') {
        kmAfEs.close(); kmAfEs = null;
        bar.style.width = '100%';
        labelEl.textContent = 'Tamamlandı';
        pctEl.textContent = '100%';
        filledEl.textContent  = d.filled;
        skippedEl.textContent = d.skipped;
        errorsEl.textContent  = d.errors;
        const rematchedCount = d.rematched || 0;
        afLog(`✅ Tamamlandı: ${d.filled} dolduruldu · ${d.skipped} atlandı · ${d.errors} hata${rematchedCount ? ` · ${rematchedCount} yeniden eşleştirmeye alındı` : ''}`);
        if (rematchedCount > 0) {
          afLog(`⚠️ ${rematchedCount} ürün parent kategoride — "🔄 Tümünü Yeniden Eşleştir" çalıştır, ardından tekrar "Toplu AI Doldur" yap`);
        }
        if (d.skipReasons && Object.keys(d.skipReasons).length > 0) {
          const reasons = Object.entries(d.skipReasons)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          afLog(`📊 Atlama nedenleri → ${reasons}`);
        }
        document.getElementById('km-af-close-btn').textContent = 'Kapat';
        kLoadData();
      } else if (d.type === 'error') {
        kmAfEs.close(); kmAfEs = null;
        afLog(`❌ Hata: ${d.message}`);
        document.getElementById('km-af-close-btn').textContent = 'Kapat';
      }
    };

    kmAfEs.onerror = function () {
      afLog('❌ Sunucu bağlantısı kesildi');
      if (kmAfEs) { kmAfEs.close(); kmAfEs = null; }
      document.getElementById('km-af-close-btn').textContent = 'Kapat';
    };
  };

  window.kmCloseAutoFill = function () {
    if (kmAfEs) { kmAfEs.close(); kmAfEs = null; }
    const overlay = document.getElementById('km-af-overlay');
    if (overlay) overlay.style.display = 'none';
  };

  // ── XML Kategori Doğrulama Modal ────────────────────────────────

  let kmVxEs = null;

  function kmInjectVerifyXmlModal() {
    if (document.getElementById('km-vx-overlay')) return;
    const el = document.createElement('div');
    el.id = 'km-vx-overlay';
    el.className = 'km-af-overlay';
    el.innerHTML = `
      <div class="km-af-modal">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:15px;font-weight:700;color:var(--text)">🔍 XML Kategorileri Doğrulat</span>
          <button class="btn btn-ghost btn-sm" onclick="kmCloseVerifyXml()">✕</button>
        </div>
        <div id="km-vx-controls" style="display:flex;flex-direction:column;gap:12px">
          <div style="font-size:13px;color:var(--muted)">
            XML feed'inden gelen (AI skoru olmayan) ürün kategorilerini AI ile doğrular.<br>
            Her <b>unique kategori</b> için tek AI çağrısı yapılır.
          </div>
          <div>
            <button class="btn btn-primary btn-sm" onclick="kmStartVerifyXml()">▶ Doğrulamayı Başlat</button>
          </div>
        </div>
        <div id="km-vx-run" style="display:none;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)">
            <span id="km-vx-label">Başlıyor…</span>
            <span id="km-vx-pct">0%</span>
          </div>
          <div class="km-af-progress-wrap">
            <div id="km-vx-bar" class="km-af-progress-bar"></div>
          </div>
          <div style="display:flex;gap:20px;font-size:12px">
            <span style="color:var(--green)">✅ <b id="km-vx-verified">0</b> doğrulandı</span>
            <span style="color:var(--yellow)">⚠️ <b id="km-vx-changed">0</b> incelemeye alındı</span>
            <span style="color:var(--muted)">🔅 <b id="km-vx-low">0</b> düşük güven</span>
            <span style="color:var(--red)">❌ <b id="km-vx-errors">0</b> hata</span>
          </div>
          <div id="km-vx-log" class="km-af-log"></div>
        </div>
        <div style="display:flex;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" id="km-vx-close-btn" onclick="kmCloseVerifyXml()">Kapat</button>
        </div>
      </div>`;
    document.body.appendChild(el);
  }

  window.kmOpenVerifyXml = function () {
    const overlay = document.getElementById('km-vx-overlay');
    if (!overlay) return;
    document.getElementById('km-vx-controls').style.display = 'flex';
    document.getElementById('km-vx-run').style.display = 'none';
    document.getElementById('km-vx-log').innerHTML = '';
    document.getElementById('km-vx-bar').style.width = '0%';
    document.getElementById('km-vx-pct').textContent = '0%';
    document.getElementById('km-vx-label').textContent = 'Başlamadı';
    ['km-vx-verified', 'km-vx-changed', 'km-vx-low', 'km-vx-errors'].forEach(id => {
      document.getElementById(id).textContent = '0';
    });
    document.getElementById('km-vx-close-btn').textContent = 'İptal';
    overlay.style.display = 'flex';
  };

  window.kmStartVerifyXml = function () {
    const token = localStorage.getItem('dealer_token') || localStorage.getItem('token');

    document.getElementById('km-vx-controls').style.display = 'none';
    document.getElementById('km-vx-run').style.display = 'flex';

    const logEl      = document.getElementById('km-vx-log');
    const bar        = document.getElementById('km-vx-bar');
    const labelEl    = document.getElementById('km-vx-label');
    const pctEl      = document.getElementById('km-vx-pct');
    const verifiedEl = document.getElementById('km-vx-verified');
    const changedEl  = document.getElementById('km-vx-changed');
    const lowEl      = document.getElementById('km-vx-low');
    const errorsEl   = document.getElementById('km-vx-errors');

    function vxLog(msg) {
      logEl.innerHTML += `<div>${msg}</div>`;
      logEl.scrollTop = logEl.scrollHeight;
    }

    if (kmVxEs) { kmVxEs.close(); kmVxEs = null; }

    kmVxEs = new EventSource(`/api/dealer/categories/verify-xml-stream?token=${token}`);

    kmVxEs.onmessage = function (e) {
      const d = JSON.parse(e.data);

      if (d.type === 'start') {
        if (d.total === 0) {
          vxLog('✅ Doğrulanacak kategori bulunamadı — tüm XML kategorileri zaten kayıtlı.');
          labelEl.textContent = 'Tamamlandı';
          document.getElementById('km-vx-close-btn').textContent = 'Kapat';
          return;
        }
        vxLog(`⏳ ${d.total} unique kategori doğrulanacak…`);
        labelEl.textContent = `0 / ${d.total}`;
      } else if (d.type === 'progress') {
        const pct = d.total > 0 ? Math.round(d.current / d.total * 100) : 0;
        bar.style.width = pct + '%';
        labelEl.textContent = `${d.current} / ${d.total}`;
        pctEl.textContent = pct + '%';

        const resultMsgs = {
          verified:       `✅ "${d.category}" — doğrulandı (${d.affected_products} ürün)`,
          changed:        `⚠️ "${d.category}" — farklı kategori önerildi, incelemeye alındı (${d.affected_products} ürün)<br>&nbsp;&nbsp;&nbsp;Mevcut: ${d.current_path || '?'}<br>&nbsp;&nbsp;&nbsp;Öneri: ${d.suggested_path || '?'}`,
          low_confidence: `🔅 "${d.category}" — düşük güven, incelemeye alındı (${d.affected_products} ürün)`,
          error:          `❌ "${d.category}" — hata (${d.affected_products} ürün)`
        };
        vxLog(resultMsgs[d.result] || `• ${d.category}`);

        if (d.result === 'verified')       verifiedEl.textContent = String(parseInt(verifiedEl.textContent) + 1);
        if (d.result === 'changed')        changedEl.textContent  = String(parseInt(changedEl.textContent)  + 1);
        if (d.result === 'low_confidence') lowEl.textContent      = String(parseInt(lowEl.textContent)      + 1);
        if (d.result === 'error')          errorsEl.textContent   = String(parseInt(errorsEl.textContent)   + 1);

      } else if (d.type === 'done') {
        kmVxEs.close(); kmVxEs = null;
        bar.style.width = '100%';
        labelEl.textContent = 'Tamamlandı';
        pctEl.textContent = '100%';
        verifiedEl.textContent = String(d.verified);
        changedEl.textContent  = String(d.changed);
        lowEl.textContent      = String(d.low_confidence);
        errorsEl.textContent   = String(d.errors);
        vxLog(`✅ Tamamlandı: ${d.verified} doğrulandı · ${d.changed} incelemeye alındı · ${d.low_confidence} düşük güven · ${d.errors} hata`);
        if (d.changed > 0) {
          vxLog('💡 İncelemeye alınan ürünler "Onay Bekliyor" filtresinde görünür.');
        }
        document.getElementById('km-vx-close-btn').textContent = 'Kapat';
        kLoadData();
      } else if (d.type === 'error') {
        kmVxEs.close(); kmVxEs = null;
        vxLog(`❌ Hata: ${d.message}`);
        document.getElementById('km-vx-close-btn').textContent = 'Kapat';
      }
    };

    kmVxEs.onerror = function () {
      vxLog('❌ Sunucu bağlantısı kesildi');
      if (kmVxEs) { kmVxEs.close(); kmVxEs = null; }
      document.getElementById('km-vx-close-btn').textContent = 'Kapat';
    };
  };

  window.kmCloseVerifyXml = function () {
    if (kmVxEs) { kmVxEs.close(); kmVxEs = null; }
    const overlay = document.getElementById('km-vx-overlay');
    if (overlay) overlay.style.display = 'none';
  };

})();
