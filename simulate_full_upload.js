const db = require('./database');
const axios = require('axios');
const fs = require('fs');

const BANNED_WORDS = ['n11', 'hepsiburada', 'amazon', 'ciceksepeti', 'instagram', 'facebook', 'whatsapp'];

function isValidImageUrl(u) {
    if (!u || typeof u !== 'string') return false;
    let lower = u.toLowerCase();
    if (!lower.startsWith('http')) return false;
    for (let w of BANNED_WORDS) {
        if (lower.includes(w)) return false;
    }
    return true;
}
const PLACEHOLDER_IMAGE = 'https://cdn.dsmcdn.com/ty1/product/media/images/20200812/11/7798319/11111/1_1_org.jpg';

async function run() {
    console.log('Fetching dealer...');
    const data = db.prepare(`
        SELECT dp.*, d.supplier_id, d.api_key, d.api_secret 
        FROM dealer_products dp 
        JOIN dealers d ON d.id = dp.dealer_id 
        WHERE d.supplier_id IS NOT NULL AND d.api_key IS NOT NULL 
    `).all();

    if (data.length === 0) {
        console.log('No products found with API credentials.');
        return;
    }

    const supplierId = data[0].supplier_id;
    const authString = Buffer.from(data[0].api_key + ':' + data[0].api_secret).toString('base64');
    const API_URL = `https://apigw.trendyol.com/integration/product/sellers/${supplierId}/products`;

    console.log(`Found ${data.length} products. Grouping into one test batch of max 50.`);

    const batch = data.slice(0, 50).filter(p => p.barcode && p.barcode.length >= 2 && p.barcode.length <= 40);

    const items = batch.map(p => {
        const rawUrls = (p.image_url || '').split(',').map(u => u.trim()).filter(u => isValidImageUrl(u));
        const imageUrls = rawUrls.length > 0 ? rawUrls.slice(0, 8) : [PLACEHOLDER_IMAGE];
        
        // Randomize barcode so we don't get 'recurring' error and can see actual validation
        const rnd = Math.floor(Math.random() * 100000);
        const testBarcode = String(p.barcode) + '-' + rnd;
        
        return {
            barcode: testBarcode,
            title: p.title.substring(0, 100),
            productMainId: testBarcode,
            brandId: 2613880,
            categoryId: p.xml_category_id || 3870,
            quantity: typeof p.stock === 'number' ? p.stock : 10,
            stockCode: testBarcode,
            dimensionalWeight: 1,
            description: p.title,
            currencyType: 'TRY',
            listPrice: p.sale_price || 100,
            salePrice: p.sale_price || 100,
            vatRate: 20,
            cargoCompanyId: 10,
            images: imageUrls.map(u => ({ url: u })),
            attributes: [
                { attributeId: 1192, attributeValueId: 10633874 },
                { attributeId: 47, customAttributeValue: 'Çok Renkli' },
                { attributeId: 348, attributeValueId: 686230 }
            ]
        };
    });

    console.log(`Sending ${items.length} items to Trendyol...`);
    try {
        const res = await axios.post(API_URL, { items }, {
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'User-Agent': `${supplierId} - SelfIntegration`
            }
        });

        const batchId = res.data.batchRequestId;
        console.log('Batch ID:', batchId);

        if (batchId) {
            console.log('Waiting 8 seconds for processing...');
            await new Promise(r => setTimeout(r, 8000));
            
            const checkUrl = `https://apigw.trendyol.com/integration/product/sellers/${supplierId}/products/batch-requests/${batchId}`;
            const batchRes = await axios.get(checkUrl, {
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'User-Agent': `${supplierId} - SelfIntegration`
                }
            });
            
            fs.writeFileSync('full_batch_result.json', JSON.stringify(batchRes.data, null, 2));
            console.log('Result written to full_batch_result.json');
            
            const failures = batchRes.data.items.filter(i => i.status !== 'SUCCESS');
            console.log(`Total: ${batchRes.data.itemCount}, Failed: ${batchRes.data.failedItemCount}`);
            if (failures.length > 0) {
                console.log('Some errors found! Check full_batch_result.json');
            } else {
                console.log('All products succeeded! No validation errors.');
            }
        }
    } catch(err) {
        console.error('Request failed:', err.response?.data || err.message);
    }
}

run();
