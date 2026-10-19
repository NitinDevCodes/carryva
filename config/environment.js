const DEFAULT_AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_AUTH_RATE_LIMIT_MAX = 10;

function integerSetting(env, name, fallback, min, max) {
    if (env[name] === undefined || env[name] === '') return fallback;
    const value = Number(env[name]);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
    }
    return value;
}

function validMongoUri(value) {
    if (typeof value !== 'string' || !/^mongodb(?:\+srv)?:\/\//i.test(value)) return false;
    try {
        const parsed = new URL(value);
        return Boolean(parsed.hostname) && ['mongodb:', 'mongodb+srv:'].includes(parsed.protocol);
    } catch (_) {
        return false;
    }
}

function validateEnvironment(env = process.env) {
    integerSetting(env, 'PORT', 3000, 1, 65535);
    integerSetting(env, 'AUTH_RATE_LIMIT_WINDOW_MS', DEFAULT_AUTH_RATE_LIMIT_WINDOW_MS, 1000, 86400000);
    integerSetting(env, 'AUTH_RATE_LIMIT_MAX', DEFAULT_AUTH_RATE_LIMIT_MAX, 1, 1000);

    if (env.TRUST_PROXY_HOPS !== undefined && env.TRUST_PROXY_HOPS !== '') {
        integerSetting(env, 'TRUST_PROXY_HOPS', 1, 1, 10);
    }
    if (env.MONGODB_URI && !validMongoUri(env.MONGODB_URI)) {
        throw new Error('MONGODB_URI must be a valid mongodb:// or mongodb+srv:// connection string.');
    }
    if (env.MONGODB_DB && !/^[A-Za-z0-9_-]{1,63}$/.test(env.MONGODB_DB)) {
        throw new Error('MONGODB_DB must contain 1 to 63 letters, numbers, underscores, or hyphens.');
    }

    if (env.NODE_ENV === 'production') {
        if (!env.MONGODB_URI) {
            throw new Error('MONGODB_URI is required in production.');
        }
        for (const [name, value] of [
            ['JWT_KEY', env.JWT_KEY],
            ['EXPRESS_SESSION_SECRET', env.EXPRESS_SESSION_SECRET],
        ]) {
            if (typeof value !== 'string' || Buffer.byteLength(value) < 32 || /^(replace-with|change-me|your[-_])/i.test(value)) {
                throw new Error(`${name} must be a unique secret containing at least 32 bytes.`);
            }
        }
        if (env.JWT_KEY === env.EXPRESS_SESSION_SECRET) {
            throw new Error('JWT_KEY and EXPRESS_SESSION_SECRET must be different secrets.');
        }
    }

    return {
        port: integerSetting(env, 'PORT', 3000, 1, 65535),
        authRateLimitWindowMs: integerSetting(env, 'AUTH_RATE_LIMIT_WINDOW_MS', DEFAULT_AUTH_RATE_LIMIT_WINDOW_MS, 1000, 86400000),
        authRateLimitMax: integerSetting(env, 'AUTH_RATE_LIMIT_MAX', DEFAULT_AUTH_RATE_LIMIT_MAX, 1, 1000),
    };
}

module.exports = {
    validateEnvironment,
    validMongoUri,
    DEFAULT_AUTH_RATE_LIMIT_WINDOW_MS,
    DEFAULT_AUTH_RATE_LIMIT_MAX,
};
