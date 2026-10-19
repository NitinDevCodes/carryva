const userModel = require('../models/user-model');
const bcrypt = require('bcrypt');
const { generateToken } = require('../utils/generateToken');
const {
    AUTH_COOKIE_NAME,
    AUTH_COOKIE_OPTIONS,
} = require('../config/keys');
const safeReturnPath = require('../utils/safeReturnPath');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordMinLength = 8;
const passwordMaxBytes = 72;

function validEmail(value) {
    return typeof value === 'string' && value.length <= 254 && emailPattern.test(value.trim());
}

function authCookieClearOptions() {
    const { maxAge, ...options } = AUTH_COOKIE_OPTIONS;
    return options;
}

function logAuthFailure(operation, error) {
    const details = { name: error && error.name ? error.name : 'Error' };
    if (error && error.code !== undefined) details.code = error.code;

    if (error && error.name === 'ValidationError') {
        details.paths = Object.keys(error.errors || {});
    } else if (error && /^Mongo/.test(error.name) && error.message) {
        // Mongo messages help diagnose outages/configuration. Redact URI
        // credentials; do not log arbitrary errors that may contain input.
        details.message = String(error.message)
            .replace(/(mongodb(?:\+srv)?:\/\/)[^\s@]+@/gi, '$1[redacted]@')
            .slice(0, 400);
    }

    console.error(`[auth] ${operation} failed`, details);
}

module.exports.registerUser = async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body.password;

    if (fullName.length < 3 || fullName.length > 80 || !validEmail(email) ||
        typeof password !== 'string' || password.length < passwordMinLength ||
        Buffer.byteLength(password, 'utf8') > passwordMaxBytes) {
        return res.status(400).send('Enter a name, valid email, and password between 8 and 72 bytes.');
    }

    try {
        const existingUser = await userModel.findOne({ email }).select('_id');
        if (existingUser) return res.status(409).send('Account already exists.');

        const hashedPassword = await bcrypt.hash(password, 12);
        const user = await userModel.create({ fullName, email, password: hashedPassword });
        res.cookie(AUTH_COOKIE_NAME, generateToken(user), AUTH_COOKIE_OPTIONS);
        return res.redirect(safeReturnPath(body.returnTo, '/shop'));
    } catch (error) {
        if (error.code === 11000) return res.status(409).send('Account already exists.');
        if (error.name === 'ValidationError') {
            logAuthFailure('registration validation', error);
            const paths = Object.keys(error.errors || {});
            return res.status(400).send(paths.length
                ? `Please check these account fields: ${paths.join(', ')}.`
                : 'Please check your account details.');
        }
        logAuthFailure('registration', error);
        return res.status(500).send('Unable to register this account.');
    }
};

module.exports.loginUser = async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body.password;

    if (!validEmail(email) || typeof password !== 'string' || password.length === 0 ||
        Buffer.byteLength(password, 'utf8') > passwordMaxBytes) {
        return res.status(400).send('Enter a valid email and password.');
    }

    try {
        const user = await userModel.findOne({ email }).select('+password');
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).send('Email or password is wrong.');
        }

        res.cookie(AUTH_COOKIE_NAME, generateToken(user), AUTH_COOKIE_OPTIONS);
        return res.redirect(safeReturnPath(body.returnTo, user.role === 'owner' ? '/owners/admin' : '/shop'));
    } catch (error) {
        logAuthFailure('login', error);
        return res.status(500).send('Unable to log in right now.');
    }
};

module.exports.logout = (req, res, next) => {
    const finishLogout = () => {
        res.clearCookie(AUTH_COOKIE_NAME, authCookieClearOptions());
        res.clearCookie('carryva.sid', {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
        });
        return res.redirect('/');
    };

    if (!req.session) return finishLogout();
    req.session.destroy((error) => {
        if (error) return next(error);
        return finishLogout();
    });
};
