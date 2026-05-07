// public/js/pricingPage.js
// Dinamik Fiyatlandırma sayfası — SPA IIFE modülü.
// Tüm global araçlar (api, toast, navigate) index.html'den gelir.
(function () {
  'use strict';

  // ── Sayfa-özel stiller ─────────────────────────────────────────────────────
  const STYLE = `
    #page-pricing {
      padding: 8px 0 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      overflow-x: hidden;
    }

    .pr-shell {
      display: flex; flex-direction: column; gap: 16px;
      width: 100%;
      max-width: 1180px; margin: 0 auto;
    }

    .pr-toolbar {
      background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,255,255,.92));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px 20px;
      box-shadow: var(--shadow);
    }
    .pr-toolbar-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .pr-toolbar-title {
      font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 4px;
    }
    .pr-toolbar-sub { font-size: 13px; color: var(--muted); }

    /* ── KPI ── */
    .pr-kpi-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; }
    .pr-kpi {
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 18px 20px;
      position: relative; overflow: hidden; transition: .2s;
    }
    .pr-kpi:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
    .pr-kpi-label { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 6px; }
    .pr-kpi-val { font-size: 26px; font-weight: 700; }
    .pr-kpi-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .pr-kpi-glow {
      position: absolute; top: -24px; right: -24px;
      width: 80px; height: 80px; border-radius: 50%; opacity: .09;
    }

    /* ── Filtre tabları ── */
    .pr-filter-bar {
      display: inline-flex; gap: 4px; padding: 4px;
      background: var(--bg3); border: 1px solid var(--border); border-radius: 10px;
    }
    .pr-filter-btn {
      padding: 7px 16px; border-radius: 8px; border: none;
      background: transparent; cursor: pointer; font-size: 13px;
      font-weight: 600; color: var(--muted); font-family: inherit; transition: .15s;
    }
    .pr-filter-btn:hover { color: var(--text); }
    .pr-filter-btn.active { background: var(--accent); color: #fff; }

    /* ── Öneri kartı ── */
    .pr-card {
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius); overflow: hidden;
      transition: box-shadow .2s, opacity .4s, transform .3s;
    }
    .pr-card:hover { box-shadow: var(--shadow); }
    .pr-card.fading { opacity: 0; transform: translateX(40px); }
    .pr-card.approved { border-color: var(--green); background: #f0fdf4; }
    .pr-card.rejected { opacity: .5; }

    .pr-card-head {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 16px; cursor: default;
    }
    .pr-card-title { flex: 1; font-size: 13px; font-weight: 600; min-width: 0; }
    .pr-card-title small {
      display: block; font-size: 11px; font-weight: 400;
      color: var(--muted); margin-top: 1px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* fiyat bloğu */
    .pr-price-block { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .pr-price-old { font-size: 12px; color: var(--muted); text-decoration: line-through; }
    .pr-price-new { font-size: 15px; font-weight: 700; }
    .pr-price-badge {
      font-size: 11px; font-weight: 700; padding: 2px 7px;
      border-radius: 99px;
    }
    .pr-price-badge.down { background: rgba(220,38,38,.12); color: var(--red); }
    .pr-price-badge.up   { background: rgba(22,163,74,.12);  color: var(--green); }

    /* güven çubuğu */
    .pr-confidence {
      display: flex; align-items: center; gap: 8px;
      padding: 0 16px 10px; font-size: 11px; color: var(--muted);
    }
    .pr-conf-bar-wrap {
      flex: 1; height: 5px; background: var(--border);
      border-radius: 99px; overflow: hidden; max-width: 120px;
    }
    .pr-conf-bar { height: 100%; border-radius: 99px; transition: width .4s; }
    .pr-conf-bar.low  { background: var(--red); }
    .pr-conf-bar.mid  { background: var(--yellow); }
    .pr-conf-bar.high { background: var(--green); }

    /* etiket şeridi */
    .pr-tags { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 16px 10px; }
    .pr-tag {
      font-size: 11px; font-weight: 500; padding: 2px 8px;
      border-radius: 99px; background: var(--bg3); color: var(--muted);
    }
    .pr-tag.warn { background: rgba(217,119,6,.1); color: var(--yellow); }
    .pr-tag.info { background: rgba(108,99,255,.1); color: var(--accent2); }

    /* aksiyon satırı */
    .pr-card-footer {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 16px; border-top: 1px solid var(--border);
      background: var(--bg3); flex-wrap: wrap;
    }
    .pr-card-footer .spacer { flex: 1; }
    .pr-status-msg { font-size: 12px; font-weight: 600; }
    .pr-status-msg.ok  { color: var(--green); }
    .pr-status-msg.err { color: var(--red); }

    /* reddetme gerekçe alanı */
    .pr-reject-row {
      padding: 0 16px 12px; display: none;
      animation: fadeDown .2s ease;
    }
    .pr-reject-row.show { display: flex; gap: 8px; }
    .pr-reject-input {
      flex: 1; padding: 7px 10px; border: 1px solid var(--border);
      border-radius: 8px; font-size: 12px; font-family: inherit;
      background: var(--bg2); color: var(--text);
    }
    .pr-reject-input:focus { outline: none; border-color: var(--accent); }

    /* detay paneli */
    .pr-detail {
      display: none; padding: 14px 16px 16px;
      border-top: 1px solid var(--border);
      animation: fadeDown .2s ease;
    }
    .pr-detail.show { display: block; }
    .pr-detail-title { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }
    .pr-reasoning { font-size: 12px; color: var(--text); line-height: 1.6; margin-bottom: 12px; background: var(--bg3); border-radius: 8px; padding: 10px 12px; }
    .pr-rule-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12px; border-bottom: 1px solid var(--border); }
    .pr-rule-row:last-child { border-bottom: none; }
    .pr-rule-name { flex: 1; font-weight: 500; }
    .pr-rule-contrib { font-weight: 700; min-width: 44px; text-align: right; }
    .pr-rule-contrib.pos { color: var(--green); }
    .pr-rule-contrib.neg { color: var(--red); }
    .pr-rule-contrib.veto { color: var(--yellow); }

    @keyframes fadeDown {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* boş durum */
    .pr-empty { text-align: center; padding: 56px 20px; color: var(--muted); }
    .pr-empty .emoji { font-size: 44px; margin-bottom: 12px; }
    .pr-empty p { font-size: 14px; }

    /* mobil */
    @media (max-width: 640px) {
      .pr-kpi-row { grid-template-columns: 1fr 1fr; }
      .pr-shell { padding: 16px; }
      .pr-card-head { flex-wrap: wrap; }
      .pr-price-block { width: 100%; }
    }
  `;

  // ── Durum ────────────────────────────────────────────────────────────────────
  let currentFilter = 'pending';
  let isScanning    = false;

  // ── Yardımcılar ─────────────────────────────────────────────────────────────
  function fmt(n) { return '₺' + Number(n).toLocaleString('tr', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtImpact(n) {
    const abs = Math.abs(n);
    const prefix = n >= 0 ? '+₺' : '-₺';
    return prefix + abs.toLocaleString('tr', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function timeAgo(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)   return 'Az önce';
    if (diff < 3600) return Math.floor(diff / 60) + ' dakika önce';
    if (diff < 86400)return Math.floor(diff / 3600) + ' saat önce';
    return Math.floor(diff / 86400) + ' gün önce';
  }
  function confClass(score) {
    if (score < 0.5) return 'low';
    if (score < 0.76) return 'mid';
    return 'high';
  }
  function confLabel(score) {
    if (score < 0.5) return 'Düşük';
    if (score < 0.76) return 'Orta';
    return 'Yüksek';
  }

  // ── Render: KPI kartları ─────────────────────────────────────────────────────
  function renderKPIs(data) {
    const lastScan = data.recommendations?.[0]?.created_at;
    return `
      <div class="pr-kpi-row">
        <div class="pr-kpi">
          <div class="pr-kpi-label">Bekleyen Öneri</div>
          <div class="pr-kpi-val" id="pr-kpi-pending">${data.pending ?? '—'}</div>
          <div class="pr-kpi-sub">Onay bekliyor</div>
          <div class="pr-kpi-glow" style="background:var(--accent)"></div>
        </div>
        <div class="pr-kpi">
          <div class="pr-kpi-label">Tahmini Aylık Etki</div>
          <div class="pr-kpi-val" id="pr-kpi-impact" style="color:${(data.estimatedMonthlyImpact||0) >= 0 ? 'var(--green)' : 'var(--red)'}">
            ${fmtImpact(data.estimatedMonthlyImpact || 0)}
          </div>
          <div class="pr-kpi-sub">Tüm öneriler uygulanırsa</div>
          <div class="pr-kpi-glow" style="background:var(--green)"></div>
        </div>
        <div class="pr-kpi">
          <div class="pr-kpi-label">Son Tarama</div>
          <div class="pr-kpi-val" style="font-size:18px" id="pr-kpi-scan">${timeAgo(lastScan)}</div>
          <div class="pr-kpi-sub">Sistem son öneriyi oluşturdu</div>
          <div class="pr-kpi-glow" style="background:var(--yellow)"></div>
        </div>
      </div>`;
  }

  // ── Render: Tek öneri kartı ──────────────────────────────────────────────────
  function renderCard(rec) {
    const pct        = parseFloat(rec.price_change_percent) || 0;
    const isDown     = pct < 0;
    const pctDisplay = (isDown ? '▼ ' : '▲ +') + Math.abs(pct).toFixed(2) + '%';
    const pctClass   = isDown ? 'down' : 'up';
    const confPct    = Math.round((rec.confidence_score || 0) * 100);
    const cClass     = confClass(rec.confidence_score || 0);

    // Uygulanan kurallar (JSON string → array)
    let rules = [];
    try { rules = JSON.parse(rec.applied_rules || '[]'); } catch { rules = []; }

    // Kural etiketleri
    const tags = rules.map(r => {
      if (r.ruleType === 'min_margin') return `<span class="pr-tag warn">⚠️ Marj koruması devreye girdi</span>`;
      if (r.ruleType === 'stock_based' && r.contribution < 0) return `<span class="pr-tag info">📦 Stok fazlası</span>`;
      if (r.ruleType === 'stock_based' && r.contribution > 0) return `<span class="pr-tag warn">📦 Düşük stok</span>`;
      if (r.ruleType === 'velocity_based' && r.contribution > 0) return `<span class="pr-tag info">🚀 Satış hızı yüksek</span>`;
      if (r.ruleType === 'velocity_based' && r.contribution < 0) return `<span class="pr-tag warn">📉 Satış hızı düşük</span>`;
      return '';
    }).filter(Boolean).join('');

    // Kural detay satırları
    const ruleRows = rules.map(r => {
      let contrib, cls;
      if (r.contribution === 0) { contrib = 'veto'; cls = 'veto'; }
      else if (r.contribution > 0) { contrib = '+' + (r.contribution * 100).toFixed(1) + '%'; cls = 'pos'; }
      else { contrib = (r.contribution * 100).toFixed(1) + '%'; cls = 'neg'; }
      const type = { min_margin: '🛡 Marj', stock_based: '📦 Stok', velocity_based: '🚀 Hız' }[r.ruleType] || r.ruleType;
      return `<div class="pr-rule-row">
        <span class="pr-tag" style="margin:0">${type}</span>
        <span class="pr-rule-name">${r.ruleName || '—'}</span>
        <span class="pr-rule-contrib ${cls}">${contrib}</span>
      </div>`;
    }).join('');

    // Durum rozeti (onaylanmış/reddedilmiş)
    let statusBadge = '';
    if (rec.status === 'approved') statusBadge = `<span class="badge badge-green">✓ Onaylandı</span>`;
    if (rec.status === 'rejected') statusBadge = `<span class="badge badge-red">✗ Reddedildi</span>`;

    const isActionable = rec.status === 'pending';

    return `
      <div class="pr-card" id="prc-${rec.id}">
        <div class="pr-card-head">
          <div class="pr-card-title">
            ${escHtml(rec.title || '—')}
            <small>Barkod: ${rec.barcode || '—'} · Stok: ${rec.stock ?? '—'} adet · ${rec.supplier_name || '—'}</small>
          </div>
          <div class="pr-price-block">
            <span class="pr-price-old">${fmt(rec.current_price)}</span>
            <span class="pr-price-new">${fmt(rec.recommended_price)}</span>
            <span class="pr-price-badge ${pctClass}">${pctDisplay}</span>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="window.prToggleDetail(${rec.id})">Detay ▾</button>
        </div>

        <div class="pr-confidence">
          <span>Güven</span>
          <div class="pr-conf-bar-wrap">
            <div class="pr-conf-bar ${cClass}" style="width:${confPct}%"></div>
          </div>
          <span>${confPct}% — ${confLabel(rec.confidence_score || 0)}</span>
          ${statusBadge}
        </div>

        ${tags ? `<div class="pr-tags">${tags}</div>` : ''}

        <!-- Detay paneli -->
        <div class="pr-detail" id="prd-${rec.id}">
          <div class="pr-detail-title">Gerekçe</div>
          <div class="pr-reasoning">${escHtml(rec.reasoning || '—').replace(/\. /g, '.<br>')}</div>
          ${ruleRows ? `<div class="pr-detail-title" style="margin-top:10px">Uygulanan Kurallar</div>${ruleRows}` : ''}
        </div>

        <!-- Reddetme gerekçe alanı -->
        ${isActionable ? `
        <div class="pr-reject-row" id="prr-${rec.id}">
          <input class="pr-reject-input" id="prri-${rec.id}" placeholder="Reddetme gerekçesi (opsiyonel)..." />
          <button class="btn btn-danger btn-sm" onclick="window.prConfirmReject(${rec.id})">Onayla →</button>
          <button class="btn btn-ghost btn-sm" onclick="window.prCancelReject(${rec.id})">İptal</button>
        </div>` : ''}

        <!-- Alt aksiyon çubuğu -->
        <div class="pr-card-footer">
          <span style="font-size:11px;color:var(--muted)">${timeAgo(rec.created_at)}</span>
          <span class="spacer"></span>
          <span class="pr-status-msg" id="prm-${rec.id}"></span>
          ${isActionable ? `
            <button class="btn btn-success btn-sm" id="prab-${rec.id}" onclick="window.prApprove(${rec.id})">✓ Onayla</button>
            <button class="btn btn-ghost btn-sm"   id="prrb-${rec.id}" onclick="window.prReject(${rec.id})">✗ Reddet</button>
          ` : ''}
        </div>
      </div>`;
  }

  // ── Render: Kart listesi ─────────────────────────────────────────────────────
  function renderList(data) {
    const list = document.getElementById('pr-list');
    if (!list) return;
    if (!data.recommendations?.length) {
      const labels = { pending: 'bekleyen', approved: 'onaylanmış', rejected: 'reddedilmiş', '': '' };
      list.innerHTML = `<div class="pr-empty">
        <div class="emoji">💰</div>
        <p>Henüz ${labels[currentFilter] || ''} fiyat önerisi yok.</p>
        <p style="margin-top:8px;font-size:12px">Öneri üretmek için <strong>"Şimdi Tara"</strong> butonuna tıklayın.</p>
      </div>`;
      return;
    }
    list.innerHTML = data.recommendations.map(renderCard).join('');
  }

  // ── API: Veri yükle ─────────────────────────────────────────────────────────
  async function load(filter) {
    currentFilter = filter ?? currentFilter;
    const list = document.getElementById('pr-list');
    if (list) list.innerHTML = `<div class="pr-empty"><div class="emoji" style="font-size:28px">⏳</div><p>Yükleniyor...</p></div>`;

    try {
      const params = new URLSearchParams({ limit: 50, page: 1 });
      if (currentFilter) params.set('status', currentFilter);
      const data = await window.api('/api/pricing/recommendations?' + params);
      if (!data) return;

      // KPI güncelle
      document.getElementById('pr-kpi-pending').textContent = data.pending ?? '—';
      const impactEl = document.getElementById('pr-kpi-impact');
      if (impactEl) {
        impactEl.textContent = fmtImpact(data.estimatedMonthlyImpact || 0);
        impactEl.style.color = (data.estimatedMonthlyImpact || 0) >= 0 ? 'var(--green)' : 'var(--red)';
      }
      const scanEl = document.getElementById('pr-kpi-scan');
      if (scanEl) {
        const lastScan = data.recommendations?.[0]?.created_at;
        scanEl.textContent = timeAgo(lastScan);
      }

      renderList(data);

      // Filtre badge'leri güncelle
      const pBtn = document.getElementById('pr-fb-pending');
      if (pBtn && data.pending > 0) pBtn.textContent = `Bekleyen (${data.pending})`;
    } catch (e) {
      if (list) list.innerHTML = `<div class="pr-empty"><div class="emoji">⚠️</div><p>${escHtml(e.message)}</p></div>`;
    }
  }

  // ── API: Tarama tetikle ──────────────────────────────────────────────────────
  async function scan() {
    if (isScanning) return;
    isScanning = true;
    const btn = document.getElementById('pr-scan-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Taranıyor...'; }

    try {
      const result = await window.api('/api/pricing/scan', { method: 'POST' });
      if (!result) return;
      window.toast(`✅ Tarama tamamlandı — ${result.created} yeni öneri oluşturuldu (${result.total} ürün tarandı)`, 'success');
      await load();
    } catch (e) {
      window.toast('❌ Tarama hatası: ' + e.message, 'error');
    } finally {
      isScanning = false;
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Şimdi Tara'; }
    }
  }

  // ── Aksiyonlar ───────────────────────────────────────────────────────────────

  // Detay panelini aç/kapat
  window.prToggleDetail = function(id) {
    const panel = document.getElementById(`prd-${id}`);
    if (!panel) return;
    panel.classList.toggle('show');
    const btn = panel.closest('.pr-card')?.querySelector('.btn-ghost');
    if (btn) btn.textContent = panel.classList.contains('show') ? 'Detay ▴' : 'Detay ▾';
  };

  // Onayla
  window.prApprove = async function(id) {
    const approveBtn = document.getElementById(`prab-${id}`);
    const rejectBtn  = document.getElementById(`prrb-${id}`);
    const msgEl      = document.getElementById(`prm-${id}`);
    if (!approveBtn) return;

    approveBtn.disabled = true; approveBtn.textContent = '⏳ İşleniyor...';
    if (rejectBtn) rejectBtn.disabled = true;

    try {
      const res = await window.api(`/api/pricing/recommendations/${id}/approve`, { method: 'POST' });
      if (!res) return;

      const card = document.getElementById(`prc-${id}`);
      if (msgEl) { msgEl.textContent = `✓ Onaylandı — Yeni fiyat: ₺${res.newPrice.toFixed(2)}`; msgEl.className = 'pr-status-msg ok'; }
      if (res.trendyolStatus !== 'ok') {
        window.toast(`⚠️ Fiyat güncellendi ama Trendyol push hatası: ${res.trendyolStatus}`, 'error');
      } else {
        window.toast('✅ Fiyat güncellendi ve Trendyol\'a gönderildi', 'success');
      }
      // Kartı kısa gecikmeyle listeden kaldır
      if (card) {
        card.classList.add('approved');
        setTimeout(() => { card.classList.add('fading'); setTimeout(() => { card.remove(); updatePendingBadge(); }, 400); }, 1200);
      }
    } catch (e) {
      if (msgEl) { msgEl.textContent = '❌ ' + e.message; msgEl.className = 'pr-status-msg err'; }
      approveBtn.disabled = false; approveBtn.textContent = '✓ Onayla';
      if (rejectBtn) rejectBtn.disabled = false;
    }
  };

  // Reddet — gerekçe alanını göster
  window.prReject = function(id) {
    const row    = document.getElementById(`prr-${id}`);
    const rejectBtn = document.getElementById(`prrb-${id}`);
    if (!row) return;
    row.classList.toggle('show');
    if (rejectBtn) rejectBtn.textContent = row.classList.contains('show') ? '▲ Kapat' : '✗ Reddet';
  };

  window.prCancelReject = function(id) {
    const row = document.getElementById(`prr-${id}`);
    const btn = document.getElementById(`prrb-${id}`);
    if (row) row.classList.remove('show');
    if (btn) btn.textContent = '✗ Reddet';
  };

  // Reddi onayla
  window.prConfirmReject = async function(id) {
    const msgEl  = document.getElementById(`prm-${id}`);
    const reason = document.getElementById(`prri-${id}`)?.value?.trim() || '';

    try {
      await window.api(`/api/pricing/recommendations/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      const card = document.getElementById(`prc-${id}`);
      if (msgEl) { msgEl.textContent = '✗ Reddedildi'; msgEl.className = 'pr-status-msg err'; }
      if (card) {
        card.classList.add('rejected');
        setTimeout(() => { card.classList.add('fading'); setTimeout(() => { card.remove(); updatePendingBadge(); }, 400); }, 1000);
      }
    } catch (e) {
      if (msgEl) { msgEl.textContent = '❌ ' + e.message; msgEl.className = 'pr-status-msg err'; }
    }
  };

  // Bekleyen sayısını güncelle
  function updatePendingBadge() {
    const remaining = document.querySelectorAll('#pr-list .pr-card').length;
    const kpiEl = document.getElementById('pr-kpi-pending');
    if (kpiEl) kpiEl.textContent = remaining;
    const fbEl = document.getElementById('pr-fb-pending');
    if (fbEl) fbEl.textContent = remaining > 0 ? `Bekleyen (${remaining})` : 'Bekleyen';
  }

  // ── HTML oluştur ─────────────────────────────────────────────────────────────
  function init() {
    const container = document.getElementById('page-pricing');
    if (!container) return;

    container.innerHTML = `
      <div class="pr-shell">
        <!-- Üst toolbar -->
        <div class="pr-toolbar">
          <div class="pr-toolbar-head">
            <div>
              <h2 class="pr-toolbar-title">💰 Fiyat Önerileri</h2>
              <p class="pr-toolbar-sub">Sistem tarafından analiz edilen fiyatlandırma önerileri</p>
            </div>
            <button class="btn btn-primary" id="pr-scan-btn" onclick="window.prScan()">
              🔄 Şimdi Tara
            </button>
          </div>
        </div>

        <!-- KPI kartları -->
        <div class="pr-kpi-row">
          <div class="pr-kpi">
            <div class="pr-kpi-label">Bekleyen Öneri</div>
            <div class="pr-kpi-val" id="pr-kpi-pending">—</div>
            <div class="pr-kpi-sub">Onay bekliyor</div>
            <div class="pr-kpi-glow" style="background:var(--accent)"></div>
          </div>
          <div class="pr-kpi">
            <div class="pr-kpi-label">Tahmini Aylık Etki</div>
            <div class="pr-kpi-val" id="pr-kpi-impact">—</div>
            <div class="pr-kpi-sub">Tüm öneriler uygulanırsa</div>
            <div class="pr-kpi-glow" style="background:var(--green)"></div>
          </div>
          <div class="pr-kpi">
            <div class="pr-kpi-label">Son Tarama</div>
            <div class="pr-kpi-val" style="font-size:18px" id="pr-kpi-scan">—</div>
            <div class="pr-kpi-sub">En son öneri oluşturuldu</div>
            <div class="pr-kpi-glow" style="background:var(--yellow)"></div>
          </div>
        </div>

        <!-- Filtre tabları -->
        <div>
          <div class="pr-filter-bar">
            <button class="pr-filter-btn active" id="pr-fb-all"      onclick="window.prFilter('')">Tümü</button>
            <button class="pr-filter-btn"         id="pr-fb-pending"  onclick="window.prFilter('pending')">Bekleyen</button>
            <button class="pr-filter-btn"         id="pr-fb-approved" onclick="window.prFilter('approved')">Onaylanan</button>
            <button class="pr-filter-btn"         id="pr-fb-rejected" onclick="window.prFilter('rejected')">Reddedilen</button>
          </div>
        </div>

        <!-- Öneri listesi -->
        <div id="pr-list" style="display:flex;flex-direction:column;gap:12px">
          <div class="pr-empty"><div class="emoji" style="font-size:28px">⏳</div><p>Yükleniyor...</p></div>
        </div>
      </div>`;

    load('pending');

    // İlk yüklemede "Bekleyen" filtresini aktif et
    setActiveFilter('pending');
  }

  // Filtre seçimi
  window.prFilter = function(status) {
    setActiveFilter(status);
    load(status);
  };

  function setActiveFilter(status) {
    currentFilter = status;
    document.querySelectorAll('.pr-filter-btn').forEach(b => b.classList.remove('active'));
    const map = { '': 'pr-fb-all', pending: 'pr-fb-pending', approved: 'pr-fb-approved', rejected: 'pr-fb-rejected' };
    const btn = document.getElementById(map[status] ?? 'pr-fb-all');
    if (btn) btn.classList.add('active');
  }

  // Tara butonu global
  window.prScan = scan;

  // ── HTML escape yardımcısı ───────────────────────────────────────────────────
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Stil enjeksiyonu ─────────────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  // ── Public API ───────────────────────────────────────────────────────────────
  window.loadPricingPage = init;

})();
