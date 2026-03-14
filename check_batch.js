const db = require('./database');
const axios = require('axios');
const fs = require('fs');

async function testUpload() {
    try {
        // Find a product that belongs to a dealer with API keys
        const data = db.prepare(`
            SELECT dp.*, d.supplier_id, d.api_key, d.api_secret 
            FROM dealer_products dp 
            JOIN dealers d ON d.id = dp.dealer_id 
            WHERE d.supplier_id IS NOT NULL AND d.api_key IS NOT NULL 
            LIMIT 1
        `).get();

        if (!data) {
            console.log('No eligible product found.');
            return;
        }

        console.log('Using supplier:', data.supplier_id, 'for product:', data.barcode);

        const authString = Buffer.from(data.api_key + ':' + data.api_secret).toString('base64');
        const API_URL = `https://apigw.trendyol.com/integration/product/sellers/${data.supplier_id}/products`;

        const randomSuffix = Math.floor(Math.random() * 10000);
        const testBarcode = String(data.barcode) + '-' + randomSuffix;

        const items = [{
            barcode: testBarcode,
            title: data.title.substring(0, 100),
            productMainId: testBarcode,
            brandId: 2613880,
            categoryId: data.xml_category_id || 3870,
            quantity: typeof data.stock === 'number' ? data.stock : 10,
            stockCode: testBarcode,
            dimensionalWeight: 1,
            description: data.title,
            currencyType: 'TRY',
            listPrice: data.sale_price || 100,
            salePrice: data.sale_price || 100,
            vatRate: 20,
            cargoCompanyId: 10,
            images: [{ url: 'https://cdn.dsmcdn.com/ty1/product/media/images/20200812/11/7798319/11111/1_1_org.jpg' }],
            attributes: [
                { attributeId: 1192, attributeValueId: 10633874 },
                { attributeId: 47, customAttributeValue: 'Çok Renkli' },
                { attributeId: 348, attributeValueId: 686230 }
            ]
        }];

        console.log('Sending product to Trendyol...');
        
        const res = await axios.post(API_URL, { items }, {
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/json',
                'User-Agent': `${data.supplier_id} - SelfIntegration`
            }
        });

        console.log('Upload OK. Batch Request ID:', res.data.batchRequestId);
        const batchId = res.data.batchRequestId;

        if (batchId) {
            console.log('Waiting 5 seconds to check status...');
            await new Promise(r => setTimeout(r, 5000));
            
            const checkUrl = `https://apigw.trendyol.com/integration/product/sellers/${data.supplier_id}/products/batch-requests/${batchId}`;
            
            const batchRes = await axios.get(checkUrl, {
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'User-Agent': `${data.supplier_id} - SelfIntegration`
                }
            });
            console.log('Batch Status saved to batch_result.json');
            fs.writeFileSync('batch_result.json', JSON.stringify(batchRes.data, null, 2));
        }
            
    } catch(err) {
        console.error('Error in script:', err.response?.data || err.message);
    }
}

testUpload();
