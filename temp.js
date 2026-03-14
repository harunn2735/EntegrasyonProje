
    const API = 'http://localhost:3000/api';
    let state = { dealers: [], prodPage: 1, prodTotal: 0, lastSyncResult: null };

    // ── AUTH ──────────────────────────────────────────────────
    async function doLogin() {
      const pass = document.getElementById('loginPass').value;
      const res = await fetch(`${API}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass })
      });
      const d = await res.json();
      if (d.ok) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('sidebar').style.display = 'block';
        document.getElementById('mainArea').style.display = 'block';
        loadDashboard();
        loadDealers();
        setInterval(loadDashboard, 30000);
      } else {
        document.getElementById('loginErr').textContent = d.error || 'Şifre yanlış';
      }
    }

    // Demo: local auth
    const DEMO_PASS = 'demo123';
    const _origLogin = doLogin;
    window.doLogin = async function () {
      const pass = document.getElementById('loginPass').value;
      if (pass === DEMO_PASS) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('sidebar').style.display = 'block';
        document.getElementById('mainArea').style.display = 'block';
        loadDemoDashboard();
        return;
      }
      await _origLogin();
    };

    // ── NAVİGASYON ────────────────────────────────────────────
    function nav(page, btn) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
      document.getElementById('page-' + page)?.classList.add('active');
      if (btn) btn.classList.add('active');
      else document.querySelectorAll('.sb-item').forEach(b => {
        if (b.getAttribute('onclick')?.includes(`'${page}'`)) b.classList.add('active');
      });
      if (page === 'dashboard') loadDashboard();
      if (page === 'products') loadProducts();
      if (page === 'upload') loadUploadPage();
      if (page === 'prices') loadPricesPage();
      if (page === 'logs') loadLogs();
      if (page === 'dealers') loadDealers();
    }

    // ── DASHBOARD & DATA YÜKLEME (API) ────────────────────

    async function fetchAPI(endpoint, options = {}) {
      try {
        const res = await fetch(API + endpoint, options);
        if (!res.ok) {
          let errText;
          const textBody = await res.text();
          try {
            const j = JSON.parse(textBody);
            errText = j.error || "API Hatası";
          } catch (e) {
            errText = textBody || res.statusText || "Sunucu bağlanılamadı";
          }
          throw new Error(errText);
        }
        return await res.json();
      } catch (err) {
        console.error("fetchAPI Exception:", err);
        return { _error: err.message };
      }
    }

    async function loadDashboard() {
      const data = await fetchAPI('/dashboard');
      if (!data) return;

      document.getElementById('d-total-products').textContent = data.totalProducts.toLocaleString();
      document.getElementById('d-instock-products').textContent = data.inStock.toLocaleString() + ' stokta';
      document.getElementById('d-total-dealers').textContent = data.totalDealers;
      document.getElementById('d-dealer-sub').textContent = `${data.activeDealers} aktif`;
      document.getElementById('d-synced').textContent = '—'; // TODO Sync eklenecek
      document.getElementById('d-xml-count').textContent = data.xmlCount.toLocaleString();
      document.getElementById('sbDealerCount').textContent = data.totalDealers;
      document.getElementById('lastSyncInfo').textContent = 'Son İşlem: ' + new Date().toLocaleTimeString('tr', { hour: '2-digit', minute: '2-digit' });

      loadLogs(true);
    }

    // ── BAYİLER ────────────────────────────────────────────────
    async function loadDealers() {
      const data = await fetchAPI('/dealers');
      if (data) {
        state.dealers = data;
        renderDealers(state.dealers);
        loadUploadPage();
        loadPricesPage();
      }
    }

    function renderDealers(dealers) {
      document.getElementById('sbDealerCount').textContent = dealers.length;
      document.getElementById('dealerTableBody').innerHTML = dealers.map(d => `
    <tr>
      <td><div style="font-weight:600">${d.name}</div><div style="font-size:11px;color:var(--t3)">#${String(d.id).padStart(3, '0')}</div></td>
      <td><div>${d.email}</div><div style="font-size:11px;color:var(--t3)">${d.phone || '—'}</div></td>
      <td><span style="font-weight:700;color:var(--orange)">%${d.profit_margin}</span></td>
      <td>${d.has_api ? '<span class="badge b-green">✅ Var</span>' : '<span class="badge b-red">❌ Yok</span>'}</td>
      <td>${uploadBadge(d)}</td>
      <td style="font-size:11px;color:var(--t3)">${d.last_sync ? new Date(d.last_sync).toLocaleTimeString('tr', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
      <td><span class="badge ${d.status === 'active' ? 'b-green' : 'b-gray'}">${d.status === 'active' ? '● Aktif' : 'Pasif'}</span></td>
      <td>
        <div style="display:flex;gap:5px">
          <button class="btn btn-sm btn-ghost" onclick="editDealer(${d.id})">✏️</button>
          <button class="btn btn-sm btn-blue" onclick="uploadForDealer(${d.id},'${d.name}')">🚀 Yükle</button>
          <button class="btn btn-sm" style="background:var(--plight);color:var(--purple)" onclick="openPriceModal(${d.id},'${d.name}',${d.profit_margin})">💰</button>
        </div>
      </td>
    </tr>
  `).join('');
    }

    function uploadBadge(d) {
      const total = state.prodTotal || 1;
      const pct = d.uploaded_count && d.upload_status !== 'pending'
        ? Math.round((d.uploaded_count / total) * 100) : 0;
      if (d.upload_status === 'done') return `<span class="badge b-green">✅ Tamamlandı</span>`;
      if (d.upload_status === 'uploading') return `
    <div><span class="badge b-blue">⏳ ${d.uploaded_count.toLocaleString()}/${total.toLocaleString()}</span>
    <div class="progress-bar-wrap" style="margin-top:4px;height:5px">
      <div class="progress-bar" style="width:${pct}%"></div>
    </div></div>`;
      if (d.upload_status === 'error') return `<span class="badge b-red">❌ Hata</span>`;
      return `<span class="badge b-gray">⏳ Bekliyor</span>`;
    }

    function showAddDealer() {
      document.getElementById('dealerEditId').value = '';
      document.getElementById('dealerModalTitle').textContent = '➕ Yeni Bayi Ekle';
      ['d-name', 'd-email', 'd-phone', 'd-sid', 'd-key', 'd-sec'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('d-margin').value = 20;
      openModal('modalDealer');
    }

    function editDealer(id) {
      const d = state.dealers.find(x => x.id === id);
      if (!d) return;
      document.getElementById('dealerEditId').value = id;
      document.getElementById('dealerModalTitle').textContent = `✏️ Bayiyi Düzenle: ${d.name}`;
      document.getElementById('d-name').value = d.name;
      document.getElementById('d-email').value = d.email;
      document.getElementById('d-phone').value = d.phone || '';
      document.getElementById('d-margin').value = d.profit_margin;
      openModal('modalDealer');
    }

    async function saveDealer() {
      const name = document.getElementById('d-name').value.trim();
      const email = document.getElementById('d-email').value.trim();
      if (!name || !email) { alert('Ad ve e-posta zorunlu!'); return; }

      const editId = document.getElementById('dealerEditId').value;
      const profit_margin = parseFloat(document.getElementById('d-margin').value) || 20;

      const payload = {
        name, email,
        phone: document.getElementById('d-phone').value,
        profit_margin,
        supplier_id: document.getElementById('d-sid').value,
        api_key: document.getElementById('d-key').value,
        api_secret: document.getElementById('d-sec').value
      };

      if (editId) payload.id = parseInt(editId);

      const res = await fetchAPI('/dealers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res && res.ok) {
        closeModal('modalDealer');
        alert('✅ Bayi kaydedildi!');
        loadDealers();
      } else {
        alert('Hata oluştu!');
      }
    }

    // ── ÜRÜNLER (API SAYFALAMA) ─────────────────────────────
    async function loadProducts(page = 1) {
      state.prodPage = page;
      const search = document.getElementById('prodSearch')?.value || '';
      const data = await fetchAPI(`/products?page=${page}&limit=50&search=${encodeURIComponent(search)}`);
      if (!data) return;

      const { products, total, totalPages } = data;
      state.prodTotal = total;

      document.getElementById('productSubtitle').textContent = `${total.toLocaleString()} ürün (DB'de)`;
      document.getElementById('prodInfo').textContent = `${products.length} ürün gösteriliyor`;
      document.getElementById('prodPageInfo').textContent = `${page}/${totalPages || 1}`;
      document.getElementById('btnPrev').disabled = page <= 1;
      document.getElementById('btnNext').disabled = page >= (totalPages || 1);

      document.getElementById('prodTableBody').innerHTML = products.length ? products.map(p => `
    <tr>
      <td style="font-family:monospace;font-size:11px;color:var(--blue)">${p.barcode}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.title}</td>
      <td><span class="badge b-gray">${p.category}</span></td>
      <td style="font-weight:600;color:${p.stock > 10 ? 'var(--green)' : 'var(--red)'}">${p.stock.toLocaleString()}</td>
      <td style="font-weight:600">₺${parseFloat(p.cost_price).toFixed(2)}</td>
    </tr>
  `).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:30px">Ürün bulunamadı</td></tr>';
    }

    function searchProducts() { loadProducts(1); }
    function prodPage(dir) { loadProducts(state.prodPage + dir); }

    // ── YÜKLEME SAYFASI ────────────────────────────────────────
    function loadUploadPage() {
      document.getElementById('uploadDealerList').innerHTML = state.dealers.map(d => `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-weight:700;font-size:15px">${d.name}</div>
          <div style="font-size:12px;color:var(--t3);margin-top:2px">${d.email} · %${d.profit_margin} kar marjı</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          ${uploadBadge(d)}
          <button class="btn btn-orange" onclick="uploadForDealer(${d.id},'${d.name}')" ${!d.has_api ? 'disabled title="Önce API bilgilerini ekle"' : ''}>
            🚀 ${d.upload_status === 'done' ? 'Tekrar Yükle' : 'Yüklemeyi Başlat'}
          </button>
        </div>
      </div>
      ${!d.has_api ? '<div class="alert a-warn" style="margin-top:12px;margin-bottom:0">⚠️ Bu bayinin Trendyol API bilgileri eksik. Bayiyi düzenleyerek ekleyin.</div>' : ''}
    </div>
  `).join('') || '<div class="alert a-info">Henüz bayi eklenmemiş.</div>';
    }

    let uploadInterval = null;

    async function uploadForDealer(id, name) {
      if (!confirm(`"${name}" için tüm ürünler Trendyol'a yüklenecek.\nBu işlem arka planda devam edecektir. Devam edilsin mi?`)) return;

      const res = await fetchAPI(`/dealers/${id}/upload`, { method: 'POST' });
      if (!res || res._error) {
        alert("Yükleme başlatılamadı: " + (res?._error || "Bilinmeyen Hata"));
        return;
      }

      alert(`✅ "${name}" için Trendyol aktarımı başlatıldı!\n\nSayfayı kapatmadan veya kapatsanız bile arka planda devam edecektir. İlerlemeyi buradan takip edebilirsiniz.`);

      // Bayi listesini çekip arayüzü güncellemeye başla
      if (!uploadInterval) {
        uploadInterval = setInterval(async () => {
          const data = await fetchAPI('/dealers');
          if (data) {
            state.dealers = data;
            renderDealers(state.dealers);
            loadUploadPage();

            // Eğer yüklenen bir bayi yoksa interval'i temizle
            const isAnyUploading = state.dealers.some(d => d.upload_status === 'uploading');
            if (!isAnyUploading) {
              clearInterval(uploadInterval);
              uploadInterval = null;
            }
          }
        }, 3000);
      }

      loadDealers(); // Hemen ilk güncellemeyi yap
    }

    // ── FİYAT YÖNETİMİ ─────────────────────────────────────────
    function loadPricesPage() {
      document.getElementById('pricesDealerList').innerHTML = state.dealers.map(d => {
        const margin = parseFloat(d.profit_margin);
        return `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px">
        <div>
          <div style="font-weight:700;font-size:15px">${d.name}</div>
          <div style="font-size:12px;color:var(--t3)">${d.email}</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="text-align:center">
            <div style="font-size:28px;font-weight:800;color:var(--orange)">%${margin}</div>
            <div style="font-size:11px;color:var(--t3)">Mevcut Marj</div>
          </div>
          <div style="text-align:center;padding:0 16px;border-left:1px solid var(--border);border-right:1px solid var(--border)">
            <div style="font-size:14px;font-weight:700">₺112 → ₺${(112 * (1 + margin / 100)).toFixed(2)}</div>
            <div style="font-size:11px;color:var(--t3)">Örnek: ₺112 ürün</div>
          </div>
          <button class="btn btn-orange" onclick="openPriceModal(${d.id},'${d.name}',${margin})">💰 Marjı Güncelle</button>
        </div>
      </div>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
        <div style="font-size:11px;color:var(--t3);margin-bottom:6px">Marj Önizleme</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          ${[50, 100, 200, 500, 1000].map(p => `
            <div style="background:var(--bg);border-radius:6px;padding:8px 12px;text-align:center;border:1px solid var(--border)">
              <div style="font-size:10px;color:var(--t3)">Alış ₺${p}</div>
              <div style="font-size:13px;font-weight:700;color:var(--green)">₺${(p * (1 + margin / 100)).toFixed(2)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `}).join('') || '<div class="alert a-info">Henüz bayi eklenmemiş.</div>';
    }

    async function openPriceModal(id, name, currentMargin) {
      const newMargin = prompt(`"${name}" için yeni kar marjı girin (%):\nMevcut: %${currentMargin}\nÖrnek: 20 → %20 kar ekler`, currentMargin);
      if (newMargin === null) return;
      const val = parseFloat(newMargin);
      if (isNaN(val) || val < 0 || val > 500) { alert('Geçersiz değer (0-500 arası)'); return; }

      const res = await fetchAPI(`/dealers/${id}/margin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profit_margin: val })
      });

      if (res && res.ok) {
        loadPricesPage();
        loadDealers();
        alert(`✅ "${name}" için marj %${val} olarak güncellendi!\n\nTrendyol'daki fiyatlar güncelleniyor... (demo modunda simülasyon)`);
      }
    }

    // ── SYNC ───────────────────────────────────────────────────
    async function doSync() {
      const btn = event?.currentTarget;
      if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
      await sleep(2000);
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Şimdi Sync'; }
      document.getElementById('lastSyncInfo').textContent = 'Son sync: ' + new Date().toLocaleTimeString('tr', { hour: '2-digit', minute: '2-digit' });
      demoData.logs.unshift({ level: 'success', message: `Sync tamamlandı: ${Math.floor(Math.random() * 1000 + 200)} değişiklik`, created_at: new Date().toISOString() });
      alert('✅ Sync tamamlandı! 847 üründe stok/fiyat güncellendi.');
    }

    // ── XML İMPORT ─────────────────────────────────────────────
    function showImportModal() {
      openModal('modalImport');
      document.getElementById('importStatus').innerHTML = '';
      document.getElementById('xmlFileInput').value = '';
    }

    function startImport() {
      const fileInput = document.getElementById('xmlFileInput');
      const xmlStr = document.getElementById('xmlInput').value.trim();

      if (fileInput.files.length > 0) {
        // Dosya seçildiyse onu oku
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = function (e) {
          processXmlString(e.target.result);
        };
        reader.readAsText(file);
      } else if (xmlStr) {
        // Dosya seçilmediyse, metin kutusunu oku
        processXmlString(xmlStr);
      } else {
        alert("Lütfen bir XML dosyası seçin veya metin kutusuna XML yapıştırın!");
      }
    }

    function processXmlString(xmlStr) {
      document.getElementById('importBtn').disabled = true;
      document.getElementById('importStatus').innerHTML = `
    <div class="alert a-info">⏳ XML Analiz ediliyor... Lütfen bekleyin.</div>
    <div class="progress-bar-wrap"><div class="progress-bar" id="importBar" style="width:50%"></div></div>
  `;

      setTimeout(() => {
        try {
          const parser = new DOMParser();
          // Wrap with root node if missing to prevent parser errors in some browsers
          const safeXml = xmlStr.includes("<root") || xmlStr.includes("<products")
            ? xmlStr
            : `<root>${xmlStr}</root>`;

          const xmlDoc = parser.parseFromString(safeXml, "text/xml");

          if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
            throw new Error("Geçersiz XML formatı!");
          }

          const items = xmlDoc.querySelectorAll("urun, item, product, urunler > urun");
          if (items.length === 0) {
            throw new Error("XML içinde ürün tag'i bulunamadı. (Beklenen etiket: <urun>, <item>, veya <product>)");
          }

          let finalItems = [];
          Array.from(items).forEach(node => {
            const getVal = (tags) => {
              for (let tag of tags) {
                const el = node.querySelector(tag);
                // CDATA content is properly read via textContent
                if (el) return el.textContent.trim();
              }
              return '';
            };

            const barcode = getVal(['barcode', 'barkod', 'gtin']) || 'B' + Math.floor(Math.random() * 100000);
            const title = getVal(['name', 'isim', 'ad', 'title', 'urun_adi']) || 'İsimsiz Ürün';

            let fullCategory = getVal(['category', 'kategori', 'cat', 'kategori_adi', 'top_category']) || 'Genel';
            let category = fullCategory;
            if (fullCategory.includes('>>>')) {
              const parts = fullCategory.split('>>>');
              category = parts[parts.length - 1].trim();
            }

            const stockText = getVal(['quantity', 'stok', 'stock', 'miktar', 'adet']) || '0';
            const priceText = getVal(['price', 'alis_fiyati', 'fiyat', 'cost', 'satis_fiyati', 'listPrice']) || '0';

            const stock = parseInt(stockText) || 0;
            const cost_price = parseFloat(priceText.replace(',', '.')) || 0;

            finalItems.push({ barcode, title, category, stock, cost_price });
          });

          if (finalItems.length === 0) throw new Error("Ayrıştırılabilecek ürün bulunamadı!");

          // 2. PARSE EDILEN URUNLERI NODEJS (VERITABANI) SUNUCUSUNA GONDER
          fetchAPI('/products/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalItems)
          }).then(res => {
            if (res && res._error) throw new Error("Ağ/Sunucu Hatası: " + res._error);
            if (!res || !res.ok) throw new Error("Bilinmeyen bir hata oluştu");

            document.getElementById('importStatus').innerHTML = '<div class="alert a-success">✅ Import tamamlandı! ' + finalItems.length + ' ürün veritabanına kaydedildi.</div>';
            loadDashboard(); // Sayıları guncelle
            if (document.getElementById('page-products').classList.contains('active')) loadProducts(1);
          }).catch(err => {
            document.getElementById('importStatus').innerHTML = '<div class="alert a-error">❌ DB Hatası: ' + err.message + '</div>';
          }).finally(() => {
            document.getElementById('importBtn').disabled = false;
          });

        } catch (err) {
          document.getElementById('importStatus').innerHTML = '<div class="alert a-error">❌ XML Parse Hatası: ' + err.message + '</div>';
          document.getElementById('importBtn').disabled = false;
        }
      }, 500);
    }

    // ── LOGLAR ────────────────────────────────────────────────
    async function loadLogs(isDash = false) {
      const logs = await fetchAPI('/logs');
      if (!logs) return;
      if (isDash) renderLogs(logs.slice(0, 5), 'dashLog');
      else renderLogs(logs, 'mainLogBox');
    }

    function renderLogs(logs, containerId) {
      const box = document.getElementById(containerId);
      if (!box) return;
      box.innerHTML = logs.map(l => {
        const t = new Date(l.created_at).toLocaleTimeString('tr', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `<div class="log-${l.level}">[${t}] ${l.message}</div>`;
      }).join('') || '<div class="log-info">Log yok</div>';
    }

    // ── MODAL ─────────────────────────────────────────────────
    function openModal(id) { document.getElementById(id).classList.add('open'); }
    function closeModal(id) { document.getElementById(id).classList.remove('open'); }
    document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); }));

    const sleep = ms => new Promise(r => setTimeout(r, ms));
  