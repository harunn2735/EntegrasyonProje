const db = require('./database');
const axios = require('axios');
const fs = require('fs');

async function testStatus() {
    console.log('Fetching dealer...');
    const data = db.prepare(`
        SELECT dp.*, d.supplier_id, d.api_key, d.api_secret 
        FROM dealer_products dp 
        JOIN dealers d ON d.id = dp.dealer_id 
        WHERE d.supplier_id IS NOT NULL AND d.api_key IS NOT NULL 
        LIMIT 5
    `).all();

    if (data.length === 0) {
        console.log('No products found.');
        return;
    }

    const supplierId = data[0].supplier_id;
    const authString = Buffer.from(data[0].api_key + ':' + data[0].api_secret).toString('base64');

    const allResults = [];
    for (const p of data) {
        const checkUrl = `https://apigw.trendyol.com/integration/product/sellers/${supplierId}/products?barcode=${encodeURIComponent(p.barcode)}`;
        console.log(`Checking barcode ${p.barcode}...`);
        
        try {
            const res = await axios.get(checkUrl, {
                headers: {
                    'Authorization': `Basic ${authString}`,
                    'User-Agent': `${supplierId} - SelfIntegration`
                }
            });
            
            const content = res.data.content || [];
            if (content.length > 0) {
                console.log(`Found! Title: ${content[0].title}, Status: ${content[0].approved === true ? 'Approved' : 'Not Approved'}`);
                allResults.push(content[0]);
            } else {
                console.log(`Not found in Trendyol catalog for this seller.`);
            }
        } catch(err) {
            console.error('Error fetching product:', err.response?.data || err.message);
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    fs.writeFileSync('product_status.json', JSON.stringify(allResults, null, 2));
    console.log('Results saved to product_status.json');
}

testStatus();
