const { randomUUID } = require('crypto');

const store = new Map();

const TTL = 1000 * 60 * 10; // 10 минут

function createSearch(data) {
    const id = randomUUID();

    store.set(id, {
        createdAt: Date.now(),
        data
    });

    return id;
}

function getSearch(id) {
    const entry = store.get(id);
    if (!entry) return null;

    if (Date.now() - entry.createdAt > TTL) {
        store.delete(id);
        return null;
    }

    return entry.data;
}

module.exports = {
    createSearch,
    getSearch
};