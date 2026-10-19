if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ override: true });
}

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
    const mongoUri = process.env.MONGODB_URI || (process.env.NODE_ENV === 'production' ? '' : development.MONG_URI);
    if (!mongoUri) throw new Error('MONGODB_URI is required in production.');
    await mongoose.connect(mongoUri, {
        dbName: process.env.MONGODB_DB || 'Carryva',
    });

    await promoteOwner(email);
    console.log('Owner access configured for the requested Carryva account.');
}

if (require.main === module) {
    main()
        .catch((error) => {
            if (error.name === 'Error') console.error(error.message);
            else console.error('Owner promotion failed.', {
                name: error.name || 'Error',
                ...(Number.isInteger(error.code) ? { code: error.code } : {}),
            });
            process.exitCode = 1;
        })
        .finally(async () => {
            if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
        });
}

module.exports = { promoteOwner };
