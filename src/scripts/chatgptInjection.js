/**
 * JobMail - ChatGPT Injected Automation Script
 *
 * Capabilities:
 * 1. Attaches captured screenshots directly to the message composer of the CURRENTLY ACTIVE chat.
 * 2. Never opens the sidebar, chat history, or navigation drawers.
 * 3. Never switches or navigates conversations.
 * 4. Preserves all existing messages and conversation state.
 * 5. Communicates status via postMessage (CHATGPT_ATTACH_SUCCESS).
 */

export const CHATGPT_INJECTION_SCRIPT = `
(function() {
  window.__JOBMAIL_CHATGPT_READY__ = true;
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

  function findAttachmentFileInput() {
    return (
      document.querySelector('form input[type="file"]') ||
      document.querySelector('input[type="file"][multiple]') ||
      document.querySelector('input[type="file"][tabindex="-1"]') ||
      document.querySelector('input[type="file"][accept*="image"]') ||
      document.querySelector('input[type="file"]')
    );
  }

  // If sidebar / chat list happens to be open, close it to keep active chat visible
  function closeSidebarIfOpen() {
    try {
      var closeBtn = (
        document.querySelector('button[aria-label*="Close sidebar" i]') ||
        document.querySelector('button[data-testid*="close-sidebar"]') ||
        document.querySelector('div[class*="backdrop"]')
      );
      if (closeBtn) {
        closeBtn.click();
      }
    } catch (_e) {}
  }

  // Convert base64 data to an image File object
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
      return new File([blob], filename || 'screenshot.png', { type: 'image/png' });
    } catch (e) {
      console.warn('[JobMail:ChatGPT] base64ToFile error:', e);
      return null;
    }
  }

  // Attach screenshots directly to the currently active chat's composer
  function attachScreenshots(base64List) {
    if (!base64List || !base64List.length) return false;
    try {
      var files = [];
      for (var i = 0; i < base64List.length; i++) {
        var file = base64ToFile(base64List[i], 'screenshot_' + (i + 1) + '.png');
        if (file) files.push(file);
      }
      if (!files.length) return false;

      // Method 1: Direct File Input assignment
      var fileInput = findAttachmentFileInput();
      if (fileInput) {
        try {
          var dt = new DataTransfer();
          for (var j = 0; j < files.length; j++) {
            dt.items.add(files[j]);
          }
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        } catch (fileErr) {
          console.warn('[JobMail:ChatGPT] FileInput error:', fileErr);
        }
      }

      // Method 2: Synthetic Clipboard paste event on the current chat composer
      var promptEl = findChatInput();
      if (promptEl) {
        try {
          promptEl.focus();
          var pasteDt = new DataTransfer();
          for (var k = 0; k < files.length; k++) {
            pasteDt.items.add(files[k]);
          }
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

      // Method 3: Drag & Drop Event on the active conversation form / composer
      var dropTarget = document.querySelector('form') || promptEl || document.querySelector('#prompt-textarea');
      if (dropTarget) {
        try {
          var dropDt = new DataTransfer();
          for (var d = 0; d < files.length; d++) {
            dropDt.items.add(files[d]);
          }
          dropTarget.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dropDt }));
          dropTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dropDt }));
          dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dropDt }));
          return true;
        } catch (dropErr) {
          console.warn('[JobMail:ChatGPT] DragEvent error:', dropErr);
        }
      }

      return false;
    } catch (e) {
      console.warn('[JobMail:ChatGPT] attachScreenshots error:', e);
      return false;
    }
  }

  // Main entry: Attaches screenshots directly into current ChatGPT conversation
  window.__JOBMAIL_ATTACH_SCREENSHOTS = function(base64List) {
    if (!base64List || !base64List.length) return false;

    // Never open sidebar or change conversation. Ensure sidebar is closed if open.
    closeSidebarIfOpen();

    var attempts = 0;
    var maxAttempts = 25;

    function tryAttach() {
      attempts++;
      var success = attachScreenshots(base64List);

      if (success) {
        closeSidebarIfOpen();
        var promptEl = findChatInput();
        if (promptEl) {
          try {
            promptEl.focus();
          } catch (_f) {}
        }
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'CHATGPT_ATTACH_SUCCESS',
              count: base64List.length
            }));
          }
        } catch (e) {}
        return true;
      }

      if (attempts < maxAttempts) {
        setTimeout(tryAttach, 250);
      } else {
        closeSidebarIfOpen();
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

    tryAttach();
    return true;
  };
})();
true;
`;
