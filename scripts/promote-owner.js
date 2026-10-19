require('dotenv').config({ override: process.env.NODE_ENV !== 'production' });

const mongoose = require('mongoose');
const User = require('../models/user-model');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function promoteOwner(inputEmail) {
    const email = typeof inputEmail === 'string' ? inputEmail.trim().toLowerCase() : '';
    if (!emailPattern.test(email)) {
        throw new Error('Enter a valid account email address.');
    }

    const result = await User.updateOne({ email }, { $set: { role: 'owner' } }, { runValidators: true });
    if (!result.matchedCount) throw new Error('No Carryva account exists with that email. Register the account first.');
    return result;
}

async function main() {
    const email = process.argv[2];
    if (!email) throw new Error('Usage: npm run owner:promote -- user@example.com');
    const development = require('../config/development.json');
    await mongoose.connect(process.env.MONGODB_URI || development.MONG_URI, {
        dbName: process.env.MONGODB_DB || 'carryva',
    });

    await promoteOwner(email);
    console.log('Owner access configured for the requested Carryva account.');
}

if (require.main === module) {
    main()
        .catch((error) => {
            console.error(error.message);
            process.exitCode = 1;
        })
        .finally(async () => {
            if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
        });
}

module.exports = { promoteOwner };
