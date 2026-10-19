const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'production';
process.env.JWT_KEY = crypto.randomBytes(48).toString('base64url');
process.env.EXPRESS_SESSION_SECRET = crypto.randomBytes(48).toString('base64url');
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017';
process.env.MONGODB_DB = `carryva_auth_test_${process.pid}`;

const app = require('../app');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/user-model');
const server = app.listen(0);

let baseUrl;
let registeredUser;
const credentials = {
    fullName: 'Carryva Test User',
    email: 'auth-test@example.com',
    password: 'correct-horse-battery',
    role: 'owner',
};

function postForm(path, fields, cookie) {
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    if (cookie) headers.cookie = cookie;
    return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: new URLSearchParams(fields),
        redirect: 'manual',
    });
}

function cookieValue(response, cookieName = 'token') {
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${cookieName}=`));
    assert.ok(cookie, `expected ${cookieName} cookie`);
    return cookie.split(';', 1)[0];
}

function tokenCookie(response) {
    return cookieValue(response).slice('token='.length);
}

before(async () => {
    await mongoose.connection.asPromise();
    await User.init();
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});

test('public shop and product listings load; owner operations reject requests without a token', async () => {
    for (const route of ['/shop', '/products']) {
        const response = await fetch(`${baseUrl}${route}`);
        assert.equal(response.status, 200);
    }

    const admin = await fetch(`${baseUrl}/owners/admin`, { redirect: 'manual' });
    assert.equal(admin.status, 302);
    assert.equal(admin.headers.get('location'), '/');

    const createProduct = await postForm('/products/create', {});
    assert.equal(createProduct.status, 302);
    assert.equal(createProduct.headers.get('location'), '/');
});

test('registration validates input and rejects malformed or weak credentials', async () => {
    const missing = await postForm('/users/register', {});
    assert.equal(missing.status, 400);

    const badEmail = await postForm('/users/register', {
        ...credentials,
        email: 'not-an-email',
    });
    assert.equal(badEmail.status, 400);

    const shortPassword = await postForm('/users/register', {
        ...credentials,
        password: 'short',
    });
    assert.equal(shortPassword.status, 400);

    const longPassword = await postForm('/users/register', {
        ...credentials,
        password: 'a'.repeat(73),
    });
    assert.equal(longPassword.status, 400);
});

test('registration hashes the password, signs an expiring token, and permits protected access', async () => {
    const response = await postForm('/users/register', credentials);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/shop');

    const token = tokenCookie(response);
    const claims = jwt.verify(token, process.env.JWT_KEY, {
        issuer: 'carryva',
        audience: 'carryva-users',
    });
    assert.equal(claims.email, credentials.email);
    assert.ok(claims.sub);
    assert.equal(claims.exp - claims.iat, 24 * 60 * 60);

    const authCookie = response.headers.getSetCookie().find((value) => value.startsWith('token='));
    assert.match(authCookie, /HttpOnly/i);
    assert.match(authCookie, /Secure/i);
    assert.match(authCookie, /SameSite=Lax/i);
    assert.match(authCookie, /Path=\//i);
    assert.match(authCookie, /Max-Age=86400/i);

    registeredUser = await User.findOne({ email: credentials.email }).select('+password');
    assert.ok(registeredUser);
    assert.equal(registeredUser.role, 'customer');
    assert.notEqual(registeredUser.password, credentials.password);
    assert.equal(await bcrypt.compare(credentials.password, registeredUser.password), true);
    assert.equal(Object.hasOwn(await User.findOne({ email: credentials.email }).lean(), 'password'), false);

    const protectedPage = await fetch(`${baseUrl}/shop`, {
        headers: { cookie: `token=${token}` },
        redirect: 'manual',
    });
    assert.equal(protectedPage.status, 200);
});

test('registration handles normalized duplicate emails', async () => {
    const response = await postForm('/users/register', {
        ...credentials,
        email: ' AUTH-TEST@EXAMPLE.COM ',
    });
    assert.equal(response.status, 409);
});

test('login rejects invalid credentials and authenticates the registered user', async () => {
    const malformed = await postForm('/users/login', { email: 'bad', password: 'nope' });
    assert.equal(malformed.status, 400);

    const wrongPassword = await postForm('/users/login', {
        email: credentials.email,
        password: 'wrong-password',
    });
    assert.equal(wrongPassword.status, 401);

    const unknownUser = await postForm('/users/login', {
        email: 'missing@example.com',
        password: 'correct-horse-battery',
    });
    assert.equal(unknownUser.status, 401);

    const successfulLogin = await postForm('/users/login', {
        email: credentials.email.toUpperCase(),
        password: credentials.password,
    });
    assert.equal(successfulLogin.status, 302);
    assert.equal(successfulLogin.headers.get('location'), '/shop');
    assert.ok(tokenCookie(successfulLogin));
});

test('tampered and expired tokens are rejected and cleared on owner routes', async () => {
    const validToken = jwt.sign(
        { email: credentials.email },
        process.env.JWT_KEY,
        {
            subject: String(registeredUser._id),
            expiresIn: -1,
            issuer: 'carryva',
            audience: 'carryva-users',
        }
    );

    for (const token of [`${validToken}tampered`, validToken]) {
        const response = await fetch(`${baseUrl}/owners/admin`, {
            headers: { cookie: `token=${token}` },
            redirect: 'manual',
        });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), '/');
        assert.match(response.headers.getSetCookie().find((value) => value.startsWith('token=')), /Expires=/i);
    }
});

test('logout clears the auth cookie and Express session; the token no longer reaches protected routes', async () => {
    const login = await postForm('/users/login', credentials);
    const token = tokenCookie(login);
    const logout = await postForm('/users/logout', {}, `token=${token}`);
    assert.equal(logout.status, 302);
    assert.equal(logout.headers.get('location'), '/');

    const cookies = logout.headers.getSetCookie();
    assert.match(cookies.find((value) => value.startsWith('token=')), /Expires=/i);
    assert.match(cookies.find((value) => value.startsWith('carryva.sid=')), /Expires=/i);

    const protectedPage = await fetch(`${baseUrl}/owners/admin`, { redirect: 'manual' });
    assert.equal(protectedPage.status, 302);
});
