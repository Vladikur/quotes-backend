const Database = require('better-sqlite3');

const db = new Database('quotes.db');

module.exports = db;