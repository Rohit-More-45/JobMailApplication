/**
 * JobMail - ChatGPT Injected Automation Script
 *
 * Automatically locates the ChatGPT prompt input area and pastes the extracted
 * LinkedIn post content directly into the conversation input field.
 */

export const CHATGPT_INJECTION_SCRIPT = `
(function() {
  window.__JOBMAIL_CHATGPT_READY__ = true;

  function findChatInput() {
    return (
      document.querySelector('#prompt-textarea') ||
      document.querySelector('textarea[data-id="root"]') ||
      document.querySelector('textarea[tabindex="0"]') ||
      document.querySelector('textarea') ||
      document.querySelector('div#prompt-textarea[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"]')
    );
  }

  window.__JOBMAIL_PASTE_INTO_CHATGPT = function(textToPaste) {
    if (!textToPaste) return false;

    var attempts = 0;
    var maxAttempts = 25;

    function tryPaste() {
      attempts++;
      var inputEl = findChatInput();

      if (inputEl) {
        inputEl.focus();

        if (inputEl.tagName.toLowerCase() === 'textarea') {
          inputEl.value = textToPaste;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          if (inputEl.style) {
            inputEl.style.height = 'auto';
            inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
          }
        } else if (inputEl.isContentEditable || inputEl.getAttribute('contenteditable') === 'true') {
          inputEl.innerHTML = '';
          var paragraphs = textToPaste.split('\\n');
          paragraphs.forEach(function(pText) {
            var p = document.createElement('p');
            p.textContent = pText || '\\u00A0';
            inputEl.appendChild(p);
          });
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'CHATGPT_PASTE_SUCCESS',
              length: textToPaste.length
            }));
          }
        } catch (e) {}

        return true;
      }

      if (attempts < maxAttempts) {
        setTimeout(tryPaste, 300);
      } else {
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'CHATGPT_PASTE_RETRY_EXHAUSTED'
            }));
          }
        } catch (e) {}
      }
      return false;
    }

    return tryPaste();
  };
})();
true;
`;
