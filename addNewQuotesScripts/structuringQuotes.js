const db = require('../scripts/db');
const fs = require('fs');
const path = require('path');
const { openaiDeepSeek } = require('../ai/openaiClients');

const newQuotes = `


`

const structureExample = [
    {
        author_en: 'Socrates',
        author_ru: 'Сократ',
        text_en: 'Those who have sufficiently purified themselves with philosophy live without the body, in mansions fairer than these.',
        text_ru: 'Те, кто достаточно очистился философией, живут вне тела, в обителях прекраснее этих.',
        source_en: 'In Plato’s Phaedo',
        source_ru: 'В «Федоне» Платона',
        dates_of_life_en: '470 — 399 BC',
        dates_of_life_ru: '470 — 399 гг. до н.э.',
        robert_comment_en: null,
        robert_comment_ru: null,
        embedding_en: null,
    },
]

function generateAuthors() {
    const authors = db.prepare(`
        SELECT DISTINCT author_en, author_ru
        FROM quotes
        ORDER BY author_en ASC
    `).all();

    return authors
        .map(a => `${a.author_en} / ${a.author_ru}`)
        .join(' ');
}

async function structureQuotes(authors) {
    const completion = await openaiDeepSeek.chat.completions.create({
        model: "deepseek-chat",
        messages: [{
            role: 'system',
            content: `
                Ты — JS-парсер.
                ТВОЙ ОТВЕТ ДОЛЖЕН БЫТЬ СТРОГО JS МАССИВОМ.
                НЕ КОММЕНТИРУЙ.
                Требования:
                    - Верни ТОЛЬКО массив объектов по шаблону
                    - Цитаты не редактировать
                    - Переносы строк заменять на \\n
                    - Цифры в скобках удалить
                    - Robert = Robert Burton
                    - Цитаты без автора → Robert Burton
                    - Источники без автора → author_en / author_ru
                    - Египетские тексты:
                      author_en: "Egyptian Texts"
                      author_ru: "Египетские тексты"
                      source = то, что указано как автор
                Шаблон: ${structureExample}
                Авторы: ${authors}
                Цитаты: ${newQuotes}
            `
        }],
    });

    const raw = completion.choices[0].message.content.trim();

    return raw;
}

async function saveQuotesToFile(quotes) {
    const outputPath = path.join(__dirname, 'newQuotes.js')

    const fileContent =
        `// ⚠️ Файл сгенерирован автоматически
        // Не редактировать вручную
        module.exports = ${quotes}};
    `;

    fs.writeFileSync(outputPath, fileContent, 'utf8');
    console.log(`✅ Файл создан: ${outputPath}`);
}

(async () => {
    const authors = generateAuthors();
    const structuredQuotes = await structureQuotes(authors);
    await saveQuotesToFile(structuredQuotes);
})();