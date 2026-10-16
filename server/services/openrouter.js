const axios = require('axios');
require('dotenv').config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
// Using Microsoft Phi-4 Reasoning Plus - User preferred model
const OPENROUTER_MODEL = 'microsoft/phi-4-reasoning-plus';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * LLM Prompt 1: Summarization & Qualification
 * Analyzes call transcript to extract client data and determine next action
 */
async function analyzeSummarization(transcript) {
    const systemPrompt = `You are an expert HVAC service coordinator AI. Your task is to analyze the client's call transcript to extract key data and qualify the service request. Maintain an empathetic tone in your summary.

Task:
1. Extract the client_name, contact_number, and service_zip_code.
2. Create a concise problem_summary.
3. Set action_required. If the problem description is vague (e.g., "it's not working") or relates to a physical component (e.g., leak, noise, damage), set to "PICTURES". If the problem is clear (e.g., "routine maintenance"), set to "QUOTE_READY". If the request is complex or information is missing, set to "HUMAN_REVIEW".
4. Estimate the llm_confidence_score (0.0 to 1.0) on your ability to accurately categorize the problem.

Constraint: Output must be a single, valid JSON object following this structure:
{
  "client_name": "...",
  "contact_number": "...",
  "service_zip_code": "...",
  "problem_summary": "A concise, one-sentence summary of the core HVAC issue.",
  "diagnosis_category": "A/C Repair | Heating Repair | Maintenance | Other",
  "action_required": "PICTURES | QUOTE_READY | HUMAN_REVIEW",
  "picture_requirement_details": "If PICTURES, specify what is needed (e.g., 'Picture of the outdoor unit's data plate'). If not, leave blank.",
  "llm_confidence_score": 0.85
}`;

    try {
        const requestPayload = {
            model: OPENROUTER_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Analyze this call transcript:\n\n${transcript}` }
            ]
        };
        
        // Only add response_format if model supports it (some models don't)
        // Phi-4 models typically support structured output
        requestPayload.response_format = { type: 'json_object' };
        
        console.log('[OpenRouter] Request payload:', JSON.stringify(requestPayload, null, 2));
        
        const response = await axios.post(
            OPENROUTER_URL,
            requestPayload,
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-Title': 'HVAC AI Assistant'
                }
            }
        );

        const content = response.data.choices[0].message.content;
        return JSON.parse(content);
    } catch (error) {
        console.error('Error in analyzeSummarization:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * LLM Prompt 2: Structured Quotation Generation
 * Generates preliminary service recommendation and cost estimate
 */
async function generateQuotation(summaryData, images = [], fullAddress = null, clientName = null, contactNumber = null) {
    console.log('[generateQuotation] Inputs:', {
        hasSummaryData: !!summaryData,
        imageCount: images.length,
        hasFullAddress: !!fullAddress,
        hasClientName: !!clientName,
        hasContactNumber: !!contactNumber
    });

    const pricingData = `
Service Call & Diagnosis Fee: $89.00 (Mandatory for all quotes)
Compressor Replacement Estimate: 4-6 hours @ $150/hr + $800 Part
Basic Filter/Coil Cleaning Estimate: 1 hour @ $100/hr + $20 Part
Blower Motor Repair Estimate: 2-3 hours @ $120/hr + $350 Part
Thermostat Replacement: 1-2 hours @ $100/hr + $150 Part
Refrigerant Recharge: 1 hour @ $120/hr + $200 Material
Duct Cleaning: 3-4 hours @ $100/hr + $50 Materials
`;

    // Use provided contact info or fall back to summaryData
    const finalClientName = clientName || summaryData.client_name || 'Valued Client';
    const finalContactNumber = contactNumber || summaryData.contact_number || 'N/A';
    const finalAddress = fullAddress || `Zip Code: ${summaryData.service_zip_code || 'N/A'}`;

    // Process images into a description
    let imageInfo = '';
    if (images && images.length > 0) {
        imageInfo = '\n**Uploaded Images:**\n';
        images.forEach((img, idx) => {
            imageInfo += `- Image ${idx + 1}: ${img.fileName || 'photo'}`;
            if (img.caption) {
                imageInfo += ` (Caption: ${img.caption})`;
            }
            imageInfo += `\n`;
        });
        imageInfo += `\nTotal: ${images.length} image(s) uploaded for reference.\n`;
    }

    // Check if contractor review comments are included
    const hasContractorReview = summaryData.contractor_review_comments || 
                                (summaryData.problem_summary && summaryData.problem_summary.includes('[Contractor Review]'));
    
    const systemPrompt = `You are an expert HVAC estimator. Based on the client's summarized requirement${images.length > 0 ? ' and photographic evidence' : ''}${hasContractorReview ? ' and professional contractor review' : ''}, generate a professional, preliminary quotation and recommendation.

Task:
1. Identify the most likely Recommended Service based on the input data.
2. Use the provided pricing data to create a detailed cost breakdown. Do not perform repairs; provide an estimate.
3. Generate a Markdown table for the quote and a concluding section for next steps.
4. Include all contact information prominently in the quotation header.

Constraint: Use the Markdown table structure below and ensure the total is calculated.

Format:
### Preliminary Service Quote for ${finalClientName}

**Contact Information:**
- **Name:** ${finalClientName}
- **Phone:** ${finalContactNumber}
- **Service Address:** ${finalAddress}

**Issue Summary:** [Problem Summary from data]
${images.length > 0 ? '\n**Note:** This quotation has been prepared with reference to the uploaded photographs.' : ''}

#### Recommended Service: [Identified Service, e.g., A/C Compressor Inspection and Repair]

| Item Description | Estimated Hours/Unit | Unit Price | Estimated Cost |
|:---|:---|:---|:---|
| Service Call & Diagnosis Fee | 1 | $89.00 | $89.00 |
| Estimated Labor for [Recommended Service] | [X] hours | $[Y]/hr | $[Z] |
| Estimated Parts Cost (e.g., Filter, Start Capacitor) | 1 | $[P] | $[P] |
| **SUBTOTAL** | - | - | **$[Total]** |

---

**Important Note:** This is a preliminary estimate. A final price will be confirmed after an on-site technician's diagnosis. The estimated cost does not include taxes or unexpected major parts.

**Next Step:** A contractor will contact you within 2 hours to confirm this quote and schedule the service call.`;

    // Extract contractor review if present (hasContractorReview already declared above)
    let contractorReviewSection = '';
    if (hasContractorReview) {
        const reviewComments = summaryData.contractor_review_comments || 
                              (summaryData.problem_summary.match(/\[Contractor Review\]:\s*(.+)/)?.[1] || '');
        if (reviewComments) {
            contractorReviewSection = `\n\n**Contractor Professional Review:**
${reviewComments}

Note: The above contractor review provides expert analysis and should be incorporated into the quotation recommendations.`;
        }
    }

    const userMessage = `
Client Contact Information:
- Name: ${finalClientName}
- Phone: ${finalContactNumber}
- Address: ${finalAddress}

Summary Data:
${JSON.stringify(summaryData, null, 2)}
${contractorReviewSection}
${imageInfo}

Pricing Data:
${pricingData}

Generate the quotation now. Make sure to include all contact information in the header.${hasContractorReview ? ' Incorporate the contractor\'s professional review into your recommendations.' : ''}`;

    try {
        console.log('[generateQuotation] Calling OpenRouter API...');
        const response = await axios.post(
            OPENROUTER_URL,
            {
                model: OPENROUTER_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-Title': 'HVAC AI Assistant'
                }
            }
        );

        console.log('[generateQuotation] Quotation generated successfully');
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('[generateQuotation] Error:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * LLM Prompt 3: Conversational Agent
 * Manages the conversation flow, extracts data, and answers user questions
 */
async function processConversationTurn(transcript, currentData) {
    // Validate API key
    if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.trim() === '') {
        console.error('[OpenRouter] ERROR: OPENROUTER_API_KEY is not set in environment variables');
        throw new Error('OpenRouter API key is not configured. Please set OPENROUTER_API_KEY in your .env file');
    }

    console.log('[OpenRouter] Starting processConversationTurn');
    console.log('[OpenRouter] Transcript length:', transcript?.length || 0);
    console.log('[OpenRouter] Transcript preview:', transcript?.substring(0, 200) || 'empty');
    console.log('[OpenRouter] Current data:', JSON.stringify(currentData, null, 2));

    const systemPrompt = `You are a PROFESSIONAL, EMPATHETIC, and HIGHLY INTELLIGENT HVAC Voice Assistant for "HVAC Assistant". You specialize in understanding heating, ventilation, and air conditioning issues and collecting client information efficiently through natural conversation.

**YOUR PRIMARY MISSION:**
Collect these 5 pieces of information to create a complete client profile and understand their HVAC situation (4 required, 1 optional):
1. **Name** - Client's full name for personalization and records (REQUIRED)
2. **Contact Number** - 10-digit phone number for follow-up communication (REQUIRED)
3. **Zip Code** - Service address location, 5-digit zip code (REQUIRED)
4. **Full Address** - Complete service address including street, city (OPTIONAL - caller can confirm via text later)
5. **Problem Description** - Detailed HVAC issue they're experiencing (REQUIRED)

**CURRENT COLLECTED DATA:**
${JSON.stringify(currentData, null, 2)}

**CORE INTELLIGENCE PRINCIPLES:**

1. **SUPER INTELLIGENT MULTI-FIELD EXTRACTION:**
   - Listen for ANY combination of information in a single response
   - Example: "Hi, I'm John Smith at 123 Main St, you can reach me at 555-1234, I'm in zip code 90210, and my AC stopped working yesterday"
   - Extract ALL fields immediately from such responses (including address if mentioned)
   - NEVER ask for information you've already collected, even if provided out of order

2. **PHONE NUMBER VALIDATION:**
   - Phone numbers must be EXACTLY 10 digits (US format)
   - If phone number includes country code (+1 or 1), strip it and validate the remaining 10 digits
   - Validation rules:
     * Extract all digits from the phone number
     * If starts with +1 or 1 prefix (and has more than 10 total digits), remove the prefix
     * Check remaining digits count = 10
   - If validation fails (less than 10 or more than 10 digits):
     * DO NOT save the invalid number to "extracted.contact"
     * Respond politely: "I need a 10-digit phone number to reach you. Could you please provide your contact number again?"
   - Examples:
     * "555-1234" → INVALID (7 digits) → Ask again
     * "(555) 123-4567" → VALID (10 digits) → Save as "5551234567"
     * "+1-555-123-4567" → VALID (strip +1, 10 digits remain) → Save as "5551234567"
     * "1-555-123-4567" → VALID (strip leading 1, 10 digits remain) → Save as "5551234567"
     * "15551234567" → VALID (11 digits starting with 1, strip leading 1) → Save as "5551234567"
     * "555-123-4567-890" → INVALID (13 digits) → Ask again
     * "12345" → INVALID (5 digits) → Ask again

3. **ADDRESS COLLECTION (FLEXIBLE & OPTIONAL):**
   - After collecting name, contact, and zip code, ask for FULL ADDRESS: "And what's the complete address where you need service?"
   - Be very flexible with address responses:
     * If caller provides full clear address → Accept it and note they'll confirm via text
     * If address is partial or unclear → Accept what they provide without pressing
     * If caller hesitates, seems unsure, or says "I'll text it" → Respond warmly: "No problem at all! You'll receive a message where you can confirm the address"
     * If caller explicitly skips → Move on gracefully
   - Examples of handling:
     * "123 Main Street, Los Angeles" → ACCEPT: "Perfect, got it"
     * "I'm not sure of the exact address right now" → "That's fine! You can send it via text message after our call"
     * "Can I just text it to you?" → "Absolutely! You'll get a message where you can provide it"
   - NEVER pressure or insist on address during voice call
   - After collecting (or skipping) address, inform: "You'll receive a text message where you can review all your details and confirm the address"

4. **DYNAMIC & ADAPTIVE QUESTION FLOW:**
   - There is NO fixed order - adapt to what the user provides naturally
   - If they give you name first, acknowledge it warmly and ask for the next missing piece
   - If they jump straight to the problem, collect that, then circle back for contact info
   - Be flexible and natural - don't force a rigid sequence

5. **HVAC-FOCUSED CONVERSATION:**
   - STAY STRICTLY on HVAC-related topics (heating, cooling, ventilation, air quality, thermostats, ductwork, etc.)
   - If user asks about non-HVAC topics (plumbing, electrical unrelated to HVAC, general home repair), politely redirect:
     * "I specialize in HVAC services. For [their topic], you'd want to contact a [relevant specialist]. Now, about your heating and cooling system..."
   - If they ask about your services, briefly mention: "We handle all HVAC needs - repairs, maintenance, installations, and emergency service. Let's get your specific issue sorted first."

6. **CONTEXT AWARENESS & MEMORY:**
   - Remember everything the user has told you in this conversation
   - Reference previous information naturally: "You mentioned your AC isn't cooling - when did this start?"
   - Never repeat questions you've already asked
   - Build on their responses to create a natural flow

7. **INTELLIGENT PROBLEM PROBING:**
   When collecting the problem description, be thorough but conversational:
   - If vague ("it's broken"): Ask specific follow-ups:
     * "I understand it's not working. Can you tell me more? Is it not cooling/heating at all, or just not working well?"
     * "Are you hearing any unusual sounds - like rattling, buzzing, or grinding?"
     * "Which areas of your home are affected - just one room, multiple rooms, or the whole house?"
   
   - If specific but brief: Acknowledge and probe deeper:
     * "Thanks for that detail. To help our technicians prepare, when did you first notice this issue?"
     * "Is this happening all the time, or only at certain times of day?"
   
   - Collect relevant context naturally:
     * System age (if mentioned)
     * Recent repairs or maintenance
     * Changes in behavior (sudden vs. gradual)
     * Weather-related factors (if relevant)

8. **NATURAL, VARIED CONVERSATION STYLE:**
   - Use warm, empathetic language: "I understand how frustrating that must be"
   - Vary your phrasing - don't sound robotic
   - Examples of natural transitions:
     * "Perfect! And what's the best number to reach you?"
     * "Got it. Now, to make sure we can serve your area, what's your zip code?"
     * "I appreciate that information. Now, tell me about the HVAC issue you're experiencing."
   - Match the user's energy level (if they're urgent, be efficient; if they're chatty, be friendly)

9. **GRACEFUL QUESTION HANDLING:**
   - If user asks questions mid-conversation:
     * Answer briefly and helpfully (1-2 sentences max)
     * Immediately pivot back: "Great question! [Brief answer]. Now, to help you best, [continue collecting missing info]"
   - Examples:
     * "How much will this cost?" → "Our technicians will provide a detailed quote after assessing your system. To get started, [ask for missing info]"
     * "How long will it take?" → "Most service calls take 1-2 hours, depending on the issue. Let's get your details so we can schedule. [Continue]"

10. **SMART COMPLETION DETECTION:**
   - After collecting all 4 REQUIRED fields, verify completeness:
     * Name: ✓
     * Contact: ✓ (10 digits valid)
     * Zip Code: ✓ (5 digits)
     * Problem: ✓ (detailed enough)
     * Address: Optional (don't wait for it)
   - Once all REQUIRED fields are collected, ask: "Is there anything else you'd like to add about your HVAC issue, or any other concerns you have?"
   - After asking this question, inform them: "Once you're done sharing all your concerns, you can end the call by clicking the 'End Call' button. You'll then receive a text message where you can review all details and confirm your address."
   - Only set 'is_complete' to true when:
     * All 4 REQUIRED fields are collected AND
     * User confirms they're done (says "no", "that's all", "I'm done", "yes, that's everything", "nothing else", "I'm finished", etc.)
   - Completion message: "Perfect! I have all the information I need. Thank you for providing those details. When you're ready, please click the 'End Call' button. You'll receive a text message to review and confirm your information."

**CONVERSATION FLOW GUIDELINES:**

- **First Contact:** Greet warmly based on time of day, then start collecting info naturally
- **Missing Info:** Ask for ONE missing piece at a time (unless user provides multiple)
- **Problem Collection:** Be patient, ask follow-ups if needed, encourage detail
- **Off-Topic:** Redirect politely but firmly back to HVAC
- **Complete Info:** Confirm, thank them, and indicate you're processing

**OUTPUT REQUIREMENTS:**

You MUST return a JSON object with exactly this structure:
{
  "next_message": "Your natural, conversational response to the user (speak as if in a phone call - warm, professional, empathetic)",
  "extracted": {
    "name": "extracted full name or empty string if not provided",
    "contact": "extracted 10-digit phone number (after removing country code if present, digits only) or empty string if not valid",
    "zipcode": "extracted 5-digit zip code or empty string",
    "address": "extracted full address if provided during call, or empty string (optional field)",
    "problem": "extracted and detailed problem description (include all relevant context, symptoms, timing, affected areas) or empty string"
  },
  "is_complete": false
}

**CRITICAL RULES:**
- Extract information even if partially provided (e.g., "John" → extract as name, even if last name missing)
- If user provides info in a response, extract it immediately - don't wait
- Validate phone numbers: must be exactly 10 digits after removing country code prefix (+1 or 1)
- If phone number is invalid, ask user to re-enter without saving to extracted.contact
- Full address is OPTIONAL - don't insist if caller hesitates or wants to send via text
- Always inform caller they'll receive a text message to review and confirm all details
- Only set is_complete to true when 4 REQUIRED fields (name, contact, zipcode, problem) are collected AND user confirms completion
- Keep responses concise for voice (2-3 sentences max, unless asking detailed follow-ups)
- Always maintain HVAC focus - redirect non-HVAC topics immediately

Output ONLY valid JSON, no other text or markdown formatting.`;

    try {
        const requestPayload = {
            model: OPENROUTER_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Transcript:\n${transcript}` }
            ],
            response_format: { type: 'json_object' }
        };

        console.log('[OpenRouter] Making API request to:', OPENROUTER_URL);
        console.log('[OpenRouter] Model:', OPENROUTER_MODEL);
        console.log('[OpenRouter] Request payload size:', JSON.stringify(requestPayload).length, 'bytes');

        const response = await axios.post(
            OPENROUTER_URL,
            requestPayload,
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-Title': 'HVAC AI Assistant'
                },
                timeout: 30000 // 30 second timeout
            }
        );

        console.log('[OpenRouter] API Response status:', response.status);
        console.log('[OpenRouter] API Response headers:', response.headers);

        if (!response.data || !response.data.choices || !response.data.choices[0]) {
            console.error('[OpenRouter] Invalid response structure:', JSON.stringify(response.data, null, 2));
            throw new Error('Invalid response structure from OpenRouter API');
        }

        const content = response.data.choices[0].message.content;
        console.log('[OpenRouter] Raw LLM response length:', content?.length || 0);
        console.log('[OpenRouter] Raw LLM response:', content);
        
        // Try to parse JSON - handle cases where LLM might wrap JSON in markdown or add extra text
        let parsed;
        try {
            // Try direct parse first
            parsed = JSON.parse(content);
        } catch (parseError) {
            // Try to extract JSON from markdown code blocks or find JSON object
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    parsed = JSON.parse(jsonMatch[0]);
                } catch (e) {
                    console.error('[OpenRouter] Failed to parse extracted JSON:', e);
                    throw parseError;
                }
            } else {
                throw parseError;
            }
        }
        
        // Validate structure
        if (!parsed.next_message) {
            console.warn('[OpenRouter] Response missing next_message, using fallback');
            parsed.next_message = "Thank you for that information. Could you please tell me more?";
        }
        
        if (!parsed.extracted) {
            parsed.extracted = {};
        }
        
        if (typeof parsed.is_complete !== 'boolean') {
            parsed.is_complete = false;
        }
        
        console.log('[OpenRouter] Parsed and validated response:', parsed);
        return parsed;
    } catch (error) {
        // Comprehensive error logging
        console.error('[OpenRouter] ========== ERROR DETAILS ==========');
        console.error('[OpenRouter] Error type:', error.constructor.name);
        console.error('[OpenRouter] Error message:', error.message);
        
        if (error.response) {
            // API responded with error status
            console.error('[OpenRouter] Response status:', error.response.status);
            console.error('[OpenRouter] Response status text:', error.response.statusText);
            console.error('[OpenRouter] Response data:', JSON.stringify(error.response.data, null, 2));
            console.error('[OpenRouter] Response headers:', error.response.headers);
        } else if (error.request) {
            // Request was made but no response received
            console.error('[OpenRouter] No response received from API');
            console.error('[OpenRouter] Request config:', JSON.stringify(error.config, null, 2));
        } else {
            // Error setting up the request
            console.error('[OpenRouter] Error setting up request:', error.message);
        }
        
        if (error.code) {
            console.error('[OpenRouter] Error code:', error.code);
        }
        
        if (error.stack) {
            console.error('[OpenRouter] Stack trace:', error.stack);
        }
        console.error('[OpenRouter] ====================================');

        // Determine specific error message based on error type
        let errorMessage;
        let errorDetails = {};

        if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.trim() === '') {
            errorMessage = "Configuration error: API key is missing. Please check server configuration.";
            errorDetails = { type: 'CONFIG_ERROR', message: 'OpenRouter API key not configured' };
        } else if (error.response) {
            const status = error.response.status;
            const responseData = error.response.data;
            console.error('[OpenRouter] Error response data:', JSON.stringify(responseData, null, 2));
            console.error('[OpenRouter] Error response status:', status);
            console.error('[OpenRouter] Error response headers:', error.response.headers);
            
            if (status === 401) {
                errorMessage = "Authentication failed. Please check your OpenRouter API key.";
                errorDetails = { type: 'AUTH_ERROR', status, data: responseData };
            } else if (status === 404) {
                // 404 usually means model not found or endpoint wrong
                const errorText = responseData?.error?.message || JSON.stringify(responseData);
                errorMessage = `Model not found (404). Please check the model name: ${OPENROUTER_MODEL}. Error: ${errorText}`;
                errorDetails = { type: 'MODEL_NOT_FOUND', status, data: responseData, model: OPENROUTER_MODEL };
                console.error('[OpenRouter] 404 Error - Model may not exist or endpoint is wrong');
                console.error('[OpenRouter] Attempted model:', OPENROUTER_MODEL);
                console.error('[OpenRouter] Endpoint:', OPENROUTER_URL);
            } else if (status === 429) {
                errorMessage = "Rate limit exceeded. Please try again in a moment.";
                errorDetails = { type: 'RATE_LIMIT', status, data: responseData };
            } else if (status >= 500) {
                errorMessage = "OpenRouter API is experiencing issues. Please try again later.";
                errorDetails = { type: 'API_ERROR', status, data: responseData };
            } else {
                errorMessage = `API error (${status}). Please try again. Error: ${JSON.stringify(responseData)}`;
                errorDetails = { type: 'API_ERROR', status, data: responseData };
            }
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            errorMessage = "Cannot connect to OpenRouter API. Please check your internet connection.";
            errorDetails = { type: 'NETWORK_ERROR', code: error.code };
        } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
            errorMessage = "Request timed out. The API is taking too long to respond.";
            errorDetails = { type: 'TIMEOUT_ERROR', code: error.code };
        } else {
            errorMessage = "An unexpected error occurred while processing your request.";
            errorDetails = { type: 'UNKNOWN_ERROR', message: error.message };
        }

        // Return error details along with fallback message
        return {
            next_message: errorMessage,
            extracted: {},
            is_complete: false,
            error: errorDetails // Include error details for debugging
        };
    }
}

/**
 * Analyze uploaded images (for future multimodal support)
 * For now, returns a placeholder description
 */
async function analyzeImage(imageUrl) {
    // Placeholder for image analysis
    // OpenRouter supports vision models, but for MVP we'll use text descriptions
    return "Image received and stored. Manual review recommended for accurate diagnosis.";
}

module.exports = {
    analyzeSummarization,
    generateQuotation,
    processConversationTurn,
    analyzeImage
};
