// ============================================
// AI CODE CHECKER - Content Script
// New approach: no API keys.
// Detects code, opens evaluator panel, pastes prompt into ChatGPT/Claude,
// auto-submits, then captures the next assistant response.
// ============================================

const languages = {
    python: /```python|def\s+\w+|import\s+\w+|class\s+\w+|if\s+__name__|return\s+|for\s+.*\s+in\s+|while\s+|try:|except:|lambda\s+/mi,
    javascript: /```javascript|```js|const\s+|let\s+|var\s+|function\s+|=>|require\(|export\s+/m,
    typescript: /```typescript|```ts|interface\s+|type\s+\w+|enum\s+|declare\s+/m,
    java: /```java|public\s+class\s+|public\s+static\s+|private\s+|protected\s+|new\s+|import\s+java/m,
    cpp: /```cpp|```c\+\+|#include\s+|using\s+namespace|int\s+main|template\s+|::/m,
    csharp: /```csharp|```cs|using\s+|public\s+class\s+|private\s+|protected\s+|namespace\s+/m,
    sql: /```sql|SELECT\s+|FROM\s+|WHERE\s+|INSERT\s+INTO|UPDATE\s+|DELETE\s+|CREATE\s+TABLE|JOIN\s+/mi,
    html: /```html|<!DOCTYPE|<html|<div|<body|<head|<script|<style/mi,
    css: /```css|@media|\.[a-zA-Z0-9_-]+\s*\{|background\s*:|color\s*:|margin\s*:|padding\s*:|width\s*:|height\s*:/m,
    bash: /```bash|```sh|#!\/bin|#!\/bin\/bash|apt-get|npm\s+|yarn\s+|python\s+|\.sh/m,
    rust: /```rust|fn\s+|let\s+|mut\s+|struct\s+|impl\s+|use\s+|crate::/m,
    go: /```go|package\s+|func\s+|import\s+|defer\s+|goroutine/m
};

const MARKER_CLASS = 'code-checker-marker';
const SCANNED_ATTR = 'data-code-checker-scanned';

let pendingEvaluation = false;
let assistantCountBeforeSubmit = 0;

// Detect current platform
function detectPlatform() {
    const host = window.location.hostname.toLowerCase();

    if (host.includes('claude')) return 'claude';
    if (host.includes('chatgpt') || host.includes('openai')) return 'chatgpt';

    return 'unknown';
}

// Detect language from code text
function detectLanguage(text) {
    for (const [lang, pattern] of Object.entries(languages)) {
        if (pattern.test(text)) return lang;
    }

    return 'unknown';
}

// Extract fenced code blocks - preserve internal whitespace and formatting
function extractCodeBlocks(text) {
    const blocks = [];
    const codeBlockRegex = /```[\w-]*\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
        // Only trim leading/trailing newlines, preserve all internal formatting
        blocks.push(match[1].replace(/^\n+|\n+$/g, ''));
    }

    return blocks;
}

// Check whether an element contains code and preserve its formatting
function hasRealCode(element) {
    const codeElements = element.querySelectorAll('pre, code');

    for (const codeEl of codeElements) {
        // Use textContent for better whitespace preservation
        const code = codeEl.textContent || codeEl.innerText || '';

        if (code.trim().length > 20) {
            // Return code with preserved formatting (no aggressive trimming)
            return code.replace(/^\n+|\n+$/g, '');
        }
    }

    const text = element.innerText || element.textContent || '';
    const blocks = extractCodeBlocks(text);

    if (blocks.length > 0) {
        return blocks[0];
    }

    return null;
}

// Get AI message containers
function getMessageContainers() {
    return document.querySelectorAll(`
        [data-message-author-role="assistant"],
        [data-testid*="conversation-turn"],
        [role="article"],
        .message,
        [data-message-id]
    `);
}

// Get assistant messages only - preserve formatting
function getAssistantMessages() {
    const platform = detectPlatform();

    if (platform === 'chatgpt') {
        return Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    }

    if (platform === 'claude') {
        return Array.from(document.querySelectorAll('[data-testid*="message"], [data-is-streaming], .font-claude-message'))
            .filter((el) => {
                const text = el.innerText || el.textContent || '';
                return text.trim().length > 20;
            });
    }

    return Array.from(getMessageContainers());
}

// Build evaluator prompt
function buildEvaluationPrompt(code, language) {
    return `Here is my code:

\`\`\`${language}
${code}
\`\`\`

1. Does the code work?
Shows expected result.
Test code in console.
Answer whether it works or not in yes or no.
If not, show why.

2. Is it logically readable?
Check:
- White space between functions
- Proper function name
- Proper variable name
- Comments that explain the function

Answer in this format:

1. Does the code work?
[Yes/No]
Expected result:
[Expected result]
Why:
[Reason]

2. Is it logically readable?
[Yes/No]
Why:
[Reason]`;
}

// Save current evaluation state for evaluator.html side panel
function saveEvaluationState(status, data = {}) {
    chrome.storage.local.set({
        evaluationStatus: status,
        evaluationResult: data.result || '',
        codeToEvaluate: data.code || '',
        languageToEvaluate: data.language || '',
        evaluationPrompt: data.prompt || '',
        updatedAt: Date.now()
    });
}

// Open evaluator panel
function openEvaluatorPanel(code, language, prompt) {
    chrome.runtime.sendMessage({
        action: 'openEvaluator',
        code,
        language,
        prompt
    }, () => {
        if (chrome.runtime.lastError) {
            console.log('Evaluator panel could not open:', chrome.runtime.lastError.message);
        }
    });
}

// Find chat input
function findChatInput() {
    const platform = detectPlatform();

    if (platform === 'chatgpt') {
        return (
            document.querySelector('#prompt-textarea') ||
            document.querySelector('textarea[data-testid="prompt-textarea"]') ||
            document.querySelector('textarea') ||
            document.querySelector('[contenteditable="true"]')
        );
    }

    if (platform === 'claude') {
        return (
            document.querySelector('div[contenteditable="true"]') ||
            document.querySelector('textarea') ||
            document.querySelector('[aria-label*="Write"]') ||
            document.querySelector('[aria-label*="message"]')
        );
    }

    return (
        document.querySelector('#prompt-textarea') ||
        document.querySelector('textarea') ||
        document.querySelector('[contenteditable="true"]')
    );
}

// Insert text into text area or contenteditable
function setInputValue(input, text) {
    input.focus();

    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value'
        )?.set;

        if (nativeSetter) {
            // Set value directly without any whitespace modifications
            nativeSetter.call(input, text);
        } else {
            input.value = text;
        }

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }

    if (input.isContentEditable) {
        // For contenteditable elements, preserve all whitespace
        input.textContent = text;
        input.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: text
        }));
    }
}

// Find submit/send button
function findSendButton() {
    const platform = detectPlatform();

    if (platform === 'chatgpt') {
        return (
            document.querySelector('[data-testid="send-button"]') ||
            document.querySelector('button[aria-label*="Send"]') ||
            document.querySelector('button[data-testid*="send"]')
        );
    }

    if (platform === 'claude') {
        return (
            document.querySelector('button[aria-label*="Send"]') ||
            document.querySelector('button[aria-label*="send"]') ||
            Array.from(document.querySelectorAll('button')).find((btn) => {
                const label = btn.getAttribute('aria-label') || btn.innerText || '';
                return label.toLowerCase().includes('send');
            })
        );
    }

    return (
        document.querySelector('[data-testid="send-button"]') ||
        document.querySelector('button[aria-label*="Send"]')
    );
}

// Submit the prompt
function submitPrompt() {
    const sendButton = findSendButton();

    if (sendButton && !sendButton.disabled) {
        sendButton.click();
        return true;
    }

    const input = findChatInput();

    if (!input) return false;

    input.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
        code: 'Enter'
    }));

    return true;
}

// Paste prompt and auto-submit
function pastePromptAndSubmit(prompt) {
    const input = findChatInput();

    if (!input) {
        saveEvaluationState('error', {
            result: 'Could not find chat input box.'
        });
        return false;
    }

    setInputValue(input, prompt);

    setTimeout(() => {
        const submitted = submitPrompt();

        if (!submitted) {
            saveEvaluationState('error', {
                result: 'Prompt was inserted, but auto-submit failed. Please press Enter manually.'
            });
        }
    }, 500);

    return true;
}

// Capture next assistant response after submit
function startResponseWatcher() {
    const observer = new MutationObserver(() => {
        if (!pendingEvaluation) return;

        const messages = getAssistantMessages();

        if (messages.length <= assistantCountBeforeSubmit) return;

        const lastMessage = messages[messages.length - 1];
        const text = lastMessage.innerText || lastMessage.textContent || '';

        if (!text.trim()) return;

        const stillGenerating =
            document.querySelector('[data-testid="stop-button"]') ||
            document.querySelector('button[aria-label*="Stop"]') ||
            document.querySelector('button[aria-label*="stop"]');

        saveEvaluationState('waiting', {
            result: text.trim()
        });

        if (!stillGenerating && text.trim().length > 80) {
            pendingEvaluation = false;

            saveEvaluationState('complete', {
                result: text.trim()
            });
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

// Create evaluate button
function addEvaluationMarker(messageElement, code, language) {
    if (messageElement.querySelector(`.${MARKER_CLASS}`)) return;

    const marker = document.createElement('button');
    marker.className = MARKER_CLASS;
    marker.textContent = '✓ Evaluate Code';
    marker.title = `Evaluate ${language} code`;

    marker.style.cssText = `
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        padding: 8px 16px;
        margin: 8px 0;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
    `;

    marker.onmouseover = () => {
        marker.style.transform = 'translateY(-2px)';
        marker.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.5)';
    };

    marker.onmouseout = () => {
        marker.style.transform = 'translateY(0)';
        marker.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.3)';
    };

    marker.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        const prompt = buildEvaluationPrompt(code, language);

        pendingEvaluation = true;
        assistantCountBeforeSubmit = getAssistantMessages().length;

        // Copy formatted code to clipboard
        copyCodeToClipboard(code);

        saveEvaluationState('waiting', {
            code,
            language,
            prompt,
            result: 'Waiting for AI response...'
        });

        openEvaluatorPanel(code, language, prompt);
        pastePromptAndSubmit(prompt);
    };

    messageElement.appendChild(marker);
}

// Copy code to clipboard while preserving formatting
function copyCodeToClipboard(code) {
    const textArea = document.createElement('textarea');
    textArea.value = code;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
}

// Scan messages for code
function scanMessages() {
    const messages = getMessageContainers();

    messages.forEach((message) => {
        if (message.getAttribute(SCANNED_ATTR) === 'true') return;

        const code = hasRealCode(message);

        if (code) {
            const language = detectLanguage(code);
            addEvaluationMarker(message, code, language);
        }

        message.setAttribute(SCANNED_ATTR, 'true');
    });
}

// Start observer for new messages
function startObserver() {
    const observer = new MutationObserver(() => {
        scanMessages();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// Handle messages from evaluator panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getEvaluationState') {
        chrome.storage.local.get([
            'evaluationStatus',
            'evaluationResult',
            'codeToEvaluate',
            'languageToEvaluate',
            'evaluationPrompt',
            'updatedAt'
        ], (result) => {
            sendResponse(result);
        });

        return true;
    }
});

// Initial run
setTimeout(scanMessages, 1000);
setTimeout(scanMessages, 3000);

startObserver();
startResponseWatcher();