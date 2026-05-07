// routes/questions.js
'use strict';

const express = require('express');
const axios = require('axios');
const db = require('../database');
const { generateAnswer } = require('../services/aiService');

const router = express.Router();

// ── TRENDYOL AUTH HELPER ────────────────────────────────────
function trendyolHeaders(dealer) {
  const auth = Buffer.from(`${dealer.api_key}:${dealer.api_secret}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'User-Agent': `${dealer.supplier_id} - SelfIntegration`,
    'Content-Type': 'application/json',
  };
}

// ── FETCH & SAVE HELPER (cron ve route her ikisi de kullanır) ─
async function fetchAndSaveQuestions(dealer) {
  let response;
  try {
    response = await axios.get(
      `https://apigw.trendyol.com/integration/qna/sellers/${dealer.supplier_id}/questions/filter?status=WAITING_FOR_ANSWER&page=0&size=50`,
      { headers: trendyolHeaders(dealer), timeout: 8000 }
    );
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    throw new Error(`Trendyol API hatası: ${detail}`);
  }

  const questions = response.data?.content || response.data?.questions || [];
  let saved = 0;

  for (const q of questions) {
    const questionId = String(q.id || q.questionId || '');
    if (!questionId) continue;

    // Daha önce kaydedildiyse atla
    const existing = db
      .prepare('SELECT id FROM questions WHERE dealer_id = ? AND question_id = ?')
      .get(dealer.id, questionId);
    if (existing) continue;

    const productName = q.productName || q.product?.name || '';
    const questionText = q.text || q.questionText || '';
    const askedAt = q.createdDate
      ? new Date(q.createdDate).toISOString()
      : new Date().toISOString();

    const aiAnswer = await generateAnswer(dealer.name || '', productName, questionText);

    db.prepare(`
      INSERT OR IGNORE INTO questions
        (dealer_id, question_id, product_name, question_text, ai_answer, status, asked_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(dealer.id, questionId, productName, questionText, aiAnswer, askedAt);

    saved++;
  }

  return { fetched: questions.length, saved };
}

// ── GET /api/questions ──────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const status = ['pending', 'sent', 'rejected'].includes(req.query.status)
      ? req.query.status
      : 'pending';
    const rows = db
      .prepare(
        'SELECT * FROM questions WHERE dealer_id = ? AND status = ? ORDER BY asked_at DESC LIMIT 100'
      )
      .all(req.dealer.id, status);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Sunucu hatası', detail: e.message });
  }
});

// ── POST /api/questions/fetch ───────────────────────────────
router.post('/fetch', async (req, res) => {
  const dealer = db
    .prepare('SELECT id, name, supplier_id, api_key, api_secret FROM dealers WHERE id = ?')
    .get(req.dealer.id);

  if (!dealer?.supplier_id || !dealer?.api_key || !dealer?.api_secret) {
    return res.status(400).json({ error: 'Trendyol API bilgileri eksik' });
  }

  try {
    const result = await fetchAndSaveQuestions(dealer);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── PUT /api/questions/:id ──────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const { ai_answer } = req.body;
    if (typeof ai_answer !== 'string') {
      return res.status(400).json({ error: 'ai_answer alanı gerekli' });
    }
    const result = db
      .prepare(
        "UPDATE questions SET ai_answer = ? WHERE id = ? AND dealer_id = ? AND status = 'pending'"
      )
      .run(ai_answer, req.params.id, req.dealer.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Soru bulunamadı veya düzenlenemez durumda' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/questions/:id/approve ────────────────────────
router.post('/:id/approve', async (req, res) => {
  const question = db
    .prepare("SELECT * FROM questions WHERE id = ? AND dealer_id = ? AND status = 'pending'")
    .get(req.params.id, req.dealer.id);

  if (!question) {
    return res.status(404).json({ error: 'Soru bulunamadı veya zaten işlendi' });
  }
  if (!question.ai_answer || !question.ai_answer.trim()) {
    return res.status(400).json({ error: 'Cevap metni boş olamaz' });
  }

  const dealer = db
    .prepare('SELECT supplier_id, api_key, api_secret FROM dealers WHERE id = ?')
    .get(req.dealer.id);

  try {
    await axios.post(
      `https://apigw.trendyol.com/integration/qna/sellers/${dealer.supplier_id}/questions/${question.question_id}/answers`,
      { text: question.ai_answer.trim() },
      { headers: trendyolHeaders(dealer), timeout: 8000 }
    );

    db.prepare(
      "UPDATE questions SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
    ).run(question.id);

    res.json({ ok: true });
  } catch (e) {
    const data = e.response?.data;
    const errorKey = data?.errors?.[0]?.key || '';

    if (errorKey === 'business.rule.question.has.already.answered') {
      db.prepare(
        "UPDATE questions SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
      ).run(question.id);
      return res.json({ ok: true, alreadyAnswered: true });
    }

    const detail = data?.errors?.[0]?.message || data?.message || e.message;
    res.status(502).json({ error: "Trendyol'a gönderilemedi", detail });
  }
});

// ── POST /api/questions/:id/reject ─────────────────────────
router.post('/:id/reject', (req, res) => {
  try {
    const result = db
      .prepare(
        "UPDATE questions SET status = 'rejected' WHERE id = ? AND dealer_id = ? AND status = 'pending'"
      )
      .run(req.params.id, req.dealer.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Soru bulunamadı veya zaten işlendi' });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.fetchAndSaveQuestions = fetchAndSaveQuestions;
