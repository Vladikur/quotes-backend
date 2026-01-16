const OpenAI = require('openai');
require('dotenv').config();

const openaiChatGPT = new OpenAI({
    apiKey: process.env.CHAT_GPT_API_KEY,
});

const openaiDeepSeek = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
});

module.exports = {
    openaiChatGPT,
    openaiDeepSeek,
};