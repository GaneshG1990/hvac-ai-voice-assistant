const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CONTRACTOR_USERNAME = 'contractor';
process.env.CONTRACTOR_PASSWORD = 'correct-horse-battery';
process.env.SESSION_SECRET = 'test-secret';

/** Points case storage at a fresh temp file and returns its path. */
function useTempCasesFile(initialCases = []) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvac-test-'));
    const file = path.join(dir, 'cases.json');
    fs.writeFileSync(file, JSON.stringify(initialCases, null, 2));
    process.env.CASES_FILE = file;
    return file;
}

function readCasesFile(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Builds the API without the Telegram bot so tests make no network calls. */
function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', require('../server/routes/auth'));
    app.use('/api/cases', require('../server/routes/cases'));
    return app;
}

/** Starts the app on a random port and returns { url, close }. */
async function startServer(app = buildApp()) {
    const server = await new Promise(resolve => {
        const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address();
    return {
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise(resolve => server.close(resolve))
    };
}

/** Signs in and returns the session cookie header value. */
async function login(url, username = 'contractor', password = 'correct-horse-battery') {
    const res = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const setCookie = res.headers.get('set-cookie');
    return { res, cookie: setCookie ? setCookie.split(';')[0] : null };
}

function json(body, cookie) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    return { headers, body: JSON.stringify(body) };
}

module.exports = { useTempCasesFile, readCasesFile, buildApp, startServer, login, json };
