const db = require('./db');
const bufferToFloatArray = require('./bufferToFloatArray');

let cache = {
    quotes: null,     // null = ещё не загружено
    loading: null,
};

function resetQuotesEmbeddingsCache() {
    cache.quotes = null;
    cache.loading = null;
}

function loadQuotesWithEmbeddings() {
    return db.prepare(`
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
            created_at,
            embedding_en_blob,
            embedding_ru_blob
        FROM quotes
        WHERE embedding_en_blob IS NOT NULL
           OR embedding_ru_blob IS NOT NULL
    `).all();
}

async function getQuotesWithEmbeddings() {
    // Уже загружено
    if (cache.quotes) {
        return cache.quotes;
    }

    // Уже идёт загрузка
    if (cache.loading) {
        return cache.loading;
    }

    cache.loading = Promise.resolve().then(() => {
        const rows = loadQuotesWithEmbeddings();

        cache.quotes = rows.map(q => ({
            ...q,
            embedding_en: q.embedding_en_blob
                ? bufferToFloatArray(q.embedding_en_blob)
                : null,
            embedding_ru: q.embedding_ru_blob
                ? bufferToFloatArray(q.embedding_ru_blob)
                : null,
        }));

        cache.loading = null;
        return cache.quotes;
    });

    return cache.loading;
}

module.exports = {
    getQuotesWithEmbeddings,
    resetQuotesEmbeddingsCache,
};
