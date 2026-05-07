-- seeds/demo_questions.sql
-- 50 Türkçe demo müşteri sorusu — INSERT OR IGNORE (idempotent)
-- dealer_id: 3 | status: sent | ai_answer: boş

-- ── ÜRÜN ÖZELLİKLERİ (20 soru) ────────────────────────────────────────────

INSERT OR IGNORE INTO questions
  (dealer_id, question_id, product_name, question_text, ai_answer, status, asked_at, sent_at, created_at)
VALUES
  (3, 100000001, '20L Akıllı Sensörlü Çöp Kovası',
   'Bu çöp kovasının sensör menzili ne kadar, kaç cm''den algılıyor?',
   '', 'sent', '2026-04-28 09:14:22', '2026-04-28 09:14:22', '2026-04-28 09:14:22'),

  (3, 100000002, '20L Akıllı Sensörlü Çöp Kovası',
   'Kapak açılma süresi ayarlanabiliyor mu yoksa sabit mi?',
   '', 'sent', '2026-04-25 14:37:05', '2026-04-25 14:37:05', '2026-04-25 14:37:05'),

  (3, 100000003, '20L Akıllı Sensörlü Çöp Kovası',
   'Ürün beyaz renkte de geliyor mu, siyah dışında seçenek var mı?',
   '', 'sent', '2026-04-22 11:02:44', '2026-04-22 11:02:44', '2026-04-22 11:02:44'),

  (3, 100000004, '20L Akıllı Sensörlü Çöp Kovası',
   'İç kova çıkarılabiliyor mu? Temizlemesi kolay mı?',
   '', 'sent', '2026-04-19 08:55:30', '2026-04-19 08:55:30', '2026-04-19 08:55:30'),

  (3, 100000005, '20L Akıllı Sensörlü Çöp Kovası',
   'Pil ile mi çalışıyor yoksa şarj edilebilir mi? Kaç pil gerekiyor?',
   '', 'sent', '2026-04-16 16:20:11', '2026-04-16 16:20:11', '2026-04-16 16:20:11'),

  (3, 100000006, '5''li Banyo Seti Çöp Kovası Tuvalet Fırçası',
   'Setin tamamı plastik mi, metal parça var mı? Kaliteli görünüyor mu?',
   '', 'sent', '2026-04-27 10:48:17', '2026-04-27 10:48:17', '2026-04-27 10:48:17'),

  (3, 100000007, '5''li Banyo Seti Çöp Kovası Tuvalet Fırçası',
   'Çöp kovasının hacmi kaç litre? Standart banyo poşeti uyar mı?',
   '', 'sent', '2026-04-24 13:22:59', '2026-04-24 13:22:59', '2026-04-24 13:22:59'),

  (3, 100000008, '5''li Banyo Seti Çöp Kovası Tuvalet Fırçası',
   'Ürün rengi fotoğraftaki gibi mi, gerçek rengi ne durumda?',
   '', 'sent', '2026-04-21 09:05:33', '2026-04-21 09:05:33', '2026-04-21 09:05:33'),

  (3, 100000009, '5''li Banyo Seti Çöp Kovası Tuvalet Fırçası',
   'Tuvalet fırçasının sapı uzun mu, eğiliyor mu kullanırken?',
   '', 'sent', '2026-04-18 15:44:02', '2026-04-18 15:44:02', '2026-04-18 15:44:02'),

  (3, 100000010, '5''li Banyo Seti Çöp Kovası Tuvalet Fırçası',
   'Set kaymaz tabanlıkla mı geliyor, banyo zemininde kayıyor mu?',
   '', 'sent', '2026-04-15 11:30:48', '2026-04-15 11:30:48', '2026-04-15 11:30:48'),

  (3, 100000011, 'Kedi Figürlü Cam Kupa',
   'Kupanın kapasitesi kaç ml? 350 ml''ye yakın mı?',
   '', 'sent', '2026-04-29 07:58:14', '2026-04-29 07:58:14', '2026-04-29 07:58:14'),

  (3, 100000012, 'Kedi Figürlü Cam Kupa',
   'Cam kalınlığı ne kadar? Sağlam mı, kolayca kırılıyor mu?',
   '', 'sent', '2026-04-26 12:15:37', '2026-04-26 12:15:37', '2026-04-26 12:15:37'),

  (3, 100000013, 'Kedi Figürlü Cam Kupa',
   'Bulaşık makinesinde yıkayabilir miyim, camı zarar görür mü?',
   '', 'sent', '2026-04-23 17:42:20', '2026-04-23 17:42:20', '2026-04-23 17:42:20'),

  (3, 100000014, 'Kedi Figürlü Cam Kupa',
   'Figürlerdeki boyalar sağlığa zararlı mı, gıdaya uygun sertifikası var mı?',
   '', 'sent', '2026-04-20 10:28:55', '2026-04-20 10:28:55', '2026-04-20 10:28:55'),

  (3, 100000015, 'Kedi Figürlü Cam Kupa',
   'Kupa şeffaf pembe mi yoksa mat pembe mi, fotoğraftan anlaşılmıyor?',
   '', 'sent', '2026-04-17 14:05:12', '2026-04-17 14:05:12', '2026-04-17 14:05:12'),

  (3, 100000016, '9 Parça Puzzle Yer Matı',
   'Matın toplam boyutu ne kadar, kaç m² alan kaplıyor?',
   '', 'sent', '2026-04-30 08:33:41', '2026-04-30 08:33:41', '2026-04-30 08:33:41'),

  (3, 100000017, '9 Parça Puzzle Yer Matı',
   'Kalınlığı kaç mm? Bebek düşmelerine karşı yeterli koruma sağlar mı?',
   '', 'sent', '2026-04-28 16:19:08', '2026-04-28 16:19:08', '2026-04-28 16:19:08'),

  (3, 100000018, '9 Parça Puzzle Yer Matı',
   'Formamit ve BPA içeriyor mu? Baskı boyaları sağlıklı mı, bebek için uygun mu?',
   '', 'sent', '2026-04-13 09:47:33', '2026-04-13 09:47:33', '2026-04-13 09:47:33'),

  (3, 100000019, 'Akıllı Sensörlü UV Işıklı Çöp Kovası',
   'UV ışığı kaç dakika çalışıyor, süre ayarlanabiliyor mu?',
   '', 'sent', '2026-04-11 13:22:16', '2026-04-11 13:22:16', '2026-04-11 13:22:16'),

  (3, 100000020, 'Akıllı Sensörlü UV Işıklı Çöp Kovası',
   'UV dezenfeksiyon gerçekten etkili mi, bakteri ve koku gideriyor mu?',
   '', 'sent', '2026-04-08 10:55:04', '2026-04-08 10:55:04', '2026-04-08 10:55:04');

-- ── KARGO / TESLİMAT (10 soru) ─────────────────────────────────────────────

INSERT OR IGNORE INTO questions
  (dealer_id, question_id, product_name, question_text, ai_answer, status, asked_at, sent_at, created_at)
VALUES
  (3, 100000021, '20L Akıllı Sensörlü Çöp Kovası',
   'Kargo paketi ne kadar sağlam? Ürün hasar almadan geliyor mu?',
   '', 'sent', '2026-04-27 15:08:29', '2026-04-27 15:08:29', '2026-04-27 15:08:29'),

  (3, 100000022, '20L Akıllı Sensörlü Çöp Kovası',
   'Aynı gün kargo yapıyor musunuz, kaçta sipariş versem bugün çıkar?',
   '', 'sent', '2026-04-24 09:31:47', '2026-04-24 09:31:47', '2026-04-24 09:31:47'),

  (3, 100000023, '5''li Banyo Seti Çöp Kovası Tuvalet Fırçası',
   'İstanbul''a 1-2 günde gelir mi, acil ihtiyacım var?',
   '', 'sent', '2026-04-21 14:22:03', '2026-04-21 14:22:03', '2026-04-21 14:22:03'),

  (3, 100000024, '5''li Banyo Seti Çöp Kovası Tuvalet Fırçası',
   'Kargo şirketi hangisi, takip numarasını paylaşıyor musunuz?',
   '', 'sent', '2026-04-18 11:44:55', '2026-04-18 11:44:55', '2026-04-18 11:44:55'),

  (3, 100000025, 'Kedi Figürlü Cam Kupa',
   'Cam ürün nasıl paketleniyor? Kırık gelme ihtimali var mı?',
   '', 'sent', '2026-04-15 16:57:22', '2026-04-15 16:57:22', '2026-04-15 16:57:22'),

  (3, 100000026, 'Kedi Figürlü Cam Kupa',
   'Hediye paketleme yapıyor musunuz, not kartı ekleyebilir misiniz?',
   '', 'sent', '2026-04-12 08:14:39', '2026-04-12 08:14:39', '2026-04-12 08:14:39'),

  (3, 100000027, '9 Parça Puzzle Yer Matı',
   '9 parça ayrı ayrı paketlenmiş mi yoksa tek kutuda mı geliyor?',
   '', 'sent', '2026-04-29 10:38:15', '2026-04-29 10:38:15', '2026-04-29 10:38:15'),

  (3, 100000028, '9 Parça Puzzle Yer Matı',
   'Kargo ücreti ne kadar, ücretsiz kargo var mı bu ürün için?',
   '', 'sent', '2026-04-10 13:05:48', '2026-04-10 13:05:48', '2026-04-10 13:05:48'),

  (3, 100000029, 'Akıllı Sensörlü UV Işıklı Çöp Kovası',
   'Adrese teslim mi yapıyorsunuz yoksa PTT şubesine mi bırakıyorlar?',
   '', 'sent', '2026-04-07 09:22:11', '2026-04-07 09:22:11', '2026-04-07 09:22:11'),

  (3, 100000030, 'Akıllı Sensörlü UV Işıklı Çöp Kovası',
   'Cumartesi günü teslimat yapılıyor mu? Hafta içi evde olamıyorum.',
   '', 'sent', '2026-04-04 14:48:37', '2026-04-04 14:48:37', '2026-04-04 14:48:37');

-- ── İADE TALEBİ (8 soru) ───────────────────────────────────────────────────

INSERT OR IGNORE INTO questions
  (dealer_id, question_id, product_name, question_text, ai_answer, status, asked_at, sent_at, created_at)
VALUES
  (3, 100000031, '20L Akıllı Sensörlü Çöp Kovası',
   'Sensör hiç çalışmıyor, iade nasıl yapabilirim? Kargo bedelini kim öder?',
   '', 'sent', '2026-04-26 11:22:04', '2026-04-26 11:22:04', '2026-04-26 11:22:04'),

  (3, 100000032, '5''li Banyo Seti Çöp Kovası Tuvalet Fırçası',
   'Ürün hasarlı geldi, kutu ezilmiş ve parçalar kırık. İade süreci nasıl işliyor?',
   '', 'sent', '2026-04-23 08:37:19', '2026-04-23 08:37:19', '2026-04-23 08:37:19'),

  (3, 100000033, '5''li Banyo Seti Çöp Kovası Tuvalet Fırçası',
   'Renk fotoğraftaki gibi değil, çok farklı. Cayma hakkımı kullanabilir miyim?',
   '', 'sent', '2026-04-20 15:14:52', '2026-04-20 15:14:52', '2026-04-20 15:14:52'),

  (3, 100000034, 'Kedi Figürlü Cam Kupa',
   'Ürün kırık geldi, ambalaj hasarlıydı. Para iadesi alabilir miyim?',
   '', 'sent', '2026-04-17 10:03:28', '2026-04-17 10:03:28', '2026-04-17 10:03:28'),

  (3, 100000035, '9 Parça Puzzle Yer Matı',
   'Parçalar birbirine tam oturmuyor, aralarında boşluk kalıyor. İade koşulları nedir?',
   '', 'sent', '2026-04-14 13:29:47', '2026-04-14 13:29:47', '2026-04-14 13:29:47'),

  (3, 100000036, '9 Parça Puzzle Yer Matı',
   'Kullanmadan iade edebilir miyim? 14 gün daha geçmedi.',
   '', 'sent', '2026-04-11 09:51:33', '2026-04-11 09:51:33', '2026-04-11 09:51:33'),

  (3, 100000037, 'Akıllı Sensörlü UV Işıklı Çöp Kovası',
   'Ürün 3. günde arıza yaptı, çalışmıyor. Teknik destek var mı yoksa iade mi yapayım?',
   '', 'sent', '2026-04-08 16:44:22', '2026-04-08 16:44:22', '2026-04-08 16:44:22'),

  (3, 100000038, 'Akıllı Sensörlü UV Işıklı Çöp Kovası',
   'İade kargosunu kim öder, ben mi ödüyorum satıcı mı? Trendyol ne diyor?',
   '', 'sent', '2026-04-05 11:17:08', '2026-04-05 11:17:08', '2026-04-05 11:17:08');

-- ── FİYAT / KAMPANYA (7 soru) ──────────────────────────────────────────────

INSERT OR IGNORE INTO questions
  (dealer_id, question_id, product_name, question_text, ai_answer, status, asked_at, sent_at, created_at)
VALUES
  (3, 100000039, '20L Akıllı Sensörlü Çöp Kovası',
   'Bu ürün için yakında indirim olacak mı, kampanyaya girecek mi?',
   '', 'sent', '2026-04-25 08:05:44', '2026-04-25 08:05:44', '2026-04-25 08:05:44'),

  (3, 100000040, '5''li Banyo Seti Çöp Kovası Tuvalet Fırçası',
   'Toplu alımda indirim var mı? 3 adet almayı düşünüyorum.',
   '', 'sent', '2026-04-22 14:38:19', '2026-04-22 14:38:19', '2026-04-22 14:38:19'),

  (3, 100000041, 'Kedi Figürlü Cam Kupa',
   'Fiyat yakın zamanda düşer mi, beklememe değer mi?',
   '', 'sent', '2026-04-19 11:24:55', '2026-04-19 11:24:55', '2026-04-19 11:24:55'),

  (3, 100000042, '9 Parça Puzzle Yer Matı',
   'Neden bu kadar pahalı, rakiplerinden daha ucuz seçenek var. Farkı nedir?',
   '', 'sent', '2026-04-16 09:47:32', '2026-04-16 09:47:32', '2026-04-16 09:47:32'),

  (3, 100000043, '9 Parça Puzzle Yer Matı',
   'Trendyol kupon kodunu bu ürüne uygulayabilir miyim?',
   '', 'sent', '2026-04-13 15:02:17', '2026-04-13 15:02:17', '2026-04-13 15:02:17'),

  (3, 100000044, 'Akıllı Sensörlü UV Işıklı Çöp Kovası',
   'Aynı ürün başka mağazada 50 TL daha ucuz, fiyat garantisi veriyor musunuz?',
   '', 'sent', '2026-04-10 10:33:41', '2026-04-10 10:33:41', '2026-04-10 10:33:41'),

  (3, 100000045, 'Akıllı Sensörlü UV Işıklı Çöp Kovası',
   'Bu fiyata 2 yıl garanti ve teknik destek dahil mi?',
   '', 'sent', '2026-04-07 13:58:26', '2026-04-07 13:58:26', '2026-04-07 13:58:26');

-- ── STOK DURUMU (5 soru) ───────────────────────────────────────────────────

INSERT OR IGNORE INTO questions
  (dealer_id, question_id, product_name, question_text, ai_answer, status, asked_at, sent_at, created_at)
VALUES
  (3, 100000046, '20L Akıllı Sensörlü Çöp Kovası',
   'Siyah renk stokta var mı, tükenmiş görünüyor?',
   '', 'sent', '2026-04-30 07:11:03', '2026-04-30 07:11:03', '2026-04-30 07:11:03'),

  (3, 100000047, '5''li Banyo Seti Çöp Kovası Tuvalet Fırçası',
   'Ürün şu an tükenmiş görünüyor, ne zaman tekrar stoka girecek?',
   '', 'sent', '2026-04-02 14:22:48', '2026-04-02 14:22:48', '2026-04-02 14:22:48'),

  (3, 100000048, 'Kedi Figürlü Cam Kupa',
   'Pembe renkli kupa stokta kaldı mı, hızlı bitiyor mu?',
   '', 'sent', '2026-04-01 10:45:19', '2026-04-01 10:45:19', '2026-04-01 10:45:19'),

  (3, 100000049, '9 Parça Puzzle Yer Matı',
   'Stok bitmek üzere yazıyor, yerine gelecek mi, ne zaman?',
   '', 'sent', '2026-04-29 16:33:57', '2026-04-29 16:33:57', '2026-04-29 16:33:57'),

  (3, 100000050, 'Akıllı Sensörlü UV Işıklı Çöp Kovası',
   'Bu üründen kaç adet alabilirim? Kısıtlama var mı, toplu sipariş verecektim.',
   '', 'sent', '2026-04-03 09:08:42', '2026-04-03 09:08:42', '2026-04-03 09:08:42');
