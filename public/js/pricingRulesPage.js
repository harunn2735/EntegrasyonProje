// public/js/pricingRulesPage.js
// Fiyat Kuralları yönetim sayfası — SPA IIFE modülü.
(function () {
  'use strict';

  // ── Stiller ───────────────────────────────────────────────────────────────────
  const STYLE = `
    #page-pricing-rules {
      padding: 8px 0 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: hidden;
    }
    .prr-shell {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
      max-width: 1180px;
      margin: 0 auto;
    }

    /* Toolbar */
    .prr-toolbar {
      background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,255,255,.92));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: var(--shadow);
    }
    .prr-toolbar-title { font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 4px; }
    .prr-toolbar-sub   { font-size: 13px; color: var(--muted); }

    /* Loading / error */
    .prr-loading {
      text-align: center;
      padding: 48px 20px;
      color: var(--muted);
      font-size: 14px;
    }
    .prr-error {
      text-align: center;
      padding: 48px 20px;
      color: var(--red);
      font-size: 14px;
    }
    .prr-retry-btn {
      margin-left: 10px;
      padding: 6px 14px;
      background: var(--bg3);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      color: var(--text);
    }
    .prr-retry-btn:hover { background: var(--border); }

    /* Kural kartı */
    .prr-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: var(--shadow);
    }
    .prr-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 20px 14px;
      gap: 12px;
    }
    .prr-card-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
    }
    .prr-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 99px;
    }
    .prr-badge.active  { background: rgba(22,163,74,.12);  color: var(--green); }
    .prr-badge.passive { background: rgba(100,116,139,.12); color: var(--muted); }

    /* Bilgi notu (pasif kart) */
    .prr-info-note {
      margin: 0 20px 14px;
      padding: 10px 14px;
      background: rgba(59,130,246,.08);
      border: 1px solid rgba(59,130,246,.2);
      border-radius: 8px;
      font-size: 12px;
      color: #2563eb;
      line-height: 1.5;
    }

    /* Açıklama */
    .prr-desc {
      margin: 0 20px 16px;
      padding: 10px 14px;
      background: var(--bg3);
      border-radius: 8px;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.6;
    }

    /* Form alanları */
    .prr-fields {
      padding: 0 20px 4px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .prr-field-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .prr-field-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      min-width: 160px;
    }
    .prr-number-input {
      width: 90px;
      padding: 7px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      background: var(--bg2);
      text-align: right;
    }
    .prr-number-input:focus { outline: none; border-color: var(--accent); }
    .prr-field-unit {
      font-size: 12px;
      color: var(--muted);
    }

    /* Slider */
    .prr-slider-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 200px;
    }
    .prr-slider-wrap input[type=range] {
      flex: 1;
      accent-color: var(--accent);
    }
    .prr-slider-val {
      font-size: 18px;
      font-weight: 700;
      color: var(--accent);
      min-width: 48px;
      text-align: right;
    }
    .prr-slider-limits {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--muted);
      margin-top: 2px;
    }

    /* Footer */
    .prr-card-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      padding: 14px 20px;
      border-top: 1px solid var(--border);
      background: var(--bg3);
      margin-top: 16px;
    }
    .prr-save-btn {
      padding: 8px 18px;
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: .15s;
    }
    .prr-save-btn:disabled { opacity: .45; cursor: not-allowed; }
    .prr-save-btn:not(:disabled):hover { background: #574fd6; }
    .prr-toggle-btn {
      padding: 8px 16px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      color: var(--text);
      transition: .15s;
    }
    .prr-toggle-btn:hover { background: var(--border); }
    .prr-toggle-btn:disabled { opacity: .45; cursor: not-allowed; }

    /* Scan onay modal */
    .prr-modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.35);
      display: flex; align-items: center; justify-content: center;
      z-index: 999;
      animation: prrFadeIn .15s ease;
    }
    @keyframes prrFadeIn { from { opacity: 0; } to { opacity: 1; } }
    .prr-modal {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px 28px 22px;
      max-width: 420px;
      width: calc(100% - 40px);
      box-shadow: 0 8px 32px rgba(0,0,0,.18);
      animation: prrSlideUp .18s ease;
    }
    @keyframes prrSlideUp { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .prr-modal-icon { font-size: 32px; margin-bottom: 12px; }
    .prr-modal-title { font-size: 15px; font-weight: 700; color: var(--text); margin-bottom: 8px; }
    .prr-modal-body  { font-size: 13px; color: var(--muted); line-height: 1.6; margin-bottom: 22px; }
    .prr-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
    .prr-modal-btn-primary {
      padding: 9px 18px; background: var(--accent); color: #fff;
      border: none; border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; font-family: inherit; transition: .15s;
    }
    .prr-modal-btn-primary:hover { background: #574fd6; }
    .prr-modal-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
    .prr-modal-btn-ghost {
      padding: 9px 16px; background: var(--bg3); color: var(--text);
      border: 1px solid var(--border); border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; font-family: inherit; transition: .15s;
    }
    .prr-modal-btn-ghost:hover { background: var(--border); }

    @media (max-width: 640px) {
      .prr-field-row { flex-direction: column; align-items: flex-start; }
      .prr-slider-wrap { width: 100%; }
    }
  `;

  // ── Stil enjeksiyonu (bir kez) ─────────────────────────────────────────────
  let styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    const el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
    styleInjected = true;
  }

  // ── Yardımcılar ───────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function numInput(id, value, min, max, step = 1, unit = '') {
    return `<input class="prr-number-input" type="number" id="${id}"
      value="${value}" min="${min}" max="${max}" step="${step}" />
      ${unit ? `<span class="prr-field-unit">${esc(unit)}</span>` : ''}`;
  }

  // ── Kural kartı render: min_margin ────────────────────────────────────────
  function renderMinMargin(rule) {
    const p   = rule.parameters || {};
    const val = p.min_margin_percent ?? 15;
    const id  = rule.id;
    const badge = rule.is_active
      ? `<span class="prr-badge active">✅ AKTİF</span>`
      : `<span class="prr-badge passive">⏸ PASİF</span>`;

    return `
      <div class="prr-card" id="prr-card-${id}">
        <div class="prr-card-head">
          <span class="prr-card-title">🛡️ Minimum Kâr Marjı Koruması</span>
          ${badge}
        </div>
        ${!rule.is_active ? `<div class="prr-info-note">ℹ️ Bu kural şu an pasif. Ürün kataloğu ile sipariş barkodları eşleştirildiğinde aktif edilebilir.</div>` : ''}
        <div class="prr-desc">
          Güvenlik ağı: Hangi kural ne önerirse önersin, fiyat hiçbir zaman
          maliyet + minimum marjın altına düşemez.
        </div>
        <div class="prr-fields">
          <div class="prr-field-row">
            <span class="prr-field-label">Minimum marj oranı:</span>
            <div style="flex:1">
              <div class="prr-slider-wrap">
                <input type="range" id="prr-${id}-min_margin_percent"
                  min="1" max="50" step="1" value="${val}"
                  oninput="document.getElementById('prr-${id}-val').textContent = '%' + this.value" />
                <span class="prr-slider-val" id="prr-${id}-val">%${val}</span>
              </div>
              <div class="prr-slider-limits"><span>%1</span><span>%50</span></div>
            </div>
          </div>
        </div>
        <div class="prr-card-footer">
          <button class="prr-toggle-btn" id="prr-toggle-${id}"
            onclick="window._prrToggle(${id}, ${rule.is_active})">
            ${rule.is_active ? '⏸ Pasif Et' : '✅ Aktif Et'}
          </button>
          <button class="prr-save-btn" id="prr-save-${id}" disabled
            onclick="window._prrSave(${id}, 'min_margin')">
            💾 Kaydet
          </button>
        </div>
      </div>`;
  }

  // ── Kural kartı render: stock_based ───────────────────────────────────────
  function renderStockBased(rule) {
    const p  = rule.parameters || {};
    const id = rule.id;
    const badge = rule.is_active
      ? `<span class="prr-badge active">✅ AKTİF</span>`
      : `<span class="prr-badge passive">⏸ PASİF</span>`;

    return `
      <div class="prr-card" id="prr-card-${id}">
        <div class="prr-card-head">
          <span class="prr-card-title">📦 Stok Bazlı Fiyatlandırma</span>
          ${badge}
        </div>
        ${!rule.is_active ? `<div class="prr-info-note">ℹ️ Bu kural şu an pasif. Ürün kataloğu ile sipariş barkodları eşleştirildiğinde aktif edilebilir.</div>` : ''}
        <div class="prr-desc">
          Stok fazlaysa fiyatı düşür (eritmeyi hızlandır), stok azsa fiyatı yükselt (kıtlık primi al).
        </div>
        <div class="prr-fields">
          <div class="prr-field-row">
            <span class="prr-field-label">Yüksek stok eşiği:</span>
            ${numInput(`prr-${id}-high_stock_threshold`, p.high_stock_threshold ?? 4500, 0, 99999, 1, 'adet üstü')}
            <span class="prr-field-unit">→</span>
            ${numInput(`prr-${id}-high_stock_discount_pct`, p.high_stock_discount_pct ?? 5, 1, 30, 1)}
            <span class="prr-field-unit">% indirim</span>
          </div>
          <div class="prr-field-row">
            <span class="prr-field-label">Düşük stok eşiği:</span>
            ${numInput(`prr-${id}-low_stock_threshold`, p.low_stock_threshold ?? 1000, 0, 99999, 1, 'adet altı')}
            <span class="prr-field-unit">→</span>
            ${numInput(`prr-${id}-low_stock_markup_pct`, p.low_stock_markup_pct ?? 10, 1, 30, 1)}
            <span class="prr-field-unit">% zam</span>
          </div>
        </div>
        <div class="prr-card-footer">
          <button class="prr-toggle-btn" id="prr-toggle-${id}"
            onclick="window._prrToggle(${id}, ${rule.is_active})">
            ${rule.is_active ? '⏸ Pasif Et' : '✅ Aktif Et'}
          </button>
          <button class="prr-save-btn" id="prr-save-${id}" disabled
            onclick="window._prrSave(${id}, 'stock_based')">
            💾 Kaydet
          </button>
        </div>
      </div>`;
  }

  // ── Kural kartı render: velocity_based ────────────────────────────────────
  function renderVelocityBased(rule) {
    const p  = rule.parameters || {};
    const id = rule.id;
    const badge = rule.is_active
      ? `<span class="prr-badge active">✅ AKTİF</span>`
      : `<span class="prr-badge passive">⏸ PASİF</span>`;

    return `
      <div class="prr-card" id="prr-card-${id}">
        <div class="prr-card-head">
          <span class="prr-card-title">📈 Satış Hızı Fiyatlandırması</span>
          ${badge}
        </div>
        <div class="prr-info-note">
          ℹ️ Bu kural şu an pasif. Ürün kataloğu ile sipariş barkodları
          eşleştirildiğinde aktif edilebilir.
        </div>
        <div class="prr-desc">
          Son 7 günün satışı 30 günlük ortalamanın üstündeyse talep yüksek demektir — fiyatı yükselt.
          Altındaysa talep düşük — fiyatı indir.
        </div>
        <div class="prr-fields">
          <div class="prr-field-row">
            <span class="prr-field-label">Lookback süresi:</span>
            ${numInput(`prr-${id}-lookback_days`, p.lookback_days ?? 7, 1, 90, 1, 'gün')}
          </div>
          <div class="prr-field-row">
            <span class="prr-field-label">Yüksek hız eşiği:</span>
            ${numInput(`prr-${id}-high_velocity_threshold_pct`, p.high_velocity_threshold_pct ?? 120, 101, 500, 1, '% üstü')}
            <span class="prr-field-unit">→</span>
            ${numInput(`prr-${id}-high_velocity_markup_pct`, p.high_velocity_markup_pct ?? 4, 1, 30, 1)}
            <span class="prr-field-unit">% zam</span>
          </div>
          <div class="prr-field-row">
            <span class="prr-field-label">Düşük hız eşiği:</span>
            ${numInput(`prr-${id}-low_velocity_threshold_pct`, p.low_velocity_threshold_pct ?? 50, 1, 99, 1, '% altı')}
            <span class="prr-field-unit">→</span>
            ${numInput(`prr-${id}-low_velocity_discount_pct`, p.low_velocity_discount_pct ?? 5, 1, 30, 1)}
            <span class="prr-field-unit">% indirim</span>
          </div>
          <div class="prr-field-row">
            <span class="prr-field-label">Min. satış sayısı:</span>
            ${numInput(`prr-${id}-min_sales_count`, p.min_sales_count ?? 3, 1, 9999, 1, 'adet')}
          </div>
        </div>
        <div class="prr-card-footer">
          <button class="prr-toggle-btn" id="prr-toggle-${id}"
            onclick="window._prrToggle(${id}, ${rule.is_active})">
            ${rule.is_active ? '⏸ Pasif Et' : '✅ Aktif Et'}
          </button>
          <button class="prr-save-btn" id="prr-save-${id}" disabled
            onclick="window._prrSave(${id}, 'velocity_based')">
            💾 Kaydet
          </button>
        </div>
      </div>`;
  }

  // ── Kural tipine göre render yönlendir ────────────────────────────────────
  function renderCard(rule) {
    switch (rule.rule_type) {
      case 'min_margin':      return renderMinMargin(rule);
      case 'stock_based':     return renderStockBased(rule);
      case 'velocity_based':  return renderVelocityBased(rule);
      default: return '';
    }
  }

  // ── Dirty tracking: input değişince kaydet butonunu aktif et ──────────────
  function initDirtyTracking(ruleId) {
    const card    = document.getElementById(`prr-card-${ruleId}`);
    const saveBtn = document.getElementById(`prr-save-${ruleId}`);
    if (!card || !saveBtn) return;

    const inputs = card.querySelectorAll('input');
    inputs.forEach(inp => {
      inp.addEventListener('input', () => { saveBtn.disabled = false; });
      inp.addEventListener('change', () => { saveBtn.disabled = false; });
    });
  }

  // ── Parametre toplama: rule_type'a göre form değerlerini oku ─────────────
  function collectParams(ruleId, ruleType) {
    function val(key) {
      const el = document.getElementById(`prr-${ruleId}-${key}`);
      return el ? parseFloat(el.value) : undefined;
    }
    switch (ruleType) {
      case 'min_margin':
        return { min_margin_percent: val('min_margin_percent') };
      case 'stock_based':
        return {
          high_stock_threshold:    val('high_stock_threshold'),
          high_stock_discount_pct: val('high_stock_discount_pct'),
          low_stock_threshold:     val('low_stock_threshold'),
          low_stock_markup_pct:    val('low_stock_markup_pct'),
        };
      case 'velocity_based':
        return {
          lookback_days:                val('lookback_days'),
          high_velocity_threshold_pct:  val('high_velocity_threshold_pct'),
          high_velocity_markup_pct:     val('high_velocity_markup_pct'),
          low_velocity_threshold_pct:   val('low_velocity_threshold_pct'),
          low_velocity_discount_pct:    val('low_velocity_discount_pct'),
          min_sales_count:              val('min_sales_count'),
        };
      default:
        return {};
    }
  }

  // ── Onay modal'ı ─────────────────────────────────────────────────────────
  function showScanConfirmModal() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'prr-modal-overlay';
      overlay.innerHTML = `
        <div class="prr-modal">
          <div class="prr-modal-icon">🔄</div>
          <div class="prr-modal-title">Kural güncellendi</div>
          <div class="prr-modal-body">
            Öneriler yeni parametrelerle yeniden hesaplansın mı?
            Mevcut bekleyen öneriler silinmez, yeni öneri seti eklenir.
          </div>
          <div class="prr-modal-actions">
            <button class="prr-modal-btn-ghost"    id="prr-modal-no">Hayır, Sonra</button>
            <button class="prr-modal-btn-primary"  id="prr-modal-yes">✅ Evet, Şimdi Tara</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      overlay.querySelector('#prr-modal-no').onclick = () => {
        overlay.remove();
        resolve(false);
      };
      overlay.querySelector('#prr-modal-yes').onclick = () => {
        overlay.remove();
        resolve(true);
      };
      overlay.addEventListener('click', e => {
        if (e.target === overlay) { overlay.remove(); resolve(false); }
      });
    });
  }

  // ── API: Yeniden tara ─────────────────────────────────────────────────────
  async function runScan() {
    try {
      const result = await window.api('/api/pricing/scan', { method: 'POST' });
      if (!result) return;
      window.toast(`✅ Tarama tamamlandı — ${result.created} yeni öneri oluşturuldu`, 'success');
    } catch (e) {
      window.toast('❌ Tarama hatası: ' + e.message, 'error');
    }
  }

  // ── API: Kaydet ───────────────────────────────────────────────────────────
  window._prrSave = async function(ruleId, ruleType) {
    const saveBtn = document.getElementById(`prr-save-${ruleId}`);
    if (!saveBtn || saveBtn.disabled) return;

    const parameters = collectParams(ruleId, ruleType);
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Kaydediliyor...';

    try {
      await window.api(`/api/pricing/rules/${ruleId}`, {
        method: 'PUT',
        body: JSON.stringify({ parameters }),
      });
      saveBtn.textContent = '💾 Kaydet';

      const wantScan = await showScanConfirmModal();
      if (wantScan) {
        saveBtn.textContent = '⏳ Taranıyor...';
        saveBtn.disabled = true;
        await runScan();
        saveBtn.textContent = '💾 Kaydet';
      }
    } catch (e) {
      window.toast('❌ Hata: ' + e.message, 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '💾 Kaydet';
    }
  };

  // ── API: Aktif / Pasif toggle ─────────────────────────────────────────────
  window._prrToggle = async function(ruleId, currentIsActive) {
    const toggleBtn = document.getElementById(`prr-toggle-${ruleId}`);
    const card      = document.getElementById(`prr-card-${ruleId}`);
    if (!toggleBtn) return;

    const newActive = currentIsActive ? 0 : 1;
    toggleBtn.disabled = true;
    toggleBtn.textContent = '⏳...';

    try {
      await window.api(`/api/pricing/rules/${ruleId}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: newActive }),
      });

      // Badge güncelle
      const badge = card?.querySelector('.prr-badge');
      if (badge) {
        badge.className = `prr-badge ${newActive ? 'active' : 'passive'}`;
        badge.textContent = newActive ? '✅ AKTİF' : '⏸ PASİF';
      }

      // Buton metni ve onclick argümanı güncelle
      toggleBtn.textContent = newActive ? '⏸ Pasif Et' : '✅ Aktif Et';
      toggleBtn.onclick = () => window._prrToggle(ruleId, newActive);
      toggleBtn.disabled = false;

      window.toast(newActive ? '✅ Kural aktif edildi' : '⏸ Kural pasif edildi', 'success');
    } catch (e) {
      window.toast('❌ Hata: ' + e.message, 'error');
      toggleBtn.disabled = false;
      toggleBtn.textContent = currentIsActive ? '⏸ Pasif Et' : '✅ Aktif Et';
    }
  };

  // ── Sayfa render ──────────────────────────────────────────────────────────
  function init() {
    injectStyle();
    const container = document.getElementById('page-pricing-rules');
    if (!container) return;

    container.innerHTML = `
      <div class="prr-shell">
        <div class="prr-toolbar">
          <div>
            <h2 class="prr-toolbar-title">⚙️ Fiyat Kuralları</h2>
            <p class="prr-toolbar-sub">Fiyatlandırma kurallarını buradan yönetin</p>
          </div>
        </div>
        <div id="prr-body">
          <div class="prr-loading">⏳ Kurallar yükleniyor...</div>
        </div>
      </div>`;

    loadRules();
  }

  async function loadRules() {
    const body = document.getElementById('prr-body');
    if (!body) return;

    try {
      const rules = await window.api('/api/pricing/rules');
      if (!rules) return;

      if (!rules.length) {
        body.innerHTML = `<div class="prr-loading">Henüz tanımlı kural yok.</div>`;
        return;
      }

      body.innerHTML = rules.map(renderCard).join('');
      rules.forEach(r => initDirtyTracking(r.id));
    } catch (e) {
      body.innerHTML = `
        <div class="prr-error">
          ❌ Kurallar yüklenemedi.
          <button class="prr-retry-btn" onclick="window.loadPricingRulesPage()">Tekrar Dene</button>
        </div>`;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.loadPricingRulesPage = init;

})();
