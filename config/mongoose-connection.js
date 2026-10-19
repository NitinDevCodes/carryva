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

mongoose
    // The existing Windows MongoDB database was created as `Carryva`. MongoDB
    // treats database names case-insensitively on Windows and rejects creating
    // `carryva` beside it with server error 13297. Keep an explicit override
    // available for other environments, and match the existing local DB.
    .connect(getMongoUri(), { dbName: process.env.MONGODB_DB || 'Carryva' })
    .then(() => {
        dbgr('Connected to MongoDB');
    })
    .catch((err) => {
        console.error('MongoDB connection failed:', err.message);
    });

module.exports = mongoose.connection;
