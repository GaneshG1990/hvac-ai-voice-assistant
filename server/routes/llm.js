const express = require('express');
const router = express.Router();
const openRouterService = require('../services/openrouter');

/**
 * POST /api/llm/analyze - Analyze transcript (LLM Prompt 1)
 */
router.post('/analyze', async (req, res) => {
    try {
        const { transcript } = req.body;

        if (!transcript) {
            return res.status(400).json({ error: 'Transcript is required' });
        }

        const analysis = await openRouterService.analyzeSummarization(transcript);
        res.json(analysis);
    } catch (error) {
        console.error('Error in /api/llm/analyze:', error);
        res.status(500).json({ error: 'Failed to analyze transcript' });
    }
});

/**
 * POST /api/llm/quotation - Generate quotation (LLM Prompt 2)
 */
router.post('/quotation', async (req, res) => {
    try {
        const { summaryData, caseId } = req.body;

        if (!summaryData) {
            return res.status(400).json({ error: 'Summary data is required' });
        }

        console.log('[Quotation] Generating quotation for caseId:', caseId);

        // Fetch complete case data if caseId is provided
        let images = [];
        let fullAddress = null;
        let clientName = null;
        let contactNumber = null;

        if (caseId) {
            try {
                const fs = require('fs').promises;
                const path = require('path');
                const casesPath = path.join(__dirname, '../data/cases.json');
                
                const casesData = await fs.readFile(casesPath, 'utf8');
                const cases = JSON.parse(casesData);
                const caseData = cases.find(c => c.id === caseId);

                if (caseData) {
                    // Extract images
                    images = caseData.images || [];
                    console.log(`[Quotation] Found ${images.length} image(s) for case ${caseId}`);

                    // Extract full address
                    fullAddress = caseData.full_address || null;
                    console.log(`[Quotation] Full address: ${fullAddress || 'not provided'}`);

                    // Extract client name (try analysis first, then clientData)
                    clientName = caseData.analysis?.client_name || caseData.clientData?.name || null;
                    console.log(`[Quotation] Client name: ${clientName || 'not provided'}`);

                    // Extract contact number (try analysis first, then clientData)
                    contactNumber = caseData.analysis?.contact_number || caseData.clientData?.contact || null;
                    console.log(`[Quotation] Contact number: ${contactNumber || 'not provided'}`);
                } else {
                    console.warn(`[Quotation] Case ${caseId} not found in cases.json`);
                }
            } catch (error) {
                console.error('[Quotation] Error fetching case data:', error);
                // Continue with quotation generation even if case data fetch fails
            }
        } else {
            console.log('[Quotation] No caseId provided, generating quotation with analysis data only');
        }

        const quotation = await openRouterService.generateQuotation(
            summaryData,
            images,
            fullAddress,
            clientName,
            contactNumber
        );
        res.json({ quotation });
    } catch (error) {
        console.error('[Quotation] Error generating quotation:', error);
        res.status(500).json({ error: 'Failed to generate quotation' });
    }
});

/**
 * POST /api/llm/chat - Process conversational turn (LLM Prompt 3)
 */
router.post('/chat', async (req, res) => {
    try {
        console.log("[LLM Route] POST /api/llm/chat received");
        console.log("[LLM Route] Request body keys:", Object.keys(req.body));
        
        const { transcript, currentData } = req.body;
        
        // Validate request body
        if (!transcript || typeof transcript !== 'string') {
            console.error("[LLM Route] Invalid transcript:", transcript);
            return res.status(400).json({ 
                error: 'Invalid transcript',
                next_message: "I'm having trouble processing your message. Please try again.",
                extracted: {},
                is_complete: false
            });
        }

        if (transcript.trim().length === 0) {
            console.error("[LLM Route] Empty transcript");
            return res.status(400).json({ 
                error: 'Empty transcript',
                next_message: "I didn't receive your message. Could you please repeat that?",
                extracted: {},
                is_complete: false
            });
        }

        console.log("[LLM Route] Transcript length:", transcript.length);
        console.log("[LLM Route] Current data:", JSON.stringify(currentData || {}, null, 2));

        const response = await openRouterService.processConversationTurn(transcript, currentData || {});
        
        console.log("[LLM Route] Response generated successfully");
        console.log("[LLM Route] Response has error:", !!response.error);
        
        res.json(response);
    } catch (error) {
        console.error('[LLM Route] ========== ROUTE ERROR ==========');
        console.error('[LLM Route] Error type:', error.constructor.name);
        console.error('[LLM Route] Error message:', error.message);
        console.error('[LLM Route] Stack trace:', error.stack);
        console.error('[LLM Route] ==================================');
        
        res.status(500).json({ 
            error: error.message,
            next_message: "I'm experiencing a technical issue. Please try again in a moment.",
            extracted: {},
            is_complete: false,
            error: {
                type: 'ROUTE_ERROR',
                message: error.message
            }
        });
    }
});

/**
 * POST /api/llm/analyze-image - Analyze image
 */
router.post('/analyze-image', async (req, res) => {
    try {
        const { imageUrl } = req.body;

        if (!imageUrl) {
            return res.status(400).json({ error: 'Image URL is required' });
        }

        const analysis = await openRouterService.analyzeImage(imageUrl);
        res.json({ analysis });
    } catch (error) {
        console.error('Error in /api/llm/analyze-image:', error);
        res.status(500).json({ error: 'Failed to analyze image' });
    }
});

module.exports = router;
