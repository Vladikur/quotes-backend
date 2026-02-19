const express = require('express');
const router = express.Router();
const embedString = require('../ai/embedString');

const db = require('../scripts/db');
const {getQuotesWithEmbeddings, resetQuotesEmbeddingsCache} = require('../scripts/quotesWithEmbeddingsCache');
const cosineSimilarity = require('../scripts/cosineSimilarity');
const detectLanguage = require('../scripts/detectLanguage');
const formatSqliteDate = require('../scripts/formatSqliteDate');
const normalizeSearchString = require('../scripts/normalizeSearchString');
const floatArrayToBuffer = require('../scripts/floatArrayToBuffer');
const {createSearch, getSearch} = require('../scripts/searchStore');
const {buildEmbeddingsBatchRu, buildEmbeddingsBatchEn} = require('../ai/buildEmbeddingsBatch');
const { auth, requireRole } = require('../middlewares/auth');

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
            strict = false,
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
        if (searchId && !strict) {
            const data = getSearch(searchId);

            if (data) {
                return res.json({
                    success: true,
                    searchId,
                    count: data.length,
                    page: pageNum,
                    limit: limitNum,
                    data: data.slice(offset, offset + limitNum)
                });
            }
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
         * СТРОГИЙ ПОСИМВОЛЬНЫЙ ПОИСК
         * =========================
         */
        if (search && strict) {
            const normalizedQuery = normalizeSearchString(search);
            const quotes = await getQuotesWithEmbeddings();

            const matched = quotes.filter(q =>
                q.search_blob.includes(normalizedQuery)
            );

            return res.json({
                success: true,
                count: matched.length,
                page: pageNum,
                limit: limitNum,
                data: matched.slice(offset, offset + limitNum),
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
 * ЗАГРУЗКА ЦИТАТЫ ПО ID
 * =========================
 * GET /api/quotes/:id
 */
router.get('/:id', auth, requireRole('editor'), (req, res) => {
    const { id } = req.params;
    const quoteId = Number(id);

    const quote = db.prepare(`
        SELECT
            id,
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
        WHERE id = ?
        LIMIT 1
    `).get(quoteId);

    if (!quote) {
        return res.json({
            success: false,
            message: 'Quote not found'
        });
    }

    return res.json({
        success: true,
        data: quote
    });
});

/**
 * =========================
 * ОБНОВЛЕНИЕ ОДНОЙ ЦИТАТЫ
 * =========================
 * PUT /api/quotes/:id
 */
router.put('/:id', auth, requireRole('editor'), async (req, res, next) => {
    try {
        const quoteId = Number(req.params.id);
        const quote = req.body;

        const {
            author_en,
            author_ru,
            text_en,
            text_ru,
            source_en = null,
            source_ru = null,
            robert_comment_en = null,
            robert_comment_ru = null,
        } = quote;

        /**
         * =========================
         * ВАЛИДАЦИЯ
         * =========================
         */
        if (!author_en || !author_ru || !text_en || !text_ru) {
            return res.json({
                success: false,
                message: 'author_en, author_ru, text_en, text_ru are required'
            });
        }

        /**
         * =========================
         * ПРОВЕРКА СУЩЕСТВОВАНИЯ
         * =========================
         */
        const exists = db
            .prepare('SELECT id FROM quotes WHERE id = ?')
            .get(quoteId);

        if (!exists) {
            return res.json({
                success: false,
                message: 'Quote not found'
            });
        }

        /**
         * =========================
         * EMBEDDINGS
         * =========================
         */
        const [embeddingRu, embeddingEn] = await Promise.all([
            buildEmbeddingsBatchRu([quote]),
            buildEmbeddingsBatchEn([quote]),
        ]);

        /**
         * =========================
         * ОБНОВЛЕНИЕ
         * =========================
         */
        db.prepare(`
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
        `).run({
            id: quoteId,
            author_en,
            author_ru,
            text_en,
            text_ru,
            source_en,
            source_ru,
            robert_comment_en,
            robert_comment_ru,
            embedding_en_blob: floatArrayToBuffer(embeddingEn[0]),
            embedding_ru_blob: floatArrayToBuffer(embeddingRu[0]),
        });

        resetQuotesEmbeddingsCache();

        return res.json({
            success: true,
            message: 'Quote updated'
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
router.delete('/:id', auth, requireRole('editor'), (req, res) => {
    const { id } = req.params;
    const quoteId = Number(id);

    const exists = db
        .prepare('SELECT id FROM quotes WHERE id = ?')
        .get(quoteId);

    if (!exists) return res.json({success: false});

    db.prepare('DELETE FROM quotes WHERE id = ?').run(quoteId);

    resetQuotesEmbeddingsCache();

    return res.json({success: true});
});

/**
 * =========================
 * МАССОВАЯ ЗАГРУЗКА ЦИТАТ
 * =========================
 * POST /api/quotes/bulk
 */
router.post('/bulk', auth, requireRole('editor'), async (req, res, next) => {
    try {
        const { quotes } = req.body;

        if (!Array.isArray(quotes)) {
            return res.json({
                success: false,
                message: 'Array of quotes expected'
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
                    message: 'author_en, author_ru, text_en, text_ru are required'
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
                message: 'No new quotes',
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
            message: `Added: ${addedCount}, skipped: ${skippedCount}`
        });

    } catch (err) {
        next(err);
    }

});

/**
 * =========================
 * ПОИСК ДУБЛИКАТОВ ЦИТАТ
 * =========================
 * POST /api/quotes/duplicates
 */
router.post(
    '/duplicates',
    auth,
    requireRole('editor'),
    async (req, res, next) => {
        try {
            const items = await getQuotesWithEmbeddings();

            const visited = new Set();
            const groups = [];

            for (let i = 0; i < items.length; i++) {
                const a = items[i];
                if (visited.has(a.id)) continue;

                visited.add(a.id);

                const group = [a];

                for (let j = i + 1; j < items.length; j++) {
                    const b = items[j];

                    if (visited.has(b.id)) continue;

                    if (Math.abs(a.text_en.length - b.text_en.length) > 25) continue;

                    const score = cosineSimilarity(
                        a.embedding_en,
                        b.embedding_en
                    );

                    if (score >= 0.9) {
                        group.push(b);
                        visited.add(b.id);
                    }
                }

                if (group.length > 1) {
                    visited.add(a.id);

                    group.forEach((q) => {
                        groups.push({
                            id: q.id,
                            author_en: q.author_en,
                            author_ru: q.author_ru,
                            text_en: q.text_en,
                            text_ru: q.text_ru,
                            source_en: q.source_en,
                            source_ru: q.source_ru,
                            robert_comment_en: q.robert_comment_en,
                            robert_comment_ru: q.robert_comment_ru,
                            created_at: formatSqliteDate()
                        })
                    })
                }
            }

            return res.json({
                success: true,
                count: groups.length,
                data: groups,
            });

        } catch (err) {
            next(err);
        }
    }
);

module.exports = router;