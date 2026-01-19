const OpenAI = require('openai');
require('dotenv').config();
const { HttpsProxyAgent } = require('https-proxy-agent');

const proxyAgent = new HttpsProxyAgent(
    process.env.PROXY
);

const openaiChatGPT = new OpenAI({
    apiKey: process.env.CHAT_GPT_API_KEY,
    httpAgent: proxyAgent,
});

const openaiDeepSeek = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
});

module.exports = {
    openaiChatGPT,
    openaiDeepSeek,
};