/**
 * JobMail - ChatGPT Injected Automation Script
 *
 * Capabilities:
 * 1. Automatically navigates to the first pinned conversation (if on new chat).
 * 2. Directly attaches captured screenshots into ChatGPT's web composer (up to 3 screenshots).
 * 3. Uses DataTransfer on file input and composer paste events.
 * 4. Communicates status via postMessage (CHATGPT_ATTACH_SUCCESS).
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

  // Find the first pinned conversation link in the sidebar
  function findFirstPinnedChat() {
    var nav = document.querySelector('nav');
    if (!nav) return null;

    // 1. Search for headings or elements containing "Pinned"
    var elements = nav.querySelectorAll('h3, h2, div, span, p');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (el.children.length <= 1) {
        var txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (txt === 'pinned' || txt === 'pin' || txt === 'pinned chats') {
          var parent = el.parentElement;
          while (parent && parent !== nav) {
            var links = parent.querySelectorAll('a[href*="/c/"]');
            if (links && links.length > 0) {
              return {
                element: links[0],
                href: links[0].getAttribute('href'),
                title: (links[0].innerText || links[0].textContent || '').trim()
              };
            }
            if (parent.nextElementSibling) {
              var sibLinks = parent.nextElementSibling.querySelectorAll('a[href*="/c/"]');
              if (sibLinks && sibLinks.length > 0) {
                return {
                  element: sibLinks[0],
                  href: sibLinks[0].getAttribute('href'),
                  title: (sibLinks[0].innerText || sibLinks[0].textContent || '').trim()
                };
              }
            }
            parent = parent.parentElement;
          }
        }
      }
    }

    // 2. Search for pin icon SVG indicators inside chat list items
    var pinSvgs = nav.querySelectorAll('svg[class*="pin"], [aria-label*="pin" i], [title*="pin" i]');
    for (var p = 0; p < pinSvgs.length; p++) {
      var itemLink = pinSvgs[p].closest('a[href*="/c/"]');
      if (itemLink) {
        return {
          element: itemLink,
          href: itemLink.getAttribute('href'),
          title: (itemLink.innerText || itemLink.textContent || '').trim()
        };
      }
    }

    // 3. Search for data attributes containing pinned
    var directPinned = nav.querySelector('[data-testid*="pinned"] a[href*="/c/"], [class*="pinned"] a[href*="/c/"]');
    if (directPinned) {
      return {
        element: directPinned,
        href: directPinned.getAttribute('href'),
        title: (directPinned.innerText || directPinned.textContent || '').trim()
      };
    }

    return null;
  }

  // Open sidebar if hidden on mobile
  function openSidebarIfNeeded(done) {
    var nav = document.querySelector('nav');
    if (nav && nav.offsetWidth > 60 && nav.offsetHeight > 100) {
      done(false);
      return;
    }

    var openBtn = (
      document.querySelector('button[aria-label*="Open sidebar" i]') ||
      document.querySelector('button[data-testid*="open-sidebar"]') ||
      document.querySelector('button[aria-label*="Sidebar" i]') ||
      document.querySelector('header button:first-child')
    );

    if (openBtn) {
      try {
        openBtn.click();
        setTimeout(function() { done(true); }, 350);
        return;
      } catch(e) {}
    }

    done(false);
  }

  function closeSidebar() {
    var closeBtn = (
      document.querySelector('button[aria-label*="Close sidebar" i]') ||
      document.querySelector('button[data-testid*="close-sidebar"]') ||
      document.querySelector('div[class*="backdrop"]')
    );
    if (closeBtn) {
      try { closeBtn.click(); } catch(e) {}
    }
  }

  // Ensure user is in the first pinned chat if on new chat
  function ensureFirstPinnedChat(callback) {
    var currentPath = window.location.pathname;

    openSidebarIfNeeded(function(didOpen) {
      var pinned = findFirstPinnedChat();

      if (pinned && pinned.href) {
        // If already on this pinned chat
        if (currentPath === pinned.href || window.location.href.indexOf(pinned.href) !== -1) {
          if (didOpen) closeSidebar();
          callback();
          return;
        }

        // Click to navigate to pinned chat
        try {
          pinned.element.click();
          if (didOpen) closeSidebar();
          setTimeout(callback, 500);
          return;
        } catch(e) {
          if (didOpen) closeSidebar();
          setTimeout(callback, 500);
          return;
        }
      }

      if (didOpen) closeSidebar();
      callback();
    });
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
      return new File([blob], filename || 'screenshot.png', { type: 'image/png' });
    } catch (e) {
      console.warn('[JobMail:ChatGPT] base64ToFile error:', e);
      return null;
    }
  }

  // Attach screenshots directly to ChatGPT web composer
  function attachScreenshots(base64List) {
    if (!base64List || !base64List.length) return false;
    try {
      var files = [];
      for (var i = 0; i < base64List.length; i++) {
        var file = base64ToFile(base64List[i], 'screenshot_' + (i + 1) + '.png');
        if (file) files.push(file);
      }
      if (!files.length) return false;

      // Method 1: File Input assignment (standard ChatGPT attachment)
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

      // Method 2: Clipboard paste event on composer
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

      // Method 3: Click attach (+) button to mount file input if not mounted yet
      var attachBtn = (
        document.querySelector('button[aria-label*="attach" i]') ||
        document.querySelector('button[aria-label*="upload" i]') ||
        document.querySelector('button[data-testid*="attach"]') ||
        document.querySelector('button[aria-label*="Add files" i]') ||
        document.querySelector('button[aria-label*="Add content" i]')
      );
      if (attachBtn) {
        try {
          attachBtn.click();
        } catch (_e) {}
      }

      return false;
    } catch (e) {
      console.warn('[JobMail:ChatGPT] attachScreenshots error:', e);
      return false;
    }
  }

  // Main entry: Attaches screenshots directly into ChatGPT composer
  window.__JOBMAIL_ATTACH_SCREENSHOTS = function(base64List) {
    if (!base64List || !base64List.length) return false;

    ensureFirstPinnedChat(function() {
      var attempts = 0;
      var maxAttempts = 25;

      function tryAttach() {
        attempts++;
        var success = attachScreenshots(base64List);

        if (success) {
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

      tryAttach();
    });

    return true;
  };

  // On page load, navigate to first pinned chat if on new chat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() { ensureFirstPinnedChat(function() {}); }, 1200);
    });
  } else {
    setTimeout(function() { ensureFirstPinnedChat(function() {}); }, 1200);
  }
})();
true;
`;
