/**
 * JobMail - ChatGPT Injected Automation Script (v6)
 *
 * Automatically ensures navigation to the FIRST PINNED CHAT (never a new chat)
 * and attaches EXACTLY ONE screenshot.
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
    return (
      document.querySelector('form input[type="file"]') ||
      document.querySelector('input[type="file"][multiple]') ||
      document.querySelector('input[type="file"][tabindex="-1"]') ||
      document.querySelector('input[type="file"]')
    );
  }

  // Helper to find the first pinned conversation link in the sidebar
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

  // Open sidebar if hidden on mobile screen
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

  // Close sidebar if we opened it
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

  // Ensure user is on the FIRST PINNED CHAT (never a new chat)
  function ensureFirstPinnedChat(callback) {
    var currentPath = window.location.pathname;

    openSidebarIfNeeded(function(didOpen) {
      var pinned = findFirstPinnedChat();

      if (pinned && pinned.href) {
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'CHATGPT_FIRST_PINNED_FOUND',
              href: pinned.href,
              title: pinned.title
            }));
          }
        } catch(e) {}

        // Check if we are already in this first pinned chat
        if (currentPath === pinned.href || window.location.href.indexOf(pinned.href) !== -1) {
          if (didOpen) closeSidebar();
          callback();
          return;
        }

        // Click to navigate to the first pinned chat
        try {
          pinned.element.click();
        } catch(err) {
          window.location.href = pinned.href;
        }

        if (didOpen) {
          setTimeout(closeSidebar, 250);
        }

        // Wait until chat switches and input is available
        var checkCount = 0;
        var checkTimer = setInterval(function() {
          checkCount++;
          if (findChatInput() || checkCount > 25) {
            clearInterval(checkTimer);
            callback();
          }
        }, 200);
        return;
      }

      if (didOpen) closeSidebar();

      // If no pinned chat found, check if we are on blank new chat ('/')
      // If so, fall back to first existing chat in history so it's not a new chat
      if (currentPath === '/' || !currentPath.includes('/c/')) {
        var firstChat = document.querySelector('nav a[href*="/c/"]');
        if (firstChat) {
          try { firstChat.click(); } catch(e) {}
          setTimeout(callback, 500);
          return;
        }
      }

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
      // Dispatch ONLY the 'change' event to avoid duplicate attachment
      var fileInput = findAttachmentFileInput();
      if (fileInput) {
        try {
          var dt = new DataTransfer();
          dt.items.add(file);
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
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

  // Main Entry: Ensures First Pinned Chat is open, then attaches exactly ONE screenshot
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

    // STEP 1: Ensure user is on FIRST PINNED CHAT before attaching
    ensureFirstPinnedChat(function() {
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
