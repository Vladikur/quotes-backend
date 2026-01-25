function formatSqliteDate(date = new Date()) {
    return date.toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z$/, '');
}

module.exports = formatSqliteDate;