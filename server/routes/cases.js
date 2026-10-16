const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { requireContractor, getSession } = require('../middleware/auth');

// CASES_FILE lets tests (or deployments) point storage somewhere else.
function casesFilePath() {
    return process.env.CASES_FILE || path.join(__dirname, '../data/cases.json');
}

// Fields only the server or a signed-in contractor may set.
const PROTECTED_FIELDS = ['id', 'createdAt', 'original_quote', 'final_quote', 'telegramChatId'];
const CONTRACTOR_ONLY_STATUSES = ['QUOTE_APPROVED', 'CHANGES_REQUESTED'];

function stripProtectedFields(body) {
    const clean = { ...(body || {}) };
    for (const field of PROTECTED_FIELDS) delete clean[field];
    return clean;
}

// Helper function to read cases
async function readCases() {
    try {
        const data = await fs.readFile(casesFilePath(), 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

// Helper function to write cases
async function writeCases(cases) {
    await fs.writeFile(casesFilePath(), JSON.stringify(cases, null, 2));
}

/**
 * GET /api/cases - List all cases (contractor only)
 */
router.get('/', requireContractor, async (req, res) => {
    try {
        const cases = await readCases();
        res.json(cases);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch cases' });
    }
});

/**
 * GET /api/cases/:id - Get specific case (contractor only)
 */
router.get('/:id', requireContractor, async (req, res) => {
    try {
        const cases = await readCases();
        const caseData = cases.find(c => c.id === req.params.id);

        if (!caseData) {
            return res.status(404).json({ error: 'Case not found' });
        }

        res.json(caseData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch case' });
    }
});

/**
 * POST /api/cases - Create new case
 */
router.post('/', async (req, res) => {
    try {
        const cases = await readCases();

        const body = stripProtectedFields(req.body);
        const newCase = {
            transcript: body.transcript,
            status: 'pending_analysis',
            ...body,
            id: `CASE-${Date.now()}`,
            createdAt: new Date().toISOString()
        };

        cases.push(newCase);
        await writeCases(cases);

        res.status(201).json(newCase);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create case' });
    }
});

/**
 * PATCH /api/cases/:id - Update case
 */
router.patch('/:id', async (req, res) => {
    try {
        const cases = await readCases();
        const index = cases.findIndex(c => c.id === req.params.id);

        if (index === -1) {
            return res.status(404).json({ error: 'Case not found' });
        }

        const isContractor = Boolean(getSession(req));
        const updates = isContractor ? { ...req.body } : stripProtectedFields(req.body);
        delete updates.id;

        if (!isContractor && CONTRACTOR_ONLY_STATUSES.includes(updates.status)) {
            return res.status(403).json({ error: 'Only a contractor can set this status' });
        }

        cases[index] = {
            ...cases[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };

        // Track timestamp when pictures are requested
        if (updates.analysis?.action_required === 'PICTURES') {
            if (!cases[index].analysis.pictures_requested_at) {
                cases[index].analysis.pictures_requested_at = new Date().toISOString();
                console.log(`[Cases] Pictures requested timestamp set for case ${cases[index].id}`);
            }
        }

        await writeCases(cases);
        res.json(cases[index]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update case' });
    }
});

/**
 * PATCH /api/cases/:id/quote - Update quote
 */
router.patch('/:id/quote', async (req, res) => {
    try {
        const cases = await readCases();
        const index = cases.findIndex(c => c.id === req.params.id);

        if (index === -1) {
            return res.status(404).json({ error: 'Case not found' });
        }

        const { quote, status, use_original } = req.body;

        // The customer app may save the first generated quote. Approving,
        // requesting changes or overwriting an existing quote needs a contractor.
        const isContractor = Boolean(getSession(req));
        if (!isContractor && (status || cases[index].original_quote)) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // Initialize analysis if missing
        if (!cases[index].analysis) {
            cases[index].analysis = {};
        }

        // Update quote and status
        if (quote) {
            // If this is the first time saving (no original_quote exists), store as original
            if (!cases[index].original_quote) {
                cases[index].original_quote = quote;
                console.log(`[Cases] Original quote stored for case ${cases[index].id}`);
            }

            // Store the quote (for contractor review/editing)
            cases[index].final_quote = quote;

            // Only change action_required if status is explicitly provided
            // If no status provided, set to QUOTE_READY for contractor review
            // If status is QUOTE_APPROVED, it will be set below
            if (!status) {
                // Quote is being saved for first time - mark as ready for contractor review
                cases[index].analysis.action_required = 'QUOTE_READY';
                console.log(`[Cases] Quote saved for case ${cases[index].id}, marked as QUOTE_READY for contractor review`);
            }
        }

        if (status) {
            cases[index].status = status;

            // Update action_required based on status
            if (status === 'QUOTE_APPROVED') {
                cases[index].analysis.action_required = 'QUOTE_APPROVED';
            } else if (status === 'CHANGES_REQUESTED') {
                cases[index].analysis.action_required = 'QUOTE_READY'; // Keep it ready for review after changes
            }

            // Trigger PDF Generation and Send if Approved
            if (status === 'QUOTE_APPROVED') {
                try {
                    // Check if we have a chatId to send to
                    if (cases[index].telegramChatId) {
                        const { generateQuotePDF } = require('../services/pdfGenerator');
                        const { sendDocument } = require('../services/telegram');

                        // Determine which quote to use for PDF
                        let quoteForPDF;
                        if (use_original === true) {
                            // Use original quote if requested
                            quoteForPDF = cases[index].original_quote || cases[index].final_quote;
                            console.log(`[Cases] Using original quote for PDF generation (case ${cases[index].id})`);
                        } else {
                            // Use edited quote - use provided quote or fall back to final_quote
                            quoteForPDF = quote || cases[index].final_quote;
                            // Update final_quote with the edited version if provided
                            if (quote) {
                                cases[index].final_quote = quote;
                            }
                            console.log(`[Cases] Using edited quote for PDF generation (case ${cases[index].id})`);
                        }

                        // Create a temporary case object with the correct quote for PDF generation
                        const caseForPDF = {
                            ...cases[index],
                            final_quote: quoteForPDF
                        };

                        console.log(`Generating PDF for case ${cases[index].id}...`);
                        const pdfBuffer = await generateQuotePDF(caseForPDF);

                        console.log(`Sending PDF to chat ${cases[index].telegramChatId}...`);
                        await sendDocument(
                            cases[index].telegramChatId,
                            pdfBuffer,
                            `HVAC_Quote_${cases[index].id}.pdf`,
                            `✅ Your quote has been approved! Please find the detailed estimate attached.\n\nCase ID: ${cases[index].id}`
                        );
                        console.log('PDF sent successfully.');
                    } else {
                        console.log('No Telegram Chat ID found for this case. Cannot send PDF.');
                    }
                } catch (pdfError) {
                    console.error('Error generating/sending PDF:', pdfError);
                    // Continue to save the status even if PDF fails
                }
            }
        }

        cases[index].updatedAt = new Date().toISOString();

        await writeCases(cases);
        res.json(cases[index]);
    } catch (error) {
        console.error('Error in PATCH /quote:', error);
        res.status(500).json({ error: 'Failed to update quote' });
    }
});

/**
 * POST /api/cases/:id/images - Add images to case (contractor only)
 */
router.post('/:id/images', requireContractor, async (req, res) => {
    try {
        const cases = await readCases();
        const index = cases.findIndex(c => c.id === req.params.id);

        if (index === -1) {
            return res.status(404).json({ error: 'Case not found' });
        }

        if (!cases[index].images) {
            cases[index].images = [];
        }

        cases[index].images.push({
            url: req.body.url,
            caption: req.body.caption,
            uploadedAt: new Date().toISOString()
        });

        cases[index].updatedAt = new Date().toISOString();

        await writeCases(cases);
        res.json(cases[index]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to add images' });
    }
});

/**
 * POST /api/cases/:id/human-review - Submit contractor review and generate quotation
 */
router.post('/:id/human-review', requireContractor, async (req, res) => {
    try {
        const cases = await readCases();
        const index = cases.findIndex(c => c.id === req.params.id);

        if (index === -1) {
            return res.status(404).json({ error: 'Case not found' });
        }

        const { contractorComments } = req.body;

        if (!contractorComments || !contractorComments.trim()) {
            return res.status(400).json({ error: 'Contractor comments are required' });
        }

        // Store contractor comments in the case
        if (!cases[index].analysis) {
            cases[index].analysis = {};
        }
        
        cases[index].analysis.contractor_review_comments = contractorComments.trim();
        cases[index].analysis.reviewed_by_contractor = true;
        cases[index].analysis.reviewed_at = new Date().toISOString();
        
        console.log(`[Human Review] Contractor review submitted for case ${cases[index].id}`);

        // Trigger quotation generation with contractor comments
        try {
            const openRouterService = require('../services/openrouter');
            const summaryData = {
                ...cases[index].analysis,
                // Enhance problem summary with contractor comments
                problem_summary: `${cases[index].analysis.problem_summary}\n\n[Contractor Review]: ${contractorComments.trim()}`
            };

            const images = cases[index].images || [];
            const fullAddress = cases[index].full_address || null;
            const clientName = cases[index].analysis?.client_name || cases[index].clientData?.name || null;
            const contactNumber = cases[index].analysis?.contact_number || cases[index].clientData?.contact || null;

            console.log(`[Human Review] Generating quotation for case ${cases[index].id} with contractor comments`);

            const quotation = await openRouterService.generateQuotation(
                summaryData,
                images,
                fullAddress,
                clientName,
                contactNumber
            );

            // Save quotation to case
            if (!cases[index].original_quote) {
                cases[index].original_quote = quotation;
            }
            cases[index].final_quote = quotation;
            cases[index].analysis.action_required = 'QUOTE_READY';
            cases[index].status = 'quote_ready';
            cases[index].updatedAt = new Date().toISOString();

            console.log(`[Human Review] ✅ Quotation generated and saved for case ${cases[index].id}`);
            console.log(`[Human Review] ✅ Status updated to QUOTE_READY`);

        } catch (quotationError) {
            console.error('[Human Review] ❌ Error generating quotation:', quotationError);
            // Still save the contractor comments even if quotation fails
            cases[index].updatedAt = new Date().toISOString();
            await writeCases(cases);
            return res.status(500).json({ 
                error: 'Failed to generate quotation', 
                details: quotationError.message,
                note: 'Contractor comments have been saved. Please try generating quotation manually.'
            });
        }

        await writeCases(cases);
        res.json({
            message: 'Review submitted and quotation generated successfully',
            case: cases[index]
        });
    } catch (error) {
        console.error('Error in POST /human-review:', error);
        res.status(500).json({ error: 'Failed to process human review' });
    }
});

/**
 * DELETE /api/cases/:id - Delete case (contractor only)
 */
router.delete('/:id', requireContractor, async (req, res) => {
    try {
        const cases = await readCases();
        const index = cases.findIndex(c => c.id === req.params.id);

        if (index === -1) {
            return res.status(404).json({ error: 'Case not found' });
        }

        cases.splice(index, 1);
        await writeCases(cases);
        res.status(200).json({ message: 'Case deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete case' });
    }
});

module.exports = router;
