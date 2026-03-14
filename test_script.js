
    // Eğer Live Server (örn: 5500) üzerinden açıldıysa veya doğrudan dosyadan açıldıysa, istekleri 3000'e yönlendir.
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const API = (window.location.protocol === 'file:' || (isLocalhost && window.location.port !== '3000')) ? 'http://localhost:3000' : '';
    let TOKEN = localStorage.getItem('dealer_token') || '';
    let DEALER = JSON.parse(localStorage.getItem('dealer_info') || 'null');
    let prodPage = 1;
    let pendingStocks = {};

    // ─── AUTH ───
    async function doLogin() {
      const email = document.getElementById('login-email').value.trim();
      const pass = document.getElementById('login-pass').value;
      if (!email || !pass) return toast('Email ve şifre girin', 'error');
      const btn = document.getElementById('login-btn');
      btn.textContent = 'Giriş yapılıyor...'; btn.disabled = true;
      try {
        const reqUrl = API + '/api/auth/login';
        const r = await fetch(reqUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
        const text = await r.text();
        let d;
        try {
          d = text ? JSON.parse(text) : {};
        } catch(err) {
          throw new Error('Sunucudan geçersiz yanıt geldi, JSON değil: ' + text.substring(0, 100));
        }

        if (!r.ok) throw new Error(d.error || 'Giriş hatası (' + r.status + ')');
        TOKEN = d.token; DEALER = d.dealer;
        localStorage.setItem('dealer_token', TOKEN);
        localStorage.setItem('dealer_info', JSON.stringify(DEALER));
        initApp();
      } catch (e) {
        if (e.message === 'Failed to fetch') {
          toast('Sunucuya bağlanılamadı. Lütfen "node server.js" komutunun çalıştığından emin olun.', 'error');
        } else {
          toast(e.message, 'error');
        }
      }
      btn.textContent = 'Giriş Yap'; btn.disabled = false;
    }

    function logout() {
      TOKEN = ''; DEALER = null;
      localStorage.removeItem('dealer_token');
      localStorage.removeItem('dealer_info');
      document.getElementById('login-page').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
    }

    async function api(path, opts = {}) {
      const res = await fetch(API + path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}`, ...(opts.headers || {}) }
      });
      if (res.status === 401) { logout(); return null; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Sunucu hatası');
      return data;
    }

    // ─── INIT ───
    function initApp() {
      document.getElementById('login-page').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      if (DEALER) {
        document.getElementById('dealer-name').textContent = DEALER.name;
        document.getElementById('dealer-email').textContent = DEALER.email;
        document.getElementById('dealer-avatar').textContent = (DEALER.name || 'B')[0].toUpperCase();
      }

      // Güvence için manuel EventListener ekleyelim
      const upBtn = document.getElementById('btn-trendyol-upload');
      if (upBtn) {
        upBtn.onclick = function(e) {
          e.preventDefault();
          uploadToTrendyol();
        };
      }

      navigate('dashboard');
      loadSupplierFilters();
    }

    function navigate(page) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.getElementById('page-' + page)?.classList.add('active');
      document.getElementById('nav-' + page)?.classList.add('active');
      const titles = { dashboard: 'Dashboard', xml: 'XML Feedler', products: 'Ürünlerim', margins: 'Kâr Marjları', profitloss: 'Kâr / Zarar Analizi', stores: 'Mağazalarım', orders: 'Siparişler', settings: 'Trendyol Ayarları' };
      document.getElementById('page-title').textContent = titles[page] || page;
      if (page === 'dashboard') loadDashboard();
      if (page === 'xml') loadXmlFeeds();
      if (page === 'products') { prodPage = 1; loadProducts(); }
      if (page === 'margins') loadMargins();
      if (page === 'profitloss') loadProfitLoss();
      if (page === 'stores') loadStores();
      if (page === 'orders') loadOrders();
      if (page === 'settings') loadSettings();
    }

    // ─── SETTINGS ───
    async function loadSettings() {
      try {
        const d = await api('/api/auth/me');
        if (!d) return;
        document.getElementById('set-name').value = d.name || '';
        document.getElementById('set-phone').value = d.phone || '';
        document.getElementById('set-supplier').value = d.supplier_id || '';
        document.getElementById('set-apikey').value = d.api_key || '';
        document.getElementById('set-margin').value = d.profit_margin || 20;
        document.getElementById('set-apisecret').value = '';
        document.getElementById('set-password').value = '';
        // Upload status
        const statusEl = document.getElementById('settings-upload-status');
        const hasApi = d.supplier_id && d.api_key;
        statusEl.innerHTML = hasApi
          ? `<span style="color:var(--green)">✅ API bilgileri mevcut. Supplier ID: <strong>${d.supplier_id}</strong></span>`
          : `<span style="color:var(--red)">⚠️ API bilgileri eksik. Lütfen Supplier ID, API Key ve API Secret girin.</span>`;
      } catch (e) { toast(e.message, 'error'); }
    }

    async function saveProfile() {
      const body = {
        name: document.getElementById('set-name').value,
        phone: document.getElementById('set-phone').value,
        supplier_id: document.getElementById('set-supplier').value,
        api_key: document.getElementById('set-apikey').value,
        api_secret: document.getElementById('set-apisecret').value,
        profit_margin: parseFloat(document.getElementById('set-margin').value) || 20,
        password: document.getElementById('set-password').value,
      };
      try {
        await api('/api/dealer/profile', { method: 'PUT', body: JSON.stringify(body) });
        toast('✅ Profil kaydedildi!', 'success');
        loadSettings();
      } catch (e) { toast(e.message, 'error'); }
    }

    async function uploadToTrendyol() {
      alert("Button clicked!");
      console.log("Upload started");
      const btn = document.getElementById('btn-trendyol-upload');
      const statusEl = document.getElementById('settings-upload-status');
      if (!btn || !statusEl) { alert('Elements not found!'); return; }
      btn.textContent = '⏳ Yükleniyor...'; btn.disabled = true;
      statusEl.innerHTML = `<span style="color:var(--accent)">⏳ Trendyol'a gönderiliyor, lütfen bekleyin...</span>`;
      try {
        console.log("Sending API request to /api/dealer/trendyol-upload");
        const reqRes = await api('/api/dealer/trendyol-upload', { method: 'POST', body: JSON.stringify({}) });
        console.log("API response arrived:", reqRes);
        
        // Logları canlı izle (90 saniye boyunca 3s'de bir kontrol et)
        let lastId = 0;
        let attempts = 0;
        const maxAttempts = 30;
        const logLines = [];
        
        const poller = setInterval(async () => {
          attempts++;
          try {
            const logs = await api('/api/dealer/logs');
            if (!logs) return;
            const newLogs = logs.filter(l => l.id > lastId).reverse();
            if (newLogs.length) {
              lastId = newLogs[newLogs.length - 1].id;
              newLogs.forEach(l => {
                const color = l.level === 'error' ? 'var(--red)' : l.level === 'success' ? 'var(--green)' : 'var(--accent)';
                const icon = l.level === 'error' ? '❌' : l.level === 'success' ? '✅' : 'ℹ️';
                const time = new Date(l.created_at + 'Z').toLocaleTimeString('tr');
                logLines.unshift(`<div style="padding:4px 0;border-bottom:1px solid #222;font-size:12px"><span style="color:${color}">${icon} [${time}] ${esc(l.message)}</span></div>`);
              });
              statusEl.innerHTML = `<div style="max-height:200px;overflow-y:auto;background:#1a1a2e;border-radius:8px;padding:8px;margin-top:8px">${logLines.slice(0,20).join('')}</div>`;
            }
            // Yükleme tamamlandı mı?
            if (newLogs.some(l => l.message.includes('yükleme tamamlandı'))) {
              clearInterval(poller);
              btn.textContent = '🚀 Trendyol\'a Yükle'; btn.disabled = false;
              toast('✅ Trendyol yükleme tamamlandı!', 'success');
            }
          } catch (ex) {
            console.error('Log fetch error:', ex);
          }
          if (attempts >= maxAttempts) {
            clearInterval(poller);
            btn.textContent = '🚀 Trendyol\'a Yükle'; btn.disabled = false;
          }
        }, 3000);
        
      } catch (e) {
        toast('❌ Hata: ' + e.message, 'error');
        btn.textContent = '🚀 Trendyol\'a Yükle'; btn.disabled = false;
      }
    }

    // ─── DASHBOARD ───
    async function loadDashboard() {
      try {
        const d = await api('/api/dealer/dashboard');
        if (!d) return;
        document.getElementById('kpi-orders').textContent = d.totalOrders.toLocaleString('tr');
        document.getElementById('kpi-revenue').textContent = '₺' + d.netRevenue.toLocaleString('tr', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        document.getElementById('kpi-refunds').textContent = d.totalRefunds.toLocaleString('tr');
        document.getElementById('kpi-stores').textContent = d.storeCount.toLocaleString('tr');
        document.getElementById('kpi-products').textContent = d.productCount.toLocaleString('tr');
        document.getElementById('kpi-xmls').textContent = d.xmlCount.toLocaleString('tr');
      } catch (e) { toast(e.message, 'error'); }
    }

    // ─── XML FEEDS ───
    async function loadXmlFeeds() {
      try {
        const feeds = await api('/api/dealer/xml-feeds');
        if (!feeds) return;
        const el = document.getElementById('xml-list');
        if (!feeds.length) { el.innerHTML = '<div class="empty-state"><div class="emoji">🔗</div><p>Henüz XML feed eklenmemiş</p></div>'; return; }
        el.innerHTML = feeds.map(f => `
      <div class="card" style="margin-bottom:12px;display:flex;align-items:center;gap:16px">
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px;margin-bottom:4px">${esc(f.name)}</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">${esc(f.url)}</div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="badge badge-blue">${esc(f.supplier_name)}</span>
            <span class="badge badge-green">${f.product_count} ürün</span>
            ${f.last_imported ? `<span style="font-size:11px;color:var(--muted)">Son: ${new Date(f.last_imported).toLocaleDateString('tr')}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-success btn-sm" onclick="importXml(${f.id}, this)">⬇️ İçe Aktar</button>
          <button class="btn btn-danger btn-sm" onclick="deleteXmlFeed(${f.id})">🗑️</button>
        </div>
      </div>
    `).join('');
      } catch (e) { toast(e.message, 'error'); }
    }

    async function addXmlFeed() {
      const url = document.getElementById('xf-url').value.trim();
      const name = document.getElementById('xf-name').value.trim() || url;
      const supplier = document.getElementById('xf-supplier').value.trim() || 'Genel';
      if (!url) return toast('URL gerekli', 'error');
      try {
        await api('/api/dealer/xml-feeds', { method: 'POST', body: JSON.stringify({ url, name, supplier_name: supplier }) });
        toast('Feed eklendi!', 'success');
        document.getElementById('xf-url').value = '';
        document.getElementById('xf-name').value = '';
        document.getElementById('xf-supplier').value = '';
        loadXmlFeeds(); loadSupplierFilters();
      } catch (e) { toast(e.message, 'error'); }
    }

    async function importXml(id, btn) {
      btn.textContent = '⏳ İçe Aktarılıyor...'; btn.disabled = true;
      try {
        const r = await api(`/api/dealer/xml-feeds/${id}/import`, { method: 'POST' });
        toast(`✅ ${r.count} ürün içe aktarıldı (Marj: %${r.margin})`, 'success');
        loadXmlFeeds(); loadSupplierFilters();
      } catch (e) { toast('Hata: ' + e.message, 'error'); }
      btn.textContent = '⬇️ İçe Aktar'; btn.disabled = false;
    }

    async function deleteXmlFeed(id) {
      if (!confirm('Bu XML feed silinsin mi?')) return;
      await api(`/api/dealer/xml-feeds/${id}`, { method: 'DELETE' });
      toast('Feed silindi', 'info'); loadXmlFeeds();
    }

    // ─── ÜRÜNLER ───
    async function loadProducts() {
      const search = document.getElementById('prod-search').value;
      const supplier = document.getElementById('prod-supplier').value;
      try {
        const d = await api(`/api/dealer/products?page=${prodPage}&limit=50&search=${encodeURIComponent(search)}&supplier=${encodeURIComponent(supplier)}`);
        if (!d) return;
        const tbody = document.getElementById('prod-tbody');
        if (!d.products.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:32px">Ürün bulunamadı</td></tr>'; return; }
        tbody.innerHTML = d.products.map(p => {
          const margin = p.cost_price > 0 ? ((p.sale_price - p.cost_price) / p.cost_price * 100).toFixed(1) : 0;
          const stockCls = p.stock === 0 ? 'badge-red' : p.stock < 5 ? 'badge-yellow' : 'badge-green';
          return `<tr>
        <td><div style="font-weight:500;font-size:13px">${esc(p.title?.substring(0, 60))}${p.title?.length > 60 ? '...' : ''}</div></td>
        <td><code style="font-size:11px;color:var(--muted)">${esc(p.barcode)}</code></td>
        <td><span class="badge badge-blue">${esc(p.supplier_name)}</span></td>
        <td>₺${p.cost_price?.toFixed(2)}</td>
        <td style="font-weight:600;color:var(--green)">₺${p.sale_price?.toFixed(2)}</td>
        <td><span class="badge ${margin > 0 ? 'badge-green' : 'badge-red'}">%${margin}</span></td>
        <td><input class="stock-input" type="number" value="${p.stock}" min="0" data-barcode="${esc(p.barcode)}" onchange="pendingStocks['${esc(p.barcode)}'] = parseInt(this.value)"/></td>
      </tr>`;
        }).join('');
        document.getElementById('prod-info').textContent = `Toplam ${d.total} ürün | Sayfa ${d.page}/${d.totalPages}`;
        document.getElementById('prod-prev').disabled = d.page <= 1;
        document.getElementById('prod-next').disabled = d.page >= d.totalPages;
      } catch (e) { toast(e.message, 'error'); }
    }

    async function savePendingStocks() {
      const items = Object.entries(pendingStocks).map(([barcode, stock]) => ({ barcode, stock }));
      if (!items.length) return toast('Değiştirilecek stok yok', 'info');
      try {
        await api('/api/dealer/products/bulk-stock', { method: 'POST', body: JSON.stringify(items) });
        pendingStocks = {};
        toast(`${items.length} ürün stoğu güncellendi`, 'success');
      } catch (e) { toast(e.message, 'error'); }
    }

    // ─── KÂR MARJLARI ───
    async function loadMargins() {
      try {
        const suppliers = await api('/api/dealer/suppliers');
        if (!suppliers) return;
        const el = document.getElementById('suppliers-grid');
        if (!suppliers.length) { el.innerHTML = '<div class="empty-state"><div class="emoji">📦</div><p>Henüz ürün yüklenmemiş</p></div>'; return; }
        el.innerHTML = suppliers.map(s => `
      <div class="supplier-card">
        <div class="supplier-icon">🏭</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px;margin-bottom:2px">${esc(s.supplier_name)}</div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:10px">${s.product_count} ürün</div>
          <div class="range-wrap">
            <input type="range" min="0" max="200" value="${s.margin}" 
              oninput="this.nextElementSibling.textContent='%'+this.value"
              onchange="updateMargin('${esc(s.supplier_name)}', this.value, this)"/>
            <div class="range-val">%${s.margin}</div>
          </div>
        </div>
      </div>
    `).join('');
      } catch (e) { toast(e.message, 'error'); }
    }

    async function updateMargin(supplierName, margin, el) {
      try {
        const r = await api(`/api/dealer/suppliers/${encodeURIComponent(supplierName)}/margin`, { method: 'PATCH', body: JSON.stringify({ margin: parseFloat(margin) }) });
        toast(`${supplierName}: Marj %${margin} yapıldı (${r.updated} ürün güncellendi)`, 'success');
      } catch (e) { toast(e.message, 'error'); }
    }

    // ─── KÂR / ZARAR ───
    async function loadProfitLoss() {
      const search = document.getElementById('pl-search').value;
      const supplier = document.getElementById('pl-supplier').value;
      try {
        const d = await api(`/api/dealer/profit-loss?search=${encodeURIComponent(search)}&supplier=${encodeURIComponent(supplier)}`);
        if (!d) return;
        const s = d.summary;
        document.getElementById('pl-products').textContent = s.total_products || 0;
        document.getElementById('pl-cost').textContent = '₺' + (s.total_cost || 0).toLocaleString('tr', { maximumFractionDigits: 0 });
        document.getElementById('pl-revenue').textContent = '₺' + (s.total_revenue || 0).toLocaleString('tr', { maximumFractionDigits: 0 });
        document.getElementById('pl-profit').textContent = '₺' + (s.total_profit || 0).toLocaleString('tr', { maximumFractionDigits: 0 });
        document.getElementById('pl-profit').style.color = s.total_profit >= 0 ? 'var(--green)' : 'var(--red)';

        const tbody = document.getElementById('pl-tbody');
        tbody.innerHTML = d.products.map(p => {
          const profitCls = p.profit_per_unit >= 0 ? 'badge-green' : 'badge-red';
          const mrgCls = p.margin_pct >= 0 ? 'badge-green' : 'badge-red';
          return `<tr>
        <td><div style="font-weight:500;font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title)}</div><div style="font-size:10px;color:var(--muted)">${esc(p.supplier_name)}</div></td>
        <td>₺${p.cost_price?.toFixed(2)}</td>
        <td style="color:var(--green);font-weight:600">₺${p.sale_price?.toFixed(2)}</td>
        <td><span class="badge ${profitCls}">₺${p.profit_per_unit?.toFixed(2)}</span></td>
        <td><span class="badge ${mrgCls}">%${p.margin_pct}</span></td>
        <td>${p.stock}</td>
        <td style="font-weight:700;color:${p.total_potential_profit >= 0 ? 'var(--green)' : 'var(--red)'}">₺${(p.total_potential_profit || 0).toLocaleString('tr', { maximumFractionDigits: 0 })}</td>
      </tr>`;
        }).join('');
      } catch (e) { toast(e.message, 'error'); }
    }

    // ─── MAĞAZALAR ───
    async function loadStores() {
      try {
        const stores = await api('/api/dealer/stores');
        if (!stores) return;
        const el = document.getElementById('stores-grid');
        if (!stores.length) { el.innerHTML = '<div class="empty-state"><div class="emoji">🏪</div><p>Henüz mağaza eklenmemiş</p></div>'; return; }
        el.innerHTML = stores.map(s => `
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:16px;font-weight:700">${esc(s.name)}</div>
          <span class="badge ${s.status === 'active' ? 'badge-green' : 'badge-red'}">${s.status === 'active' ? 'Aktif' : 'Pasif'}</span>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Supplier ID: <strong>${esc(s.supplier_id) || 'Belirtilmemiş'}</strong></div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn btn-ghost btn-sm" onclick="openStoreModal(${JSON.stringify(s).replace(/"/g, '&quot;')})">✏️ Düzenle</button>
          <button class="btn btn-success btn-sm" onclick="uploadToStore(${s.id})">⬆️ Trendyol'a Yükle</button>
          <button class="btn btn-danger btn-sm" onclick="deleteStore(${s.id})">🗑️</button>
        </div>
      </div>
    `).join('');
      } catch (e) { toast(e.message, 'error'); }
    }

    function openStoreModal(s = null) {
      document.getElementById('sm-id').value = s?.id || '';
      document.getElementById('sm-name').value = s?.name || '';
      document.getElementById('sm-supplier').value = s?.supplier_id || '';
      document.getElementById('sm-apikey').value = s?.api_key || '';
      document.getElementById('sm-apisecret').value = '';
      document.getElementById('store-modal').classList.add('show');
    }

    async function saveStore() {
      const body = {
        id: document.getElementById('sm-id').value || undefined,
        name: document.getElementById('sm-name').value,
        supplier_id: document.getElementById('sm-supplier').value,
        api_key: document.getElementById('sm-apikey').value,
        api_secret: document.getElementById('sm-apisecret').value,
      };
      try {
        await api('/api/dealer/stores', { method: 'POST', body: JSON.stringify(body) });
        toast('Mağaza kaydedildi', 'success');
        closeModal('store-modal'); loadStores();
      } catch (e) { toast(e.message, 'error'); }
    }

    async function deleteStore(id) {
      if (!confirm('Mağaza silinsin mi?')) return;
      await api(`/api/dealer/stores/${id}`, { method: 'DELETE' });
      toast('Mağaza silindi', 'info'); loadStores();
    }

    async function uploadToStore(storeId) {
      try {
        await api('/api/dealer/trendyol-upload', { method: 'POST', body: JSON.stringify({ store_id: storeId }) });
        toast('Ürün yükleme başlatıldı! Arka planda devam ediyor.', 'success');
      } catch (e) { toast(e.message, 'error'); }
    }

    // ─── SİPARİŞLER ───
    async function loadOrders() {
      try {
        const d = await api('/api/dealer/orders?limit=50');
        if (!d) return;
        const tbody = document.getElementById('orders-tbody');
        if (!d.orders.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:32px">Sipariş bulunamadı. Trendyol\'dan çekmeyi deneyin.</td></tr>'; return; }
        tbody.innerHTML = d.orders.map(o => `<tr>
      <td style="font-weight:600">${esc(o.order_number)}</td>
      <td>${o.order_date ? new Date(o.order_date).toLocaleDateString('tr') : '-'}</td>
      <td><span class="badge badge-blue">${esc(o.status)}</span></td>
      <td>₺${(o.total_price || 0).toFixed(2)}</td>
      <td style="color:var(--green);font-weight:600">₺${(o.net_price || 0).toFixed(2)}</td>
      <td><span class="badge ${o.is_refund ? 'badge-red' : 'badge-green'}">${o.is_refund ? 'İade' : 'Satış'}</span></td>
    </tr>`).join('');
      } catch (e) { toast(e.message, 'error'); }
    }

    async function syncOrders() {
      try {
        const r = await api('/api/dealer/orders/sync', { method: 'POST', body: JSON.stringify({}) });
        toast(`${r.synced} sipariş senkronize edildi`, 'success'); loadOrders();
      } catch (e) { toast('Hata: ' + e.message, 'error'); }
    }

    // ─── HELPERS ───
    async function loadSupplierFilters() {
      try {
        const suppliers = await api('/api/dealer/suppliers');
        if (!suppliers) return;
        ['prod-supplier', 'pl-supplier'].forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          const val = el.value;
          el.innerHTML = '<option value="">Tüm Tedarikçiler</option>' +
            suppliers.map(s => `<option value="${esc(s.supplier_name)}">${esc(s.supplier_name)} (${s.product_count})</option>`).join('');
          el.value = val;
        });
      } catch (e) { }
    }

    function closeModal(id) { document.getElementById(id).classList.remove('show'); }
    function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function toast(msg, type = 'info') {
      const t = document.getElementById('toast');
      const d = document.createElement('div');
      d.className = `toast-item toast-${type}`; d.textContent = msg;
      t.appendChild(d);
      setTimeout(() => d.remove(), 3500);
    }

    // ─── ROUTE ───
    window.addEventListener('DOMContentLoaded', () => {
      if (TOKEN && DEALER) { initApp(); } else {
        document.getElementById('login-page').style.display = 'flex';
      }
    });
  