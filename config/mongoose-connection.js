const mongoose = require('mongoose');
const dbgr = require('debug')('development:mongoose');

function getMongoUri() {
    if (process.env.MONGODB_URI) return process.env.MONGODB_URI;

    if (process.env.NODE_ENV === 'production') {
        throw new Error('MONGODB_URI is required in production.');
    }

    return 'mongodb://127.0.0.1:27017';
}

const connection = mongoose.connection;
const ready = mongoose
    // Keep the existing local database name; production must provide both URI
    // and database name through deployment configuration.
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
