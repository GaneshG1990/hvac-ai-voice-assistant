const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { useTempCasesFile, readCasesFile } = require('./helpers');
const openrouter = require('../server/services/openrouter');
const { checkAndProcessCases } = require('../server/services/autoQuotationScheduler');
const { generateQuotePDF } = require('../server/services/pdfGenerator');

openrouter.generateQuotation = async () => 'AUTO QUOTE';

const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

describe('auto-quotation scheduler', () => {
    test('quotes a case that has waited 15+ minutes for photos', async () => {
        const file = useTempCasesFile([
            { id: 'OLD', analysis: { action_required: 'PICTURES', pictures_requested_at: minutesAgo(20) } }
        ]);
        await checkAndProcessCases();
        const [saved] = readCasesFile(file);
        assert.equal(saved.final_quote, 'AUTO QUOTE');
        assert.equal(saved.analysis.action_required, 'QUOTE_READY');
        assert.equal(saved.analysis.auto_generated_without_images, true);
    });

    test('leaves recent, photographed or non-photo cases alone', async () => {
        const file = useTempCasesFile([
            { id: 'RECENT', analysis: { action_required: 'PICTURES', pictures_requested_at: minutesAgo(5) } },
            { id: 'HAS_PHOTOS', images: [{ url: 'x' }], analysis: { action_required: 'PICTURES', pictures_requested_at: minutesAgo(30) } },
            { id: 'REVIEW', analysis: { action_required: 'HUMAN_REVIEW', pictures_requested_at: minutesAgo(30) } },
            { id: 'NO_TIMESTAMP', analysis: { action_required: 'PICTURES' } }
        ]);
        await checkAndProcessCases();
        for (const c of readCasesFile(file)) {
            assert.equal(c.final_quote, undefined, `${c.id} should not be quoted`);
        }
    });
});

describe('quote PDF', () => {
    test('produces a PDF document', async () => {
        const pdf = await generateQuotePDF({
            id: 'CASE-1',
            analysis: { client_name: 'Asha', contact_number: '+1 555 0100', problem_summary: 'AC not cooling' },
            final_quote: '| Labor | $100 |'
        });
        assert.ok(Buffer.isBuffer(pdf));
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
        assert.ok(pdf.length > 1000);
    });
});
