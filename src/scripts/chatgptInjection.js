/**
 * JobMail - ChatGPT Injected Automation Script (v5)
 *
 * Automatically attaches EXACTLY ONE screenshot into ChatGPT chat.
 * Prevents duplicate attachments across events, listeners, and re-renders.
 * No extra text content is inserted.
 */

export const CHATGPT_INJECTION_SCRIPT = `
(function() {
  window.__JOBMAIL_CHATGPT_READY__ = true;
  window.__JOBMAIL_ATTACHED_POST_IDS__ = window.__JOBMAIL_ATTACHED_POST_IDS__ || {};
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

  // Find the file input dedicated to ChatGPT chat attachments
  function findAttachmentFileInput() {
    // Look for file input within or near chat form/footer first
    return (
      document.querySelector('form input[type="file"]') ||
      document.querySelector('input[type="file"][multiple]') ||
      document.querySelector('input[type="file"][tabindex="-1"]') ||
      document.querySelector('input[type="file"]')
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

  // Attach screenshot to ChatGPT - strictly ONE single channel used
  function attachSingleScreenshot(base64Image) {
    if (!base64Image) return false;
    try {
      var file = base64ToFile(base64Image, 'post-screenshot.png');
      if (!file) return false;

      // Method 1: File Input assignment
      // IMPORTANT: ONLY dispatch the 'change' event.
      // Dispatching both 'input' and 'change' causes React synthetic event handlers
      // to trigger twice, attaching duplicate files!
      var fileInput = findAttachmentFileInput();
      if (fileInput) {
        try {
          var dt = new DataTransfer();
          dt.items.add(file);
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          // File input succeeded. Return immediately - DO NOT dispatch paste event!
          return true;
        } catch (fileErr) {
          console.warn('[JobMail:ChatGPT] FileInput assignment error:', fileErr);
        }
      }

      // Method 2: Fallback to clipboard paste event ONLY if file input was not found or failed
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
        } catch (pasteErr) {
          console.warn('[JobMail:ChatGPT] ClipboardEvent paste error:', pasteErr);
        }
      }

      return false;
    } catch (e) {
      console.warn('[JobMail:ChatGPT] attachSingleScreenshot error:', e);
      return false;
    }
  }

  // Attach exactly ONE screenshot, guarded by unique postId and timestamp
  window.__JOBMAIL_ATTACH_SCREENSHOT_ONLY = function(base64Image, postId, force) {
    if (!base64Image) return false;

    var key = postId || 'default_post';
    var now = Date.now();

    // Prevent duplicate attachment of the same post screenshot
    if (!force) {
      if (window.__JOBMAIL_ATTACHED_POST_IDS__[key]) {
        console.log('[JobMail:ChatGPT] Screenshot for ' + key + ' already attached. Skipping duplicate.');
        return true;
      }
      if (now - window.__JOBMAIL_LAST_ATTACH_TIME__ < 3500) {
        console.log('[JobMail:ChatGPT] Attach cooldown active. Skipping duplicate.');
        return true;
      }
    }

    if (window.__JOBMAIL_IS_ATTACHING__) return false;
    window.__JOBMAIL_IS_ATTACHING__ = true;

    var attempts = 0;
    var maxAttempts = 25;

    function tryAttach() {
      attempts++;
      var success = attachSingleScreenshot(base64Image);

      if (success) {
        window.__JOBMAIL_ATTACHED_POST_IDS__[key] = true;
        window.__JOBMAIL_LAST_ATTACH_TIME__ = Date.now();
        window.__JOBMAIL_IS_ATTACHING__ = false;

        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'CHATGPT_ATTACH_SUCCESS',
              postId: key
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
              type: 'CHATGPT_ATTACH_RETRY_EXHAUSTED',
              postId: key
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
