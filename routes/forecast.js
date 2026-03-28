// routes/forecast.js
'use strict';

const express = require('express');
const { getDealerForecast, getProductForecast } = require('../services/demandForecast');
const { generateForecastComment } = require('../services/aiService');

const router = express.Router();

// GET /api/forecast — tüm ürünlerin tahmin listesi (AI yorum yok)
router.get('/', (req, res) => {
  try {
    const forecasts = getDealerForecast(req.dealer.id);
    res.json(forecasts);
  } catch (e) {
    res.status(500).json({ error: 'Tahmin hesaplanamadı', detail: e.message });
  }
});

// GET /api/forecast/:productId — tek ürün + Claude yorumu
router.get('/:productId', async (req, res) => {
  try {
    const productId = parseInt(req.params.productId, 10);
    if (!productId || isNaN(productId)) {
      return res.status(400).json({ error: 'Geçersiz ürün ID' });
    }

    const forecast = getProductForecast(req.dealer.id, productId);
    if (!forecast) {
      return res.status(404).json({ error: 'Ürün bulunamadı' });
    }

    const aiComment = await generateForecastComment(
      forecast.title,
      forecast.weeklySales,
      forecast.trend,
      forecast.forecast7d
    ).catch(() => null);

    res.json({ ...forecast, aiComment });
  } catch (e) {
    res.status(500).json({ error: 'Tahmin alınamadı', detail: e.message });
  }
});

module.exports = router;
