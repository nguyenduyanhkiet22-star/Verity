// ============================================
// EVALUATOR PANEL SCRIPT (FROM MINIFIED)
// Displays code evaluation results from AI
// ============================================

/**
 * Initialize when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
    // Set up button listeners
    const refreshBtn = document.getElementById('refreshBtn');
    const closeBtn = document.getElementById('closeBtn');

    // FIX: Add null checks for elements
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadEvaluationState);
    } else {
        console.warn('refreshBtn element not found');
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => window.close());
    } else {
        console.warn('closeBtn element not found');
    }

    // Initial load
    loadEvaluationState();

    // Watch for storage changes
    startStorageWatcher();

    // FIX: Remove 1-second polling interval (wastes CPU)
    // setInterval(loadEvaluationState, 1000);  // ← REMOVED: Storage listener is sufficient
});

/**
 * Load evaluation state from storage and update UI
 * FIX: Fixed spacing in "async function" declaration
 * UPDATED: Preserve code formatting and whitespace
 */
async function loadEvaluationState() {
    try {
        // FIX: Fixed all "const" declarations (were missing spaces)
        const result = await chrome.storage.local.get([
            'evaluationStatus',
            'evaluationResult',
            'codeToEvaluate',
            'languageToEvaluate'
        ]);

        // Extract with defaults
        const status = result.evaluationStatus || 'waiting';
        const code = result.codeToEvaluate || '';
        const language = result.languageToEvaluate || 'unknown';
        const evaluationResult = result.evaluationResult || 'Waiting for AI response...';

        // Update UI with code info
        const languageTag = document.getElementById('languageTag');
        const codePreview = document.getElementById('codePreview');

        // FIX: Add null checks before updating DOM
        if (languageTag) {
            languageTag.textContent = language.toUpperCase();
        } else {
            console.warn('languageTag element not found');
        }

        if (codePreview) {
            // CRITICAL: Use textContent (not innerText) to preserve whitespace and formatting
            codePreview.textContent = code || 'No code found.';
            // Ensure the code element maintains white-space: pre styling
            codePreview.style.whiteSpace = 'pre';
        } else {
            console.warn('codePreview element not found');
        }

        // Update UI based on status
        updateUI(status, evaluationResult);

    } catch (error) {
        console.error('Error loading evaluation state:', error);
        updateUI('error', 'Error loading state: ' + error.message);
    }
}

/**
 * Update UI to show appropriate card (waiting/result/error)
 * FIX: Fixed spacing in "function" declaration
 * UPDATED: Preserve formatting in result and error text
 */
function updateUI(status, text) {
    // FIX: Fixed all "const" declarations
    const waitingCard = document.getElementById('waitingCard');
    const resultCard = document.getElementById('resultCard');
    const errorCard = document.getElementById('errorCard');
    const resultText = document.getElementById('resultText');
    const errorText = document.getElementById('errorText');

    // FIX: Add validation - elements might not exist
    if (!waitingCard || !resultCard || !errorCard) {
        console.error('Required UI elements not found');
        return;
    }

    // Hide all cards initially
    waitingCard.classList.add('hidden');
    resultCard.classList.add('hidden');
    errorCard.classList.add('hidden');

    // Show appropriate card based on status
    if (status === 'error') {
        if (errorText) {
            errorText.textContent = text || 'Unknown error.';
            // Preserve whitespace in error display
            errorText.style.whiteSpace = 'pre-wrap';
        }
        errorCard.classList.remove('hidden');
        return;
    }

    if (status === 'complete') {
        if (resultText) {
            resultText.textContent = text || 'No result captured.';
            // Preserve whitespace in result display
            resultText.style.whiteSpace = 'pre-wrap';
        }
        resultCard.classList.remove('hidden');
        return;
    }

    // Default: show waiting card
    waitingCard.classList.remove('hidden');

    // If we have partial result, show it alongside waiting
    if (text && text !== 'Waiting for AI response...') {
        if (resultText) {
            resultText.textContent = text;
            // Preserve whitespace in result display
            resultText.style.whiteSpace = 'pre-wrap';
        }
        resultCard.classList.remove('hidden');
    }
}

/**
 * Watch for changes to storage and reload when data updates
 * FIX: Fixed spacing in "function" declaration
 */
function startStorageWatcher() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        // Only care about local storage
        if (areaName !== 'local') return;

        // Reload if any relevant field changed
        if (
            changes.evaluationStatus ||
            changes.evaluationResult ||
            changes.codeToEvaluate ||
            changes.languageToEvaluate
        ) {
            loadEvaluationState();
        }
    });
}

console.log('✓ Evaluator script loaded');