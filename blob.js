const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'quotes.db');

console.log('Opening database:', DB_PATH);

const db = new Database(DB_PATH);

console.log('Running VACUUM...');
db.exec('VACUUM;');

console.log('✓ VACUUM completed');
db.close();