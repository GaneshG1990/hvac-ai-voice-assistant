// Contractor Portal Logic

const API_BASE = window.location.origin;

// Send the contractor back to the login page if the session expires.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (response.status === 401) {
        window.location.replace('/login');
    }
    return response;
};

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await nativeFetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
        window.location.replace('/login');
    });
}
let allCases = [];
let currentFilter = 'all';
let activeCaseId = null;

// DOM elements
const casesContainer = document.getElementById('casesContainer');
const refreshBtn = document.getElementById('refreshBtn');
const filterTabs = document.querySelectorAll('.filter-tab');
const totalCasesEl = document.getElementById('totalCases');
const pendingReviewEl = document.getElementById('pendingReview');
const picturesNeededEl = document.getElementById('picturesNeeded');
const quotesReadyEl = document.getElementById('quotesReady');
const quoteBadge = document.getElementById('quoteBadge');

// Modal elements
const reviewModal = document.getElementById('reviewModal');
const modalCaseId = document.getElementById('modalCaseId');
const modalClientName = document.getElementById('modalClientName');
const originalQuote = document.getElementById('originalQuote');
const quoteEditor = document.getElementById('quoteEditor');
const sendOriginalBtn = document.getElementById('sendOriginalBtn');
const sendEditedBtn = document.getElementById('sendEditedBtn');

// Human Review Modal elements
const humanReviewModal = document.getElementById('humanReviewModal');
const humanReviewCaseId = document.getElementById('humanReviewCaseId');
const humanReviewClientName = document.getElementById('humanReviewClientName');
const humanReviewSummary = document.getElementById('humanReviewSummary');
const contractorComments = document.getElementById('contractorComments');
const submitHumanReviewBtn = document.getElementById('submitHumanReviewBtn');

// Event listeners
refreshBtn.addEventListener('click', loadCases);
filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter;
        
        // If clicking on Quote Ready, update last view timestamp
        if (currentFilter === 'QUOTE_READY') {
            localStorage.setItem('lastQuoteView', new Date().toISOString());
            updateQuotationBadge(); // This will hide the badge
        }
        
        renderCases();
    });
});

sendOriginalBtn.addEventListener('click', sendOriginalQuote);
sendEditedBtn.addEventListener('click', sendEditedQuote);
submitHumanReviewBtn.addEventListener('click', submitHumanReview);

// Load cases on page load
loadCases();

// Auto-refresh every 30 seconds
setInterval(loadCases, 30000);

// Load cases from API
async function loadCases() {
    try {
        const response = await fetch(`${API_BASE}/api/cases`);
        allCases = await response.json();

        updateStats();
        updateQuotationBadge();
        renderCases();
    } catch (error) {
        console.error('Error loading cases:', error);
        casesContainer.innerHTML = `
            <div class="empty-state">
                <h3>❌ Error loading cases</h3>
                <p>Please try refreshing the page</p>
            </div>
        `;
    }
}

// Update statistics
function updateStats() {
    totalCasesEl.textContent = allCases.length;

    const humanReview = allCases.filter(c => c.analysis?.action_required === 'HUMAN_REVIEW').length;
    const pictures = allCases.filter(c => c.analysis?.action_required === 'PICTURES').length;
    const quotes = allCases.filter(c => c.analysis?.action_required === 'QUOTE_READY').length;

    pendingReviewEl.textContent = humanReview;
    picturesNeededEl.textContent = pictures;
    quotesReadyEl.textContent = quotes;
}

// Render cases based on current filter
function renderCases() {
    let filteredCases = allCases;

    if (currentFilter !== 'all') {
        filteredCases = allCases.filter(c => c.analysis?.action_required === currentFilter);
    }

    if (filteredCases.length === 0) {
        casesContainer.innerHTML = `
            <div class="empty-state">
                <h3>📭 No cases found</h3>
                <p>${currentFilter === 'all' ? 'No cases have been created yet' : `No cases with filter: ${currentFilter}`}</p>
            </div>
        `;
        return;
    }

    // Sort by creation date (newest first)
    filteredCases.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    casesContainer.innerHTML = filteredCases.map(caseData => renderCaseCard(caseData)).join('');
}

// Render individual case card
function renderCaseCard(caseData) {
    const analysis = caseData.analysis || {};
    const actionRequired = analysis.action_required || 'PENDING';
    const confidence = analysis.llm_confidence_score || 0;

    let badgeClass = 'badge-review';
    let badgeText = actionRequired;

    if (actionRequired === 'PICTURES') {
        badgeClass = 'badge-pictures';
        badgeText = '📸 Pictures Needed';
    } else if (actionRequired === 'QUOTE_READY') {
        badgeClass = 'badge-ready';
        badgeText = '✅ Quote Ready';
    } else if (actionRequired === 'QUOTE_APPROVED') {
        badgeClass = 'badge-ready';
        badgeText = '🎉 Approved';
    } else if (actionRequired === 'HUMAN_REVIEW') {
        badgeClass = 'badge-review';
        badgeText = '👤 Human Review';
    }

    const createdDate = new Date(caseData.createdAt).toLocaleString();

    // Checking if quote exists (either initial or final)
    const hasQuote = caseData.final_quote || (caseData.analysis && caseData.analysis.action_required === 'QUOTE_READY');
    const needsHumanReview = actionRequired === 'HUMAN_REVIEW';

    return `
        <div class="case-card">
            <div class="case-header">
                <div class="case-id">
                    ${caseData.id}
                    ${hasQuote ? `<button onclick="openReviewModal('${caseData.id}')" style="margin-left: 10px; padding: 4px 8px; font-size: 0.8rem; background: var(--accent-blue); border: none; border-radius: 4px; color: white; cursor: pointer;">📝 Review Quote</button>` : ''}
                    ${needsHumanReview ? `<button onclick="openHumanReviewModal('${caseData.id}')" style="margin-left: 10px; padding: 4px 8px; font-size: 0.8rem; background: linear-gradient(135deg, var(--error), #f87171); border: none; border-radius: 4px; color: white; cursor: pointer;">👤 Review Case</button>` : ''}
                    <button onclick="deleteCase('${caseData.id}')" style="margin-left: 10px; padding: 4px 8px; font-size: 0.8rem; background: var(--error); border: none; border-radius: 4px; color: white; cursor: pointer;">🗑️ Delete</button>
                </div>
                <div class="case-badge ${badgeClass}">${badgeText}</div>
            </div>

            <div class="case-info">
                <div class="info-item">
                    <div class="info-label">Client Name</div>
                    <div class="info-value">${analysis.client_name || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Contact</div>
                    <div class="info-value">${analysis.contact_number || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Location</div>
                    <div class="info-value">${analysis.service_zip_code || 'N/A'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Category</div>
                    <div class="info-value">${analysis.diagnosis_category || 'N/A'}</div>
                </div>
            </div>

            ${analysis.problem_summary ? `
                    <div class="case-problem">
                        <div class="info-label">Problem Summary</div>
                        <div style="margin-top: 0.5rem;">${analysis.problem_summary}</div>
                    </div>
                ` : ''
        }

            ${analysis.picture_requirement_details ? `
                    <div style="margin-top: 1rem; padding: 0.8rem; background: rgba(251, 146, 60, 0.1); border-radius: 8px; border-left: 3px solid var(--accent-orange);">
                        <div class="info-label">📸 Picture Requirements</div>
                        <div style="margin-top: 0.3rem; font-size: 0.9rem;">${analysis.picture_requirement_details}</div>
                    </div>
                ` : ''
        }

            ${analysis.auto_generated_without_images ? `
                    <div style="margin-top: 1rem; padding: 0.8rem; background: rgba(234, 179, 8, 0.1); border-radius: 8px; border-left: 3px solid #eab308;">
                        <div class="info-label">⚠️ Auto-Generated Quote</div>
                        <div style="margin-top: 0.3rem; font-size: 0.9rem;">This quote was automatically generated after 15 minutes without receiving requested images. Please review carefully.</div>
                    </div>
                ` : ''
        }

            ${caseData.images && caseData.images.length > 0 ? `
                    <div style="margin-top: 1rem;">
                        <div class="info-label">📷 Images Received: ${caseData.images.length}</div>
                    </div>
                ` : ''
        }

            <div style="margin-top: 1rem;">
                <div class="info-label">AI Confidence Score</div>
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: ${confidence * 100}%"></div>
                </div>
                <div style="text-align: right; font-size: 0.85rem; color: var(--text-gray); margin-top: 0.3rem;">
                    ${(confidence * 100).toFixed(0)}%
                </div>
            </div>

            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--glass-border); display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 0.85rem; color: var(--text-gray);">
                    Created: ${createdDate}
                </div>
                <div style="font-size: 0.85rem; color: var(--text-gray);">
                    Status: ${caseData.status || 'pending'}
                </div>
            </div>
        </div>
    `;
}

// Modal Functions
window.openReviewModal = async (caseId) => {
    const caseData = allCases.find(c => c.id === caseId);
    if (!caseData) return;

    activeCaseId = caseId;
    modalCaseId.textContent = caseId;
    modalClientName.textContent = caseData.analysis?.client_name || 'Unknown Client';

    // Load original quote (left column - read-only)
    // Use original_quote if available, otherwise fall back to final_quote for backward compatibility
    let originalQuoteContent = caseData.original_quote || caseData.final_quote || "No quote available yet.";

    if (!caseData.original_quote && !caseData.final_quote && caseData.analysis && caseData.analysis.action_required === 'QUOTE_READY') {
        originalQuoteContent = "Quote is being generated. Please wait a moment and refresh, or the quote may still be processing.";
        console.log('[Contractor] Quote not found in case data, but action_required is QUOTE_READY');
    }

    originalQuote.value = originalQuoteContent;

    // Load editable quote (right column - can be edited)
    // Start with final_quote, or original if no final exists
    let editableQuoteContent = caseData.final_quote || caseData.original_quote || "No quote available yet.";
    quoteEditor.value = editableQuoteContent;

    reviewModal.classList.add('active');
};

window.closeModal = () => {
    reviewModal.classList.remove('active');
    activeCaseId = null;
};

// Human Review Modal Functions
window.openHumanReviewModal = (caseId) => {
    const caseData = allCases.find(c => c.id === caseId);
    if (!caseData) return;

    activeCaseId = caseId;
    humanReviewCaseId.textContent = caseId;
    humanReviewClientName.textContent = caseData.analysis?.client_name || 'Unknown Client';
    
    // Build summary display
    const analysis = caseData.analysis || {};
    const summaryHtml = `
        <div style="margin-bottom: 1rem;">
            <strong style="color: var(--accent-blue);">Problem Summary:</strong>
            <p style="margin-top: 0.3rem;">${analysis.problem_summary || 'N/A'}</p>
        </div>
        <div style="margin-bottom: 1rem;">
            <strong style="color: var(--accent-blue);">Category:</strong>
            <span style="margin-left: 0.5rem;">${analysis.diagnosis_category || 'N/A'}</span>
        </div>
        <div style="margin-bottom: 1rem;">
            <strong style="color: var(--accent-blue);">Contact:</strong>
            <span style="margin-left: 0.5rem;">${analysis.contact_number || 'N/A'}</span>
        </div>
        <div style="margin-bottom: 1rem;">
            <strong style="color: var(--accent-blue);">Location:</strong>
            <span style="margin-left: 0.5rem;">${caseData.full_address || analysis.service_zip_code || 'N/A'}</span>
        </div>
        ${analysis.picture_requirement_details ? `
            <div style="margin-bottom: 1rem;">
                <strong style="color: var(--accent-orange);">Picture Requirements:</strong>
                <p style="margin-top: 0.3rem;">${analysis.picture_requirement_details}</p>
            </div>
        ` : ''}
        ${caseData.images && caseData.images.length > 0 ? `
            <div style="margin-bottom: 1rem;">
                <strong style="color: var(--success);">Images Received:</strong>
                <span style="margin-left: 0.5rem;">${caseData.images.length} image(s)</span>
            </div>
        ` : ''}
        ${analysis.auto_generated_without_images ? `
            <div style="margin-bottom: 1rem; padding: 0.8rem; background: rgba(234, 179, 8, 0.1); border-radius: 8px; border-left: 3px solid #eab308;">
                <strong style="color: #eab308;">⚠️ Auto-Generated:</strong>
                <p style="margin-top: 0.3rem; font-size: 0.9rem;">This quote was generated without the requested images after 15-minute timeout.</p>
            </div>
        ` : ''}
        <div>
            <strong style="color: var(--accent-blue);">AI Confidence:</strong>
            <span style="margin-left: 0.5rem;">${((analysis.llm_confidence_score || 0) * 100).toFixed(0)}%</span>
        </div>
    `;
    
    humanReviewSummary.innerHTML = summaryHtml;
    contractorComments.value = ''; // Clear previous comments
    
    humanReviewModal.classList.add('active');
};

window.closeHumanReviewModal = () => {
    humanReviewModal.classList.remove('active');
    activeCaseId = null;
    contractorComments.value = '';
};

// Send original quote to client
async function sendOriginalQuote() {
    if (!activeCaseId) return;

    try {
        const response = await fetch(`${API_BASE}/api/cases/${activeCaseId}/quote`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'QUOTE_APPROVED',
                use_original: true
            })
        });

        if (response.ok) {
            const result = await response.json();
            alert('✅ Original Quote Sent! PDF will be sent to client via Telegram if they have a chat ID.');
            closeModal();
            loadCases(); // Refresh list
        } else {
            const errorText = await response.text();
            console.error('Error sending original quote:', errorText);
            alert('Error sending original quote: ' + errorText);
        }
    } catch (error) {
        console.error('Error sending original quote:', error);
        alert('Failed to send original quote: ' + error.message);
    }
}

// Send edited quote to client
async function sendEditedQuote() {
    if (!activeCaseId) return;

    const editedQuote = quoteEditor.value.trim();

    if (!editedQuote) {
        alert('⚠️ Please enter a quote before sending.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/cases/${activeCaseId}/quote`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quote: editedQuote,
                status: 'QUOTE_APPROVED',
                use_original: false
            })
        });

        if (response.ok) {
            const result = await response.json();
            alert('✅ Changes Implemented and Quote Sent! PDF will be sent to client via Telegram if they have a chat ID.');
            closeModal();
            loadCases(); // Refresh list
        } else {
            const errorText = await response.text();
            console.error('Error sending edited quote:', errorText);
            alert('Error sending edited quote: ' + errorText);
        }
    } catch (error) {
        console.error('Error sending edited quote:', error);
        alert('Failed to send edited quote: ' + error.message);
    }
}

// Update quotation badge with count of new quotations
function updateQuotationBadge() {
    // Get last view timestamp from localStorage
    const lastView = localStorage.getItem('lastQuoteView');
    const lastViewDate = lastView ? new Date(lastView) : new Date(0); // If never viewed, use epoch
    
    // Count quotations that are QUOTE_READY and updated after last view
    const newQuotations = allCases.filter(c => {
        if (c.analysis?.action_required !== 'QUOTE_READY') return false;
        
        // Check if case was updated after last view
        const caseUpdateDate = new Date(c.updatedAt || c.createdAt);
        return caseUpdateDate > lastViewDate;
    });
    
    const count = newQuotations.length;
    
    console.log('[Badge] New quotations count:', count);
    console.log('[Badge] Last view:', lastViewDate.toISOString());
    
    if (count > 0) {
        quoteBadge.textContent = count;
        quoteBadge.style.display = 'inline-block';
    } else {
        quoteBadge.style.display = 'none';
    }
}

// Submit human review and generate quotation
async function submitHumanReview() {
    if (!activeCaseId) return;

    const comments = contractorComments.value.trim();
    
    if (!comments) {
        alert('⚠️ Please provide your professional review comments before submitting.');
        return;
    }

    // Disable button during submission
    submitHumanReviewBtn.disabled = true;
    submitHumanReviewBtn.textContent = '⏳ Processing...';

    try {
        const response = await fetch(`${API_BASE}/api/cases/${activeCaseId}/human-review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contractorComments: comments
            })
        });

        if (response.ok) {
            const result = await response.json();
            alert('✅ Review submitted successfully! Quotation is being generated. The case will move to "Quote Ready" once complete.');
            closeHumanReviewModal();
            loadCases(); // Refresh list
        } else {
            const errorText = await response.text();
            console.error('Error submitting human review:', errorText);
            alert('Error submitting review: ' + errorText);
        }
    } catch (error) {
        console.error('Error submitting human review:', error);
        alert('Failed to submit review: ' + error.message);
    } finally {
        submitHumanReviewBtn.disabled = false;
        submitHumanReviewBtn.textContent = '✅ Submit Review & Generate Quote';
    }
}

// Global scope for onclick handler
window.deleteCase = async (caseId) => {
    if (!confirm(`Are you sure you want to delete case ${caseId}? This action cannot be undone.`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/cases/${caseId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            // Remove from local array immediately for snappiness
            allCases = allCases.filter(c => c.id !== caseId);
            updateStats();
            updateQuotationBadge();
            renderCases();
            alert('Case deleted successfully');
        } else {
            alert('Failed to delete case');
        }
    } catch (error) {
        console.error('Error deleting case:', error);
        alert('Error deleting case');
    }
};
