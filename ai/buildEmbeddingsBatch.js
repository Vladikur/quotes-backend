const {openaiChatGPT} = require("./openaiClients");

function normalizeText(text) {
    if (!text) return '';
    return text
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function buildEmbeddingsBatchRu(quotes) {
    const inputs = quotes.map(q =>
        `Автор: ${normalizeText(q.author_ru)}. ` +
        `Цитата: ${normalizeText(q.text_ru)}. ` +
        (q.source_ru ? `Источник: ${normalizeText(q.source_ru)}. ` : '') +
        (q.robert_comment_ru ? `Комментарий Роберта: ${normalizeText(q.robert_comment_ru)}.` : '')
    );

    const response = await openaiChatGPT.embeddings.create({
        model: 'text-embedding-3-small',
        input: inputs
    });

    return response.data.map(d => d.embedding);
}

async function buildEmbeddingsBatchEn(quotes) {
    const inputs = quotes.map(q =>
        `Author: ${normalizeText(q.author_en)}. ` +
        `Quote: ${normalizeText(q.text_en)}. ` +
        (q.source_en ? `Source: ${normalizeText(q.source_en)}. ` : '') +
        (q.robert_comment_en ? `Robert comment: ${normalizeText(q.robert_comment_en)}.` : '')
    );

    const response = await openaiChatGPT.embeddings.create({
        model: 'text-embedding-3-small',
        input: inputs
    });

    return response.data.map(d => d.embedding);
}

module.exports = {
    buildEmbeddingsBatchRu,
    buildEmbeddingsBatchEn
};
