/**
 * JobMail - ChatGPT Injected Automation Script (v4)
 *
 * Automatically attaches EXACTLY ONE screenshot into ChatGPT chat.
 * Prevents duplicate attachments and does not insert extra text.
 */

export const CHATGPT_INJECTION_SCRIPT = `
(function() {
  window.__JOBMAIL_CHATGPT_READY__ = true;
  window.__JOBMAIL_LAST_ATTACH_TIME__ = window.__JOBMAIL_LAST_ATTACH_TIME__ || 0;
  window.__JOBMAIL_IS_ATTACHING__ = false;

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

  // Convert base64 data to an image File
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
      return new File([blob], filename || 'post-screenshot.png', { type: 'image/png' });
    } catch (e) {
      console.warn('[JobMail:ChatGPT] base64ToFile error:', e);
      return null;
    }
  }

  // Attach screenshot to ChatGPT - exactly ONE mechanism used
  function attachScreenshotOnce(base64Image) {
    if (!base64Image) return false;
    try {
      var file = base64ToFile(base64Image, 'post-screenshot.png');
      if (!file) return false;

      // Method 1: Try ChatGPT file input element first
      var fileInputs = document.querySelectorAll('input[type="file"]');
      if (fileInputs && fileInputs.length > 0) {
        for (var i = 0; i < fileInputs.length; i++) {
          try {
            var input = fileInputs[i];
            var dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            // Succeeded with file input - STOP immediately so we don't attach twice!
            return true;
          } catch (e) {}
        }
      }

      // Method 2: Fallback to paste event ONLY if file input was not found/usable
      var promptEl = findChatInput();
      if (promptEl) {
        try {
          promptEl.focus();
          var pasteDt = new DataTransfer();
          pasteDt.items.add(file);
          var pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: pasteDt
          });
          promptEl.dispatchEvent(pasteEvent);
          return true;
        } catch (e) {}
      }

      return false;
    } catch (e) {
      console.warn('[JobMail:ChatGPT] attachScreenshotOnce error:', e);
      return false;
    }
  }

  // Only send ONE screenshot - debounced against multiple triggers
  window.__JOBMAIL_ATTACH_SCREENSHOT_ONLY = function(base64Image, force) {
    if (!base64Image) return false;

    var now = Date.now();
    // Guard: ignore if attached within last 3 seconds unless forced
    if (!force && (now - window.__JOBMAIL_LAST_ATTACH_TIME__ < 3000)) {
      console.log('[JobMail:ChatGPT] Attach already completed recently, skipping duplicate.');
      return true;
    }

    if (window.__JOBMAIL_IS_ATTACHING__) return false;
    window.__JOBMAIL_IS_ATTACHING__ = true;

    var attempts = 0;
    var maxAttempts = 25;

    function tryAttach() {
      attempts++;
      var success = attachScreenshotOnce(base64Image);

      if (success) {
        window.__JOBMAIL_LAST_ATTACH_TIME__ = Date.now();
        window.__JOBMAIL_IS_ATTACHING__ = false;

        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'CHATGPT_ATTACH_SUCCESS'
            }));
          }
        } catch (e) {}
        return true;
      }

      if (attempts < maxAttempts) {
        setTimeout(tryAttach, 300);
      } else {
        window.__JOBMAIL_IS_ATTACHING__ = false;
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'CHATGPT_ATTACH_RETRY_EXHAUSTED'
            }));
          }
        } catch (e) {}
      }
      return false;
    }

    return tryAttach();
  };
})();
true;
`;
