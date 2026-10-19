const jwt = require('jsonwebtoken');
const userModel = require('../models/user-model');
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

module.exports = async function isLoggedIn(req, res, next) {
    const token = req.cookies && req.cookies[AUTH_COOKIE_NAME];
    if (!token) {
        req.flash('error', 'You need to log in first.');
        return res.redirect('/');
    }

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_KEY, {
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
        });
    } catch (error) {
        clearAuthCookie(res);
        req.flash('error', 'Your login has expired. Please log in again.');
        return res.redirect('/');
    }

    if (!decoded.sub || !decoded.email) {
        clearAuthCookie(res);
        req.flash('error', 'Please log in again.');
        return res.redirect('/');
    }

    try {
        const user = await userModel
            .findOne({ _id: decoded.sub, email: decoded.email })
            .select('-password');
        if (!user) {
            clearAuthCookie(res);
            req.flash('error', 'Please log in again.');
            return res.redirect('/');
        }

        req.user = user;
        return next();
    } catch (error) {
        return next(error);
    }
};
