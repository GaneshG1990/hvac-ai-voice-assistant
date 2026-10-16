const fs = require('fs').promises;
const path = require('path');

/**
 * Auto-Quotation Scheduler Service
 * 
 * Monitors cases waiting for pictures and automatically generates quotations
 * after 15 minutes if no images are received.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const TIMEOUT_MINUTES = 15; // Generate quote after 15 minutes

let schedulerInterval = null;

function casesFilePath() {
    return process.env.CASES_FILE || path.join(__dirname, '../data/cases.json');
}

/**
 * Check and process cases that have been waiting for pictures too long
 */
async function checkAndProcessCases() {
    console.log('[Auto-Quotation Scheduler] Running check...');
    
    try {
        const casesPath = casesFilePath();
        const casesData = await fs.readFile(casesPath, 'utf8');
        const cases = JSON.parse(casesData);
        
        const now = new Date();
        let processedCount = 0;
        
        for (let i = 0; i < cases.length; i++) {
            const caseData = cases[i];
            
            // Only process cases waiting for pictures
            if (caseData.analysis?.action_required !== 'PICTURES') {
                continue;
            }
            
            // Skip if case already has images
            if (caseData.images && caseData.images.length > 0) {
                continue;
            }
            
            // Check if pictures_requested_at exists
            if (!caseData.analysis.pictures_requested_at) {
                console.log(`[Auto-Quotation Scheduler] Case ${caseData.id} has no pictures_requested_at timestamp, skipping`);
                continue;
            }
            
            // Calculate time elapsed
            const requestedAt = new Date(caseData.analysis.pictures_requested_at);
            const minutesElapsed = (now - requestedAt) / (1000 * 60);
            
            console.log(`[Auto-Quotation Scheduler] Case ${caseData.id}: ${minutesElapsed.toFixed(1)} minutes elapsed`);
            
            // Check if timeout has been reached
            if (minutesElapsed >= TIMEOUT_MINUTES) {
                console.log(`[Auto-Quotation Scheduler] ⏰ Case ${caseData.id} timeout reached, generating quotation without images`);
                
                try {
                    await generateQuotationForCase(caseData, i, cases);
                    processedCount++;
                } catch (error) {
                    console.error(`[Auto-Quotation Scheduler] ❌ Failed to generate quotation for case ${caseData.id}:`, error.message);
                }
            }
        }
        
        if (processedCount > 0) {
            console.log(`[Auto-Quotation Scheduler] ✅ Processed ${processedCount} case(s)`);
        } else {
            console.log(`[Auto-Quotation Scheduler] No cases requiring auto-quotation`);
        }
        
    } catch (error) {
        console.error('[Auto-Quotation Scheduler] Error during check:', error);
    }
}

/**
 * Generate quotation for a case without images
 */
async function generateQuotationForCase(caseData, caseIndex, cases) {
    const openRouterService = require('./openrouter');
    
    console.log(`[Auto-Quotation Scheduler] Generating quotation for case ${caseData.id}`);
    
    const summaryData = caseData.analysis;
    const images = []; // No images
    const fullAddress = caseData.full_address || null;
    const clientName = caseData.analysis?.client_name || caseData.clientData?.name || null;
    const contactNumber = caseData.analysis?.contact_number || caseData.clientData?.contact || null;
    
    // Generate quotation
    const quotation = await openRouterService.generateQuotation(
        summaryData,
        images,
        fullAddress,
        clientName,
        contactNumber
    );
    
    // Save quotation to case
    if (!cases[caseIndex].original_quote) {
        cases[caseIndex].original_quote = quotation;
    }
    cases[caseIndex].final_quote = quotation;
    cases[caseIndex].analysis.action_required = 'QUOTE_READY';
    cases[caseIndex].status = 'quote_ready';
    cases[caseIndex].analysis.auto_generated_without_images = true;
    cases[caseIndex].analysis.auto_generated_at = new Date().toISOString();
    cases[caseIndex].updatedAt = new Date().toISOString();
    
    // Write updated cases
    const casesPath = casesFilePath();
    await fs.writeFile(casesPath, JSON.stringify(cases, null, 2));
    
    console.log(`[Auto-Quotation Scheduler] ✅ Quotation saved for case ${caseData.id}`);
    console.log(`[Auto-Quotation Scheduler] ✅ Status updated to QUOTE_READY (auto-generated)`);
}

/**
 * Start the scheduler
 */
function startScheduler() {
    if (schedulerInterval) {
        console.log('[Auto-Quotation Scheduler] ⚠️ Scheduler already running');
        return;
    }
    
    console.log(`[Auto-Quotation Scheduler] 🚀 Starting scheduler (check every ${CHECK_INTERVAL_MS / 1000 / 60} minutes, timeout: ${TIMEOUT_MINUTES} minutes)`);
    
    // Run immediately on start
    checkAndProcessCases();
    
    // Then run on interval
    schedulerInterval = setInterval(checkAndProcessCases, CHECK_INTERVAL_MS);
}

/**
 * Stop the scheduler
 */
function stopScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
        console.log('[Auto-Quotation Scheduler] ⏹️ Scheduler stopped');
    }
}

module.exports = {
    startScheduler,
    stopScheduler,
    checkAndProcessCases // Export for manual testing
};

