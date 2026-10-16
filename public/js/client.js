// Client-side logic for HVAC AI Assistant

const API_BASE = window.location.origin;

// Voice Synthesis Setup
const synthesis = window.speechSynthesis;
let voice = null;

// Speech Recognition Setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true; // Keep listening continuously for better UX
    recognition.lang = 'en-US';
    recognition.interimResults = true; // Show interim results for real-time feedback
    recognition.maxAlternatives = 1;
}

// Conversation state
let conversationState = {
    step: 0,
    transcript: '',
    clientData: {},
    caseId: null,
    analysis: null,
    isListening: false,
    voiceEnabled: false
};

// Speech recognition variables
let finalTranscript = '';  // For accumulating speech recognition results
let silenceTimer = null;    // Timer for debouncing speech input

// Conversation flow
const conversationFlow = [
    {
        question: "Thank you for calling HVAC AI Assistant! I'm here to help you with your heating and cooling needs. May I have your name, please?",
        field: 'name',
        validation: (value) => value.trim().length > 0
    },
    {
        question: "Thank you, {name}! I understand how frustrating HVAC issues can be. Could you please provide your contact number so we can reach you?",
        field: 'contact',
        validation: (value) => /^\+?[\d\s\-()]+$/.test(value)
    },
    {
        question: "Perfect! And what's your zip code or service address? This helps us ensure we can serve your area.",
        field: 'zipcode',
        validation: (value) => /^\d{5}(-\d{4})?$/.test(value.trim())
    },
    {
        question: "Great! Now, could you please describe the HVAC problem you're experiencing? Please be as detailed as possible - for example, is it making unusual noises, not cooling/heating properly, or something else?",
        field: 'problem',
        validation: (value) => value.trim().length > 10
    }
];

// DOM elements
const callNowBtn = document.getElementById('callNowBtn');
const callSection = document.getElementById('callSection');
const chatInterface = document.getElementById('chatInterface');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const endCallBtn = document.getElementById('endCallBtn'); // New Button
const typingIndicator = document.getElementById('typingIndicator');
const resultSection = document.getElementById('resultSection');
const resultContent = document.getElementById('resultContent');

// Create Mic Button
const micBtn = document.createElement('button');
micBtn.innerHTML = '🎤';
micBtn.className = 'mic-btn';
micBtn.style.cssText = `
  background: var(--card-bg);
  border: 2px solid var(--accent-orange);
  color: white;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  font-size: 1.5rem;
  cursor: pointer;
  transition: all 0.3s ease;
  margin-right: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
`;
document.querySelector('.chat-input-area').insertBefore(micBtn, chatInput);

// Event listeners
callNowBtn.addEventListener('click', () => {
    // Reset conversation state for new call
    conversationState = {
        step: 0,
        transcript: '',
        clientData: {},
        caseId: null,
        analysis: null,
        isListening: false,
        voiceEnabled: true,
        manualEnd: false
    };

    // Clear any previous analysis status
    const statusDiv = document.getElementById('analysisStatus');
    if (statusDiv) {
        statusDiv.remove();
    }

    // Clear chat messages
    chatMessages.innerHTML = '';

    // Enable voice and start conversation
    startConversation();
});

sendBtn.addEventListener('click', sendMessage);

// Ensure endCallBtn exists before adding listener
if (endCallBtn) {
    endCallBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('End Call button clicked');
        endCall();
    });
} else {
    console.error('End Call button not found in DOM');
}

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

micBtn.addEventListener('click', toggleMic);

// Voice Logic
function setupVoice() {
    const voices = synthesis.getVoices();
    console.log('[Speech Synthesis] Available voices:', voices.length);
    
    // Try to find a friendly English voice
    voice = voices.find(v => v.name.includes('Google US English')) ||
        voices.find(v => v.name.includes('Samantha')) ||
        voices.find(v => v.name.includes('Alex')) ||
        voices.find(v => v.lang === 'en-US' && v.localService);
    
    if (voice) {
        console.log('[Speech Synthesis] Selected voice:', voice.name, voice.lang);
    } else {
        console.warn('[Speech Synthesis] No preferred voice found, using default');
        // Use first available English voice as fallback
        voice = voices.find(v => v.lang.startsWith('en')) || voices[0];
    }
}

// Check if speech synthesis is supported
if (!('speechSynthesis' in window)) {
    console.error('[Speech Synthesis] Not supported in this browser');
} else {
    // Load voices immediately if available
    setupVoice();
    
    // Also listen for voices to be loaded (some browsers load asynchronously)
    if (synthesis.onvoiceschanged !== undefined) {
        synthesis.onvoiceschanged = setupVoice;
    }
}

// function speak(text) { ... } // Replaced by new implementation below named speak

function toggleMic() {
    if (conversationState.isListening) {
        stopListening();
    } else {
        startListening();
    }
}

function startListening() {
    if (!recognition) {
        console.error('[Speech Recognition] Not supported in this browser');
        alert('Speech recognition is not supported in this browser.');
        return;
    }

    // Don't start if already listening
    if (conversationState.isListening) {
        console.log('[Speech Recognition] Already listening, skipping start');
        return;
    }

    try {
        // Interrupt agent if speaking - allow user to interrupt
        synthesis.cancel();

        finalTranscript = ''; // Reset transcript
        recognition.start();
        conversationState.isListening = true;
        micBtn.style.background = 'var(--error)';
        micBtn.classList.add('listening');
        chatInput.placeholder = "Listening... (Speak now)";
        console.log('[Speech Recognition] Started listening');
    } catch (e) {
        console.log('[Speech Recognition] Start error:', e.message);
        // If already started, that's okay - just update UI
        if (e.message.includes('already started') || e.message.includes('started')) {
            console.log('[Speech Recognition] Recognition already active');
            conversationState.isListening = true;
            micBtn.style.background = 'var(--error)';
            micBtn.classList.add('listening');
            chatInput.placeholder = "Listening... (Speak now)";
        } else {
            console.error('[Speech Recognition] Failed to start:', e);
            conversationState.isListening = false;
            micBtn.style.background = 'var(--card-bg)';
            micBtn.classList.remove('listening');
            chatInput.placeholder = "Type your response...";
        }
    }
}

function stopListening() {
    if (recognition) {
        recognition.stop();
        conversationState.isListening = false;
        micBtn.style.background = 'var(--card-bg)';
        micBtn.classList.remove('listening');
        chatInput.placeholder = "Type your response...";

        clearTimeout(silenceTimer); // Clear any pending send
    }
}

if (recognition) {
    recognition.onresult = (event) => {
        console.log('[Speech Recognition] onresult triggered, resultIndex:', event.resultIndex);
        // Interrupt agent if speaking - user is talking
        synthesis.cancel();

        let interimTranscript = '';
        let currentFinal = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                currentFinal += event.results[i][0].transcript;
                console.log('[Speech Recognition] Final result:', event.results[i][0].transcript);
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        if (currentFinal) {
            finalTranscript += currentFinal + ' ';
        }

        // Update input box so user sees what's being heard
        chatInput.value = (finalTranscript + interimTranscript).trim();
        console.log('[Speech Recognition] Current input value:', chatInput.value);

        // DEBOUNCE LOGIC: Wait for silence before sending
        clearTimeout(silenceTimer);

        // If we have some input, start the "End of Speech" timer
        // Only set timer if we're not already sending a message
        if (chatInput.value.trim().length > 0 && !isSendingMessage) {
            console.log('[Speech Recognition] Setting silence timer for 1.5 seconds');
            // Wait 1.5 seconds of silence before sending
            silenceTimer = setTimeout(() => {
                // Double-check we're not already sending before calling sendMessage
                if (!isSendingMessage && chatInput.value.trim().length > 0) {
                    console.log('[Speech Recognition] Silence timer expired, calling sendMessage');
                    sendMessage();
                } else {
                    console.log('[Speech Recognition] Silence timer expired but message already sending or input cleared, skipping');
                }
            }, 1500);
        }
    };

    recognition.onend = () => {
        console.log('[Speech Recognition] onend triggered, isListening:', conversationState.isListening, 'inputValue:', chatInput.value, 'isSendingMessage:', isSendingMessage);
        
        // With continuous mode, onend might fire when recognition stops
        // We need to handle this carefully to avoid duplicate sends
        if (conversationState.isListening && !conversationState.manualEnd) {
            // Clear the silence timer since onend fired (silence timer might still be pending)
            clearTimeout(silenceTimer);
            
            if (chatInput.value.trim().length > 0 && !isSendingMessage) {
                console.log('[Speech Recognition] Recognition ended with input, silence timer cleared - will let silence timer handle send');
                // Don't send here - let the silence timer from onresult handle it
                // If silence timer already fired, isSendingMessage will be true and we won't send again
                // If silence timer is still pending, it will send after 1.5s of silence
                // This prevents duplicate sends
            } else if (chatInput.value.trim().length === 0) {
                console.log('[Speech Recognition] Recognition ended without input, restarting...');
                // Restart if stopped unexpectedly without input (only if we should be listening)
                if (!conversationState.manualEnd && !isSendingMessage) {
                    setTimeout(() => {
                        if (conversationState.isListening && !conversationState.manualEnd && !isSendingMessage) {
                            try {
                                recognition.start();
                                console.log('[Speech Recognition] Restarted successfully');
                            } catch (e) {
                                console.log('[Speech Recognition] Could not restart:', e.message);
                                // If restart fails, reset listening state
                                if (e.message.includes('already started')) {
                                    // Already started, that's fine
                                } else {
                                    conversationState.isListening = false;
                                    micBtn.style.background = 'var(--card-bg)';
                                    micBtn.classList.remove('listening');
                                }
                            }
                        }
                    }, 300);
                }
            }
        } else {
            console.log('[Speech Recognition] Recognition ended but not in listening state or call ended');
        }
    };

    recognition.onerror = (event) => {
        console.error('[Speech Recognition] Error:', event.error);
        console.error('[Speech Recognition] Error type:', event.error);
        
        // Handle specific error types
        switch (event.error) {
            case 'no-speech':
                // User didn't speak - this is normal, just restart
                console.log('[Speech Recognition] No speech detected, will restart');
                if (conversationState.isListening) {
                    setTimeout(() => {
                        if (conversationState.isListening && !isSendingMessage) {
                            try {
                                recognition.start();
                            } catch (e) {
                                console.log('[Speech Recognition] Could not restart after no-speech:', e.message);
                            }
                        }
                    }, 500);
                }
                break;
            case 'audio-capture':
                console.error('[Speech Recognition] No microphone found or microphone not accessible');
                stopListening();
                alert('Microphone not found or not accessible. Please check your microphone settings.');
                break;
            case 'not-allowed':
                console.error('[Speech Recognition] Microphone permission denied');
                stopListening();
                alert('Microphone permission denied. Please allow microphone access and try again.');
                break;
            case 'network':
                console.error('[Speech Recognition] Network error');
                // Retry after a delay
                setTimeout(() => {
                    if (conversationState.isListening) {
                        try {
                            recognition.start();
                        } catch (e) {
                            console.error('[Speech Recognition] Could not restart after network error:', e.message);
                        }
                    }
                }, 1000);
                break;
            case 'aborted':
                console.log('[Speech Recognition] Recognition aborted (this is normal when stopping)');
                break;
            default:
                console.error('[Speech Recognition] Unknown error:', event.error);
                stopListening();
                break;
        }
    };
}


// Get time-based greeting
function getTimeBasedGreeting() {
    const hour = new Date().getHours();
    let greeting;

    if (hour >= 5 && hour < 12) {
        greeting = "Good morning";
    } else if (hour >= 12 && hour < 17) {
        greeting = "Good afternoon";
    } else if (hour >= 17 && hour < 21) {
        greeting = "Good evening";
    } else {
        greeting = "Good evening"; // Late night/early morning
    }

    return `${greeting}! Thank you for calling HVAC AI Assistant. How can I help you today?`;
}

// Start conversation
function startConversation() {
    callSection.style.display = 'none';
    chatInterface.classList.add('active');
    endCallBtn.style.display = 'block'; // Show End Call button
    setupVoice(); // Ensure voice is ready

    // Reset transcript and initialize with agent greeting
    conversationState.transcript = '';

    // Start with time-based greeting
    setTimeout(() => {
        const greeting = getTimeBasedGreeting();
        addAgentMessage(greeting);

        // Add agent greeting to transcript for LLM context
        conversationState.transcript = `Agent: ${greeting}\n`;
        console.log('[Conversation] Initialized transcript with greeting:', conversationState.transcript);

        speak(greeting);
    }, 500);
}

// Add message to chat
function addAgentMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message agent';
    messageDiv.innerHTML = `
    <div class="message-sender">AI Assistant</div>
    <div class="message-bubble">${text}</div>
  `;
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

function addUserMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message user';
    messageDiv.innerHTML = `
    <div class="message-sender">You</div>
    <div class="message-bubble">${text}</div>
  `;
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Global abort controller for active requests
let activeRequestController = null;
let isSendingMessage = false; // Prevent duplicate sends

// Send message
async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) {
        console.log('[Conversation] sendMessage called with empty message, ignoring');
        return;
    }

    // Prevent duplicate sends
    if (isSendingMessage) {
        console.log('[Conversation] sendMessage already in progress, ignoring duplicate call');
        console.log('[Conversation] DEBUG: isSendingMessage flag is stuck, resetting...');
        // Safety: Reset flag if stuck for more than 10 seconds (indicates error)
        isSendingMessage = false;
        // Don't return, allow this call to proceed
    }

    isSendingMessage = true;
    console.log('[Conversation] sendMessage triggered:', message);
    console.log('[Conversation] DEBUG: isSendingMessage set to true');

    // Clear silence timer to prevent duplicate sends
    clearTimeout(silenceTimer);
    
    // Stop listening immediately to prevent capturing more input
    stopListening();

    // Add user message
    addUserMessage(message);
    chatInput.value = '';
    sendBtn.disabled = true;

    // Update transcript with user message
    conversationState.transcript += `Client: ${message}\n`;
    console.log('[Conversation] Updated transcript:', conversationState.transcript.substring(0, 200) + '...');

    // Validate transcript is not empty (should have at least agent greeting)
    if (!conversationState.transcript || conversationState.transcript.trim().length === 0) {
        console.warn('[Conversation] WARNING: Transcript is empty, initializing with default greeting');
        const defaultGreeting = getTimeBasedGreeting();
        conversationState.transcript = `Agent: ${defaultGreeting}\nClient: ${message}\n`;
    }

    // Show typing indicator
    showTyping();

    // AUDITORY FEEDBACK: Tell user we are working
    // This helps confirm the function actually ran
    if (conversationState.voiceEnabled) {
        // Use a short, non-disruptive sound or phrase
        // "Thinking..."
    }

    // Verify API_BASE is defined
    if (!API_BASE) {
        console.error('[Conversation] ERROR: API_BASE is not defined!');
        isSendingMessage = false;
        const errorMsg = "Configuration error. Please refresh the page.";
        addAgentMessage(errorMsg);
        return;
    }

    const targetUrl = `${API_BASE}/api/llm/chat`;
    console.log(`[Client] Sending POST to ${targetUrl}`);
    console.log('[Client] API_BASE:', API_BASE);
    console.log('[Client] Request payload:', {
        transcriptLength: conversationState.transcript.length,
        transcriptPreview: conversationState.transcript.substring(0, 200),
        currentData: conversationState.clientData
    });

    // Declare timeoutId in outer scope so it can be cleared in finally block
    let timeoutId = null;
    
    try {
        // Add timeout to fetch request (30 seconds)
        const controller = new AbortController();
        timeoutId = setTimeout(() => {
            console.log('[Client] Request timeout after 30 seconds, aborting...');
            controller.abort();
        }, 30000);

        // Store controller so it can be aborted if user ends call
        activeRequestController = controller;

        console.log('[Client] Making fetch request to:', targetUrl);
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: conversationState.transcript,
                currentData: conversationState.clientData
            }),
            signal: controller.signal
        });

        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        activeRequestController = null; // Clear after successful request
        console.log('[Client] Response status:', response.status, response.statusText);

        if (!response.ok) {
            const errText = await response.text();
            console.error('[Client] Server error response:', errText);
            throw new Error(`Server Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        hideTyping();
        sendBtn.disabled = false;

        console.log("[Client] LLM Response received:", JSON.stringify(data, null, 2));

        // Validate response structure
        if (!data || typeof data !== 'object') {
            console.error("[Client] Invalid response format:", data);
            const errorMsg = "I'm having trouble processing that. Could you please repeat?";
            addAgentMessage(errorMsg);
            speak(errorMsg);
            return;
        }

        // Update client data with findings from LLM
        if (data.extracted && typeof data.extracted === 'object') {
            // Only update non-empty values
            Object.keys(data.extracted).forEach(key => {
                if (data.extracted[key] && data.extracted[key].trim() !== '') {
                    conversationState.clientData[key] = data.extracted[key].trim();
                }
            });
            console.log("[Client] Updated client data:", conversationState.clientData);
        }

        // Check if response contains an error
        if (data.error) {
            console.error("[Client] Server returned error:", data.error);
            console.error("[Client] Error type:", data.error.type);
            console.error("[Client] Error details:", JSON.stringify(data.error, null, 2));
            
            // Display error message to user
            if (data.next_message) {
                addAgentMessage(data.next_message);
                speak(data.next_message);
            } else {
                const errorMsg = "I'm experiencing a technical issue. Please try again.";
                addAgentMessage(errorMsg);
                speak(errorMsg);
            }
            return; // Don't continue processing if there's an error
        }

        // Agent speaks the response
        if (data.next_message && typeof data.next_message === 'string' && data.next_message.trim() !== '') {
            addAgentMessage(data.next_message);
            speak(data.next_message);
        } else {
            console.error("[Client] Missing or invalid next_message:", data.next_message);
            const fallbackMsg = "I'm sorry, could you please repeat that?";
            addAgentMessage(fallbackMsg);
            speak(fallbackMsg);
        }

        // Check if conversation is complete (handled by UI now)
        if (data.is_complete) {
            // No auto-action, user must click "End Call"
        }

    } catch (error) {
        console.error('[Conversation] Chat error:', error);
        console.error('[Conversation] Error name:', error.name);
        console.error('[Conversation] Error message:', error.message);
        if (error.stack) {
            console.error('[Conversation] Error stack:', error.stack);
        }
        hideTyping();
        sendBtn.disabled = false;

        let errorMsg;
        if (error.name === 'AbortError') {
            errorMsg = "The request took too long. Please try again.";
            console.error('[Conversation] Request timeout or aborted');
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            errorMsg = "Cannot connect to server. Please make sure the backend server is running on port 3000.";
            console.error('[Conversation] Network error - server may not be running');
        } else if (error.message.includes('Server Error')) {
            // Server returned an error status
            errorMsg = "The server encountered an error. Please try again.";
            console.error('[Conversation] Server error response');
        } else {
            errorMsg = "I'm having trouble processing your request. Please try again.";
        }

        addAgentMessage(errorMsg);
        if (conversationState.voiceEnabled) {
            speak(errorMsg);
        }
        console.error("FETCH FAILED: " + error.message);
    } finally {
        // Clean up timeout and controller
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (activeRequestController) {
            activeRequestController = null;
        }
        console.log('[Conversation] DEBUG: Resetting isSendingMessage flag in finally block');
        isSendingMessage = false; // Reset flag - ALWAYS executes
    }
}

// Override speak function to handle completion check
let lastAgentQuestion = ""; // Track the last question asked to determine wait time

/**
 * Convert numbers to digit-by-digit format for speech synthesis
 * Preserves monetary values (prices, costs, quotes) as natural numbers
 * Converts phone numbers, zip codes, case IDs, and other identifiers to digits
 */
function convertNumbersToDigits(text) {
    if (!text || typeof text !== 'string') return text;
    
    // Monetary keywords that indicate a number should be read naturally
    const monetaryKeywords = [
        '\\$', 'dollar', 'dollars', 'price', 'prices', 'cost', 'costs', 
        'quote', 'quotes', 'estimate', 'estimates', 'fee', 'fees', 
        'charge', 'charges', 'payment', 'payments', 'total', 'totals',
        'amount', 'amounts', 'bill', 'bills', 'paid', 'pay', 'pays',
        'worth', 'value', 'values', 'budget', 'budgets'
    ];
    
    // Create regex pattern for monetary context (number near monetary keywords)
    const monetaryPattern = new RegExp(
        `(?:${monetaryKeywords.join('|')})\\s*[\\d,]+|[\\d,]+\\s*(?:${monetaryKeywords.join('|')})`,
        'gi'
    );
    
    // Find all monetary numbers to preserve
    const monetaryMatches = [];
    let match;
    while ((match = monetaryPattern.exec(text)) !== null) {
        monetaryMatches.push({
            text: match[0],
            index: match.index,
            endIndex: match.index + match[0].length
        });
    }
    
    // Check if a number is in monetary context
    function isMonetaryNumber(numIndex, numLength) {
        return monetaryMatches.some(m => {
            const numEnd = numIndex + numLength;
            // Check if number overlaps with or is near a monetary match
            return (numIndex >= m.index - 20 && numEnd <= m.endIndex + 20);
        });
    }
    
    // Digit to word mapping
    const digitWords = {
        '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
        '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine'
    };
    
    // Convert a number string to digit-by-digit words
    function numberToDigits(numStr) {
        return numStr.split('').map(digit => digitWords[digit] || digit).join(' ');
    }
    
    // Find all numbers in the text (including those with formatting)
    // Pattern matches: sequences of digits, optionally with formatting characters
    // This will match: 123, 123-456, (123) 456-7890, CASE-1234567890, etc.
    const numberPattern = /\d+(?:[\s\-\(\)\.\/]*\d+)*/g;
    let result = text;
    
    // Collect all number matches with their positions
    const numberMatches = [];
    while ((match = numberPattern.exec(text)) !== null) {
        const numStr = match[0];
        const numIndex = match.index;
        
        // Skip if this is part of a monetary value
        if (isMonetaryNumber(numIndex, numStr.length)) {
            continue;
        }
        
        // Extract just the digits (remove formatting)
        const digitsOnly = numStr.replace(/\D/g, '');
        
        // Skip if no digits found
        if (!digitsOnly || digitsOnly.length === 0) {
            continue;
        }
        
        // For very small numbers (1-2 digits), only convert if they're clearly identifiers
        // Check context to determine if it's an identifier (phone, zip, case ID, etc.)
        if (digitsOnly.length <= 2) {
            const before = text.substring(Math.max(0, numIndex - 15), numIndex).toLowerCase();
            const after = text.substring(numIndex + numStr.length, Math.min(text.length, numIndex + numStr.length + 15)).toLowerCase();
            
            // Check if it's part of an identifier pattern
            const isIdentifier = 
                before.match(/\b(case|phone|zip|id|number|code|contact|extension)\b/i) ||
                after.match(/\b(case|phone|zip|id|number|code|contact|extension)\b/i) ||
                numStr.includes('-') ||
                numStr.includes('(') ||
                numStr.includes(')');
            
            // If it's not clearly an identifier and not formatted, skip it
            // (likely part of natural language like "2 hours", "1 room", etc.)
            if (!isIdentifier) {
                continue;
            }
        }
        
        numberMatches.push({
            original: numStr,
            digits: digitsOnly,
            index: numIndex,
            length: numStr.length
        });
    }
    
    // Replace numbers from end to start to preserve indices
    numberMatches.reverse().forEach(numMatch => {
        const { original, digits, index } = numMatch;
        const digitWords = numberToDigits(digits);
        result = result.substring(0, index) + digitWords + result.substring(index + original.length);
    });
    
    return result;
}

function speak(text) {
    if (!conversationState.voiceEnabled) {
        console.log('[Speech Synthesis] Voice disabled, skipping speech');
        return;
    }

    // Check if speech synthesis is supported
    if (!('speechSynthesis' in window)) {
        console.error('[Speech Synthesis] Not supported in this browser');
        return;
    }

    lastAgentQuestion = text.toLowerCase();
    synthesis.cancel(); // Cancel any ongoing speech
    scrollToBottom();

    // Ensure voice is loaded before speaking
    if (!voice) {
        console.warn('[Speech Synthesis] Voice not loaded yet, attempting to load...');
        setupVoice();
        // If still no voice, use default
        if (!voice) {
            const voices = synthesis.getVoices();
            voice = voices.find(v => v.lang.startsWith('en')) || voices[0];
            if (voice) {
                console.log('[Speech Synthesis] Using fallback voice:', voice.name);
            }
        }
    }

    // Add agent message to transcript
    // Only add if not already present (to avoid duplicates from initial greeting)
    const agentMessageLine = `Agent: ${text}\n`;
    const transcriptEndsWithThis = conversationState.transcript.trim().endsWith(text.trim());

    if (!transcriptEndsWithThis) {
        conversationState.transcript += agentMessageLine;
        console.log('[Conversation] Added agent message to transcript:', text.substring(0, 50) + '...');
        console.log('[Conversation] Current transcript length:', conversationState.transcript.length);
    } else {
        console.log('[Conversation] Agent message already in transcript, skipping duplicate');
    }

    // Convert numbers to digit-by-digit format for speech (except monetary values)
    const textForSpeech = convertNumbersToDigits(text);
    console.log('[Speech Synthesis] Original text:', text.substring(0, 100));
    console.log('[Speech Synthesis] Converted text:', textForSpeech.substring(0, 100));

    const utterance = new SpeechSynthesisUtterance(textForSpeech);
    if (voice) {
        utterance.voice = voice;
        console.log('[Speech Synthesis] Using voice:', voice.name);
    }
    utterance.pitch = 1;
    utterance.rate = 1;
    utterance.volume = 1;

    // Error handling
    utterance.onerror = (event) => {
        console.error('[Speech Synthesis] Error:', event.error);
        console.error('[Speech Synthesis] Error type:', event.type);
        // Try to continue conversation even if speech fails
        if (!conversationState.manualEnd) {
            setTimeout(() => {
                startListening();
            }, 500);
        }
    };

    utterance.onstart = () => {
        console.log('[Speech Synthesis] Started speaking');
    };

    utterance.onend = () => {
        console.log('[Conversation] Agent finished speaking, starting to listen...');
        // ALWAYS go back to listening until user clicks "End Call"
        // But don't restart if we're currently sending a message
        if (!conversationState.manualEnd && !isSendingMessage) {
            // Small delay to ensure speech is fully finished
            setTimeout(() => {
                // Double-check we're not sending before starting to listen
                if (!conversationState.manualEnd && !isSendingMessage) {
                    startListening();
                }
            }, 100);
        }
    };

    utterance.onpause = () => {
        console.log('[Speech Synthesis] Speech paused');
    };

    utterance.onresume = () => {
        console.log('[Speech Synthesis] Speech resumed');
    };

    try {
        synthesis.speak(utterance);
        console.log('[Speech Synthesis] Speech queued successfully');
    } catch (error) {
        console.error('[Speech Synthesis] Failed to speak:', error);
        // Fallback: just start listening if speech fails
        if (!conversationState.manualEnd) {
            startListening();
        }
    }
}

// Helper to manually end the call
function endCall() {
    console.log("End Call Button Clicked - Force Stopping");
    conversationState.manualEnd = true; // Flag to prevent auto-restart

    // 1. Force Stop Fetch
    if (activeRequestController) {
        activeRequestController.abort();
        activeRequestController = null;
    }
    clearTimeout(silenceTimer);

    // 2. Stop Voice/Audio
    stopListening();
    conversationState.isListening = false;
    synthesis.cancel();

    // 3. Disable voice for analysis phase
    conversationState.voiceEnabled = false;

    // 4. Return to initial page - Hide chat interface, show call section
    chatInterface.classList.remove('active');
    callSection.style.display = 'block';

    // 5. Reset UI elements
    endCallBtn.style.display = 'none';
    micBtn.disabled = false;
    chatInput.disabled = false;
    hideTyping();

    // 6. Clear chat messages for next call (but keep transcript for analysis)
    // chatMessages.innerHTML = '';

    // 7. Trigger Analysis in background
    // Small delay to ensure browser cleans up audio context and UI transitions
    setTimeout(() => {
        analyzeConversation();
    }, 300);
}



function showTyping() {
    typingIndicator.classList.add('active');
}

function hideTyping() {
    typingIndicator.classList.remove('active');
}

// Analyze conversation with LLM
async function analyzeConversation() {
    // Check if we have enough data to analyze
    if (!conversationState.transcript || conversationState.transcript.trim().length === 0) {
        console.log("No transcript to analyze");
        return;
    }

    // Show processing message in chat if interface is still active, otherwise show on initial page
    const processingMsg = "Thank you for providing all that information! Let me analyze your request and prepare a quote for you. This will just take a moment...";

    if (chatInterface.classList.contains('active')) {
        addAgentMessage(processingMsg);
        speak(processingMsg);
        showTyping();
    } else {
        // Show message on initial page
        const statusDiv = document.createElement('div');
        statusDiv.id = 'analysisStatus';
        statusDiv.style.cssText = `
            background: rgba(16, 185, 129, 0.1);
            border-left: 4px solid var(--success);
            padding: 1rem;
            border-radius: 8px;
            margin: 1rem 0;
            color: white;
        `;
        statusDiv.innerHTML = `<strong>📞 Call Ended</strong><br>${processingMsg}`;
        callSection.querySelector('.glass-card').appendChild(statusDiv);
    }

    try {
        // Create case
        console.log('[Analysis] Creating case...');
        const caseResponse = await fetch(`${API_BASE}/api/cases`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: conversationState.transcript,
                clientData: conversationState.clientData
            })
        });

        if (!caseResponse.ok) {
            const errorText = await caseResponse.text();
            throw new Error(`Failed to create case: ${caseResponse.status} - ${errorText}`);
        }

        const caseData = await caseResponse.json();
        conversationState.caseId = caseData.id;
        // Store case data including chatId if available
        conversationState.caseData = caseData;
        console.log('[Analysis] Case created:', conversationState.caseId);

        // Analyze with LLM (Prompt 1)
        console.log('[Analysis] Analyzing transcript with LLM...');
        const analysisResponse = await fetch(`${API_BASE}/api/llm/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: conversationState.transcript
            })
        });

        if (!analysisResponse.ok) {
            const errorText = await analysisResponse.text();
            throw new Error(`Failed to analyze: ${analysisResponse.status} - ${errorText}`);
        }

        const analysis = await analysisResponse.json();
        conversationState.analysis = analysis;
        console.log('[Analysis] Analysis completed');

        // Update case with analysis
        console.log('[Analysis] Updating case with analysis...');
        const updateResponse = await fetch(`${API_BASE}/api/cases/${conversationState.caseId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                analysis,
                status: 'analyzed'
            })
        });

        if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            console.warn('[Analysis] Failed to update case:', errorText);
            // Don't throw - analysis is complete, update failure is not critical
        } else {
            try {
                // Refresh case data to get updated chatId if available
                const updatedCaseData = await updateResponse.json();
                conversationState.caseData = updatedCaseData;
            } catch (e) {
                console.warn('[Analysis] Could not parse updated case data:', e);
            }
        }

        // Hide typing indicator if chat is active
        if (chatInterface.classList.contains('active')) {
            hideTyping();
        }

        // Display analysis (will handle both chat and initial page display)
        // This function will automatically trigger Telegram request if pictures are needed
        displayAnalysis(analysis);

    } catch (error) {
        if (chatInterface.classList.contains('active')) {
            hideTyping();
            const errorMsg = "I apologize, but I encountered an error analyzing your request. Please try again or contact us directly.";
            addAgentMessage(errorMsg);
            speak(errorMsg);
        } else {
            // Show error on initial page
            const statusDiv = document.getElementById('analysisStatus');
            if (statusDiv) {
                statusDiv.style.background = 'rgba(239, 68, 68, 0.1)';
                statusDiv.style.borderLeftColor = 'var(--error)';
                statusDiv.innerHTML = `<strong>❌ Error</strong><br>I apologize, but I encountered an error analyzing your request. Please try again or contact us directly.`;
            }
        }
        console.error('Analysis error:', error);
    }
}

// Display analysis results
function displayAnalysis(analysis) {
    const isOnInitialPage = !chatInterface.classList.contains('active');

    if (isOnInitialPage) {
        // Display on initial page
        const statusDiv = document.getElementById('analysisStatus');
        if (statusDiv) {
            statusDiv.innerHTML = `
                <strong>✅ Analysis Complete!</strong><br>
                <div style="margin-top: 1rem;">
                    <h3 style="margin: 0.5rem 0; color: var(--accent-orange);">📋 Service Summary</h3>
                    <p><strong>Problem:</strong> ${analysis.problem_summary}</p>
                    <p><strong>Category:</strong> ${analysis.diagnosis_category}</p>
                    <p><strong>Confidence:</strong> ${(analysis.llm_confidence_score * 100).toFixed(0)}%</p>
                    <p><strong>Case ID:</strong> <code style="background: rgba(0,0,0,0.3); padding: 0.3rem 0.6rem; border-radius: 4px;">${conversationState.caseId}</code></p>
                </div>
            `;
        }

        // Always send Telegram confirmation with summary
        setTimeout(async () => {
            console.log('[Analysis] Sending Telegram confirmation summary');
            await sendTelegramConfirmation(analysis);
            
            // Then handle next action based on action_required
            if (analysis.action_required === 'PICTURES') {
                handlePictureRequestOnInitialPage(analysis);
            } else if (analysis.action_required === 'QUOTE_READY') {
                generateQuotationOnInitialPage(analysis);
            } else {
                handleHumanReviewOnInitialPage(analysis);
            }
        }, 1000);
    } else {
        // Display in chat interface (original behavior)
        const summaryMsg = "Thank you for your patience! I've analyzed your request.";
        addAgentMessage(summaryMsg);
        speak(summaryMsg);

        setTimeout(() => {
            const summaryHtml = `
      <h3>📋 Service Summary</h3>
      <p><strong>Problem:</strong> ${analysis.problem_summary}</p>
      <p><strong>Category:</strong> ${analysis.diagnosis_category}</p>
      <p><strong>Confidence:</strong> ${(analysis.llm_confidence_score * 100).toFixed(0)}%</p>
    `;

            addAgentMessage(summaryHtml);

            // Always send Telegram confirmation with summary
            sendTelegramConfirmation(analysis);
            
            // Handle next action
            if (analysis.action_required === 'PICTURES') {
                handlePictureRequest(analysis);
            } else if (analysis.action_required === 'QUOTE_READY') {
                generateQuotation(analysis);
            } else {
                handleHumanReview(analysis);
            }
        }, 1000);
    }
}

// Handle picture request
async function handlePictureRequest(analysis) {
    setTimeout(async () => {
        const step1Msg = `To provide you with the most accurate quote, I'll need some photos of your HVAC system. Specifically: ${analysis.picture_requirement_details}`;
        addAgentMessage(step1Msg);
        speak(step1Msg);

        setTimeout(async () => {
            const step2Msg = "I'm sending you a message on Telegram to upload the photos. Please check your Telegram app and send the requested images to our bot.";
            addAgentMessage(step2Msg);
            speak(step2Msg);

            // Request pictures via Telegram
            try {
                const telegramResponse = await fetch(`${API_BASE}/api/telegram/request-pictures`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phoneNumber: conversationState.clientData.contact,
                        caseId: conversationState.caseId,
                        pictureDetails: analysis.picture_requirement_details,
                        problemSummary: analysis.problem_summary
                    })
                });

                if (!telegramResponse.ok) {
                    const errorText = await telegramResponse.text();
                    console.error('[Telegram] Failed to request pictures:', errorText);
                    throw new Error(`Telegram API error: ${telegramResponse.status}`);
                }

                const finalMsg = "Once you've sent the photos, our team will review them and send you a detailed quote within 2 hours. Thank you!";
                addAgentMessage(finalMsg);
                speak(finalMsg);

                // Show case ID
                displayCaseId();
            } catch (error) {
                console.error('Error requesting pictures:', error);
                addAgentMessage("Note: Please start a conversation with @HVACFDA_bot on Telegram first, then send your photos there.");
                displayCaseId();
            }
        }, 4000); // Increased delay for voice
    }, 1000);
}

// Generate quotation
async function generateQuotation(analysis) {
    showTyping();

    setTimeout(async () => {
        try {
            console.log('[Quotation] Generating quotation...');
            const quotationResponse = await fetch(`${API_BASE}/api/llm/quotation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    summaryData: analysis,
                    caseId: conversationState.caseId
                })
            });

            if (!quotationResponse.ok) {
                const errorText = await quotationResponse.text();
                throw new Error(`Failed to generate quotation: ${quotationResponse.status} - ${errorText}`);
            }

            const { quotation } = await quotationResponse.json();
            console.log('[Quotation] Quotation generated successfully');

            // Save the generated quote to the case for contractor review
            console.log('[Quotation] Saving quote to case...');
            const saveResponse = await fetch(`${API_BASE}/api/cases/${conversationState.caseId}/quote`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quote: quotation
                })
            });

            if (!saveResponse.ok) {
                const errorText = await saveResponse.text();
                console.warn('[Quotation] Failed to save quote to case:', errorText);
                // Don't throw - quote is generated, saving failure is not critical
            } else {
                console.log('[Quotation] Quote saved to case successfully');
            }

            hideTyping();

            const successMsg = "Great news! I've prepared a preliminary quote for you:";
            addAgentMessage(successMsg);
            speak(successMsg);

            setTimeout(() => {
                displayQuotation(quotation);
            }, 800);

        } catch (error) {
            hideTyping();
            console.error('Quotation error:', error);
            const errorMsg = "I encountered an error generating your quote. A contractor will contact you shortly with a detailed estimate.";
            addAgentMessage(errorMsg);
            speak(errorMsg);
        }
    }, 2000);
}

// Handle human review
function handleHumanReview(analysis) {
    setTimeout(() => {
        const reviewMsg = "Your request requires some additional review from our expert team. A contractor will contact you within 2 hours to discuss your specific needs and provide a detailed quote.";
        addAgentMessage(reviewMsg);
        speak(reviewMsg);
        displayCaseId();
    }, 1000);
}

// Helper function to send Telegram confirmation summary
async function sendTelegramConfirmation(analysis) {
    console.log('[Telegram Confirmation] ========== Sending Confirmation Summary ==========');
    
    try {
        const clientName = conversationState.clientData.name || analysis.client_name || 'Customer';
        const phoneNumber = conversationState.clientData.contact || analysis.contact_number;
        const zipCode = conversationState.clientData.zipcode || analysis.service_zip_code;
        const address = conversationState.clientData.address || '';
        const problemSummary = analysis.problem_summary;
        const pictureDetails = analysis.picture_requirement_details || '';
        const chatId = conversationState.caseData?.telegramChatId || null;
        
        console.log('[Telegram Confirmation] Sending with data:', {
            clientName,
            phoneNumber,
            zipCode,
            address: address || 'not provided',
            caseId: conversationState.caseId,
            chatId: chatId || 'not available'
        });
        
        const response = await fetch(`${API_BASE}/api/telegram/send-confirmation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phoneNumber,
                caseId: conversationState.caseId,
                clientName,
                zipCode,
                address,
                problemSummary,
                pictureDetails,
                chatId
            })
        });
        
        if (!response.ok) {
            console.error('[Telegram Confirmation] Failed:', await response.text());
        } else {
            console.log('[Telegram Confirmation] ✅ Confirmation sent successfully');
        }
    } catch (error) {
        console.error('[Telegram Confirmation] Error:', error);
    }
}

// Helper function to trigger Telegram request automatically
async function triggerTelegramRequest(analysis) {
    console.log('[Telegram] ========== Starting Telegram Request ==========');
    console.log('[Telegram] Analysis object:', JSON.stringify(analysis, null, 2));
    console.log('[Telegram] Conversation state:', {
        caseId: conversationState.caseId,
        clientData: conversationState.clientData,
        caseData: conversationState.caseData
    });
    
    // Get client name from multiple sources (priority order)
    const clientName = conversationState.clientData.name || 
                       analysis.client_name || 
                       null;
    
    // Get phone number
    const phoneNumber = conversationState.clientData.contact || 
                       analysis.contact_number || 
                       null;
    
    // Get chatId if available
    const chatId = conversationState.caseData?.telegramChatId || null;
    
    console.log('[Telegram] Extracted data:', {
        clientName: clientName || '❌ not available',
        phoneNumber: phoneNumber || '❌ not available',
        chatId: chatId ? `✅ ${chatId}` : '❌ not available',
        caseId: conversationState.caseId || '❌ not available'
    });
    
    if (!phoneNumber) {
        console.error('[Telegram] ❌ CRITICAL: No phone number available, cannot send Telegram message');
        console.log('[Telegram] Debug info - conversationState.clientData:', conversationState.clientData);
        console.log('[Telegram] Debug info - analysis:', analysis);
        return;
    }
    
    if (!conversationState.caseId) {
        console.error('[Telegram] ❌ CRITICAL: No caseId available');
        return;
    }
    
    // Log for debugging
    console.log('[Telegram] 📤 Sending request to backend with:', {
        clientName: clientName || 'not available',
        phoneNumber: phoneNumber,
        chatId: chatId ? 'available' : 'not available',
        caseId: conversationState.caseId,
        pictureDetails: analysis.picture_requirement_details || 'not available',
        problemSummary: analysis.problem_summary || 'not available'
    });
    
    try {
        const requestBody = {
            phoneNumber: phoneNumber,
            caseId: conversationState.caseId,
            pictureDetails: analysis.picture_requirement_details,
            problemSummary: analysis.problem_summary,
            clientName: clientName,
            chatId: chatId
        };
        
        console.log('[Telegram] Request body:', JSON.stringify(requestBody, null, 2));
        console.log('[Telegram] API endpoint:', `${API_BASE}/api/telegram/request-pictures`);
        
        const telegramResponse = await fetch(`${API_BASE}/api/telegram/request-pictures`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        console.log('[Telegram] Response status:', telegramResponse.status, telegramResponse.statusText);

        if (!telegramResponse.ok) {
            const errorText = await telegramResponse.text();
            console.error('[Telegram] ❌ API Error Response:', errorText);
            throw new Error(`Telegram API error: ${telegramResponse.status} - ${errorText}`);
        }

        const result = await telegramResponse.json();
        console.log('[Telegram] ✅ Success! Response from backend:', JSON.stringify(result, null, 2));
        console.log('[Telegram] Message sent:', result.messageSent ? '✅ YES' : '❌ NO (stored for later)');
        console.log('[Telegram] Note:', result.note || 'No note provided');
        
        // Update UI to show Telegram message status
        updateTelegramStatus(result, analysis);
    } catch (error) {
        console.error('[Telegram] ❌ Exception occurred:', error);
        console.error('[Telegram] Error stack:', error.stack);
        // Still show the request info even if Telegram fails
        updateTelegramStatus({ success: false, messageSent: false, error: error.message }, analysis);
    }
    
    console.log('[Telegram] ========== Telegram Request Complete ==========');
}

// Update UI with Telegram status
function updateTelegramStatus(result, analysis) {
    const statusDiv = document.getElementById('analysisStatus');
    if (!statusDiv) return;
    
    const telegramSection = document.createElement('div');
    telegramSection.style.cssText = 'margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);';
    
    if (result.messageSent) {
        telegramSection.innerHTML = `
            <p><strong>📸 Photo Request:</strong> ${analysis.picture_requirement_details}</p>
            <p style="color: var(--success);">✅ Message sent to your Telegram! Please check your Telegram app and send the requested images.</p>
            <p>Once you've sent the photos, our team will review them and send you a detailed quote within 2 hours.</p>
        `;
    } else {
        telegramSection.innerHTML = `
            <p><strong>📸 Photo Request:</strong> ${analysis.picture_requirement_details}</p>
            <p>I'm preparing a message for you on Telegram. Please start a conversation with <strong>@HVACFDA_bot</strong> on Telegram, and you'll receive the photo request.</p>
            <p style="margin-top: 0.5rem; color: var(--text-gray);">For Telegram photo uploads, please message: <strong>@HVACFDA_bot</strong></p>
            <p>Once you've sent the photos, our team will review them and send you a detailed quote within 2 hours.</p>
        `;
    }
    
    statusDiv.appendChild(telegramSection);
}

// Helper functions for displaying results on initial page
async function handlePictureRequestOnInitialPage(analysis) {
    const statusDiv = document.getElementById('analysisStatus');
    if (!statusDiv) {
        console.warn('[Telegram] analysisStatus div not found, cannot display Telegram request');
        return;
    }

    console.log('[Telegram] handlePictureRequestOnInitialPage called, triggering Telegram request...');
    
    // Use the proper triggerTelegramRequest function which has all the data extraction logic
    // Small delay to ensure UI is updated first
    setTimeout(async () => {
        try {
            await triggerTelegramRequest(analysis);
            // updateTelegramStatus will be called by triggerTelegramRequest to update the UI
        } catch (error) {
            console.error('[Telegram] Error in handlePictureRequestOnInitialPage:', error);
            // Fallback UI update if triggerTelegramRequest fails
            const telegramSection = document.createElement('div');
            telegramSection.style.cssText = 'margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);';
            telegramSection.innerHTML = `
                <p><strong>📸 Photo Request:</strong> ${analysis.picture_requirement_details || 'Photos needed for accurate assessment'}</p>
                <p>Please start a conversation with <strong>@HVACFDA_bot</strong> on Telegram first, then send your photos there.</p>
                <p style="margin-top: 0.5rem; color: var(--text-gray);">For Telegram photo uploads, please message: <strong>@HVACFDA_bot</strong></p>
            `;
            statusDiv.appendChild(telegramSection);
        }
    }, 1000);
}

async function generateQuotationOnInitialPage(analysis) {
    const statusDiv = document.getElementById('analysisStatus');
    if (!statusDiv) return;

    statusDiv.innerHTML += `<div style="margin-top: 1rem;"><p>⏳ Generating your quote...</p></div>`;

    setTimeout(async () => {
        try {
            console.log('[Quotation] Generating quotation for initial page...');
            const quotationResponse = await fetch(`${API_BASE}/api/llm/quotation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    summaryData: analysis,
                    caseId: conversationState.caseId
                })
            });

            if (!quotationResponse.ok) {
                const errorText = await quotationResponse.text();
                throw new Error(`Failed to generate quotation: ${quotationResponse.status} - ${errorText}`);
            }

            const { quotation } = await quotationResponse.json();
            console.log('[Quotation] Quotation generated successfully');

            // Save the generated quote to the case
            console.log('[Quotation] Saving quote to case...');
            const saveResponse = await fetch(`${API_BASE}/api/cases/${conversationState.caseId}/quote`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    quote: quotation
                })
            });

            if (!saveResponse.ok) {
                const errorText = await saveResponse.text();
                console.warn('[Quotation] Failed to save quote to case:', errorText);
                // Don't throw - quote is generated, saving failure is not critical
            }

            statusDiv.innerHTML += `
                <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
                    <h3 style="margin: 0.5rem 0; color: var(--accent-orange);">💰 Preliminary Quote</h3>
                    <div style="background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 8px; margin-top: 0.5rem;">
                        ${quotation.replace(/\n/g, '<br>')}
                    </div>
                    <p style="margin-top: 1rem;"><strong>📞 Next Steps:</strong> A contractor will contact you at <strong>${conversationState.clientData.contact}</strong> within 2 hours to confirm this quote and schedule your service.</p>
                </div>
            `;

        } catch (error) {
            console.error('Quotation error:', error);
            statusDiv.innerHTML += `
                <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
                    <p>I encountered an error generating your quote. A contractor will contact you shortly with a detailed estimate.</p>
                </div>
            `;
        }
    }, 2000);
}

function handleHumanReviewOnInitialPage(analysis) {
    const statusDiv = document.getElementById('analysisStatus');
    if (!statusDiv) return;

    setTimeout(() => {
        statusDiv.innerHTML += `
            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
                <p>Your request requires some additional review from our expert team. A contractor will contact you within 2 hours to discuss your specific needs and provide a detailed quote.</p>
            </div>
        `;
    }, 1000);
}

// Display quotation
function displayQuotation(quotation) {
    resultSection.classList.add('active');
    resultContent.innerHTML = `
    <div style="background: rgba(16, 185, 129, 0.1); border-left: 4px solid var(--success); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem;">
      <strong>✅ Quote Generated Successfully!</strong>
    </div>
    ${quotation.replace(/\n/g, '<br>')}
    <div style="margin-top: 2rem; padding: 1rem; background: rgba(59, 130, 246, 0.1); border-radius: 8px;">
      <strong>📞 Next Steps:</strong><br>
      A contractor will contact you at <strong>${conversationState.clientData.contact}</strong> within 2 hours to confirm this quote and schedule your service.
    </div>
  `;

    scrollToBottom();
}

// Display case ID
function displayCaseId() {
    resultSection.classList.add('active');
    resultContent.innerHTML = `
    <h3>✅ Request Submitted</h3>
    <p>Your case has been created successfully!</p>
    <p><strong>Case ID:</strong> <code style="background: rgba(0,0,0,0.3); padding: 0.3rem 0.6rem; border-radius: 4px;">${conversationState.caseId}</code></p>
    <p style="margin-top: 1rem;">Our team will review your request and contact you at <strong>${conversationState.clientData.contact}</strong> within 2 hours.</p>
    <p style="margin-top: 1rem; color: var(--text-gray);">For Telegram photo uploads, please message: <strong>@HVACFDA_bot</strong></p>
  `;
}
