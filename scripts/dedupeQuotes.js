/**
 * Скрипт удаления дубликатов цитат по embedding similarity
 *
 * Правило:
 * - если cosineSimilarity >= THRESHOLD
 * - считаем цитаты дубликатами
 * - оставляем цитату с максимальным id
 * - удаляем все остальные
 *
 * Запуск:
 * node scripts/dedupeQuotes.js
 */

const db = require('./db');
const { getQuotesWithEmbeddings, resetQuotesEmbeddingsCache } = require('./quotesWithEmbeddingsCache');
const cosineSimilarity = require('./cosineSimilarity');

const THRESHOLD = 0.9; // как в /duplicates
const LENGTH_DIFF_LIMIT = 25;

async function run() {
    console.log('▶ Loading quotes with embeddings...');
    const quotes = await getQuotesWithEmbeddings();

    console.log(`▶ Loaded ${quotes.length} quotes`);

    const visited = new Set();
    const idsToDelete = new Set();

    for (let i = 0; i < quotes.length; i++) {
        const a = quotes[i];
        if (visited.has(a.id)) continue;

        const group = [a];
        visited.add(a.id);

        for (let j = i + 1; j < quotes.length; j++) {
            const b = quotes[j];
            if (visited.has(b.id)) continue;

            // Быстрый отсев по длине
            if (Math.abs(a.text_en.length - b.text_en.length) > LENGTH_DIFF_LIMIT) {
                continue;
            }

            const score = cosineSimilarity(
                a.embedding_en,
                b.embedding_en
            );

            if (score >= THRESHOLD) {
                group.push(b);
                visited.add(b.id);
            }
        }

        if (group.length > 1) {
            // оставляем цитату с максимальным id
            group.sort((x, y) => y.id - x.id);

            const keeper = group[0];
            const duplicates = group.slice(1);

            duplicates.forEach(q => idsToDelete.add(q.id));

            console.log(
                `⚠ Duplicate group: keep id=${keeper.id}, remove [${duplicates.map(d => d.id).join(', ')}]`
            );
        }
    }

    if (!idsToDelete.size) {
        console.log('✔ No duplicates found');
        return;
    }

    console.log(`▶ Deleting ${idsToDelete.size} quotes...`);

    const deleteStmt = db.prepare(
        'DELETE FROM quotes WHERE id = ?'
    );

    const deleteMany = db.transaction((ids) => {
        ids.forEach(id => deleteStmt.run(id));
    });

    deleteMany([...idsToDelete]);

    resetQuotesEmbeddingsCache();

    console.log('✔ Done. Cache reset.');
}

run().catch(err => {
    console.error('✖ Error during deduplication');
    console.error(err);
    process.exit(1);
});
