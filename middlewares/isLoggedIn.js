const jwt = require('jsonwebtoken');
const userModel = require('../models/user-model');
const safeReturnPath = require('../utils/safeReturnPath');
const {
    JWT_KEY,
    JWT_ISSUER,
    JWT_AUDIENCE,
    AUTH_COOKIE_NAME,
    AUTH_COOKIE_OPTIONS,
} = require('../config/keys');

const clearAuthCookie = (res) => {
    const { maxAge, ...options } = AUTH_COOKIE_OPTIONS;
    res.clearCookie(AUTH_COOKIE_NAME, options);
};

function redirectToLogin(req, res, message) {
    req.flash('error', message);
    if (!req.loginReturnTo) return res.redirect('/');
    const returnTo = safeReturnPath(req.loginReturnTo, '/cart');
    return res.redirect(`/?returnTo=${encodeURIComponent(returnTo)}`);
}

module.exports = async function isLoggedIn(req, res, next) {
    const token = req.cookies && req.cookies[AUTH_COOKIE_NAME];
    if (!token) {
        return redirectToLogin(req, res, 'You need to log in first.');
    }

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_KEY, {
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            algorithms: ['HS256'],
        });
    } catch (error) {
        clearAuthCookie(res);
        return redirectToLogin(req, res, 'Your login has expired. Please log in again.');
    }

    if (!decoded.sub || !decoded.email) {
        clearAuthCookie(res);
        return redirectToLogin(req, res, 'Please log in again.');
    }

    try {
        const user = await userModel
            .findOne({ _id: decoded.sub, email: decoded.email })
            .select('-password +authVersion');
        if (!user) {
            clearAuthCookie(res);
            return redirectToLogin(req, res, 'Please log in again.');
        }

        if ((decoded.ver ?? 0) !== (Number(user.authVersion) || 0)) {
            clearAuthCookie(res);
            return redirectToLogin(req, res, 'Your login has expired. Please log in again.');
        }

        req.user = user;
        return next();
    } catch (error) {
        return next(error);
    }
};
