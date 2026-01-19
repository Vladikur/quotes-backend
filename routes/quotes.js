const express = require('express');
const router = express.Router();
const db = require('../scripts/db');
const {getQuotesWithEmbeddings} = require('../scripts/quotesWithEmbeddingsCache');
const cosineSimilarity = require('../scripts/cosineSimilarity');
const translateStringToEnglish = require('../ai/translateToEnglish');
const embedString = require('../ai/embedString');
const {createSearch, getSearch} = require('../scripts/searchStore');

const MIN_SCORE = 0.25;

router.post('/', async (req, res, next) => {
    try {
        const {
            search,
            searchId,
            page = 1,
            limit = 10
        } = req.body;

        const pageNum = Math.max(Number(page), 1);
        const limitNum = Math.max(Number(limit), 1);
        const offset = (pageNum - 1) * limitNum;

        /**
         * =========================
         * ПАГИНАЦИЯ ПО searchId
         * =========================
         */
        if (searchId) {
            const data = getSearch(searchId);

            if (!data) {
                return res.status(410).json({
                    success: false,
                    message: 'Срок поиска истек, повторите запрос'
                });
            }

            return res.json({
                success: true,
                searchId,
                count: data.length,
                page: pageNum,
                limit: limitNum,
                data: data.slice(offset, offset + limitNum)
            });
        }

        /**
         * =========================
         * ОБЫЧНЫЙ СПИСОК (без поиска)
         * =========================
         */
        if (!search) {
            const total = db.prepare(`SELECT COUNT(*) as count
                                      FROM quotes`).get();

            const quotes = db.prepare(`
                SELECT id,
                       author_en,
                       author_ru,
                       text_en,
                       text_ru,
                       source_en,
                       source_ru,
                       robert_comment_en,
                       robert_comment_ru,
                       created_at
                FROM quotes
                ORDER BY created_at DESC LIMIT ?
                OFFSET ?
            `).all(limitNum, offset);

            return res.json({
                success: true,
                count: total.count,
                page: pageNum,
                limit: limitNum,
                data: quotes
            });
        }

        /**
         * =========================
         * ПЕРВЫЙ AI-ПОИСК
         * =========================
         */
        const queryEn = await translateStringToEnglish(search);
        const queryEmbedding = await embedString(queryEn);
        const quotes = await getQuotesWithEmbeddings();

        const scored = quotes
            .map(q => {
                const embedding = JSON.parse(q.embedding_en);
                const score = cosineSimilarity(queryEmbedding, embedding);

                return {
                    id: q.id,
                    author_en: q.author_en,
                    author_ru: q.author_ru,
                    text_en: q.text_en,
                    text_ru: q.text_ru,
                    source_en: q.source_en,
                    source_ru: q.source_ru,
                    robert_comment_en: q.robert_comment_en,
                    robert_comment_ru: q.robert_comment_ru,
                    created_at: q.created_at,
                    score
                };
            })
            .filter(q => q.score >= MIN_SCORE)
            .sort((a, b) => b.score - a.score);

        const newSearchId = createSearch(scored);

        res.json({
            success: true,
            searchId: newSearchId,
            count: scored.length,
            page: pageNum,
            limit: limitNum,
            data: scored.slice(offset, offset + limitNum)
        });

    } catch (err) {
        next(err);
    }
});

module.exports = router;