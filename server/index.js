const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const casesRouter = require('./routes/cases');
const llmRouter = require('./routes/llm');
const { initializeTelegramBot, requestPictures, sendConfirmationMessage, bot } = require('./services/telegram');
const openRouterService = require('./services/openrouter');
const { startScheduler, stopScheduler } = require('./services/autoQuotationScheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// CORS configuration - allow all origins for development, can be restricted in production
app.use(cors({
    origin: true, // Allow all origins (can be restricted to specific domain in production)
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// API Routes
app.use('/api/cases', casesRouter);
app.use('/api/llm', llmRouter);

// Telegram picture request endpoint
app.post('/api/telegram/request-pictures', async (req, res) => {
    try {
        const { phoneNumber, caseId, pictureDetails, problemSummary, clientName, chatId } = req.body;
        const result = await requestPictures(phoneNumber, caseId, pictureDetails, problemSummary, clientName, chatId);
        res.json(result);
    } catch (error) {
        console.error('[API] Error in /api/telegram/request-pictures:', error);
        res.status(500).json({ error: 'Failed to send picture request', details: error.message });
    }
});

// Telegram confirmation message endpoint
app.post('/api/telegram/send-confirmation', async (req, res) => {
    try {
        const { phoneNumber, caseId, clientName, zipCode, address, problemSummary, pictureDetails, chatId } = req.body;
        
        console.log('[API] /api/telegram/send-confirmation called with:', {
            phoneNumber, caseId, clientName, zipCode, address: address || 'not provided', chatId: chatId || 'not available'
        });
        
        const result = await sendConfirmationMessage(
            phoneNumber,
            caseId,
            clientName,
            zipCode,
            address,
            problemSummary,
            pictureDetails,
            chatId
        );
        
        res.json(result);
    } catch (error) {
        console.error('[API] Error in /api/telegram/send-confirmation:', error);
        res.status(500).json({ error: 'Failed to send confirmation', details: error.message });
    }
});

// ==================== AUTO-QUOTATION HELPER FUNCTIONS ====================

/**
 * Check if images need analysis or if summary is sufficient
 */
async function analyzeImagesIfNeeded(caseData) {
    console.log('[Auto-Quotation] Checking if image analysis is needed...');
    
    // If no images, return null
    if (!caseData.images || caseData.images.length === 0) {
        console.log('[Auto-Quotation] No images to analyze');
        return null;
    }
    
    // Check if picture requirements were specified
    const hasPictureRequirements = caseData.analysis?.picture_requirement_details;
    
    // If no specific picture requirements, assume summary is sufficient
    if (!hasPictureRequirements) {
        console.log('[Auto-Quotation] No specific picture requirements, summary is sufficient');
        return 'Images uploaded for reference. Summary is sufficient for quotation.';
    }
    
    // For MVP: Return a simple description of images
    // Future enhancement: Use vision models to analyze images
    const imageDescriptions = caseData.images.map((img, idx) => {
        return `Image ${idx + 1}: ${img.fileName}${img.caption ? ` (Caption: ${img.caption})` : ''}`;
    }).join('\n');
    
    console.log('[Auto-Quotation] Image analysis:', imageDescriptions);
    return `Images provided:\n${imageDescriptions}\n\nNote: Images have been uploaded for contractor review.`;
}

/**
 * Generate quotation for a case
 */
async function generateQuotationForCase(caseData, imageAnalysis) {
    console.log('[Auto-Quotation] ========== Generating Quotation ==========');
    console.log('[Auto-Quotation] Case ID:', caseData.id);
    
    try {
        // Extract data for quotation
        const summaryData = caseData.analysis;
        const images = caseData.images || [];
        const fullAddress = caseData.full_address || null;
        const clientName = caseData.analysis?.client_name || caseData.clientData?.name || null;
        const contactNumber = caseData.analysis?.contact_number || caseData.clientData?.contact || null;
        
        console.log('[Auto-Quotation] Quotation parameters:', {
            caseId: caseData.id,
            imageCount: images.length,
            hasAddress: !!fullAddress,
            hasClientName: !!clientName,
            hasContactNumber: !!contactNumber,
            hasImageAnalysis: !!imageAnalysis
        });
        
        // Generate quotation using OpenRouter service
        const quotation = await openRouterService.generateQuotation(
            summaryData,
            images,
            fullAddress,
            clientName,
            contactNumber
        );
        
        console.log('[Auto-Quotation] ✅ Quotation generated successfully');
        
        // Save quotation to case
        const fs = require('fs').promises;
        const casesPath = path.join(__dirname, 'data/cases.json');
        
        const casesData = await fs.readFile(casesPath, 'utf8');
        const cases = JSON.parse(casesData);
        const caseIndex = cases.findIndex(c => c.id === caseData.id);
        
        if (caseIndex !== -1) {
            // Store quotation
            if (!cases[caseIndex].original_quote) {
                cases[caseIndex].original_quote = quotation;
            }
            cases[caseIndex].final_quote = quotation;
            cases[caseIndex].analysis.action_required = 'QUOTE_READY';
            cases[caseIndex].status = 'quote_ready';
            cases[caseIndex].updatedAt = new Date().toISOString();
            
            await fs.writeFile(casesPath, JSON.stringify(cases, null, 2));
            console.log('[Auto-Quotation] ✅ Quotation saved to case');
            console.log('[Auto-Quotation] ✅ Status updated to QUOTE_READY');
        }
        
        return true;
    } catch (error) {
        console.error('[Auto-Quotation] ❌ Error generating quotation:', error);
        console.error('[Auto-Quotation] Error details:', error.message);
        return false;
    }
}

/**
 * Check if case is ready for quotation and trigger generation
 */
async function checkAndTriggerQuotation(caseData) {
    console.log('[Auto-Quotation] ========== Checking Quotation Readiness ==========');
    console.log('[Auto-Quotation] Case ID:', caseData.id);
    console.log('[Auto-Quotation] Current action_required:', caseData.analysis?.action_required);
    
    // Only proceed if case is waiting for pictures
    if (caseData.analysis?.action_required !== 'PICTURES') {
        console.log('[Auto-Quotation] ⏭️ Case not waiting for pictures, skipping');
        return;
    }
    
    // Check if we have address
    const hasAddress = !!caseData.full_address;
    console.log('[Auto-Quotation] Has address:', hasAddress);
    
    // Check if we have images OR if summary is sufficient
    const hasImages = caseData.images && caseData.images.length > 0;
    console.log('[Auto-Quotation] Has images:', hasImages, `(${caseData.images?.length || 0} image(s))`);
    
    // Determine if we're ready
    const isReady = hasAddress && (hasImages || !caseData.analysis?.picture_requirement_details);
    
    if (!isReady) {
        console.log('[Auto-Quotation] ⏳ Not ready yet. Waiting for:', {
            needsAddress: !hasAddress,
            needsImages: !hasImages && !!caseData.analysis?.picture_requirement_details
        });
        return;
    }
    
    console.log('[Auto-Quotation] ✅ Case is ready for quotation generation!');
    
    // Analyze images if needed
    const imageAnalysis = await analyzeImagesIfNeeded(caseData);
    
    // Generate quotation
    const success = await generateQuotationForCase(caseData, imageAnalysis);
    
    if (success) {
        console.log('[Auto-Quotation] ========== Quotation Process Complete ==========');
    } else {
        console.log('[Auto-Quotation] ========== Quotation Process Failed ==========');
    }
}

/**
 * Check if case is ready after confirmation and trigger quotation if complete
 */
async function checkAndGenerateQuoteIfReady(caseData) {
    console.log('[Confirmation Check] ========== Checking Quote Readiness After Confirmation ==========');
    console.log('[Confirmation Check] Case ID:', caseData.id);
    console.log('[Confirmation Check] Confirmed:', !!caseData.telegram_confirmed);
    console.log('[Confirmation Check] Action Required:', caseData.analysis?.action_required);
    
    // Only proceed if user has confirmed
    if (!caseData.telegram_confirmed) {
        console.log('[Confirmation Check] ⏭️ Skipping - not confirmed yet');
        return false;
    }
    
    const needsPictures = caseData.analysis?.action_required === 'PICTURES';
    const hasPictures = caseData.images && caseData.images.length > 0;
    const hasAddress = !!caseData.full_address;
    
    console.log('[Confirmation Check] Status:', {
        needsPictures,
        hasPictures,
        hasAddress
    });
    
    // Determine if ready to generate quote
    let isReady = false;
    
    if (needsPictures) {
        // Need both pictures and address
        isReady = hasPictures && hasAddress;
        console.log('[Confirmation Check] Needs pictures - ready:', isReady);
    } else {
        // Just need confirmation (address optional but recommended)
        isReady = true;
        console.log('[Confirmation Check] No pictures needed - proceeding with quote');
    }
    
    if (isReady) {
        console.log('[Confirmation Check] ✅ All requirements met - generating quotation');
        
        // Analyze images if needed
        const imageAnalysis = await analyzeImagesIfNeeded(caseData);
        
        // Generate quotation
        return await generateQuotationForCase(caseData, imageAnalysis);
    } else {
        console.log('[Confirmation Check] ⏳ Still waiting for:', {
            needsPictures: needsPictures && !hasPictures,
            needsAddress: !hasAddress
        });
        
        // Send reminder message if needed
        if (caseData.telegramChatId) {
            try {
                let reminderMsg = '⏳ Thank you for confirming! ';
                if (needsPictures && !hasPictures) {
                    reminderMsg += 'We\'re still waiting for the photos. ';
                }
                if (!hasAddress) {
                    reminderMsg += 'Please send your complete address. ';
                }
                reminderMsg += '\n\nOnce we have everything, we\'ll generate your quote automatically.';
                
                await bot.sendMessage(caseData.telegramChatId, reminderMsg);
                console.log('[Confirmation Check] ✅ Reminder message sent');
            } catch (error) {
                console.warn('[Confirmation Check] ⚠️ Could not send reminder:', error.message);
            }
        }
        
        return false;
    }
}

// ==================== END AUTO-QUOTATION FUNCTIONS ====================

// Initialize Telegram bot with image handler AND text handler
initializeTelegramBot(
    // 1. Image Handler
    async (imageData) => {
        console.log('[Image Handler] ========== Processing received image ==========');
        console.log('[Image Handler] Image data:', {
            chatId: imageData.chatId,
            phoneNumber: imageData.phoneNumber,
            fileName: imageData.fileName,
            hasCaption: !!imageData.caption,
            timestamp: imageData.timestamp
        });

        const fs = require('fs').promises;
        const casesPath = path.join(__dirname, 'data/cases.json');

        try {
            const casesData = await fs.readFile(casesPath, 'utf8');
            const cases = JSON.parse(casesData);

            let caseIndex = -1;
            let matchMethod = 'none';

            // Try matching by chatId first (most reliable)
            if (imageData.chatId) {
                caseIndex = cases.findIndex(c => c.telegramChatId === imageData.chatId);
                if (caseIndex !== -1) {
                    matchMethod = 'chatId';
                    console.log(`[Image Handler] ✅ Found case by chatId: ${cases[caseIndex].id}`);
                }
            }

            // Fall back to phone number matching if chatId didn't work
            if (caseIndex === -1 && imageData.phoneNumber) {
                const normalizedPhone = imageData.phoneNumber.replace(/[^\d+]/g, '');
                caseIndex = cases.findIndex(c => {
                    const casePhone = c.analysis?.contact_number;
                    if (!casePhone) return false;
                    const normalizedCasePhone = casePhone.replace(/[^\d+]/g, '');
                    return normalizedCasePhone === normalizedPhone || 
                           normalizedCasePhone === `+${normalizedPhone}` ||
                           normalizedCasePhone === normalizedPhone.replace('+', '');
                });
                if (caseIndex !== -1) {
                    matchMethod = 'phoneNumber';
                    console.log(`[Image Handler] ✅ Found case by phone number: ${cases[caseIndex].id}`);
                }
            }

            if (caseIndex !== -1) {
                // Add image to case
                if (!cases[caseIndex].images) {
                    cases[caseIndex].images = [];
                }

                cases[caseIndex].images.push({
                    url: imageData.fileUrl,
                    fileId: imageData.fileId,
                    fileName: imageData.fileName,
                    caption: imageData.caption,
                    uploadedAt: imageData.timestamp
                });

                cases[caseIndex].status = 'images_received';
                
                // Save chatId for future communication (if not already stored)
                if (!cases[caseIndex].telegramChatId) {
                    cases[caseIndex].telegramChatId = imageData.chatId;
                    console.log(`[Image Handler] ✅ Stored chatId ${imageData.chatId} for case ${cases[caseIndex].id}`);
                }
                
                cases[caseIndex].updatedAt = new Date().toISOString();

                await fs.writeFile(casesPath, JSON.stringify(cases, null, 2));
                console.log(`[Image Handler] ✅ Image added to case ${cases[caseIndex].id} (matched by ${matchMethod})`);
                console.log(`[Image Handler] Total images for this case: ${cases[caseIndex].images.length}`);
                
                // Check if we should trigger automatic quotation
                await checkAndTriggerQuotation(cases[caseIndex]);
            } else {
                console.warn('[Image Handler] ⚠️ Could not find matching case for image');
                console.warn('[Image Handler] Search criteria:', {
                    chatId: imageData.chatId,
                    phoneNumber: imageData.phoneNumber,
                    totalCases: cases.length
                });
                console.warn('[Image Handler] Available cases:', cases.map(c => ({
                    id: c.id,
                    hasChatId: !!c.telegramChatId,
                    chatId: c.telegramChatId,
                    phone: c.analysis?.contact_number
                })));
            }
        } catch (error) {
            console.error('[Image Handler] ❌ Error updating case with image:', error);
            console.error('[Image Handler] Error stack:', error.stack);
        }
        
        console.log('[Image Handler] ========== Image processing complete ==========');
    },
    // 2. Text Handler (for Address Collection)
    async (textData) => {
        console.log('[Text Handler] ========== Processing received text ==========');
        console.log('[Text Handler] Text data:', {
            chatId: textData.chatId,
            phoneNumber: textData.phoneNumber,
            textLength: textData.text?.length || 0,
            textPreview: textData.text?.substring(0, 50) + (textData.text?.length > 50 ? '...' : ''),
            timestamp: textData.timestamp
        });

        const fs = require('fs').promises;
        const casesPath = path.join(__dirname, 'data/cases.json');

        try {
            const casesData = await fs.readFile(casesPath, 'utf8');
            const cases = JSON.parse(casesData);

            let caseIndex = -1;
            let matchMethod = 'none';

            // Try matching by chatId first (most reliable)
            if (textData.chatId) {
                caseIndex = cases.findIndex(c => c.telegramChatId === textData.chatId);
                if (caseIndex !== -1) {
                    matchMethod = 'chatId';
                    console.log(`[Text Handler] ✅ Found case by chatId: ${cases[caseIndex].id}`);
                }
            }

            // Fall back to phone number matching if chatId didn't work
            if (caseIndex === -1 && textData.phoneNumber) {
                const normalizedPhone = textData.phoneNumber.replace(/[^\d+]/g, '');
                console.log(`[Text Handler] Trying phone number match: ${normalizedPhone}`);
                
                // Find all matching cases by phone number
                const matchingCases = cases
                    .map((c, idx) => {
                        const casePhone = c.analysis?.contact_number;
                        if (!casePhone) return null;
                        const normalizedCasePhone = casePhone.replace(/[^\d+]/g, '');
                        const matches = normalizedCasePhone === normalizedPhone || 
                                       normalizedCasePhone === `+${normalizedPhone}` ||
                                       normalizedCasePhone === normalizedPhone.replace('+', '');
                        return matches ? { index: idx, case: c } : null;
                    })
                    .filter(item => item !== null);

                if (matchingCases.length > 0) {
                    // Use the most recent case (highest index or latest updatedAt)
                    const mostRecent = matchingCases.reduce((latest, current) => {
                        const latestTime = new Date(latest.case.updatedAt || latest.case.createdAt || 0);
                        const currentTime = new Date(current.case.updatedAt || current.case.createdAt || 0);
                        return currentTime > latestTime ? current : latest;
                    });
                    
                    caseIndex = mostRecent.index;
                    matchMethod = 'phoneNumber';
                    console.log(`[Text Handler] ✅ Found case by phone number: ${cases[caseIndex].id} (${matchingCases.length} match(es) found, using most recent)`);
                }
            }

            if (caseIndex !== -1) {
                // Handle different types of text messages
                if (textData.isConfirmation) {
                    // User confirmed details
                    console.log(`[Text Handler] ✅ User confirmed details for case ${cases[caseIndex].id}`);
                    cases[caseIndex].telegram_confirmed = true;
                    cases[caseIndex].telegram_confirmation_time = new Date().toISOString();
                    cases[caseIndex].updatedAt = new Date().toISOString();
                    
                    await fs.writeFile(casesPath, JSON.stringify(cases, null, 2));
                    
                    // Check if we should trigger automatic quotation
                    await checkAndGenerateQuoteIfReady(cases[caseIndex]);
                    
                } else if (textData.isFieldUpdate) {
                    // User is updating a specific field
                    console.log(`[Text Handler] ✅ Updating field "${textData.updateField}" for case ${cases[caseIndex].id}`);
                    
                    const fieldValue = textData.text.trim();
                    
                    // Update the appropriate field
                    switch (textData.updateField) {
                        case 'name':
                            if (cases[caseIndex].clientData) {
                                cases[caseIndex].clientData.name = fieldValue;
                            }
                            if (cases[caseIndex].analysis) {
                                cases[caseIndex].analysis.client_name = fieldValue;
                            }
                            break;
                        case 'phone':
                            if (cases[caseIndex].clientData) {
                                cases[caseIndex].clientData.contact = fieldValue;
                            }
                            if (cases[caseIndex].analysis) {
                                cases[caseIndex].analysis.contact_number = fieldValue;
                            }
                            break;
                        case 'address':
                            cases[caseIndex].full_address = fieldValue;
                            break;
                        case 'issue':
                            if (cases[caseIndex].clientData) {
                                cases[caseIndex].clientData.problem = fieldValue;
                            }
                            if (cases[caseIndex].analysis) {
                                cases[caseIndex].analysis.problem_summary = fieldValue;
                            }
                            break;
                    }
                    
                    // Track the update
                    if (!cases[caseIndex].field_updates) {
                        cases[caseIndex].field_updates = [];
                    }
                    cases[caseIndex].field_updates.push({
                        field: textData.updateField,
                        oldValue: 'previous',
                        newValue: fieldValue,
                        updatedAt: new Date().toISOString()
                    });
                    
                    cases[caseIndex].updatedAt = new Date().toISOString();
                    await fs.writeFile(casesPath, JSON.stringify(cases, null, 2));
                    
                    console.log(`[Text Handler] ✅ Field "${textData.updateField}" updated successfully`);
                    
                } else {
                    // Regular text message - treat as address
                    const addressText = textData.text.trim();
                    cases[caseIndex].full_address = addressText;
                    
                    // Store chatId for future communication (if not already stored)
                    if (!cases[caseIndex].telegramChatId) {
                        cases[caseIndex].telegramChatId = textData.chatId;
                        console.log(`[Text Handler] ✅ Stored chatId ${textData.chatId} for case ${cases[caseIndex].id}`);
                    }
                    
                    cases[caseIndex].updatedAt = new Date().toISOString();

                    await fs.writeFile(casesPath, JSON.stringify(cases, null, 2));
                    console.log(`[Text Handler] ✅ Address saved for case ${cases[caseIndex].id} (matched by ${matchMethod})`);
                    console.log(`[Text Handler] Address: ${addressText.substring(0, 100)}${addressText.length > 100 ? '...' : ''}`);

                    // Check if we should trigger automatic quotation
                    await checkAndGenerateQuoteIfReady(cases[caseIndex]);

                    // Send confirmation message to user
                    try {
                        await bot.sendMessage(
                            textData.chatId,
                            '✅ Thank you! Your address has been received and saved.\n\nWe\'ll use this information to prepare your quote. If you have photos to share, please upload them now.'
                        );
                        console.log(`[Text Handler] ✅ Confirmation message sent to chatId ${textData.chatId}`);
                    } catch (confirmError) {
                        console.warn(`[Text Handler] ⚠️ Could not send confirmation message:`, confirmError.message);
                    }
                }
            } else {
                console.warn('[Text Handler] ⚠️ Could not find matching case for text message');
                console.warn('[Text Handler] Search criteria:', {
                    chatId: textData.chatId,
                    phoneNumber: textData.phoneNumber,
                    totalCases: cases.length
                });
                console.warn('[Text Handler] Available cases:', cases.map(c => ({
                    id: c.id,
                    hasChatId: !!c.telegramChatId,
                    chatId: c.telegramChatId,
                    phone: c.analysis?.contact_number,
                    hasAddress: !!c.full_address
                })));

                // Try to send helpful message to user
                try {
                    await bot.sendMessage(
                        textData.chatId,
                        '⚠️ I received your message, but I couldn\'t link it to an active case. Please make sure you\'ve sent /start first, or provide your Case ID (e.g., CASE-1234567890).'
                    );
                } catch (errorMsgError) {
                    console.warn(`[Text Handler] ⚠️ Could not send error message:`, errorMsgError.message);
                }
            }
        } catch (error) {
            console.error('[Text Handler] ❌ Error handling Telegram text:', error);
            console.error('[Text Handler] Error stack:', error.stack);
            
            // Try to send error message to user
            try {
                await bot.sendMessage(
                    textData.chatId,
                    '❌ Sorry, there was an error processing your message. Please try again or contact support.'
                );
            } catch (errorMsgError) {
                console.error('[Text Handler] ❌ Could not send error message:', errorMsgError);
            }
        }
        
        console.log('[Text Handler] ========== Text processing complete ==========');
    }
);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'HVAC AI Assistant API is running' });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/contractor', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/contractor.html'));
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 HVAC AI Assistant server running on http://localhost:${PORT}`);
    console.log(`📱 Telegram bot is active and listening for messages`);
    console.log(`👤 Client interface: http://localhost:${PORT}`);
    console.log(`🔧 Contractor portal: http://localhost:${PORT}/contractor`);
    
    // Start auto-quotation scheduler
    startScheduler();
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    stopScheduler();
    server.close(() => {
        console.log('HTTP server closed');
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    stopScheduler();
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
