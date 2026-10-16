const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, login, json, useTempCasesFile, readCasesFile } = require('./helpers');
const openrouter = require('../server/services/openrouter');

// Never call the real LLM from tests.
openrouter.generateQuotation = async () => '| Item | Cost |\n| Labor | $100 |';

const existingCase = () => ({
    id: 'CASE-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'analyzed',
    analysis: { problem_summary: 'AC not cooling', action_required: 'HUMAN_REVIEW' }
});

describe('cases API authorization', () => {
    let server;
    let cookie;
    let file;

    before(async () => {
        server = await startServer();
        ({ cookie } = await login(server.url));
    });
    after(() => server.close());
    beforeEach(() => {
        file = useTempCasesFile([existingCase()]);
    });

    describe('contractor-only routes reject anonymous requests', () => {
        const routes = [
            ['GET', '/api/cases'],
            ['GET', '/api/cases/CASE-1'],
            ['DELETE', '/api/cases/CASE-1'],
            ['POST', '/api/cases/CASE-1/images'],
            ['POST', '/api/cases/CASE-1/human-review']
        ];
        for (const [method, route] of routes) {
            test(`${method} ${route} -> 401`, async () => {
                const options = method === 'GET' ? { method } : { method, ...json({}) };
                const res = await fetch(`${server.url}${route}`, options);
                assert.equal(res.status, 401);
            });
        }
    });

    test('a contractor can list cases', async () => {
        const res = await fetch(`${server.url}/api/cases`, { headers: { Cookie: cookie } });
        assert.equal(res.status, 200);
        assert.equal((await res.json()).length, 1);
    });

    test('a contractor can delete a case', async () => {
        const res = await fetch(`${server.url}/api/cases/CASE-1`, { method: 'DELETE', headers: { Cookie: cookie } });
        assert.equal(res.status, 200);
        assert.equal(readCasesFile(file).length, 0);
    });

    test('a forged cookie is rejected', async () => {
        const res = await fetch(`${server.url}/api/cases`, { headers: { Cookie: 'hvac_session=forged.token' } });
        assert.equal(res.status, 401);
    });

    describe('customer flow stays public', () => {
        test('anyone can create a case, but cannot choose its id or quotes', async () => {
            const res = await fetch(`${server.url}/api/cases`, {
                method: 'POST',
                ...json({ transcript: 'hello', id: 'CASE-1', final_quote: 'free!' })
            });
            assert.equal(res.status, 201);
            const created = await res.json();
            assert.notEqual(created.id, 'CASE-1');
            assert.equal(created.final_quote, undefined);
            assert.equal(readCasesFile(file).length, 2);
        });

        test('anyone can save the analysis on a case', async () => {
            const res = await fetch(`${server.url}/api/cases/CASE-1`, {
                method: 'PATCH',
                ...json({ status: 'analyzed', analysis: { action_required: 'PICTURES' } })
            });
            assert.equal(res.status, 200);
            const saved = readCasesFile(file)[0];
            assert.equal(saved.analysis.action_required, 'PICTURES');
            assert.ok(saved.analysis.pictures_requested_at, 'picture request time is recorded');
        });

        test('an anonymous PATCH cannot approve a quote', async () => {
            const res = await fetch(`${server.url}/api/cases/CASE-1`, {
                method: 'PATCH',
                ...json({ status: 'QUOTE_APPROVED' })
            });
            assert.equal(res.status, 403);
        });

        test('the first generated quote can be saved anonymously', async () => {
            const res = await fetch(`${server.url}/api/cases/CASE-1/quote`, {
                method: 'PATCH',
                ...json({ quote: 'Q1' })
            });
            assert.equal(res.status, 200);
            const saved = readCasesFile(file)[0];
            assert.equal(saved.original_quote, 'Q1');
            assert.equal(saved.analysis.action_required, 'QUOTE_READY');
        });

        test('an existing quote cannot be overwritten anonymously', async () => {
            await fetch(`${server.url}/api/cases/CASE-1/quote`, { method: 'PATCH', ...json({ quote: 'Q1' }) });
            const res = await fetch(`${server.url}/api/cases/CASE-1/quote`, {
                method: 'PATCH',
                ...json({ quote: 'cheaper' })
            });
            assert.equal(res.status, 401);
            assert.equal(readCasesFile(file)[0].final_quote, 'Q1');
        });
    });

    describe('contractor quote workflow', () => {
        test('approving a quote requires a contractor', async () => {
            const anonymous = await fetch(`${server.url}/api/cases/CASE-1/quote`, {
                method: 'PATCH',
                ...json({ quote: 'Q1', status: 'QUOTE_APPROVED' })
            });
            assert.equal(anonymous.status, 401);

            const res = await fetch(`${server.url}/api/cases/CASE-1/quote`, {
                method: 'PATCH',
                ...json({ quote: 'Q1', status: 'QUOTE_APPROVED' }, cookie)
            });
            assert.equal(res.status, 200);
            const saved = readCasesFile(file)[0];
            assert.equal(saved.status, 'QUOTE_APPROVED');
            assert.equal(saved.analysis.action_required, 'QUOTE_APPROVED');
        });

        test('human review needs comments', async () => {
            const res = await fetch(`${server.url}/api/cases/CASE-1/human-review`, {
                method: 'POST',
                ...json({ contractorComments: '   ' }, cookie)
            });
            assert.equal(res.status, 400);
        });

        test('human review generates a quote and marks it ready', async () => {
            const res = await fetch(`${server.url}/api/cases/CASE-1/human-review`, {
                method: 'POST',
                ...json({ contractorComments: 'Compressor likely failed' }, cookie)
            });
            assert.equal(res.status, 200);
            const saved = readCasesFile(file)[0];
            assert.equal(saved.analysis.reviewed_by_contractor, true);
            assert.equal(saved.analysis.action_required, 'QUOTE_READY');
            assert.match(saved.final_quote, /Labor/);
        });

        test('unknown case ids return 404', async () => {
            const res = await fetch(`${server.url}/api/cases/CASE-404`, { headers: { Cookie: cookie } });
            assert.equal(res.status, 404);
        });
    });
});
