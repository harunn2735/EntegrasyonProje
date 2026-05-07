// routes/health.js
// Ürün Sağlık Merkezi API endpoint'leri.
// Auth middleware server.js'te mount noktasında uygulanır (req.dealer erişilebilir).
'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../database');
const {
  analyzeAllQuestions,
  getQuestionStats,
  getRefundStats,
  calculateHealthScores,
} = require('../services/sentimentService');

// ── GET /api/health/stats ─────────────────────────────────────────────────────
// Soru kategorisi dağılımı + iade istatistiklerini birleştirir.
router.get('/stats', (req, res) => {
  try {
    const dealerId = req.dealer.id;
    const questions = getQuestionStats(db, dealerId);
    const refunds   = getRefundStats(db, dealerId);
    res.json({ questions, refunds });
  } catch (e) {
    console.error('[health] /stats hatası:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/health/scores ────────────────────────────────────────────────────
// Ürün sağlık skorlarını overall_score ASC (kötüler önce) döndürür.
router.get('/scores', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, product_title, sales_score, refund_score,
             question_score, overall_score, alerts, calculated_at
      FROM   product_health_scores
      ORDER  BY overall_score ASC
    `).all();

    rows.forEach(r => {
      try { r.alerts = JSON.parse(r.alerts || '[]'); } catch { r.alerts = []; }
    });

    res.json(rows);
  } catch (e) {
    console.error('[health] /scores hatası:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/health/analyze ──────────────────────────────────────────────────
// Analiz edilmemiş soruları kategorize eder, ardından sağlık skorlarını günceller.
router.post('/analyze', async (req, res) => {
  try {
    const dealerId = req.dealer.id;

    const { analyzed, errors } = await analyzeAllQuestions(db);
    const scores = calculateHealthScores(db, dealerId);

    res.json({ analyzed, errors, scoresUpdated: scores.length });
  } catch (e) {
    console.error('[health] /analyze hatası:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
