const fs = require('fs');
let content = fs.readFileSync('./server.js', 'utf8');

const newKeywords = `const CATEGORY_KEYWORDS = [
    // Kulaklik (Gercek Trendyol ID'leri)
    { keys: ['airpod', 'tws', 'bluetooth kulak', 'kablosuz kulak', 'earbud', 'true wireless', 'itws'], categoryId: 1058 },
    { keys: ['kulaklık', 'earphone', 'headphone'], categoryId: 1058 },
    { keys: ['boyun bantlı kulaklık', 'neckband'], categoryId: 5196 },
    { keys: ['oyuncu kulaklık', 'gaming headset'], categoryId: 2700 },
    // Akilli Saat
    { keys: ['akıllı saat', 'smart watch', 'smartwatch', 'watch ultra', 'watch series', 'g9 mini', 't800', 't700'], categoryId: 1890 },
    // Arac Kamera
    { keys: ['arka görüş kamer', 'geri görüş kamer'], categoryId: 1952 },
    { keys: ['araç içi kamera', 'araç kamera', 'dash cam', 'dvr', 'araç içi kayıt', 'araç içi güvenlik'], categoryId: 1949 },
    // Supurge
    { keys: ['araç içi süpürge', 'araç süpürge', 'oto süpürge'], categoryId: 4484 },
    { keys: ['süpürge', 'vakumlu el', 'el süpürge', 'kablosuz süpürge', 'şarjlı süpürge', 'mini süpürge'], categoryId: 873 },
    // Isitici
    { keys: ['ısıtıcı', 'elektrikli soba', 'quartz ısıtıcı', 'fanlı ısıtıcı', 'quartz soba'], categoryId: 833 },
    // Hulahop
    { keys: ['hulahop', 'hula hoop', 'hulahoop', 'egzersiz çemberi', 'egzersiz halkası'], categoryId: 827 },
    // Cop Kovasi
    { keys: ['çöp kovası', 'çöp kutusu', 'çöp tenekesi', 'sensörlü çöp', 'akıllı çöp'], categoryId: 2188 },
    // Banyo
    { keys: ['banyo seti', 'tuvalet fırçası', 'sabunluk', 'banyo rafı', 'duş rafı', 'şampuanlık', 'banyo düzenleyici', 'banyo organizer'], categoryId: 1830 },
    // Jel Kompres / Ortopedik
    { keys: ['jel kompres', 'termojel', 'soğuk sıcak jel', 'buz jeli', 'kompres jel', 'buz paketi'], categoryId: 826 },
    { keys: ['dizlik', 'diz korsesi', 'patella', 'menisküs', 'çapraz bağ'], categoryId: 826 },
    { keys: ['bel korsesi', 'bel destekli'], categoryId: 826 },
    { keys: ['dirsek bandı', 'dirseklik', 'epikondilit'], categoryId: 826 },
    { keys: ['baldırlık', 'baldır desteği'], categoryId: 826 },
    { keys: ['kol askısı'], categoryId: 826 },
    { keys: ['bilekliği', 'bilek destek'], categoryId: 826 },
    { keys: ['topuk çorabı', 'topuk dikeni'], categoryId: 826 },
    // Masaj
    { keys: ['masaj tabancası'], categoryId: 4675 },
    { keys: ['masaj yastığı', 'boyun masaj yast'], categoryId: 4610 },
    { keys: ['masaj aleti', 'masaj cihazı', 'masaj pedi', 'titreşimli masaj', 'ems masaj', 'kelebek masaj', 'hip trainer', 'kalça egzersiz', 'hips trainer'], categoryId: 3550 },
    // Epilator
    { keys: ['epilatör', 'epilasyon aleti', 'tüy alıcı', 'tüy temizleyici', 'kaş bıyık', 'yüz tüy', 'finishing touch', 'flawless'], categoryId: 867 },
    // Nemlendirici
    { keys: ['nemlendirici', 'difüzör', 'aromaterapi', 'buhar makinesi', 'ultrasonik nem'], categoryId: 3013 },
    // Projektor
    { keys: ['projektör', 'projeksiyon', 'gece lambası', 'galaksi lamba', 'robot projektör'], categoryId: 1789 },
    // Oyun Konsolu
    { keys: ['el atarisi', 'retro konsol', 'nostalji oyun', 'taşınabilir konsol', 'arcade konsol', 'psp ps1', 'gamepad', 'oyun kolu', 'ps4 kolu', 'joystick'], categoryId: 1901 },
    // Oyuncak
    { keys: ['manyetik hayvan', 'manyetik meyve', 'mıknatıslı oyun'], categoryId: 1011 },
    { keys: ['ahşap denge', 'kule oyunu', 'ahşap kule'], categoryId: 2256 },
    { keys: ['tesettürlü bebek', 'meryem bebek', 'dua eden bebek', 'edep bebek', 'ilahi söyleyen'], categoryId: 4516 },
    // Mutfak Aletleri
    { keys: ['cupcake kalıbı', 'muffin kalıbı', 'kek kalıbı', 'fırın kalıbı', 'yanmaz muffin'], categoryId: 911 },
    { keys: ['öğütücü', 'kahve öğütücü', 'baharat öğütücü', 'elektrikli öğütücü'], categoryId: 834 },
    { keys: ['sarımsak doğrayıcı', 'soğan doğrayıcı'], categoryId: 834 },
    { keys: ['turbo fan', 'jet fan', 'mini fan', 'vantilatör'], categoryId: 834 },
    // Pil
    { keys: ['kalem pil', 'aa pil', 'aaa pil', 'alkalin pil', 'r6 pil'], categoryId: 1841 },
    // Dolap/Raf Organizer
    { keys: ['dolap içi', 'çekmece örtüsü', 'raf örtüsü', 'shelf liner', 'kaydırmaz raflık', 'kaymaz raf'], categoryId: 4458 },
    { keys: ['evye altı', 'dolap organizer', 'mutfak organizer'], categoryId: 4458 },
    // Yastik
    { keys: ['nano jel yastık', 'jel yastık', 'anti-alerjik yastık', 'otel yastığı'], categoryId: 1850 },
    { keys: ['hamile minderi', 'gebelik minderi', 'uyku minderi'], categoryId: 1850 },
    // Musluk
    { keys: ['musluk başlığı', 'musluk ucu', 'lavabo başlığı', '360 döner musluk', 'su tasarruflu musluk'], categoryId: 4726 },
    // Lunch Box / Saklama
    { keys: ['lunch box', 'saklama kabı', 'yemek kabı', 'beslenme kabı', 'bambu lunch', 'kahvaltılık kutu'], categoryId: 2188 },
    // Uydu Alicisi
    { keys: ['uydu alıcısı', 'uydu alici', 'dijital alıcı', 'wifi uydu', 'youtube uydu'], categoryId: 837 },
    // Yagmurluk
    { keys: ['yağmurluk', 'eva yağmurluk', 'kapüşonlu yağmurluk', 'pardesü yağmurluk', 'su geçirmez'], categoryId: 541 },
    // El Feneri
    { keys: ['el feneri', 'mini fener', 'cob led fener', 'q5 fener', 'şarjlı fener', 'zoomlu fener'], categoryId: 2060 },
    // Telefon Tutucu
    { keys: ['araç içi telefon tutucu', 'araç tutucu', 'magsafe tutucu', 'vakumlu telefon tutucu', 'mıknatıslı tutucu', '360 telefon tutucu'], categoryId: 1056 },
    // Sarj Kablosu / Powerbank
    { keys: ['powerbank', 'taşınabilir şarj', 'kablosuz powerbank', 'magsafe powerbank'], categoryId: 771 },
    { keys: ['şarj kablosu', 'type-c kablo', 'lightning kablo', 'usb kablo', '4in1 kablo', 'hızlı şarj kablo'], categoryId: 5504 },
    // Kemer Delici
    { keys: ['kemer delme', 'kemer delici', 'deri delik açıcı', 'delik açma pensesi', 'perçin pensesi'], categoryId: 834 },
    // Priz
    { keys: ['priz', 'sıva üstü priz', 'duvar prizi', 'topraklı priz', 'ikili priz'], categoryId: 836 },
    // Pubg Eldiven
    { keys: ['pubg eldiven', 'oyun eldiveni', 'parmak eldiveni', 'e-spor eldiven'], categoryId: 5394 },
    // Kedi Kumu
    { keys: ['kedi kumu', 'kumu küreği', 'kedi küreği'], categoryId: 1288 },
    // Yun Topu
    { keys: ['yün kurutma', 'kurutma topu', 'çamaşır topu'], categoryId: 1401 },
    // Eviye
    { keys: ['eviye seti', 'led eviye', 'akıllı eviye', 'çift şelale eviye'], categoryId: 4719 },
    // Vazo
    { keys: ['vazo', 'dekoratif vazo', 'skandinav vazo'], categoryId: 2105 },
    // Kopek
    { keys: ['köpek kovucu', 'ultrasonik köpek', 'köpek eğitim', 'köpek kovucu'], categoryId: 1357 },
    // Boks
    { keys: ['boks padi', 'duvar boks', 'müzikli boks'], categoryId: 827 },
    // Led Panel
    { keys: ['panel led', 'cama yapışır led'], categoryId: 836 },
];`;

// CATEGORY_KEYWORDS bloğunu bul ve değiştir
const startMark = 'const CATEGORY_KEYWORDS = [';
const startIdx = content.indexOf(startMark);
if (startIdx === -1) { console.log('ERR: CATEGORY_KEYWORDS bulunamadı'); process.exit(1); }

// Köşeli parantez sayarak array'in sonunu bul
let depth = 0;
let endIdx = -1;
for (let i = startIdx + startMark.length - 1; i < content.length; i++) {
    if (content[i] === '[') depth++;
    else if (content[i] === ']') { depth--; if (depth === 0) { endIdx = i; break; } }
}
if (endIdx === -1) { console.log('ERR: Kapanma bulunamadı'); process.exit(1); }

const newContent = content.substring(0, startIdx) + newKeywords + content.substring(endIdx + 1);
fs.writeFileSync('./server.js', newContent, 'utf8');
console.log('OK - CATEGORY_KEYWORDS guncellendi. Satir sayisi: ' + newContent.split('\n').length);
