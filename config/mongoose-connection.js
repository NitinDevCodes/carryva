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
    .connect(getMongoUri(), { dbName: process.env.MONGODB_DB || 'carryva' })
    .then(() => {
        dbgr('Connected to MongoDB');
    })
    .catch((err) => {
        console.error('MongoDB connection failed:', err.message);
    });

module.exports = mongoose.connection;
