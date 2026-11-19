/**
 * JobMail - ChatGPT Injected Automation Script (v7)
 *
 * Capabilities:
 * 1. Automatically ensures navigation to the FIRST PINNED CHAT (never a new chat).
 * 2. Attaches EXACTLY ONE screenshot cleanly (no duplicates, no extra text).
 * 3. Continuously monitors assistant responses for drafted email outputs:
 *    - mail adress : <email>
 *    - subject : <subject>
 *    - mail : <body>
 * 4. Automatically detects when generation is complete and communicates details to React Native
 *    to open Gmail with pre-filled To, Subject, and Body.
 * 5. Injects an in-page "✉️ Open in Gmail" button right below the drafted email inside ChatGPT.
 */

export const CHATGPT_INJECTION_SCRIPT = `
(function() {
  window.__JOBMAIL_CHATGPT_READY__ = true;
  window.__JOBMAIL_ATTACHED_POST_IDS__ = window.__JOBMAIL_ATTACHED_POST_IDS__ || {};
  window.__JOBMAIL_LAST_ATTACH_TIME__ = window.__JOBMAIL_LAST_ATTACH_TIME__ || 0;
  window.__JOBMAIL_IS_ATTACHING__ = false;
  window.__JOBMAIL_DISPATCHED_EMAILS__ = window.__JOBMAIL_DISPATCHED_EMAILS__ || {};
  window.__JOBMAIL_LAST_EMAIL_TEXT__ = window.__JOBMAIL_LAST_EMAIL_TEXT__ || '';
  window.__JOBMAIL_LAST_CHANGE_TIME__ = window.__JOBMAIL_LAST_CHANGE_TIME__ || 0;

  // 1. In-page Styles for Gmail Action Buttons
  function injectStyles() {
    var styleId = 'jobmail-chatgpt-styles-v7';
    if (document.getElementById(styleId)) return;

    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = [
      '.jobmail-gmail-btn {',
      '  display: inline-flex !important;',
      '  align-items: center !important;',
      '  gap: 8px !important;',
      '  margin: 12px 0 6px 0 !important;',
      '  background-color: #ea4335 !important;',
      '  color: #ffffff !important;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;',
      '  font-size: 13px !important;',
      '  font-weight: 700 !important;',
      '  padding: 8px 16px !important;',
      '  border-radius: 8px !important;',
      '  border: 1px solid rgba(255, 255, 255, 0.25) !important;',
      '  cursor: pointer !important;',
      '  box-shadow: 0 3px 10px rgba(234, 67, 53, 0.35) !important;',
      '  transition: transform 0.15s ease, background-color 0.15s ease !important;',
      '  user-select: none !important;',
      '  -webkit-user-select: none !important;',
      '}',
      '.jobmail-gmail-btn:active {',
      '  transform: scale(0.96) !important;',
      '  background-color: #d93025 !important;',
      '}',
      '.jobmail-gmail-icon {',
      '  font-size: 15px !important;',
      '}'
    ].join('\\n');

    (document.head || document.documentElement).appendChild(style);
  }

  injectStyles();

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

  // =========================================================================
  // GMAIL AUTO-DETECTION & EXTRACTION ENGINE
  // =========================================================================

  // Parse structured email details from assistant response
  function parseEmailDetails(text) {
    if (!text) return null;

    // Clean code blocks, bold, and italic markers
    var cleaned = text.replace(/\`\`\`[\\s\\S]*?\`\`\`/g, function(match) {
      return match.replace(/\`\`\`[a-z]*\\n?/gi, '').replace(/\`\`\`/g, '');
    });
    cleaned = cleaned.replace(/\\*\\*/g, '').replace(/__/g, '');

    // 1. Recipient Address: 'mail adress :', 'mail address :', 'email :', 'to :'
    var addrMatch = cleaned.match(/(?:^|\\n)\\s*(?:mail\\s*add?ress|email|to)\\s*:\\s*([^\\r\\n]+)/i);

    // 2. Subject: 'subject :'
    var subjMatch = cleaned.match(/(?:^|\\n)\\s*subject\\s*:\\s*([^\\r\\n]+)/i);

    // 3. Body: 'mail :' (not mail address), 'body :', 'content :'
    var bodyMatch = cleaned.match(/(?:^|\\n)\\s*(?:mail(?!\\s*add?ress)|body|content|message)\\s*:\\s*([\\s\\S]*)$/i);

    if (!addrMatch && !subjMatch && !bodyMatch) return null;

    var address = addrMatch ? addrMatch[1].trim() : '';
    var subject = subjMatch ? subjMatch[1].trim() : '';
    var body = bodyMatch ? bodyMatch[1].trim() : '';

    // Extract pure email address if found within the string
    var emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/;
    var emailInAddr = address.match(emailRegex);
    if (emailInAddr) {
      address = emailInAddr[1];
    }

    if (body) {
      // Clean accidental repeats of header fields
      body = body.replace(/(?:^|\\n)\\s*(?:mail\\s*add?ress|email|to)\\s*:\\s*[^\\r\\n]+/gi, '');
      body = body.replace(/(?:^|\\n)\\s*subject\\s*:\\s*[^\\r\\n]+/gi, '');
      body = body.trim();
    }

    if (!body && !subject) return null;

    return {
      address: address,
      subject: subject,
      body: body
    };
  }

  // Check if ChatGPT is currently streaming or generating tokens
  function isChatGPTGenerating() {
    var stopBtn = document.querySelector(
      'button[data-testid="stop-button"], button[aria-label*="Stop generating" i], button[aria-label*="Stop streaming" i], button[aria-label*="Stop" i], .result-streaming'
    );
    return !!stopBtn;
  }

  // Find the relevant assistant turn containing the email output
  function findAssistantMessageWithEmail() {
    var assistantEls = document.querySelectorAll(
      '[data-message-author-role="assistant"], article[data-testid*="conversation-turn-"], div[data-testid*="conversation-turn-"], .agent-turn'
    );

    if (assistantEls && assistantEls.length > 0) {
      for (var i = assistantEls.length - 1; i >= 0; i--) {
        var el = assistantEls[i];
        var role = el.getAttribute('data-message-author-role');
        if (role === 'user') continue;

        var text = (el.innerText || el.textContent || '').trim();
        if (/mail\\s*add?ress/i.test(text) || (/subject\\s*:/i.test(text) && /mail\\s*:/i.test(text))) {
          return { element: el, text: text };
        }
      }
    }

    // Markdown containers fallback
    var markdownEls = document.querySelectorAll('.markdown, div[class*="markdown"], div.prose');
    if (markdownEls && markdownEls.length > 0) {
      for (var j = markdownEls.length - 1; j >= 0; j--) {
        var mdEl = markdownEls[j];
        var mdText = (mdEl.innerText || mdEl.textContent || '').trim();
        if (/mail\\s*add?ress/i.test(mdText) || (/subject\\s*:/i.test(mdText) && /mail\\s*:/i.test(mdText))) {
          return { element: mdEl, text: mdText };
        }
      }
    }

    // Full document body fallback
    var bodyText = document.body ? (document.body.innerText || '') : '';
    if (/mail\\s*add?ress/i.test(bodyText) && /subject\\s*:/i.test(bodyText)) {
      return { element: document.body, text: bodyText };
    }

    return null;
  }

  // Injects an in-page "Open in Gmail" button inside the assistant message
  function injectInPageGmailButton(targetEl, emailData) {
    if (!targetEl || targetEl === document.body) return;

    var existingBtn = targetEl.querySelector('.jobmail-gmail-btn');
    if (existingBtn) {
      existingBtn.__jobmailEmailData = emailData;
      return;
    }

    var btn = document.createElement('button');
    btn.className = 'jobmail-gmail-btn';
    btn.__jobmailEmailData = emailData;
    btn.innerHTML = '<span class="jobmail-gmail-icon">✉️</span> Open in Gmail & Send';

    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var data = btn.__jobmailEmailData || emailData;
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'CHATGPT_OPEN_GMAIL',
            data: data
          }));
        }
      } catch (err) {}
    });

    // Append button cleanly at the bottom of the message
    targetEl.appendChild(btn);
  }

  // Scan and detect drafted emails from ChatGPT responses
  function scanForDraftedEmail(force) {
    var match = findAssistantMessageWithEmail();
    if (!match) return;

    var text = match.text;
    var targetEl = match.element;

    // Check if text is currently changing
    if (text !== window.__JOBMAIL_LAST_EMAIL_TEXT__) {
      window.__JOBMAIL_LAST_EMAIL_TEXT__ = text;
      window.__JOBMAIL_LAST_CHANGE_TIME__ = Date.now();
      return;
    }

    // Do not trigger while ChatGPT is still actively generating tokens
    var generating = isChatGPTGenerating();
    if (generating && !force) {
      return;
    }

    // Ensure content has stabilized for at least 800ms
    var quietDuration = Date.now() - window.__JOBMAIL_LAST_CHANGE_TIME__;
    if (quietDuration < 800 && !force) {
      return;
    }

    var parsed = parseEmailDetails(text);
    if (!parsed) return;

    // In-page button is always updated/injected
    injectInPageGmailButton(targetEl, parsed);

    // Unique key to prevent repeatedly auto-launching the same drafted email
    var emailKey = (parsed.address || '') + '||' + (parsed.subject || '') + '||' + (parsed.body || '').substring(0, 40);

    if (!window.__JOBMAIL_DISPATCHED_EMAILS__[emailKey] || force) {
      window.__JOBMAIL_DISPATCHED_EMAILS__[emailKey] = true;

      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'CHATGPT_EMAIL_DETECTED',
            data: {
              address: parsed.address,
              subject: parsed.subject,
              body: parsed.body,
              timestamp: Date.now()
            }
          }));
        }
      } catch (postErr) {}
    }
  }

  window.__JOBMAIL_DETECT_EMAIL = function(force) {
    scanForDraftedEmail(force || true);
  };

  // Continuous monitoring using MutationObserver
  var scanDebounceTimer = null;
  var observer = new MutationObserver(function() {
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(function() {
      scanForDraftedEmail(false);
    }, 400);
  });

  var observeTarget = document.body || document.documentElement;
  if (observeTarget) {
    observer.observe(observeTarget, { childList: true, subtree: true, characterData: true });
  }

  // Backup interval to handle streaming and completion
  setInterval(function() {
    scanForDraftedEmail(false);
  }, 1000);

  // On page load, navigate to first pinned chat if on new chat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      injectStyles();
      setTimeout(function() { ensureFirstPinnedChat(function() {}); }, 1200);
    });
  } else {
    setTimeout(function() { ensureFirstPinnedChat(function() {}); }, 1200);
  }
})();
true;
`;
