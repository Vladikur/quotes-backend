const { openaiChatGPT } = require('../ai/openaiClients');
const db = require('../scripts/db');

function normalizeText(text) {
    if (!text) return '';
    return text
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// 1. Берём цитаты без эмбеддингов
function getQuotesWithoutEmbeddings(limit = 100) {
    return db.prepare(`
        SELECT id, author_en, text_en, source_en, robert_comment_en
        FROM quotes
        WHERE embedding_en IS NULL
        LIMIT ?
    `).all(limit);
}

// 2. Батч-генерация
async function buildEmbeddingsBatch(quotes) {
    const inputs = quotes.map(q =>
        `Author: ${normalizeText(q.author_en)}. ` +
        `Quote: ${normalizeText(q.text_en)}. ` +
        (q.source_en ? `Source: ${normalizeText(q.source_en)}. ` : '') +
        (q.robert_comment_en ? `Robert comment (interpretation): ${normalizeText(q.robert_comment_en)}.` : '')
    );

    const response = await openaiChatGPT.embeddings.create({
        model: 'text-embedding-3-small',
        input: inputs
    });

    return response.data.map(d => d.embedding);
}

// 3. Основной цикл
async function run() {
    const BATCH_SIZE = 50;

    while (true) {
        const quotes = getQuotesWithoutEmbeddings(BATCH_SIZE);

        if (quotes.length === 0) {
            console.log('✓ All embeddings are built');
            break;
        }

        try {
            const embeddings = await buildEmbeddingsBatch(quotes);

            const update = db.prepare(`
                UPDATE quotes
                SET embedding_en = ?
                WHERE id = ?
            `);

            const tx = db.transaction(() => {
                quotes.forEach((q, i) => {
                    update.run(
                        JSON.stringify(embeddings[i]),
                        q.id
                    );
                });
            });

            tx();

            console.log(`✓ Embedded batch of ${quotes.length}`);
        } catch (err) {
            console.error('✗ Batch failed:', err.message);
            break;
        }
    }

    console.log('Done');
}

run();