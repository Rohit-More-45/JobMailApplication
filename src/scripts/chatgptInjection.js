/**
 * JobMail - ChatGPT Injected Automation Script (v3)
 *
 * Automatically attaches ONLY the captured screenshot into ChatGPT chat.
 * No extra text content is pasted.
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

  // Attach screenshot to ChatGPT (via File Input and Clipboard Paste event)
  function attachScreenshot(base64Image) {
    if (!base64Image) return false;
    try {
      var file = base64ToFile(base64Image, 'post-screenshot.png');
      if (!file) return false;

      var attached = false;

      // 1. Try ChatGPT file input element
      var fileInputs = document.querySelectorAll('input[type="file"]');
      for (var i = 0; i < fileInputs.length; i++) {
        try {
          var input = fileInputs[i];
          var dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          attached = true;
          break;
        } catch (e) {}
      }

      // 2. Try dispatching paste event on chat prompt input with file in clipboardData
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
          attached = true;
        } catch (e) {}
      }

      return attached;
    } catch (e) {
      console.warn('[JobMail:ChatGPT] attachScreenshot error:', e);
      return false;
    }
  }

  // Only send screenshot - no extra text
  window.__JOBMAIL_ATTACH_SCREENSHOT_ONLY = function(base64Image) {
    if (!base64Image) return false;

    var attempts = 0;
    var maxAttempts = 25;

    function tryAttach() {
      attempts++;
      var success = attachScreenshot(base64Image);

      if (success) {
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
