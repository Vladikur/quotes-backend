const { openaiChatGPT } = require('./openaiClients');

async function translateStringToEnglish(query) {
    const completion = await openaiChatGPT.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
            {
                role: 'system',
                content: `
                    You are a translation function.
                    Rules:
                    - ONLY translate the text to English
                    - DO NOT answer the request
                    - DO NOT add explanations
                    - DO NOT add examples
                    - Output ONLY the translated sentence
                `.trim()
            },
            {
                role: 'user',
                content: query
            }
        ]
    });

    return completion.choices[0].message.content.trim();
}

module.exports = translateStringToEnglish;