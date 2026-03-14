// Trendyol'daki gerçek kategori ID'lerini listeler
// Kullanım: node kategori_bul.js [arama_kelimesi]
// Örnek:    node kategori_bul.js kulaklık

const axios = require('axios');
const db = require('./database');

const aranan = (process.argv[2] || '').toLowerCase();

const dealer = db.prepare("SELECT * FROM dealers WHERE api_key IS NOT NULL AND api_key != '' LIMIT 1").get();
if (!dealer) { console.log('HATA: DB\'de API bilgisi olan bayi bulunamadı!'); process.exit(1); }

const auth = Buffer.from(`${dealer.api_key}:${dealer.api_secret}`).toString('base64');
const headers = {
    'Authorization': `Basic ${auth}`,
    'User-Agent': `${dealer.supplier_id} - SelfIntegration`
};

// Doğru public kategori endpoint'i (seller auth gerektirmez)
const url = `https://apigw.trendyol.com/integration/product/product-categories`;

console.log(`Trendyol kategorileri çekiliyor...`);
if (aranan) console.log(`Filtre: "${aranan}"`);
console.log('---');

async function flatten(cats, result = []) {
    for (const c of cats) {
        result.push({ id: c.id, name: c.name, parentName: c.parentName || '' });
        if (c.subCategories && c.subCategories.length > 0) {
            flatten(c.subCategories, result);
        }
    }
    return result;
}

axios.get(url, { headers }).then(async r => {
    const data = r.data;
    const rawCats = Array.isArray(data) ? data : (data.categories || data.items || []);
    const all = await flatten(rawCats);

    console.log(`Toplam ${all.length} kategori (tüm seviyelerde)\n`);

    const filtered = aranan
        ? all.filter(c => (c.name || '').toLowerCase().includes(aranan) || (c.parentName || '').toLowerCase().includes(aranan))
        : all.slice(0, 60);

    filtered.forEach(c => {
        console.log(`ID: ${String(c.id).padEnd(8)} | ${c.parentName ? c.parentName + ' > ' : ''}${c.name}`);
    });

    if (aranan && filtered.length === 0) console.log(`"${aranan}" için eşleşen kategori bulunamadı.`);
    process.exit(0);
}).catch(e => {
    console.log('API HATASI:', e.response?.status, e.message);
    console.log(JSON.stringify(e.response?.data, null, 2)?.substring(0, 500));
    process.exit(1);
});
