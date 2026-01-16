const {openaiChatGPT} = require("./openaiClients");

async function embedString(queryEn) {
    const response = await openaiChatGPT.embeddings.create({
        model: 'text-embedding-3-small',
        input: queryEn
    });

    return response.data[0].embedding;
}

module.exports = embedString;