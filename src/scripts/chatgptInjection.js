/**
 * JobMail - ChatGPT Injected Automation Script (v2)
 *
 * Automatically locates the ChatGPT prompt input area and pastes the clean
 * LinkedIn post content and attaches the screenshot directly into the conversation.
 */

export const CHATGPT_INJECTION_SCRIPT = `
(function() {
  window.__JOBMAIL_CHATGPT_READY__ = true;

  function findChatInput() {
    return (
      document.querySelector('#prompt-textarea') ||
      document.querySelector('div#prompt-textarea[contenteditable="true"]') ||
      document.querySelector('textarea[data-id="root"]') ||
      document.querySelector('textarea[tabindex="0"]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea')
    );
  }

  // Helper to create an image File from base64
  function base64ToFile(base64Data, filename) {
    try {
      var cleanBase64 = base64Data.replace(/^data:image\\/\\w+;base64,/, '');
      var byteCharacters = atob(cleanBase64);
      var byteNumbers = new Array(byteCharacters.length);
      for (var i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      var byteArray = new Uint8Array(byteNumbers);
      var blob = new Blob([byteArray], { type: 'image/png' });
      return new File([blob], filename || 'linkedin-post.png', { type: 'image/png' });
    } catch (e) {
      console.warn('[JobMail:ChatGPT] base64ToFile error:', e);
      return null;
    }
  }

  // Attempt to attach screenshot file to ChatGPT file input or paste event
  function attachScreenshot(base64Image) {
    if (!base64Image) return false;
    try {
      var file = base64ToFile(base64Image, 'linkedin-post-screenshot.png');
      if (!file) return false;

      // 1. Try file input attachment
      var fileInput = document.querySelector('input[type="file"]');
      if (fileInput) {
        var dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // 2. Try dispatching paste event on chat input with file in clipboardData
      var inputEl = findChatInput();
      if (inputEl) {
        var pasteDt = new DataTransfer();
        pasteDt.items.add(file);
        var pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: pasteDt
        });
        inputEl.dispatchEvent(pasteEvent);
      }
      return true;
    } catch (e) {
      console.warn('[JobMail:ChatGPT] attachScreenshot error:', e);
      return false;
    }
  }

  window.__JOBMAIL_PASTE_INTO_CHATGPT = function(textToPaste, base64Image) {
    if (!textToPaste && !base64Image) return false;

    var attempts = 0;
    var maxAttempts = 30;

    function tryPaste() {
      attempts++;
      var inputEl = findChatInput();

      if (inputEl) {
        inputEl.focus();

        // Attach image if available
        if (base64Image) {
          attachScreenshot(base64Image);
        }

        // Insert text content
        if (textToPaste) {
          if (inputEl.tagName.toLowerCase() === 'textarea') {
            inputEl.value = textToPaste;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            if (inputEl.style) {
              inputEl.style.height = 'auto';
              inputEl.style.height = Math.min(inputEl.scrollHeight, 220) + 'px';
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
        }

        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'CHATGPT_PASTE_SUCCESS',
              length: textToPaste ? textToPaste.length : 0,
              hasImage: !!base64Image
            }));
          }
        } catch (e) {}

        return true;
      }

      if (attempts < maxAttempts) {
        setTimeout(tryPaste, 250);
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
