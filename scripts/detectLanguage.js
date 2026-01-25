function detectLanguage(text) {
    if (!text) return 'en';

    // если есть кириллица — считаем русским
    if (/[а-яё]/i.test(text)) {
        return 'ru';
    }

    return 'en';
}

module.exports = detectLanguage;