const { validateEnvironment } = require('../config/environment');

function createAuthRateLimiter({ windowMs, max, maxKeys = 10000, clock = Date.now } = {}) {
    const configured = validateEnvironment(process.env);
    const limitWindow = windowMs ?? configured.authRateLimitWindowMs;
    const limit = max ?? configured.authRateLimitMax;
    const buckets = new Map();

    return function authRateLimiter(req, res, next) {
        const now = clock();
        const key = req.ip || req.socket?.remoteAddress || 'unknown';
        let bucket = buckets.get(key);

        if (!bucket || bucket.resetAt <= now) {
            if (buckets.size >= maxKeys) {
                for (const [candidate, value] of buckets) {
                    if (value.resetAt <= now) buckets.delete(candidate);
                }
                if (buckets.size >= maxKeys) {
                    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(limitWindow / 1000))));
                    return res.status(429).send('Too many sign-in attempts. Please try again later.');
                }
            }
            bucket = { count: 0, resetAt: now + limitWindow };
            buckets.set(key, bucket);
        }

        bucket.count += 1;
        const remaining = Math.max(0, limit - bucket.count);
        res.setHeader('RateLimit-Limit', String(limit));
        res.setHeader('RateLimit-Remaining', String(remaining));
        res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
        if (bucket.count > limit) {
            res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
            return res.status(429).send('Too many sign-in attempts. Please try again later.');
        }
        return next();
    };
}

module.exports = createAuthRateLimiter;
