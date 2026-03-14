// Trendyol'dan tüm kategorileri çekip dosyaya yazar
const axios = require('axios');
const db = require('./database');
const fs = require('fs');

const dealer = db.prepare("SELECT * FROM dealers WHERE api_key IS NOT NULL AND api_key != '' LIMIT 1").get();
if (!dealer) { console.log('Bayi bulunamadı'); process.exit(1); }

const auth = Buffer.from(`${dealer.api_key}:${dealer.api_secret}`).toString('base64');
const headers = { 'Authorization': `Basic ${auth}`, 'User-Agent': `${dealer.supplier_id} - SelfIntegration` };

function flatten(cats, result = [], parentName = '') {
    for (const c of (cats || [])) {
        result.push({ id: c.id, name: c.name, parent: parentName });
        if (c.subCategories && c.subCategories.length) flatten(c.subCategories, result, c.name);
    }
    return result;
}

const araKelimeler = ['kulaklık', 'saat', 'kamera', 'süpürge', 'ısıtıcı', 'spor', 'banyo', 'ortopedik', 'masaj', 'epilasyon', 'nemlendirici', 'projektör', 'oyun', 'bebek', 'büyük', 'tencere', 'pil', 'mutfak', 'yastık', 'musluk', 'raf', 'yağmurluk', 'fener', 'telefon', 'şarj'];

axios.get('https://apigw.trendyol.com/integration/product/product-categories', { headers })
    .then(r => {
        const all = flatten(Array.isArray(r.data) ? r.data : r.data.categories || []);
        console.log(`Toplam ${all.length} kategori`);

        araKelimeler.forEach(kw => {
            const bulunan = all.filter(c => c.name.toLowerCase().includes(kw));
            if (bulunan.length) {
                console.log(`\n=== "${kw}" ===`);
                bulunan.forEach(c => console.log(`  ${c.id}  ${c.parent ? c.parent + ' > ' : ''}${c.name}`));
            }
        });
        process.exit(0);
    }).catch(e => { console.log('HATA:', e.response?.status, JSON.stringify(e.response?.data).substring(0, 300)); process.exit(1); });
