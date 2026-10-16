const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Store pending picture requests by phone number
const pendingRequests = new Map();
// Store pending picture requests by case ID for better matching
const pendingRequestsByCaseId = new Map();
// Store pending field updates
const pendingFieldUpdates = new Map(); // Key: chatId, Value: {caseId, field, awaitingValue}

// Path to pending requests file
const pendingRequestsPath = path.join(__dirname, '../data/pending-requests.json');

/**
 * Load pending requests from disk
 */
async function loadPendingRequests() {
    try {
        const data = await fs.readFile(pendingRequestsPath, 'utf8');
        const saved = JSON.parse(data);
        
        // Clear existing maps
        pendingRequests.clear();
        pendingRequestsByCaseId.clear();
        
        // Restore pending requests
        if (saved.byPhone && Array.isArray(saved.byPhone)) {
            for (const [phone, request] of saved.byPhone) {
                pendingRequests.set(phone, request);
            }
        }
        
        if (saved.byCaseId && Array.isArray(saved.byCaseId)) {
            for (const [caseId, request] of saved.byCaseId) {
                pendingRequestsByCaseId.set(caseId, request);
            }
        }
        
        console.log(`[Telegram] ✅ Loaded ${pendingRequests.size} pending requests by phone, ${pendingRequestsByCaseId.size} by case ID`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist yet, that's okay
            console.log('[Telegram] No existing pending requests file, starting fresh');
        } else {
            console.error('[Telegram] Error loading pending requests:', error.message);
        }
    }
}

/**
 * Save pending requests to disk
 */
async function savePendingRequests() {
    try {
        // Ensure data directory exists
        const dataDir = path.dirname(pendingRequestsPath);
        await fs.mkdir(dataDir, { recursive: true });
        
        // Convert Maps to arrays for JSON serialization
        const data = {
            byPhone: Array.from(pendingRequests.entries()),
            byCaseId: Array.from(pendingRequestsByCaseId.entries()),
            lastUpdated: new Date().toISOString()
        };
        
        await fs.writeFile(pendingRequestsPath, JSON.stringify(data, null, 2));
        console.log(`[Telegram] 💾 Saved ${pendingRequests.size} pending requests by phone, ${pendingRequestsByCaseId.size} by case ID`);
    } catch (error) {
        console.error('[Telegram] Error saving pending requests:', error.message);
    }
}

// Load pending requests when module initializes
loadPendingRequests().catch(err => {
    console.error('[Telegram] Failed to load pending requests on startup:', err);
});

/**
 * Initialize Telegram bot with message handlers
 */
/**
 * Initialize Telegram bot with message handlers
 */
function initializeTelegramBot(onImageReceived, onTextReceived) {
    console.log('Telegram bot initialized and listening...');

    // Handle photo uploads
    bot.on('photo', async (msg) => {
        console.log('[Telegram] 📸 Photo received from chatId:', msg.chat.id);
        
        try {
            const chatId = msg.chat.id;
            const phoneNumber = msg.from?.phone_number || msg.chat.id.toString();
            const caption = msg.caption || '';
            const timestamp = new Date().toISOString();
            
            // Get the largest photo (last in the array)
            const photos = msg.photo;
            if (!photos || photos.length === 0) {
                console.error('[Telegram] ❌ No photo data found in message');
                return;
            }
            
            const largestPhoto = photos[photos.length - 1];
            const fileId = largestPhoto.file_id;
            
            console.log('[Telegram] Photo details:', {
                chatId,
                phoneNumber,
                caption: caption || 'no caption',
                fileId,
                photoCount: photos.length,
                largestSize: `${largestPhoto.width}x${largestPhoto.height}`
            });
            
            // Download the file
            try {
                const fileInfo = await bot.getFile(fileId);
                console.log('[Telegram] File info retrieved:', {
                    fileId: fileInfo.file_id,
                    fileSize: fileInfo.file_size,
                    filePath: fileInfo.file_path
                });
                
                // Create uploads directory if it doesn't exist
                const uploadsDir = path.join(__dirname, '../data/uploads');
                await fs.mkdir(uploadsDir, { recursive: true });
                
                // Generate unique filename
                const fileExtension = fileInfo.file_path?.split('.').pop() || 'jpg';
                const fileName = `${Date.now()}_${fileId}.${fileExtension}`;
                const filePath = path.join(uploadsDir, fileName);
                
                // Download the file - bot.downloadFile saves to the directory using file_path structure
                console.log('[Telegram] Downloading file...');
                const downloadedPath = await bot.downloadFile(fileId, uploadsDir);
                
                // The downloadedPath will be the full path to the downloaded file
                // Telegram API may create subdirectories based on file_path, so we need to handle that
                let actualFilePath = downloadedPath;
                
                // If the file was downloaded with a different name, rename it
                if (downloadedPath !== filePath) {
                    try {
                        // Check if the downloaded file exists
                        await fs.access(downloadedPath);
                        // Rename to our desired filename
                        await fs.rename(downloadedPath, filePath);
                        actualFilePath = filePath;
                        console.log('[Telegram] ✅ File saved as:', fileName);
                    } catch (renameError) {
                        // If rename fails, use the actual downloaded path
                        console.warn('[Telegram] ⚠️ Could not rename file, using downloaded path:', downloadedPath);
                        actualFilePath = downloadedPath;
                    }
                } else {
                    console.log('[Telegram] ✅ File saved as:', fileName);
                }
                
                // Prepare image data for callback
                const imageData = {
                    chatId,
                    phoneNumber,
                    fileUrl: actualFilePath,
                    fileId,
                    caption,
                    timestamp,
                    fileName: path.basename(actualFilePath)
                };
                
                console.log('[Telegram] 📤 Calling onImageReceived callback with:', {
                    chatId: imageData.chatId,
                    phoneNumber: imageData.phoneNumber,
                    fileName: imageData.fileName,
                    hasCaption: !!imageData.caption
                });
                
                if (onImageReceived) {
                    await onImageReceived(imageData);
                }
                
                // Send confirmation to user
                try {
                    await bot.sendMessage(chatId, '✅ Photo received! Thank you for uploading. We\'ll review it and get back to you soon.');
                } catch (confirmError) {
                    console.warn('[Telegram] ⚠️ Could not send confirmation message:', confirmError.message);
                }
                
            } catch (downloadError) {
                console.error('[Telegram] ❌ Error downloading photo:', downloadError);
                console.error('[Telegram] Error details:', downloadError.message);
                
                // Try to send error message to user
                try {
                    await bot.sendMessage(chatId, '❌ Sorry, there was an error processing your photo. Please try uploading again.');
                } catch (errorMsgError) {
                    console.error('[Telegram] ❌ Could not send error message:', errorMsgError);
                }
            }
        } catch (error) {
            console.error('[Telegram] ❌ Error handling photo:', error);
            console.error('[Telegram] Error stack:', error.stack);
        }
    });

    // Handle text messages
    bot.on('message', async (msg) => {
        // Skip if it's a photo message (already handled above)
        if (msg.photo) return;

        const chatId = msg.chat.id;
        const text = msg.text;
        const phoneNumber = msg.from.phone_number || msg.chat.id.toString();

        console.log(`[Telegram] Received message from chatId ${chatId}, phone: ${phoneNumber}, text: ${text}`);

        if (text === '/start') {
            // Try phone number match first
            const normalizedPhone = normalizePhoneNumber(phoneNumber);
            console.log(`[Telegram] /start command - trying to match phone: ${normalizedPhone}`);
            
            // Debug: Log all pending requests
            console.log(`[Telegram] 📋 Current pending requests:`);
            console.log(`[Telegram]   - By phone: ${pendingRequests.size} requests`);
            console.log(`[Telegram]   - By case ID: ${pendingRequestsByCaseId.size} requests`);
            if (pendingRequestsByCaseId.size > 0) {
                const caseIds = Array.from(pendingRequestsByCaseId.keys());
                console.log(`[Telegram]   - Available Case IDs: ${caseIds.join(', ')}`);
            }
            
            let pendingRequest = getPendingRequest(phoneNumber);
            
            if (pendingRequest) {
                console.log(`[Telegram] ✅ Found pending request by phone number for case ${pendingRequest.caseId}`);
                await sendPendingMessageAndStoreChatId(bot, chatId, pendingRequest);
                // Clear the pending request after sending
                await clearPendingRequestByCaseId(pendingRequest.caseId);
            } else {
                // No phone match - ask for Case ID
                console.log(`[Telegram] ⚠️ No pending request found for phone ${normalizedPhone}`);
                
                // Build message with available Case IDs if any
                let message = '👋 Hi! Welcome to HVAC FD Assistant!\n\n';
                
                if (pendingRequestsByCaseId.size > 0) {
                    const caseIds = Array.from(pendingRequestsByCaseId.keys());
                    message += `I found ${pendingRequestsByCaseId.size} pending request(s). To retrieve your photo request, please send your **Case ID**.\n\n`;
                    message += `**Available Case IDs:**\n`;
                    caseIds.forEach(id => {
                        message += `• ${id}\n`;
                    });
                    message += '\n';
                } else {
                    message += 'To retrieve your photo request, please send your **Case ID**.\n\n';
                }
                
                message += 'You can find your Case ID in the message you received after your call (it looks like: CASE-1234567890).\n\n';
                message += 'Just type or paste your Case ID here.';
                
                await bot.sendMessage(chatId, message);
            }
        } else if (text && text.trim().toUpperCase().startsWith('CASE-')) {
            // User provided Case ID - try to match
            const caseId = text.trim().toUpperCase();
            console.log(`[Telegram] User provided Case ID: ${caseId}`);
            
            const pendingRequest = getPendingRequestByCaseId(caseId);
            
            if (pendingRequest) {
                console.log(`[Telegram] ✅ Found pending request by Case ID ${caseId}`);
                await sendPendingMessageAndStoreChatId(bot, chatId, pendingRequest);
                // Clear the pending request after sending
                await clearPendingRequestByCaseId(caseId);
            } else {
                console.log(`[Telegram] ❌ No pending request found for Case ID ${caseId}`);
                
                // Show available Case IDs if any
                let errorMessage = '❌ Sorry, I couldn\'t find a pending request for that Case ID.\n\n';
                
                if (pendingRequestsByCaseId.size > 0) {
                    const caseIds = Array.from(pendingRequestsByCaseId.keys());
                    errorMessage += `**Available Case IDs:**\n`;
                    caseIds.forEach(id => {
                        errorMessage += `• ${id}\n`;
                    });
                    errorMessage += '\n';
                }
                
                errorMessage += 'Please make sure you\'ve entered the correct Case ID (e.g., CASE-1234567890).\n\n';
                errorMessage += 'If you need help, please contact our support team.';
                
                await bot.sendMessage(chatId, errorMessage);
            }
        } else {
            // Check if user is updating a field
            const pendingUpdate = pendingFieldUpdates.get(chatId);
            
            if (pendingUpdate && pendingUpdate.awaitingValue) {
                console.log(`[Telegram] Processing field update for case ${pendingUpdate.caseId}, field: ${pendingUpdate.field}`);
                
                // Call onTextReceived with update information
                if (onTextReceived) {
                    await onTextReceived({
                        chatId,
                        phoneNumber,
                        text,
                        timestamp: new Date(),
                        isFieldUpdate: true,
                        updateField: pendingUpdate.field,
                        caseId: pendingUpdate.caseId
                    });
                }
                
                // Clear the pending update
                pendingFieldUpdates.delete(chatId);
                
                await bot.sendMessage(chatId, `✅ ${pendingUpdate.field.charAt(0).toUpperCase() + pendingUpdate.field.slice(1)} updated successfully!`);
            } else if (text && text.trim().toUpperCase() === 'CONFIRM') {
                // Handle manual CONFIRM text
                console.log(`[Telegram] Manual CONFIRM received from ${chatId}`);
                
                if (onTextReceived) {
                    await onTextReceived({
                        chatId,
                        phoneNumber,
                        text,
                        timestamp: new Date(),
                        isConfirmation: true
                    });
                }
            } else {
                // Treat other text as potential address or info
                console.log(`[Telegram] Received text from ${chatId}: ${text}`);
                if (onTextReceived) {
                    await onTextReceived({
                        chatId,
                        phoneNumber,
                        text,
                        timestamp: new Date()
                    });
                }
            }
        }
    });

    // Error handling
    bot.on('polling_error', (error) => {
        console.error('Telegram polling error:', error);
    });

    // Handle callback queries (button clicks)
    bot.on('callback_query', async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;
        const messageId = query.message.message_id;

        console.log('[Telegram Callback] Button clicked:', data, 'from chatId:', chatId);

        try {
            // Parse the callback data
            if (data.startsWith('update_')) {
                // Extract field and caseId
                const parts = data.split('_');
                const field = parts[1]; // name, phone, address, issue
                const caseId = parts.slice(2).join('_'); // rejoin in case caseId has underscores

                console.log('[Telegram Callback] Update request:', { field, caseId });

                // Store pending update
                pendingFieldUpdates.set(chatId, {
                    caseId,
                    field,
                    awaitingValue: true
                });

                // Prompt user for new value
                const fieldNames = {
                    name: 'Name',
                    phone: 'Phone Number',
                    address: 'Complete Address',
                    issue: 'Issue Description'
                };

                await bot.sendMessage(
                    chatId,
                    `✏️ Please send the new **${fieldNames[field]}**:`,
                    { parse_mode: 'Markdown' }
                );

                // Answer the callback query
                await bot.answerCallbackQuery(query.id, {
                    text: `Please send the new ${fieldNames[field]}`
                });

            } else if (data.startsWith('confirm_all_')) {
                // Extract caseId
                const caseId = data.replace('confirm_all_', '');

                console.log('[Telegram Callback] Confirmation received for case:', caseId);

                // Call the onTextReceived callback with confirmation flag
                if (onTextReceived) {
                    await onTextReceived({
                        chatId,
                        text: 'CONFIRM',
                        caseId,
                        isConfirmation: true
                    });
                }

                // Answer the callback query
                await bot.answerCallbackQuery(query.id, {
                    text: '✅ Details confirmed!'
                });

                // Send confirmation message
                await bot.sendMessage(
                    chatId,
                    '✅ Thank you for confirming! We\'re processing your request now.',
                    { parse_mode: 'Markdown' }
                );
            }

        } catch (error) {
            console.error('[Telegram Callback] Error handling callback:', error);
            await bot.answerCallbackQuery(query.id, {
                text: '❌ Error processing request'
            });
        }
    });
}

/**
 * Send picture request to client via Telegram
 */
async function requestPictures(phoneNumber, caseId, pictureDetails, problemSummary = "HVAC Inspection Required", clientName = null, chatId = null) {
    try {
        console.log('[Telegram] ========== requestPictures called ==========');
        console.log('[Telegram] Parameters:', {
            phoneNumber: phoneNumber || '❌ missing',
            caseId: caseId || '❌ missing',
            pictureDetails: pictureDetails || '❌ missing',
            problemSummary: problemSummary || '❌ missing',
            clientName: clientName || 'not provided',
            chatId: chatId || 'not available'
        });
        
        // Personalize greeting
        const greeting = clientName ? `Hi ${clientName}! 👋` : 'Hi there! 👋';
        
        // Create personalized message
        const message = `${greeting}

Thank you for calling HVAC AI Assistant. We've analyzed your request:

📋 **Your Issue:** ${problemSummary}

To provide you with the most accurate quote, we need:

📸 **Photos Needed:**
${pictureDetails}

📍 **Complete Address:**
Please reply with your **Door Number, Street Name, and City**.

**How to Send:**
- Reply directly to this chat with your address
- Upload the photos here as well

**Case ID:** ${caseId}

Our team will review your photos and send you a detailed quote within 2 hours.`;

        console.log('[Telegram] Generated message length:', message.length, 'characters');
        console.log('[Telegram] Message preview:', message.substring(0, 100) + '...');

        // Normalize phone number for consistent matching
        const normalizedPhone = normalizePhoneNumber(phoneNumber);
        console.log('[Telegram] Phone number normalization:', {
            original: phoneNumber,
            normalized: normalizedPhone
        });
        
        // Store the pending request by phone number
        const requestData = {
            caseId,
            pictureDetails,
            problemSummary,
            clientName,
            message,
            phoneNumber: normalizedPhone,
            timestamp: new Date()
        };
        
        pendingRequests.set(normalizedPhone, requestData);
        // Also store by case ID for alternative matching
        pendingRequestsByCaseId.set(caseId, requestData);
        
        // Save to disk
        await savePendingRequests();
        
        console.log(`[Telegram] ✅ Stored pending request:`);
        console.log(`[Telegram]   - By phone: ${normalizedPhone}`);
        console.log(`[Telegram]   - By caseId: ${caseId}`);
        console.log(`[Telegram]   - Total pending by phone: ${pendingRequests.size}`);
        console.log(`[Telegram]   - Total pending by caseId: ${pendingRequestsByCaseId.size}`);

        let messageSent = false;
        let errorMessage = null;

        // If chatId is available, send message immediately
        if (chatId) {
            console.log(`[Telegram] 📤 chatId available (${chatId}), attempting to send message immediately...`);
            try {
                await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                messageSent = true;
                console.log(`[Telegram] ✅ Picture request sent successfully to chatId: ${chatId} for case: ${caseId}`);
            } catch (telegramError) {
                console.error(`[Telegram] ❌ Failed to send message to chatId ${chatId}:`, telegramError.message);
                console.error(`[Telegram] Error details:`, telegramError);
                errorMessage = telegramError.message;
                // Continue - message is stored and will be sent when user starts conversation
                console.log(`[Telegram] ⚠️ Message stored for later delivery when user starts conversation`);
            }
        } else {
            console.log(`[Telegram] ⚠️ No chatId available for ${phoneNumber}. Message stored and will be sent when user starts conversation with bot.`);
            console.log(`[Telegram] Instructions for user: Send /start to @HVACFDA_bot or provide Case ID: ${caseId}`);
        }

        const result = {
            success: true,
            message,
            messageSent,
            chatId: chatId || null,
            error: errorMessage,
            note: messageSent ? 'Message sent successfully via Telegram.' : 'User must initiate contact with bot first. Message will be sent when they start conversation.'
        };
        
        console.log('[Telegram] Returning result:', JSON.stringify(result, null, 2));
        console.log('[Telegram] ========== requestPictures complete ==========');
        
        return result;
    } catch (error) {
        console.error('[Telegram] ❌ Exception in requestPictures:', error);
        console.error('[Telegram] Error stack:', error.stack);
        throw error;
    }
}

/**
 * Send message to a specific chat ID
 */
async function sendMessage(chatId, message) {
    try {
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        return { success: true };
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
}

/**
 * Helper function to send pending message and store chatId
 */
async function sendPendingMessageAndStoreChatId(bot, chatId, pendingRequest) {
    try {
        // Try sending with Markdown first
        try {
            await bot.sendMessage(chatId, pendingRequest.message, { parse_mode: 'Markdown' });
            console.log(`[Telegram] ✅ Sent pending message to chatId ${chatId} for case ${pendingRequest.caseId} (with Markdown)`);
        } catch (markdownError) {
            // If Markdown fails, send as plain text
            console.warn(`[Telegram] ⚠️ Markdown parse failed, sending as plain text:`, markdownError.message);
            await bot.sendMessage(chatId, pendingRequest.message);
            console.log(`[Telegram] ✅ Sent pending message to chatId ${chatId} for case ${pendingRequest.caseId} (as plain text)`);
        }
        
        // Store chatId in case for future messages
        const fs = require('fs').promises;
        const path = require('path');
        const casesPath = path.join(__dirname, '../data/cases.json');
        
        console.log(`[Telegram] Attempting to store chatId ${chatId} for case ${pendingRequest.caseId}`);
        
        try {
            const casesData = await fs.readFile(casesPath, 'utf8');
            const cases = JSON.parse(casesData);
            const caseIndex = cases.findIndex(c => c.id === pendingRequest.caseId);
            
            if (caseIndex !== -1) {
                cases[caseIndex].telegramChatId = chatId;
                cases[caseIndex].updatedAt = new Date().toISOString();
                await fs.writeFile(casesPath, JSON.stringify(cases, null, 2));
                console.log(`[Telegram] ✅ Stored chatId ${chatId} for case ${pendingRequest.caseId}`);
            } else {
                console.warn(`[Telegram] ⚠️ Case ${pendingRequest.caseId} not found in cases.json`);
            }
        } catch (error) {
            console.error('[Telegram] ❌ Error storing chatId:', error);
        }
    } catch (error) {
        console.error('[Telegram] ❌ Error sending pending message:', error);
        console.error('[Telegram] Error details:', error);
        // Only send fallback if we couldn't send the message at all
        try {
            await bot.sendMessage(
                chatId,
                '👋 Welcome to HVAC FD Assistant!\n\nIf you received a message from us, please send your **Complete Address (Door #, Street)** and the requested **Photos** here.'
            );
        } catch (fallbackError) {
            console.error('[Telegram] ❌ Even fallback message failed:', fallbackError);
        }
    }
}

/**
 * Normalize phone number for consistent matching
 */
function normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    // Remove all non-digit characters except +
    let normalized = phoneNumber.toString().replace(/[^\d+]/g, '');
    // Remove leading + if present (we'll add it back if needed)
    if (normalized.startsWith('+')) {
        normalized = normalized.substring(1);
    }
    // Try to match with and without country code
    return normalized;
}

/**
 * Get pending request for a phone number (tries multiple formats)
 */
function getPendingRequest(phoneNumber) {
    if (!phoneNumber) return null;
    
    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized) return null;
    
    // Try exact match
    let request = pendingRequests.get(normalized);
    if (request) return request;
    
    // Try with + prefix
    request = pendingRequests.get('+' + normalized);
    if (request) return request;
    
    // Try without + prefix (already tried, but keep for clarity)
    // Try last 10 digits (US phone number)
    if (normalized.length >= 10) {
        const last10 = normalized.slice(-10);
        for (const [key, value] of pendingRequests.entries()) {
            const keyNormalized = normalizePhoneNumber(key);
            if (keyNormalized && keyNormalized.slice(-10) === last10) {
                return value;
            }
        }
    }
    
    return null;
}

/**
 * Get pending request by case ID
 */
function getPendingRequestByCaseId(caseId) {
    if (!caseId) return null;
    return pendingRequestsByCaseId.get(caseId);
}

/**
 * Clear pending request
 */
async function clearPendingRequest(phoneNumber) {
    if (!phoneNumber) return;
    const normalized = normalizePhoneNumber(phoneNumber);
    if (normalized) {
        const request = pendingRequests.get(normalized);
        if (request && request.caseId) {
            pendingRequestsByCaseId.delete(request.caseId);
        }
        pendingRequests.delete(normalized);
        // Save to disk
        await savePendingRequests();
    }
}

/**
 * Clear pending request by case ID
 */
async function clearPendingRequestByCaseId(caseId) {
    if (!caseId) return;
    const request = pendingRequestsByCaseId.get(caseId);
    if (request && request.phoneNumber) {
        pendingRequests.delete(request.phoneNumber);
    }
    pendingRequestsByCaseId.delete(caseId);
    // Save to disk
    await savePendingRequests();
}

/**
 * Send a document (PDF) to a chat ID
 */
async function sendDocument(chatId, buffer, filename, caption) {
    try {
        await bot.sendDocument(chatId, buffer, {
            caption: caption,
            parse_mode: 'Markdown'
        }, {
            filename: filename,
            contentType: 'application/pdf'
        });
        return { success: true };
    } catch (error) {
        console.error('Error sending document:', error);
        throw error;
    }
}

/**
 * Send confirmation summary with update buttons
 */
async function sendConfirmationMessage(phoneNumber, caseId, clientName, zipCode, address, problemSummary, pictureDetails, chatId = null) {
    try {
        console.log('[Telegram Confirmation] ========== sendConfirmationMessage called ==========');
        console.log('[Telegram Confirmation] Parameters:', {
            phoneNumber, caseId, clientName, zipCode, address: address || 'not provided', chatId
        });

        // Create detailed summary message
        const message = `👋 Hi ${clientName}! This is HVAC FD Assistant.

📋 **Summary of Your Request:**

👤 **Name:** ${clientName}
📞 **Phone:** ${phoneNumber}
📍 **Zip Code:** ${zipCode}
${address ? `🏠 **Address:** ${address}\n` : ''}🔧 **Issue:** ${problemSummary}

${pictureDetails ? `📸 **Please send photos:** ${pictureDetails}\n\n` : ''}📍 **Please confirm/send complete address:** Street #, Street Name, City, State, ZIP

✅ **If all details are correct**, reply with "CONFIRM"
✏️ **To update any detail**, use the buttons below:`;

        // Create inline keyboard with update buttons
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✏️ Update Name', callback_data: `update_name_${caseId}` },
                    { text: '✏️ Update Phone', callback_data: `update_phone_${caseId}` }
                ],
                [
                    { text: '✏️ Update Address', callback_data: `update_address_${caseId}` },
                    { text: '✏️ Update Issue', callback_data: `update_issue_${caseId}` }
                ],
                [
                    { text: '✅ All Correct - CONFIRM', callback_data: `confirm_all_${caseId}` }
                ]
            ]
        };

        // Normalize phone number
        const normalizedPhone = normalizePhoneNumber(phoneNumber);
        
        // Store the pending request
        const requestData = {
            caseId,
            pictureDetails,
            problemSummary,
            clientName,
            zipCode,
            address,
            phoneNumber: normalizedPhone,
            message,
            timestamp: new Date()
        };
        
        pendingRequests.set(normalizedPhone, requestData);
        pendingRequestsByCaseId.set(caseId, requestData);
        await savePendingRequests();

        let messageSent = false;

        // If chatId is available, send message immediately
        if (chatId) {
            console.log(`[Telegram Confirmation] 📤 Sending to chatId: ${chatId}`);
            try {
                await bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
                messageSent = true;
                console.log(`[Telegram Confirmation] ✅ Message sent successfully`);
            } catch (error) {
                console.error(`[Telegram Confirmation] ❌ Failed to send:`, error.message);
            }
        } else {
            console.log(`[Telegram Confirmation] ⚠️ No chatId, message will be sent when user starts conversation`);
        }

        return {
            success: true,
            messageSent,
            phoneNumber: normalizedPhone,
            caseId
        };

    } catch (error) {
        console.error('[Telegram Confirmation] ❌ Error:', error);
        throw error;
    }
}

module.exports = {
    initializeTelegramBot,
    requestPictures,
    sendConfirmationMessage,
    sendMessage,
    sendDocument,
    getPendingRequest,
    getPendingRequestByCaseId,
    clearPendingRequest,
    clearPendingRequestByCaseId,
    bot
};
