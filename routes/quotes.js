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
            return res.json({
                success: false,
                message: 'Ожидается массив цитат'
            });
        }

        const insertCandidates = [];
        let addedCount = 0;
        let skippedCount = 0;

        const findByTextPrefixStmt = db.prepare(`
            SELECT id
            FROM quotes
            WHERE text_en LIKE ?
            LIMIT 1
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
                return res.json({
                    success: false,
                    message: 'author_en, author_ru, text_en, text_ru обязательны'
                });
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
                message: 'Новых цитат нет',
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
                `пропущено: ${skippedCount}`
        });

    } catch (err) {
        next(err);
    }

});

/**
 * =========================
 * МАССОВОЕ ОБНОВЛЕНИЕ ЦИТАТ
 * =========================
 * POST /api/quotes/bulk/update
 */
router.post('/bulk/update', async (req, res, next) => {
    try {
        const { quotes } = req.body;

        if (!Array.isArray(quotes) || !quotes.length) {
            return res.json({
                success: false,
                message: 'Ожидается непустой массив цитат'
            });
        }

        /**
         * =========================
         * ВАЛИДАЦИЯ
         * =========================
         */
        const ids = [];
        for (const quote of quotes) {
            const {
                id,
                author_en,
                author_ru,
                text_en,
                text_ru
            } = quote;

            if (!Number.isInteger(id)) {
                return res.json({
                    success: false,
                    message: 'У каждой цитаты должен быть корректный id'
                });
            }

            if (!author_en || !author_ru || !text_en || !text_ru) {
                return res.json({
                    success: false,
                    message: 'author_en, author_ru, text_en, text_ru обязательны'
                });
            }

            ids.push(id);
        }

        /**
         * =========================
         * ПРОВЕРКА СУЩЕСТВОВАНИЯ ID
         * =========================
         */
        const placeholders = ids.map(() => '?').join(',');
        const existingIds = db.prepare(`
            SELECT id
            FROM quotes
            WHERE id IN (${placeholders})
        `).all(...ids).map(r => r.id);

        if (existingIds.length !== ids.length) {
            const missing = ids.filter(id => !existingIds.includes(id));
            return res.json({
                success: false,
                message: `Цитаты не найдены: ${missing.join(', ')}`
            });
        }

        /**
         * =========================
         * BATCH EMBEDDINGS
         * =========================
         */
        const [embeddingsRu, embeddingsEn] = await Promise.all([
            buildEmbeddingsBatchRu(quotes),
            buildEmbeddingsBatchEn(quotes)
        ]);

        /**
         * =========================
         * ОБНОВЛЕНИЕ В БД
         * =========================
         */
        const updateStmt = db.prepare(`
            UPDATE quotes
            SET
                author_en = @author_en,
                author_ru = @author_ru,
                text_en = @text_en,
                text_ru = @text_ru,
                source_en = @source_en,
                source_ru = @source_ru,
                robert_comment_en = @robert_comment_en,
                robert_comment_ru = @robert_comment_ru,
                embedding_en_blob = @embedding_en_blob,
                embedding_ru_blob = @embedding_ru_blob
            WHERE id = @id
        `);

        const updateMany = db.transaction((rows) => {
            rows.forEach((row, index) => {
                updateStmt.run({
                    id: row.id,
                    author_en: row.author_en,
                    author_ru: row.author_ru,
                    text_en: row.text_en,
                    text_ru: row.text_ru,
                    source_en: row.source_en ?? null,
                    source_ru: row.source_ru ?? null,
                    robert_comment_en: row.robert_comment_en ?? null,
                    robert_comment_ru: row.robert_comment_ru ?? null,
                    embedding_en_blob: floatArrayToBuffer(embeddingsEn[index]),
                    embedding_ru_blob: floatArrayToBuffer(embeddingsRu[index])
                });
            });
        });

        updateMany(quotes);

        /**
         * =========================
         * СБРОС КЭША
         * =========================
         */
        resetQuotesEmbeddingsCache();

        return res.json({
            success: true,
            message: `Обновлено цитат: ${quotes.length}`
        });

    } catch (err) {
        next(err);
    }
});

module.exports = router;