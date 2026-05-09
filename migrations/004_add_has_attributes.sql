-- Migration: 004_add_has_attributes
-- Trendyol kategorilerin attribute tanımlayıp tanımlamadığını takip eder.
-- NULL = henüz kontrol edilmedi  |  0 = attribute yok (üst/parent kategori)  |  1 = attribute var (leaf)

ALTER TABLE trendyol_kategoriler ADD COLUMN has_attributes INTEGER DEFAULT NULL;
