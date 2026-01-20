const fs = require('fs');
const path = require('path');
const db = require('../scripts/db');

const quotes = [

]

// --------------------
// Utils
// --------------------

function getFirstWords(text, count = 5) {
    if (!text) return '';
    return text
        .trim()
        .split(/\s+/)
        .slice(0, count)
        .join(' ')
        .toLowerCase();
}

// --------------------
// Читаем существующие цитаты из БД
// --------------------

function getExistingQuotes() {
    return db.prepare(`
        SELECT id, text_en
        FROM quotes
    `).all();
}

// --------------------
// Проверка дубликатов
// --------------------

function filterNewQuotes(existingQuotes, quotesNew) {
    const existingKeys = new Set(
        existingQuotes.map(q => getFirstWords(q.text_en))
    );

    const duplicates = [];
    const uniqueQuotes = [];

    for (const quote of quotesNew) {
        const key = getFirstWords(quote.text_en);

        if (existingKeys.has(key)) {
            duplicates.push({
                author: quote.author_en,
                preview: key
            });
        } else {
            uniqueQuotes.push(quote);
        }
    }

    if (duplicates.length > 0) {
        console.error('✗ Найдены дубликаты цитат:');
        duplicates.forEach(d => {
            console.error(`  - ${d.author}: "${d.preview}..."`);
        });
    } else {
        console.log('✓ Дубликатов не найдено');
    }

    return uniqueQuotes;
}

// --------------------
// Импорт только новых цитат
// --------------------

function importQuotes(quotes) {
    if (quotes.length === 0) {
        console.log('ℹ Нет новых цитат для импорта');
        return;
    }

    const insert = db.prepare(`
        INSERT INTO quotes (
            author_en, author_ru, text_en, text_ru,
            source_en, source_ru,
            dates_of_life_en, dates_of_life_ru,
            robert_comment_en, robert_comment_ru,
            embedding_en
        ) VALUES (
            @author_en, @author_ru, @text_en, @text_ru,
            @source_en, @source_ru,
            @dates_of_life_en, @dates_of_life_ru,
            @robert_comment_en, @robert_comment_ru,
            NULL
        )
    `);

    const tx = db.transaction(() => {
        quotes.forEach(q => insert.run(q));
    });

    tx();

    console.log(`✓ Добавлено новых цитат: ${quotes.length}`);
}

// --------------------
// Генерация authors.txt из БД
// --------------------

// function generateAuthorsFile(fileName = 'authors.txt') {
//     const authors = db.prepare(`
//         SELECT DISTINCT author_en, author_ru
//         FROM quotes
//         ORDER BY author_en ASC
//     `).all();
//
//     const content = authors
//         .map(a => `${a.author_en} / ${a.author_ru}`)
//         .join('\n');
//
//     fs.writeFileSync(
//         path.join(__dirname, fileName),
//         content,
//         'utf8'
//     );
// }

// --------------------
// Запуск
// --------------------

const existingQuotes = getExistingQuotes();
const quotesToInsert = filterNewQuotes(existingQuotes, quotes);

importQuotes(quotesToInsert);
// generateAuthorsFile();