// index.html'de görsel parsing'i image1/image2/... destekleyecek şekilde güncelle
// server.js'de Trendyol'a birden fazla görsel gönder
const fs = require('fs');

// ── INDEX.HTML güncelle ──────────────────────────────────────────
let html = fs.readFileSync('./index.html', 'utf8');

const OLD_IMAGE_BLOCK = `            // Görsel URL'si — birden fazla olası etiket
            let image_url = getVal(['resim', 'image', 'img', 'picture', 'foto', 'photo', 'image_url', 'imageUrl', 'gorsel', 'urun_resim', 'ImageUrl']);
            // Eğer boşsa <images> altındaki <url> tag'ine de bak
            if (!image_url) {
              const imagesEl = node.querySelector('images');
              if (imagesEl) image_url = imagesEl.querySelector('url')?.textContent?.trim() || '';
            }`;

const NEW_IMAGE_BLOCK = `            // Görsel URL'leri — image1, image2...image8 etiketlerini dene (XML formatı)
            const _imageUrls = [];
            for (let _i = 1; _i <= 8; _i++) {
              const _u = getVal(['image' + _i, 'resim' + _i, 'foto' + _i, 'img' + _i]);
              if (_u && _u.trim()) _imageUrls.push(_u.trim());
            }
            // image1 yoksa tekil etiketlere bak
            if (_imageUrls.length === 0) {
              const _single = getVal(['image', 'resim', 'img', 'picture', 'foto', 'photo', 'image_url', 'imageUrl', 'gorsel', 'urun_resim', 'ImageUrl']);
              if (_single) _imageUrls.push(_single.trim());
              else {
                const _imgsEl = node.querySelector('images');
                if (_imgsEl) _imgsEl.querySelectorAll('url').forEach(u => { if (u.textContent.trim()) _imageUrls.push(u.textContent.trim()); });
              }
            }
            const image_url = _imageUrls.join(','); // virgülle birleştirilmiş URL listesi (max 8)`;

if (!html.includes(OLD_IMAGE_BLOCK)) {
    console.log('WARN: index.html - eski blok bulunamadı, elle kontrol edin');
} else {
    html = html.replace(OLD_IMAGE_BLOCK, NEW_IMAGE_BLOCK);
    fs.writeFileSync('./index.html', html, 'utf8');
    console.log('OK - index.html guncellendi (image1/image2 destegi eklendi)');
}

// ── SERVER.JS güncelle — birden fazla görsel Trendyol'a gönder ──
let server = fs.readFileSync('./server.js', 'utf8');

const OLD_SERVER_IMAGE = `                // Görsel URL: önce DB'deki ürün URL'si, geçersizse placeholder
                const PLACEHOLDER_IMAGE = 'https://cdn.dsmcdn.com/ty1/product/media/images/20200812/11/7798319/11111/1_1_org.jpg';
                const imageUrl = isValidImageUrl(p.image_url) ? p.image_url.trim() : PLACEHOLDER_IMAGE;`;

const NEW_SERVER_IMAGE = `                // Görsel URL'leri: DB'den virgülle ayrılmış liste, max 8 adet
                const PLACEHOLDER_IMAGE = 'https://cdn.dsmcdn.com/ty1/product/media/images/20200812/11/7798319/11111/1_1_org.jpg';
                const rawUrls = (p.image_url || '').split(',').map(u => u.trim()).filter(u => isValidImageUrl(u));
                const imageUrls = rawUrls.length > 0 ? rawUrls.slice(0, 8) : [PLACEHOLDER_IMAGE];`;

const OLD_SERVER_IMAGES_FIELD = `                    images: [{ url: imageUrl }],`;
const NEW_SERVER_IMAGES_FIELD = `                    images: imageUrls.map(u => ({ url: u })),`;

if (!server.includes(OLD_SERVER_IMAGE)) {
    console.log('WARN: server.js - görsel blok bulunamadı');
} else {
    server = server.replace(OLD_SERVER_IMAGE, NEW_SERVER_IMAGE);
    server = server.replace(OLD_SERVER_IMAGES_FIELD, NEW_SERVER_IMAGES_FIELD);
    fs.writeFileSync('./server.js', server, 'utf8');
    console.log('OK - server.js guncellendi (coklu gorsel destegi eklendi)');
}
