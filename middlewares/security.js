const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function setSecurityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "img-src 'self' data:",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self'",
    ].join('; '));
    if (process.env.NODE_ENV === 'production' && req.secure) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return next();
}

function sameOriginWrites(req, res, next) {
    if (!unsafeMethods.has(req.method)) return next();

    const origin = req.get('origin');
    if (origin) {
        try {
            const expected = new URL(`${req.protocol}://${req.get('host')}`).origin;
            if (new URL(origin).origin !== expected) return res.status(403).send('This request was rejected. Refresh the page and try again.');
        } catch (_) {
            return res.status(403).send('This request was rejected. Refresh the page and try again.');
        }
    } else if (req.get('sec-fetch-site') === 'cross-site') {
        return res.status(403).send('This request was rejected. Refresh the page and try again.');
    }
    return next();
}

module.exports = { setSecurityHeaders, sameOriginWrites };
