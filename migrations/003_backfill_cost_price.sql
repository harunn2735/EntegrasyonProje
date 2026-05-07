-- Migration: 003_backfill_cost_price
-- cost_price = 0 olan ürünler için sale_price'tan geri hesaplama.
-- İş mantığı: XML fiyatı = cost_price, sale_price = cost_price * (1 + margin/100)
-- Geri hesap: cost_price = sale_price / (1 + margin/100)
-- Önce tedarikçi bazlı margin, yoksa bayi genel margini, yoksa varsayılan %20 kullanılır.

UPDATE dealer_products
SET cost_price = ROUND(
    sale_price / (1.0 + COALESCE(
        (
            SELECT sm.margin
            FROM supplier_margins sm
            WHERE sm.dealer_id = dealer_products.dealer_id
              AND sm.supplier_name = dealer_products.supplier_name
            LIMIT 1
        ),
        (
            SELECT d.profit_margin
            FROM dealers d
            WHERE d.id = dealer_products.dealer_id
        ),
        20
    ) / 100.0),
2)
WHERE cost_price = 0 AND sale_price > 0;
