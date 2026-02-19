/**
 * Удаление всех цитат с author_en = 'Aphorism'
 *
 * Запуск:
 * node scripts/deleteAphorisms.js
 */

const db = require('./db');
const { resetQuotesEmbeddingsCache } = require('./quotesWithEmbeddingsCache');

function run() {
    console.log('▶ Searching quotes with author_en = "Aphorism"...');

    const rows = db.prepare(`
        SELECT id
        FROM quotes
        WHERE author_en = ?
    `).all('Aphorism');

    if (!rows.length) {
        console.log('✔ No quotes found');
        return;
    }

    console.log(`⚠ Found ${rows.length} quotes. Deleting...`);

    const deleteStmt = db.prepare(`
        DELETE FROM quotes
        WHERE id = ?
    `);

    const deleteMany = db.transaction((ids) => {
        ids.forEach(({ id }) => deleteStmt.run(id));
    });

    deleteMany(rows);

    resetQuotesEmbeddingsCache();

    console.log(`✔ Deleted ${rows.length} quotes. Cache reset.`);
}

try {
    run();
} catch (err) {
    console.error('✖ Error while deleting aphorisms');
    console.error(err);
    process.exit(1);
}
