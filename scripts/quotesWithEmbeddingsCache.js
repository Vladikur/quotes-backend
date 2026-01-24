const db = require('./db');

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 час

let cache = {
    quotes: [],
    expiresAt: 0,
    loading: null,
};

function resetQuotesEmbeddingsCache() {
    cache = {
        quotes: [],
        expiresAt: 0,
        loading: null,
    };
}

function loadQuotesWithEmbeddings() {
    return db.prepare(`
        SELECT *
        FROM quotes
        WHERE embedding_en IS NOT NULL
    `).all();
}

async function getQuotesWithEmbeddings() {
    const now = Date.now();

    // cache ещё валиден
    if (cache.quotes.length && now < cache.expiresAt) {
        return cache.quotes;
    }

    // защита от одновременной перезагрузки
    if (cache.loading) {
        return cache.loading;
    }

    cache.loading = Promise.resolve().then(() => {
        const quotes = loadQuotesWithEmbeddings();

        cache.quotes = quotes;
        cache.expiresAt = Date.now() + CACHE_TTL_MS;
        cache.loading = null;

        return quotes;
    });

    return cache.loading;
}

module.exports = {
    getQuotesWithEmbeddings,
    resetQuotesEmbeddingsCache,
};