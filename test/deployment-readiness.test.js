const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'production';
process.env.JWT_KEY = crypto.randomBytes(48).toString('base64url');
process.env.EXPRESS_SESSION_SECRET = crypto.randomBytes(48).toString('base64url');
process.env.MONGODB_URI = process.env.CARRYVA_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
process.env.MONGODB_DB = `carryva_deployment_readiness_test_${process.pid}`;
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';
process.env.AUTH_RATE_LIMIT_MAX = '2';
delete process.env.TRUST_PROXY_HOPS;

const { validateEnvironment } = require('../config/environment');
const { isApplicationReady } = require('../utils/readiness');
const app = require('../app');
const mongoose = require('mongoose');
const server = app.listen(0);
let baseUrl;

const validProductionEnv = () => ({
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb+srv://carryva.example.mongodb.net/Carryva?retryWrites=true&w=majority',
    JWT_KEY: 'j'.repeat(48),
    EXPRESS_SESSION_SECRET: 's'.repeat(48),
});

before(async () => {
    await mongoose.connection.ready;
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});

test('production configuration requires a valid database URI and distinct non-placeholder secrets', () => {
    assert.doesNotThrow(() => validateEnvironment(validProductionEnv()));

    for (const [name, value] of [
        ['MONGODB_URI', undefined],
        ['MONGODB_URI', 'https://example.com/database'],
        ['JWT_KEY', 'short'],
        ['EXPRESS_SESSION_SECRET', 'short'],
        ['JWT_KEY', 'replace-with-a-random-secret-that-is-long-enough'],
    ]) {
        const env = { ...validProductionEnv(), [name]: value };
        assert.throws(() => validateEnvironment(env), new RegExp(name));
    }

    const sameSecrets = validProductionEnv();
    sameSecrets.EXPRESS_SESSION_SECRET = sameSecrets.JWT_KEY;
    assert.throws(() => validateEnvironment(sameSecrets), /must be different/);
    assert.throws(() => validateEnvironment({ ...validProductionEnv(), PORT: '70000' }), /PORT/);
    assert.throws(() => validateEnvironment({ ...validProductionEnv(), TRUST_PROXY_HOPS: '0' }), /TRUST_PROXY_HOPS/);
});

test('readiness requires a connected database with transaction support', async () => {
    assert.equal(isApplicationReady({ readyState: 0, db: null, supportsTransactions: false }), false);
    assert.equal(isApplicationReady({ readyState: 1, db: {}, supportsTransactions: false }), false);
    assert.equal(isApplicationReady({ readyState: 1, db: {}, supportsTransactions: true }), true);

    const live = await fetch(`${baseUrl}/health/live`);
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: 'alive' });

    const readiness = await fetch(`${baseUrl}/health/ready`);
    const expectedReady = mongoose.connection.readyState === 1 && mongoose.connection.supportsTransactions === true;
    assert.equal(readiness.status, expectedReady ? 200 : 503);
    assert.deepEqual(await readiness.json(), { status: expectedReady ? 'ready' : 'not_ready' });
    assert.doesNotMatch(readiness.headers.get('content-type'), /mongodb|secret|uri/i);
});

test('login and registration share a per-IP rate limit and ignore spoofed forwarding headers by default', async () => {
    const first = await fetch(`${baseUrl}/users/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '198.51.100.10' },
        body: new URLSearchParams({ email: 'invalid', password: 'x' }),
        redirect: 'manual',
    });
    const second = await fetch(`${baseUrl}/users/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.15' },
        body: new URLSearchParams({ fullName: 'Rate Test User', email: 'invalid', password: 'x' }),
        redirect: 'manual',
    });
    const third = await fetch(`${baseUrl}/users/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '192.0.2.30' },
        body: new URLSearchParams({ email: 'another-invalid', password: 'x' }),
        redirect: 'manual',
    });

    assert.equal(first.status, 400);
    assert.equal(second.status, 400);
    assert.equal(third.status, 429);
    assert.equal(third.headers.get('ratelimit-limit'), '2');
    assert.ok(Number(third.headers.get('retry-after')) >= 1);
    assert.match(await third.text(), /too many sign-in attempts/i);
});
