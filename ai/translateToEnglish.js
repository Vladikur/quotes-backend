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
                    
                    Context:
                    - Translate texts in the philosophical and psychological context of the Fourth Way (Gurdjieff / Ouspensky tradition).
                    - Prefer established English terminology used in Fourth Way literature.
                    
                    Glossary (strict):
                    - "Управляющий" → "Steward"
                    - "Четвёртый путь" → "Fourth Way"
                    - "Самовоспоминание" → "Selfremembering"
                    - "Сущность" → "Essence"
                    - "Личность" → "Personality"
                    - "Девятка червей" → "nine of hearts"
                    
                    Rules:
                    - ONLY translate the text to English
                    - Use the glossary terms exactly as specified when applicable
                    - Preserve meaning and conceptual nuance of the Fourth Way
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