module.exports = function normalizeSearchString(str) {
    if (!str) return '';

    return str
        .toLowerCase()
        .normalize('NFKD')              // ё → е + диакритика
        .replace(/[\u0300-\u036f]/g, '') // убрать диакритику
        .replace(/[^a-zа-я0-9\s]/gi, ' ') // убрать пунктуацию
        .replace(/\s+/g, ' ')
        .trim();
};