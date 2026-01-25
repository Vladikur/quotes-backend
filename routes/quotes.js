const express = require('express');
const router = express.Router();
const embedString = require('../ai/embedString');

const db = require('../scripts/db');
const {getQuotesWithEmbeddings, resetQuotesEmbeddingsCache} = require('../scripts/quotesWithEmbeddingsCache');
const cosineSimilarity = require('../scripts/cosineSimilarity');
const detectLanguage = require('../scripts/detectLanguage');
const formatSqliteDate = require('../scripts/formatSqliteDate');
const floatArrayToBuffer = require('../scripts/floatArrayToBuffer');
const {createSearch, getSearch} = require('../scripts/searchStore');
const {buildEmbeddingsBatchRu, buildEmbeddingsBatchEn} = require('../ai/buildEmbeddingsBatch');

const MIN_SCORE = 0.3;

/**
 * =========================
 * ПОИСК ЦИТАТ
 * =========================
 * DELETE /api/quotes/
 */
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
        const lang = detectLanguage(search); // 'ru' | 'en'
        const queryEmbedding = await embedString(search);
        const quotes = await getQuotesWithEmbeddings();

        const scored = quotes
            .map(q => {
                const embedding =
                    lang === 'ru' ? q.embedding_ru : q.embedding_en;
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
            lang: lang,
            data: scored.slice(offset, offset + limitNum)
        });

    } catch (err) {
        next(err);
    }
});

/**
 * =========================
 * УДАЛЕНИЕ ЦИТАТЫ
 * =========================
 * DELETE /api/quotes/:id
 */
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const quoteId = Number(id);

    if (!Number.isInteger(quoteId)) {
        return res.status(400).json({
            success: false,
            message: 'Некорректный id цитаты'
        });
    }

    const exists = db
        .prepare('SELECT id FROM quotes WHERE id = ?')
        .get(quoteId);

    if (!exists) {
        return res.status(404).json({
            success: false,
            message: 'Цитата не найдена'
        });
    }

    db.prepare('DELETE FROM quotes WHERE id = ?').run(quoteId);

    resetQuotesEmbeddingsCache();

    return res.json({
        success: true,
        message: 'Цитата удалена'
    });
});

/**
 * =========================
 * МАССОВАЯ ЗАГРУЗКА ЦИТАТ
 * =========================
 * POST /api/quotes/bulk
 */
router.post('/bulk', async (req, res, next) => {
    try {
        const { quotes } = req.body;

        if (!Array.isArray(quotes)) {
            return res.status(400).json({
                success: false,
                message: 'Ожидается массив цитат'
            });
        }

        const insertCandidates = [];
        let addedCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;

        const findByTextPrefixStmt = db.prepare(`
            SELECT id
            FROM quotes
            WHERE text_en LIKE ?
            LIMIT 1
        `);

        const updateStmt = db.prepare(`
            UPDATE quotes
            SET author_en = @author_en,
                author_ru = @author_ru,
                text_en = @text_en,
                text_ru = @text_ru,
                source_en = @source_en,
                source_ru = @source_ru,
                robert_comment_en = @robert_comment_en,
                robert_comment_ru = @robert_comment_ru
            WHERE id = @id
        `);

        for (const quote of quotes) {
            const {
                id,
                author_en,
                author_ru,
                text_en,
                text_ru,
                source_en = null,
                source_ru = null,
                robert_comment_en = null,
                robert_comment_ru = null,
            } = quote;

            if (!author_en || !author_ru || !text_en || !text_ru) {
                return res.status(400).json({
                    success: false,
                    message: 'author_en, author_ru, text_en, text_ru обязательны'
                });
            }

            // Обновление по id
            if (id) {
                updateStmt.run({
                    id,
                    author_en,
                    author_ru,
                    text_en,
                    text_ru,
                    source_en,
                    source_ru,
                    robert_comment_en,
                    robert_comment_ru
                });

                updatedCount++;
                continue;
            }

            // Проверка дубликата по первым 5 словам
            const firstFiveWords = text_en
                .split(/\s+/)
                .slice(0, 5)
                .join(' ');

            const exists = findByTextPrefixStmt.get(`${firstFiveWords}%`);
            if (exists) {
                skippedCount++;
                continue;
            }

            insertCandidates.push({
                author_en,
                author_ru,
                text_en,
                text_ru,
                source_en,
                source_ru,
                robert_comment_en,
                robert_comment_ru
            });
        }

        if (!insertCandidates.length) {
            return res.json({
                success: true,
                message:
                    `Добавлено: ${addedCount}, ` +
                    `обновлено: ${updatedCount}, ` +
                    `пропущено: ${skippedCount}`
            });
        }

        /**
         * =========================
         * BATCH EMBEDDINGS
         * =========================
         */
        const [embeddingsRu, embeddingsEn] = await Promise.all([
            buildEmbeddingsBatchRu(insertCandidates),
            buildEmbeddingsBatchEn(insertCandidates)
        ]);

        /**
         * =========================
         * ВСТАВКА В БД
         * =========================
         */
        const insertStmt = db.prepare(`
            INSERT INTO quotes (
                author_en,
                author_ru,
                text_en,
                text_ru,
                source_en,
                source_ru,
                robert_comment_en,
                robert_comment_ru,
                embedding_en_blob,
                embedding_ru_blob,
                created_at
            ) VALUES (
                @author_en,
                @author_ru,
                @text_en,
                @text_ru,
                @source_en,
                @source_ru,
                @robert_comment_en,
                @robert_comment_ru,
                @embedding_en_blob,
                @embedding_ru_blob,
                @created_at
            )
        `);

        const insertMany = db.transaction((rows) => {
            rows.forEach((row, index) => {
                insertStmt.run({
                    ...row,
                    embedding_en_blob: floatArrayToBuffer(embeddingsEn[index]),
                    embedding_ru_blob: floatArrayToBuffer(embeddingsRu[index]),
                    created_at: formatSqliteDate()
                });
                addedCount++;
            });
        });

        insertMany(insertCandidates);

        resetQuotesEmbeddingsCache();

        return res.json({
            success: true,
            message:
                `Добавлено: ${addedCount}, ` +
                `обновлено: ${updatedCount}, ` +
                `пропущено: ${skippedCount}`
        });

    } catch (err) {
        next(err);
    }

});


module.exports = router;