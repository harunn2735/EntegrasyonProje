const db = require('./database');
const fs = require('fs');

const CATEGORY_KEYWORDS = [
    { keys: ['banyo seti', 'tuvalet fırçası', 'sabunluk', 'banyo rafı', 'duş rafı', 'şampuanlık', 'banyo düzenleyici', 'banyo organizer'], categoryId: 1830 },
    { keys: ['çöp kovası', 'çöp kutusu', 'çöp tenekesi', 'sensörlü çöp', 'akıllı çöp'], categoryId: 2188 }
];

function getCategoryId(title) {
    const lower = (title || '').toLowerCase();
    
    // Turkish lowercase replacement to be safe
    const trLower = String(title || '')
        .replace(/I/g, 'ı').replace(/İ/g, 'i')
        .replace(/C/g, 'c').replace(/Ç/g, 'ç')
        .replace(/S/g, 's').replace(/Ş/g, 'ş')
        .replace(/O/g, 'o').replace(/Ö/g, 'ö')
        .replace(/U/g, 'u').replace(/Ü/g, 'ü')
        .replace(/G/g, 'g').replace(/Ğ/g, 'ğ')
        .toLowerCase();
        
    for (const entry of CATEGORY_KEYWORDS) {
        for (const key of entry.keys) {
            if (lower.includes(key) || trLower.includes(key)) return entry.categoryId;
        }
    }
    return 3870; // Genel
}

const products = db.prepare('SELECT barcode, title, xml_category_id FROM dealer_products LIMIT 10').all();
console.log('Sample Products:');
for (const p of products) {
    console.log(`Barcode: ${p.barcode}, Title: ${p.title}`);
    console.log(`DB xml_category_id: ${p.xml_category_id}`);
    console.log(`getCategoryId(title): ${getCategoryId(p.title)}`);
    const finalCat = (p.xml_category_id && p.xml_category_id > 0) ? p.xml_category_id : getCategoryId(p.title);
    console.log(`Final Category ID: ${finalCat}\n`);
}
