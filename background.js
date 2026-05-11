// ============================================
// BACKGROUND SERVICE WORKER (FROM MINIFIED)
// Handles: opening evaluator panel, managing state, error handling
// ============================================

let evaluatorPanelTabId = null;  // FIX: Added space after "let"
let isOpeningPanel = false;      // FIX: Added race condition prevention

const PANEL_TIMEOUT = 5000;      // 5 second timeout

/**
 * Main message listener from content script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'openEvaluator') {
        handleOpenEvaluator(request, sendResponse);
        return true;  // Keep channel open for async response
    }
});

/**
 * Handle opening the evaluator panel
 * FIX: Added comprehensive error handling and race condition prevention
 */
function handleOpenEvaluator(request, sendResponse) {
    // FIX: Prevent race condition from multiple rapid clicks
    if (isOpeningPanel) {
        console.warn('Panel open already in progress');
        sendResponse({
            status: 'already_opening',
            message: 'Panel is already opening, please wait'
        });
        return;
    }

    isOpeningPanel = true;

    // Validate input
    if (!request.code || typeof request.code !== 'string') {
        console.warn('Invalid code provided');
        isOpeningPanel = false;
        sendResponse({
            error: 'Invalid code provided',
            status: 'error'
        });
        return;
    }

    // Save evaluation data to storage
    // CRITICAL: Preserve code formatting - do NOT trim or compress
    const storageData = {
        codeToEvaluate: request.code,  // Store as-is, with all whitespace and newlines
        languageToEvaluate: request.language || 'unknown',
        evaluationPrompt: request.prompt || '',
        evaluationStatus: 'waiting',
        evaluationResult: 'Waiting for AI response...',
        updatedAt: Date.now()
    };

    chrome.storage.local.set(storageData, () => {
        // FIX: Check for storage error
        if (chrome.runtime.lastError) {
            console.error('Storage error:', chrome.runtime.lastError);
            isOpeningPanel = false;
            sendResponse({
                error: 'Storage error: ' + chrome.runtime.lastError.message,
                status: 'error'
            });
            return;
        }

        // If panel tab already exists, focus it
        if (evaluatorPanelTabId) {
            focusExistingPanel(sendResponse);
        } else {
            createNewPanel(sendResponse);
        }
    });
}

/**
 * Focus existing evaluator panel
 * FIX: Added error handling for tab update
 */
function focusExistingPanel(sendResponse) {
    chrome.tabs.update(evaluatorPanelTabId, {active: true}, () => {
        // FIX: Check for error (tab might have been closed)
        if (chrome.runtime.lastError) {
            console.warn('Tab no longer exists, creating new panel:', chrome.runtime.lastError);
            evaluatorPanelTabId = null;
            isOpeningPanel = false;
            // Recursively create new panel
            createNewPanel(sendResponse);
            return;
        }

        console.log('Focused existing panel tab:', evaluatorPanelTabId);
        isOpeningPanel = false;
        sendResponse({
            status: 'focused',
            message: 'Focused existing panel'
        });
    });
}

/**
 * Create new evaluator panel window
 * FIX: Added comprehensive error handling and timeout
 */
function createNewPanel(sendResponse) {
    const panelConfig = {
        url: chrome.runtime.getURL('evaluator.html'),
        type: 'popup',
        width: 520,
        height: 820
    };

    // FIX: Set timeout to prevent hanging
    const timeoutId = setTimeout(() => {
        console.error('Panel creation timeout');
        isOpeningPanel = false;
        sendResponse({
            error: 'Panel creation timed out',
            status: 'error'
        });
    }, PANEL_TIMEOUT);

    chrome.windows.create(panelConfig, (window) => {
        clearTimeout(timeoutId);

        // FIX: Check for window creation error
        if (chrome.runtime.lastError) {
            console.error('Failed to create panel window:', chrome.runtime.lastError);
            isOpeningPanel = false;
            sendResponse({
                error: 'Failed to create panel: ' + chrome.runtime.lastError.message,
                status: 'error'
            });
            return;
        }

        // FIX: Validate window and tabs exist
        if (!window) {
            console.error('Window creation returned null');
            isOpeningPanel = false;
            sendResponse({
                error: 'Panel window is null',
                status: 'error'
            });
            return;
        }

        if (!window.tabs || window.tabs.length === 0) {
            console.warn('Panel opened but no tabs found');
            isOpeningPanel = false;
            sendResponse({
                status: 'opened_no_tab',
                message: 'Panel opened but tab ID unavailable'
            });
            return;
        }

        // FIX: Store tab ID (THIS WAS THE EMPTY BLOCK IN YOUR CODE!)
        evaluatorPanelTabId = window.tabs[0].id;
        console.log('Created new panel with tab ID:', evaluatorPanelTabId);

        isOpeningPanel = false;
        sendResponse({
            status: 'created',
            message: 'Panel created successfully',
            tabId: evaluatorPanelTabId
        });
    });
}

/**
 * Clean up when panel tab is closed
 */
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === evaluatorPanelTabId) {
        console.log('Panel tab closed');
        evaluatorPanelTabId = null;
    }
});

/**
 * Clean up on extension unload
 */
chrome.runtime.onSuspend?.addListener?.(() => {
    console.log('Extension suspending, cleaning up');
    evaluatorPanelTabId = null;
    isOpeningPanel = false;
});

console.log('✓ Background service worker loaded');