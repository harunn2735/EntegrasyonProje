// public/js/markaYonetimiPage.js
(function () {
  'use strict';

  const STYLE = `
    #page-brands {
      padding: 8px 0 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }
    .bm-card {
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: var(--shadow);
      padding: 24px;
    }
    .bm-card-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 16px;
    }
    .bm-active-banner {
      background: linear-gradient(135deg, rgba(108,99,255,.12), rgba(139,92,246,.08));
      border: 2px solid var(--accent);
      border-radius: 16px;
      padding: 24px;
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .bm-active-icon {
      width: 56px;
      height: 56px;
      border-radius: 14px;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      flex-shrink: 0;
    }
    .bm-active-info { flex: 1; }
    .bm-active-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .6px;
      color: var(--accent);
      margin-bottom: 4px;
    }
    .bm-active-name {
      font-size: 22px;
      font-weight: 700;
      color: var(--text);
    }
    .bm-active-id {
      font-size: 12px;
      color: var(--muted);
      margin-top: 2px;
    }
    .bm-warning {
      background: rgba(217,119,6,.08);
      border: 1px solid rgba(217,119,6,.35);
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: var(--yellow);
      font-weight: 500;
    }
    .bm-search-input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--bg3);
      color: var(--text);
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color .15s;
    }
    .bm-search-input:focus { border-color: var(--accent); }
    .bm-results {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .bm-result-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 10px;
      transition: border-color .15s, background .15s;
    }
    .bm-result-item:hover { border-color: var(--accent); background: rgba(108,99,255,.05); }
    .bm-result-name { font-size: 14px; font-weight: 600; color: var(--text); }
    .bm-result-id { font-size: 11px; color: var(--muted); margin-top: 2px; }
    .bm-empty { font-size: 13px; color: var(--muted); text-align: center; padding: 20px 0; }
    .bm-spinner { text-align: center; padding: 20px 0; color: var(--muted); font-size: 13px; }
    #bm-toast:empty { display: none; }
  `;

  let debounceTimer = null;
  let activeBrand = null;

  function injectStyle() {
    if (document.getElementById('bm-style')) return;
    const el = document.createElement('style');
    el.id = 'bm-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderActiveBrand() {
    if (!activeBrand) {
      return `
        <div class="bm-warning">
          ⚠️ Aktif marka seçilmemiş — ürün yüklemeden önce aşağıdan bir marka seçiniz.
        </div>`;
    }
    return `
      <div class="bm-active-banner">
        <div class="bm-active-icon">🏷️</div>
        <div class="bm-active-info">
          <div class="bm-active-label">Aktif Marka</div>
          <div class="bm-active-name">${esc(activeBrand.name)}</div>
          <div class="bm-active-id">Trendyol Brand ID: ${esc(activeBrand.id)}</div>
        </div>
      </div>`;
  }

  function renderPage() {
    const el = document.getElementById('page-brands');
    if (!el) return;
    el.innerHTML = `
      <div style="padding:24px;width:100%;box-sizing:border-box;max-width:900px;display:flex;flex-direction:column;gap:20px;">

        <div id="bm-active-slot">${renderActiveBrand()}</div>

        <div id="bm-toast"></div>

        <div class="bm-card">
          <div class="bm-card-title">🔍 Trendyol'da Marka Ara</div>
          <input
            id="bm-query"
            class="bm-search-input"
            type="text"
            placeholder="Marka adı yazın (min. 2 karakter)…"
            oninput="bmOnInput()"
            autocomplete="off"
          />
          <div id="bm-results" class="bm-results"></div>
        </div>

      </div>`;
  }

  async function loadActive() {
    try {
      const token = localStorage.getItem('dealer_token') || localStorage.getItem('token');
      const r = await fetch('/api/brands/active', {
        headers: { Authorization: `Bearer ${token}` },
      });
      activeBrand = r.ok ? await r.json() : null;
    } catch (_) {
      activeBrand = null;
    }
  }

  async function doSearch(q) {
    const resultsEl = document.getElementById('bm-results');
    if (!resultsEl) return;
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }

    resultsEl.innerHTML = '<div class="bm-spinner">Aranıyor…</div>';
    try {
      const token = localStorage.getItem('dealer_token') || localStorage.getItem('token');
      const r = await fetch(`/api/brands/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await r.json();
      if (!r.ok) {
        const msg = json?.error || `Sunucu hatası (${r.status})`;
        resultsEl.innerHTML = `<div class="bm-empty" style="color:var(--red)">⚠️ ${esc(msg)}</div>`;
        return;
      }
      const list = Array.isArray(json) ? json : (json?.brands || json?.content || []);
      if (!list.length) {
        resultsEl.innerHTML = '<div class="bm-empty">Sonuç bulunamadı.</div>';
        return;
      }
      resultsEl.innerHTML = list.slice(0, 20).map(b => `
        <div class="bm-result-item">
          <div>
            <div class="bm-result-name">${esc(b.name)}</div>
            <div class="bm-result-id">ID: ${esc(b.id)}</div>
          </div>
          <button class="btn btn-primary btn-sm"
            data-brand-id="${Number(b.id)}"
            data-brand-name="${esc(b.name)}"
            onclick="bmSave(this.dataset.brandId, this.dataset.brandName)">
            Seç &amp; Aktif Yap
          </button>
        </div>`).join('');
    } catch (err) {
      resultsEl.innerHTML = `<div class="bm-empty" style="color:var(--red)">⚠️ ${esc(err.message)}</div>`;
    }
  }

  function bmToast(msg, isError) {
    const el = document.getElementById('bm-toast');
    if (!el) return;
    el.style.cssText = `padding:12px 16px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:4px;background:${isError ? 'rgba(220,38,38,.1)' : 'rgba(22,163,74,.1)'};border:1px solid ${isError ? 'rgba(220,38,38,.3)' : 'rgba(22,163,74,.3)'};color:${isError ? 'var(--red)' : 'var(--green)'}`;
    el.textContent = msg;
    setTimeout(() => { if (el) el.style.cssText = ''; el.textContent = ''; }, 4000);
  }

  async function bmSave(trendyolBrandId, name) {
    const id = Number(trendyolBrandId);
    const token = localStorage.getItem('dealer_token') || localStorage.getItem('token');
    try {
      const r = await fetch('/api/brands/save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trendyol_brand_id: id, name }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Kayıt başarısız');
      activeBrand = { id, name };
      const slot = document.getElementById('bm-active-slot');
      if (slot) slot.innerHTML = renderActiveBrand();
      const resultsEl = document.getElementById('bm-results');
      if (resultsEl) resultsEl.innerHTML = '';
      const queryEl = document.getElementById('bm-query');
      if (queryEl) queryEl.value = '';
      bmToast(`✅ "${name}" aktif marka olarak seçildi, tüm ürünler güncellendi.`);
    } catch (err) {
      bmToast(`❌ ${err.message}`, true);
    }
  }

  function bmOnInput() {
    clearTimeout(debounceTimer);
    const q = (document.getElementById('bm-query')?.value || '').trim();
    debounceTimer = setTimeout(() => doSearch(q), 400);
  }

  window.loadBrandsPage = async function () {
    injectStyle();
    await loadActive();
    renderPage();
  };

  window.bmOnInput = bmOnInput;
  window.bmSave = bmSave;
})();
