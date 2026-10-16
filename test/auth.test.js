const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, login, useTempCasesFile } = require('./helpers');
const auth = require('../server/middleware/auth');
const authRouter = require('../server/routes/auth');

describe('session tokens', () => {
    test('a freshly issued token verifies', () => {
        const token = auth.createToken('contractor');
        assert.equal(auth.verifyToken(token).u, 'contractor');
    });

    test('a tampered payload is rejected', () => {
        const [, signature] = auth.createToken('contractor').split('.');
        const forged = Buffer.from(JSON.stringify({ u: 'admin', exp: Date.now() + 1e9 })).toString('base64url');
        assert.equal(auth.verifyToken(`${forged}.${signature}`), null);
    });

    test('an expired token is rejected', () => {
        const issuedLongAgo = Date.now() - 24 * 60 * 60 * 1000;
        assert.equal(auth.verifyToken(auth.createToken('contractor', issuedLongAgo)), null);
    });

    test('garbage input is rejected', () => {
        for (const value of [undefined, '', 'abc', 'a.b', '..']) {
            assert.equal(auth.verifyToken(value), null);
        }
    });

    test('cookies are parsed from the header', () => {
        assert.deepEqual(auth.parseCookies('a=1; hvac_session=x.y; b=two'), { a: '1', hvac_session: 'x.y', b: 'two' });
    });
});

describe('login API', () => {
    let server;
    before(async () => {
        useTempCasesFile();
        server = await startServer();
    });
    after(() => server.close());
    beforeEach(() => authRouter._resetFailures());

    test('valid credentials set an HttpOnly, SameSite=Strict cookie', async () => {
        const { res } = await login(server.url);
        assert.equal(res.status, 200);
        const cookie = res.headers.get('set-cookie');
        assert.match(cookie, /hvac_session=/);
        assert.match(cookie, /HttpOnly/);
        assert.match(cookie, /SameSite=Strict/);
    });

    test('a wrong password is rejected without a cookie', async () => {
        const { res, cookie } = await login(server.url, 'contractor', 'wrong');
        assert.equal(res.status, 401);
        assert.equal(cookie, null);
    });

    test('/me reflects the session', async () => {
        const anonymous = await fetch(`${server.url}/api/auth/me`);
        assert.equal(anonymous.status, 401);

        const { cookie } = await login(server.url);
        const me = await fetch(`${server.url}/api/auth/me`, { headers: { Cookie: cookie } });
        assert.equal(me.status, 200);
        assert.equal((await me.json()).username, 'contractor');
    });

    test('logout clears the cookie', async () => {
        const res = await fetch(`${server.url}/api/auth/logout`, { method: 'POST' });
        assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
    });

    test('repeated failures lock the IP out, even for the right password', async () => {
        for (let i = 0; i < 5; i++) {
            await login(server.url, 'contractor', 'wrong');
        }
        const { res } = await login(server.url);
        assert.equal(res.status, 429);
    });

    test('login is disabled when credentials are not configured', async () => {
        const saved = process.env.CONTRACTOR_PASSWORD;
        delete process.env.CONTRACTOR_PASSWORD;
        try {
            const { res } = await login(server.url);
            assert.equal(res.status, 503);
        } finally {
            process.env.CONTRACTOR_PASSWORD = saved;
        }
    });
});
