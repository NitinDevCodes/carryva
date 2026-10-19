function isApplicationReady(connection) {
    return Boolean(connection && connection.readyState === 1 && connection.db && connection.supportsTransactions === true);
}

module.exports = { isApplicationReady };
