const mongoose = require('mongoose');
const dbgr = require('debug')('development:mongoose');
const fs = require('fs');
const path = require('path');

function getMongoUri() {
    if (process.env.MONGODB_URI) return process.env.MONGODB_URI;

    const configPath = path.join(__dirname, 'development.json');
    if (fs.existsSync(configPath)) {
        const development = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (development.MONG_URI) return development.MONG_URI;
    }

    return 'mongodb://127.0.0.1:27017';
}

const connection = mongoose.connection;
const ready = mongoose
    // Keep the existing local database name; production deployments should set
    // MONGODB_DB explicitly alongside their connection URI.
    .connect(getMongoUri(), { dbName: process.env.MONGODB_DB || 'Carryva' })
    .then(async () => {
        dbgr('Connected to MongoDB');
        const hello = await connection.db.admin().command({ hello: 1 });
        connection.supportsTransactions = Boolean(hello.setName || hello.msg === 'isdbgrid');
        if (!connection.supportsTransactions) {
            console.warn('MongoDB is running standalone. Checkout and order cancellation require a replica set or MongoDB Atlas.');
        }
        return connection;
    })
    .catch((error) => {
        console.error('MongoDB connection failed.', {
            name: error.name || 'Error',
            ...(Number.isInteger(error.code) ? { code: error.code } : {}),
        });
        throw error;
    });

// Startup awaits the rejected promise. This attached handler prevents an
// unhandled rejection in tests that wait directly on Mongoose's connection.
ready.catch(() => {});
connection.ready = ready;

module.exports = connection;
