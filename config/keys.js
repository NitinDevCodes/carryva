require('dotenv').config({ override: process.env.NODE_ENV !== 'production' });

const JWT_KEY = process.env.JWT_KEY;
const SESSION_SECRET = process.env.EXPRESS_SESSION_SECRET;

if (!JWT_KEY || Buffer.byteLength(JWT_KEY) < 32) {
    const length = Buffer.byteLength(JWT_KEY || '');
    throw new Error(`JWT_KEY must be configured with at least 32 characters (received ${length} bytes).`);
}

if (!SESSION_SECRET || Buffer.byteLength(SESSION_SECRET) < 32) {
    throw new Error('EXPRESS_SESSION_SECRET must be configured with at least 32 characters.');
}

module.exports = {
    JWT_KEY,
    SESSION_SECRET,
    JWT_ISSUER: 'carryva',
    JWT_AUDIENCE: 'carryva-users',
    TOKEN_TTL_SECONDS: 24 * 60 * 60,
    AUTH_COOKIE_NAME: 'token',
    AUTH_COOKIE_OPTIONS: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000,
    },
};
