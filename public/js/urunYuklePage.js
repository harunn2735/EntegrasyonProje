// public/js/urunYuklePage.js
(function () {
  'use strict';

  const STYLE = `
    #page-upload { padding: 8px 0 0; width: 100%; max-width: 100%; box-sizing: border-box; }

    .up-toolbar {
      display: flex; align-items: center; gap: 10px;
      background: var(--bg2); border: 1px solid var(--border);
      border-radius: 14px; padding: 14px 20px; margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .up-toolbar-left { display: flex; align-items: center; gap: 10px; flex: 1; }
    .up-count { font-size: 13px; color: var(--text2); }
    .up-count strong { color: var(--text); }

    .up-btn {
      padding: 8px 18px; border-radius: 10px; font-size: 13px; font-weight: 600;
      border: none; cursor: pointer; transition: opacity .15s;
    }
    .up-btn:disabled { opacity: .45; cursor: not-allowed; }
    .up-btn-primary { background: var(--accent); color: #fff; }
    .up-btn-primary:not(:disabled):hover { opacity: .85; }
    .up-btn-ghost { background: transparent; color: var(--text2); border: 1px solid var(--border); }
    .up-btn-ghost:hover { background: var(--bg3); }

    .up-table-wrap {
      background: var(--bg2); border: 1px solid var(--border);
      border-radius: 14px; overflow: hidden;
    }
    .up-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .up-table th {
      background: var(--bg3); color: var(--text2); font-weight: 600;
      padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    .up-table th:first-child, .up-table td:first-child { width: 36px; padding-left: 16px; }
    .up-table td { padding: 10px 14px; border-bottom: 1px solid var(--border); color: var(--text); vertical-align: middle; }
    .up-table tr:last-child td { border-bottom: none; }
    .up-table tr.up-selected td { background: rgba(99,102,241,.06); }

    .up-title { font-weight: 500; max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .up-price { white-space: nowrap; }
    .up-badge {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11px; padding: 2px 7px; border-radius: 6px; font-weight: 500;
    }
    .up-badge-ok  { background: rgba(22,163,74,.12);  color: var(--green); }
    .up-badge-err { background: rgba(220,38,38,.1);   color: var(--red);  }
    .up-badge-warn{ background: rgba(234,179,8,.12);  color: #b45309;     }

    .up-status-cell { white-space: nowrap; min-width: 110px; }

    .up-result-ok   { color: var(--green); font-weight: 600; font-size: 13px; }
    .up-result-err  { color: var(--red);   font-size: 12px; max-width: 260px; word-break: break-word; }
    .up-result-proc { color: var(--text2); font-size: 12px; }

    .up-progress-bar-wrap {
      background: var(--bg3); border-radius: 8px; height: 8px;
      overflow: hidden; margin: 8px 0 4px;
    }
    .up-progress-bar {
      height: 100%; background: var(--accent);
      border-radius: 8px; transition: width .3s;
    }
    .up-progress-label { font-size: 12px; color: var(--text2); }

    .up-empty { padding: 60px 20px; text-align: center; color: var(--text2); font-size: 14px; }
    .up-empty-icon { font-size: 36px; margin-bottom: 12px; }

    .up-summary {
      display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;
    }
    .up-summary-card {
      flex: 1; min-width: 120px; background: var(--bg2);
      border: 1px solid var(--border); border-radius: 12px;
      padding: 14px 18px; text-align: center;
    }
    .up-summary-num { font-size: 24px; font-weight: 700; color: var(--text); }
    .up-summary-lbl { font-size: 11px; color: var(--text2); margin-top: 2px; }
    .up-summary-num.green { color: var(--green); }
    .up-summary-num.red   { color: var(--red);   }

    .up-filter-wrap { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .up-filter-wrap input[type=text] {
      padding: 7px 12px; border-radius: 9px; border: 1px solid var(--border);
      background: var(--bg3); color: var(--text); font-size: 13px; width: 220px;
    }
  `;

  // ── State ──────────────────────────────────────────────────
  let allProducts  = [];
  let filtered     = [];
  let selected     = new Set();
  let uploading    = false;
  let resultMap    = {}; // id → { status, error }
  let searchQ      = '';

  // ── Helpers ────────────────────────────────────────────────
  function esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function badge(ok, labelOk, labelErr) {
    return ok
      ? `<span class="up-badge up-badge-ok">✅ ${labelOk}</span>`
      : `<span class="up-badge up-badge-err">❌ ${labelErr}</span>`;
  }

  function readiness(p) {
    return {
      kategori:  !!p.xml_category_id,
      marka:     !!p.brand_id,
      attribute: !!(p.attributes_json && p.attributes_json !== '[]'),
      gorsel:    !!(p.image_url && p.image_url.trim()),
    };
  }

  function isReady(p) {
    const r = readiness(p);
    return r.kategori && r.marka; // attribute + görsel opsiyonel
  }

  // ── Render ─────────────────────────────────────────────────
  function renderSummary() {
    const total    = allProducts.length;
    const ready    = allProducts.filter(isReady).length;
    const noAttr   = allProducts.filter(p => !p.attributes_json || p.attributes_json === '[]').length;
    const noImg    = allProducts.filter(p => !p.image_url || !p.image_url.trim()).length;

    return `
      <div class="up-summary">
        <div class="up-summary-card">
          <div class="up-summary-num">${total}</div>
          <div class="up-summary-lbl">Hazır Ürün</div>
        </div>
        <div class="up-summary-card">
          <div class="up-summary-num green">${ready}</div>
          <div class="up-summary-lbl">Yüklenebilir</div>
        </div>
        <div class="up-summary-card">
          <div class="up-summary-num${noAttr > 0 ? ' red' : ''}">${noAttr}</div>
          <div class="up-summary-lbl">Attribute Eksik</div>
        </div>
        <div class="up-summary-card">
          <div class="up-summary-num${noImg > 0 ? ' red' : ''}">${noImg}</div>
          <div class="up-summary-lbl">Görsel Eksik</div>
        </div>
      </div>`;
  }

  function statusCell(p) {
    const res = resultMap[p.id];
    if (!res) return '<span class="up-result-proc">—</span>';
    if (res.status === 'success')    return '<span class="up-result-ok">✅ Yüklendi</span>';
    if (res.status === 'processing') return '<span class="up-result-proc">⏳ İşleniyor</span>';
    return `<span class="up-result-err" title="${esc(res.error)}">❌ ${esc((res.error || '').slice(0, 60))}${(res.error || '').length > 60 ? '…' : ''}</span>`;
  }

  function renderTable() {
    if (!filtered.length) {
      return `<div class="up-empty"><div class="up-empty-icon">📦</div>Yüklenecek ürün bulunamadı.<br><small>Brand ve kategori atanmış, stoğu 0'dan büyük ürünler listelenir.</small></div>`;
    }

    const allChecked = filtered.length > 0 && filtered.every(p => selected.has(p.id));

    const rows = filtered.map(p => {
      const r = readiness(p);
      const checked = selected.has(p.id) ? 'checked' : '';
      const rowCls  = selected.has(p.id) ? 'up-selected' : '';
      return `
        <tr class="${rowCls}" data-up-id="${p.id}">
          <td><input type="checkbox" ${checked} onchange="upToggle(${p.id}, this.checked)"></td>
          <td><div class="up-title" title="${esc(p.ai_baslik || p.title)}">${esc((p.ai_baslik || p.title).slice(0, 60))}</div>
              <div style="font-size:11px;color:var(--text2);margin-top:2px">${esc(p.barcode)}</div></td>
          <td style="font-size:11px;color:var(--text2);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(p.kategori_tam_yol)}">${esc((p.kategori_tam_yol || '').split('>').pop()?.trim() || p.xml_category_id)}</td>
          <td style="font-size:12px">${esc(p.brand_name_resolved || p.brand_id)}</td>
          <td class="up-price"><strong>${fmt(p.sale_price)} ₺</strong><br><span style="font-size:11px;color:var(--text2)">${p.stock} adet</span></td>
          <td>
            ${badge(r.kategori,  'Kategori', 'Kategori')}
            ${badge(r.marka,     'Marka',    'Marka')}
            ${badge(r.attribute, 'Attr',     'Attr?')}
            ${badge(r.gorsel,    'Görsel',   'Görsel?')}
          </td>
          <td class="up-status-cell">${statusCell(p)}</td>
        </tr>`;
    }).join('');

    return `
      <div class="up-table-wrap">
        <table class="up-table">
          <thead>
            <tr>
              <th><input type="checkbox" ${allChecked ? 'checked' : ''} onchange="upSelectAll(this.checked)"></th>
              <th>Ürün / Barkod</th>
              <th>Kategori</th>
              <th>Marka</th>
              <th>Fiyat / Stok</th>
              <th>Hazırlık</th>
              <th>Sonuç</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderProgress(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return `
      <div class="up-progress-bar-wrap"><div class="up-progress-bar" style="width:${pct}%"></div></div>
      <div class="up-progress-label">${done} / ${total} işlendi (${pct}%)</div>`;
  }

  function render() {
    const el = document.getElementById('page-upload');
    if (!el) return;

    const selCount = selected.size;

    el.innerHTML = `
      <div style="padding:8px 0;width:100%;box-sizing:border-box">
        ${renderSummary()}
        <div class="up-toolbar">
          <div class="up-toolbar-left">
            <div class="up-filter-wrap">
              <input type="text" placeholder="Ürün veya barkod ara…" value="${esc(searchQ)}" oninput="upSearch(this.value)" id="up-search-input">
            </div>
            <div class="up-count"><strong>${filtered.length}</strong> ürün gösteriliyor, <strong>${selCount}</strong> seçili</div>
          </div>
          <button class="up-btn up-btn-ghost" onclick="upRefresh()" ${uploading ? 'disabled' : ''}>🔄 Yenile</button>
          <button class="up-btn up-btn-primary" id="up-upload-btn"
            onclick="upUpload()" ${selCount === 0 || uploading ? 'disabled' : ''}>
            ${uploading ? '⏳ Yükleniyor…' : `🚀 Seçilenleri Yükle (${selCount})`}
          </button>
        </div>
        <div id="up-progress-area"></div>
        ${renderTable()}
      </div>`;
  }

  // ── Data loading ───────────────────────────────────────────
  async function load() {
    const el = document.getElementById('page-upload');
    if (!el) return;
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text2)">Yükleniyor…</div>';

    try {
      const data = await window.api('/api/dealer/products/upload-ready');
      if (!data) return;
      allProducts = data;
      resultMap   = {};
      selected    = new Set();
      applyFilter();
      render();
    } catch (e) {
      el.innerHTML = `<div class="up-empty"><div class="up-empty-icon">⚠️</div>${esc(e.message)}</div>`;
    }
  }

  function applyFilter() {
    const q = searchQ.toLowerCase();
    filtered = q
      ? allProducts.filter(p =>
          (p.title || '').toLowerCase().includes(q) ||
          (p.ai_baslik || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q))
      : [...allProducts];
    // Seçililer listesini temizle (filtreden çıkanlar)
    for (const id of selected) {
      if (!allProducts.find(p => p.id === id)) selected.delete(id);
    }
  }

  // ── Upload ─────────────────────────────────────────────────
  async function upload() {
    if (uploading || selected.size === 0) return;
    uploading = true;
    render();

    const ids = [...selected];
    const total = ids.length;
    let done = 0;

    const progressEl = () => document.getElementById('up-progress-area');
    if (progressEl()) progressEl().innerHTML = renderProgress(0, total);

    try {
      const token = localStorage.getItem('dealer_token') || '';
      const resp = await fetch('/api/dealer/products/upload-selected', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ ids }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        window.toast(err.error || 'Yükleme başlatılamadı', 'error');
        uploading = false;
        render();
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt;
          try { evt = JSON.parse(line.slice(6)); } catch (_) { continue; }

          if (evt.type === 'result') {
            resultMap[evt.id] = { status: evt.status, error: evt.error };
            done++;
            if (progressEl()) progressEl().innerHTML = renderProgress(done, total);
            // Satırın sonuç hücresini güncelle
            const row = document.querySelector(`tr[data-up-id="${evt.id}"]`);
            if (row) {
              const cell = row.querySelector('.up-status-cell');
              const p = allProducts.find(x => x.id === evt.id);
              if (cell && p) cell.innerHTML = statusCell(p);
            }
          } else if (evt.type === 'done') {
            const msg = `Yükleme tamamlandı: ✅ ${evt.succeeded} başarılı, ❌ ${evt.failed} hatalı`;
            window.toast(msg, evt.failed > 0 ? 'error' : 'success');
          } else if (evt.type === 'error') {
            window.toast(evt.message, 'error');
          }
        }
      }
    } catch (e) {
      window.toast(e.message, 'error');
    }

    uploading = false;
    render();
  }

  // ── Public API ─────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById('up-style')) return;
    const el = document.createElement('style');
    el.id = 'up-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  window.loadUploadPage = async function () {
    injectStyle();
    await load();
  };

  window.upRefresh = function () { load(); };

  window.upSearch = function (q) {
    searchQ = q;
    applyFilter();
    // Tablo + toolbar'ı kısmen güncelle
    const tableWrap = document.querySelector('#page-upload .up-table-wrap') ||
                      document.querySelector('#page-upload .up-empty');
    const toolbar   = document.querySelector('#page-upload .up-count');
    if (tableWrap) tableWrap.outerHTML = renderTable();
    if (toolbar)   toolbar.innerHTML  =
      `<strong>${filtered.length}</strong> ürün gösteriliyor, <strong>${selected.size}</strong> seçili`;
    const btn = document.getElementById('up-upload-btn');
    if (btn) {
      btn.disabled   = selected.size === 0 || uploading;
      btn.textContent = uploading ? '⏳ Yükleniyor…' : `🚀 Seçilenleri Yükle (${selected.size})`;
    }
  };

  window.upToggle = function (id, checked) {
    if (checked) selected.add(id);
    else         selected.delete(id);
    // Satır arka planı + toolbar sayacı güncelle
    const tr = document.querySelector(`tr[data-up-id="${id}"]`);
    if (tr) tr.classList.toggle('up-selected', checked);
    const toolbar = document.querySelector('#page-upload .up-count');
    if (toolbar) toolbar.innerHTML =
      `<strong>${filtered.length}</strong> ürün gösteriliyor, <strong>${selected.size}</strong> seçili`;
    const btn = document.getElementById('up-upload-btn');
    if (btn) {
      btn.disabled    = selected.size === 0 || uploading;
      btn.textContent = `🚀 Seçilenleri Yükle (${selected.size})`;
    }
  };

  window.upSelectAll = function (checked) {
    if (checked) filtered.forEach(p => selected.add(p.id));
    else         filtered.forEach(p => selected.delete(p.id));
    render();
  };

  window.upUpload = function () { upload(); };

})();
