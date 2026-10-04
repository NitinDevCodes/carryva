const mongoose = require('mongoose');
const config = require("config");
const dbgr = require('debug')('development:mongoose');

mongoose
    .connect(`${config.get("MONG_URI")}/carryva`)
    .then(() => {
        dbgr('Connected to MongoDB');
    })
    .catch((err) => {
        dbgr('Error connecting to MongoDB:', err);
    });

module.exports = mongoose.connection;