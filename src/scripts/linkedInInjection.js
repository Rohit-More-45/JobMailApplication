/**
 * JobMail - LinkedIn Feed Post Detection & Selection Script
 *
 * Capabilities:
 * 1. Post detection & continuous observation via MutationObserver.
 * 2. Visual radio button support with tap interception and single selection.
 * 3. Highlights the currently selected post.
 * 4. Communicates selection state to React Native via window.ReactNativeWebView.postMessage.
 * 5. Normal mobile LinkedIn browsing experience with zero artificial zooming.
 */

export const LINKEDIN_INJECTION_SCRIPT = `
(function() {
  window.__JOBMAIL_STATE__ = window.__JOBMAIL_STATE__ || {
    selectedPostId: null,
    postCounter: 0,
    scanDebounceTimer: null,
    observer: null,
    isInitialized: false,
    lastScannedCount: 0
  };

  var state = window.__JOBMAIL_STATE__;

  // 1. Logging Helper
  function sendLog(type, details) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'DEBUG_LOG',
          subType: type,
          details: details,
          timestamp: Date.now()
        }));
      }
    } catch (e) {}
    try {
      console.log('[JobMail:' + type + ']', typeof details === 'object' ? JSON.stringify(details) : details);
    } catch (e) {}
  }

  // 2. CSS Styles Injection for Radio Buttons & Selection Highlight
  function injectStyles() {
    var styleId = 'jobmail-injected-styles-v6';
    var existingStyle = document.getElementById(styleId);
    if (existingStyle) return;

    var styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = \`
      /* Subtle Highlight for Selected Post */
      .jobmail-post-highlight {
        outline: 2.5px solid #0a66c2 !important;
        outline-offset: -2px !important;
        background-color: rgba(10, 102, 194, 0.035) !important;
        box-shadow: 0 4px 16px rgba(10, 102, 194, 0.18) !important;
        transition: outline 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease !important;
      }

      /* Radio Button Container */
      .jobmail-radio-container {
        position: absolute !important;
        top: 10px !important;
        right: 48px !important;
        z-index: 99999 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 36px !important;
        height: 36px !important;
        cursor: pointer !important;
        -webkit-tap-highlight-color: transparent !important;
        user-select: none !important;
        touch-action: manipulation !important;
      }

      /* Circular Radio Button */
      .jobmail-radio-button {
        width: 24px !important;
        height: 24px !important;
        border-radius: 50% !important;
        border: 2.5px solid #0a66c2 !important;
        background-color: #ffffff !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22) !important;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        box-sizing: border-box !important;
      }

      .jobmail-radio-button:active {
        transform: scale(0.92) !important;
      }

      /* Inner Dot */
      .jobmail-radio-inner {
        width: 12px !important;
        height: 12px !important;
        border-radius: 50% !important;
        background-color: transparent !important;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        box-sizing: border-box !important;
      }

      /* Active Selected State */
      .jobmail-radio-button.active {
        border-color: #0a66c2 !important;
        background-color: #ffffff !important;
        box-shadow: 0 0 0 3px rgba(10, 102, 194, 0.3), 0 2px 8px rgba(0, 0, 0, 0.25) !important;
      }

      .jobmail-radio-button.active .jobmail-radio-inner {
        background-color: #0a66c2 !important;
      }
    \`;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  // 3. Post ID Extraction
  function getPostId(el) {
    if (!el) return 'jobmail_post_' + (++state.postCounter);
    if (el.dataset && el.dataset.jobmailPostId) {
      return el.dataset.jobmailPostId;
    }

    var directUrn = el.getAttribute('data-urn') ||
                    el.getAttribute('data-activity-urn') ||
                    el.getAttribute('data-entity-urn') ||
                    el.getAttribute('data-id') ||
                    el.getAttribute('data-activity-id');
    if (directUrn && directUrn.length > 5) {
      el.dataset.jobmailPostId = directUrn;
      return directUrn;
    }

    var urnLink = el.querySelector('a[href*="urn:li:activity:"], a[href*="/feed/update/urn:li:activity:"]');
    if (urnLink && urnLink.href) {
      var match = urnLink.href.match(/urn:li:activity:\\d+/);
      if (match) {
        el.dataset.jobmailPostId = match[0];
        return match[0];
      }
    }

    state.postCounter++;
    var fallbackId = 'jobmail_post_' + state.postCounter;
    if (el.dataset) el.dataset.jobmailPostId = fallbackId;
    return fallbackId;
  }

  // 4. Find Post Card From Any Node
  function findPostCardFromNode(node) {
    if (!node || node === document.body || node === document.documentElement) return null;

    var curr = node;
    var candidate = null;

    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.classList && (curr.classList.contains('jobmail-radio-container') || curr.id === 'jobmail-injected-styles-v6')) {
        return null;
      }

      var vName = curr.getAttribute('data-view-name') || '';
      var cName = (curr.className || '').toString();
      var dUrn = curr.getAttribute('data-urn') || curr.getAttribute('data-id') || '';

      if (
        vName === 'feed-full-update' ||
        cName.indexOf('feed-shared-update') !== -1 ||
        dUrn.indexOf('urn:li:activity') !== -1 ||
        curr.tagName.toLowerCase() === 'article'
      ) {
        return curr;
      }

      var parent = curr.parentElement;
      if (parent) {
        var actorsInParent = parent.querySelectorAll(
          '.update-components-actor, [class*="update-components-actor"], [class*="actor__name"], [class*="actor__title"], .feed-shared-actor'
        );
        if (actorsInParent.length > 1) {
          return curr;
        }
      }

      var rect = curr.getBoundingClientRect();
      if (rect.height > 120) {
        var text = (curr.innerText || '').trim();
        var hasActor = curr.querySelector('[class*="actor"], [class*="author"], a[href*="/in/"]') !== null;
        var hasButtons = curr.querySelector('button') !== null;

        if (hasActor && hasButtons && text.length > 35) {
          candidate = curr;
        }
      }

      curr = curr.parentElement;
    }

    return candidate;
  }

  // 5. Find Feed Posts for Radio Buttons
  function findFeedPosts() {
    var postsSet = [];

    function addIfValid(el) {
      if (el && postsSet.indexOf(el) === -1) {
        postsSet.push(el);
      }
    }

    var directSelectors = [
      '[data-view-name="feed-full-update"]',
      'div.feed-shared-update-v2',
      'div[class*="feed-shared-update"]',
      'div[data-urn*="urn:li:activity"]',
      'div[data-urn*="urn:li:ugcPost"]',
      'div[data-id*="urn:li:activity"]',
      'article[data-activity-id]',
      'article'
    ];

    directSelectors.forEach(function(sel) {
      try {
        var elements = document.querySelectorAll(sel);
        for (var i = 0; i < elements.length; i++) {
          if (elements[i].offsetHeight > 100) {
            addIfValid(elements[i]);
          }
        }
      } catch (e) {}
    });

    var actors = document.querySelectorAll(
      '.update-components-actor, [class*="update-components-actor"], .feed-shared-actor, [class*="actor__container"], [class*="actor__title"]'
    );
    for (var a = 0; a < actors.length; a++) {
      var card = findPostCardFromNode(actors[a]);
      if (card) addIfValid(card);
    }

    return postsSet;
  }

  // 6. Radio Button Injection & Setup
  function injectRadioButton(post) {
    var postId = getPostId(post);
    if (!post.classList) return false;
    post.classList.add('jobmail-post-container');

    var computedPos = window.getComputedStyle(post).position;
    if (computedPos === 'static') {
      post.style.position = 'relative';
    }

    for (var i = 0; i < post.children.length; i++) {
      if (post.children[i].classList && post.children[i].classList.contains('jobmail-radio-container')) {
        return false;
      }
    }

    var container = document.createElement('div');
    container.className = 'jobmail-radio-container';
    container.setAttribute('data-post-id', postId);

    var menuBtn = post.querySelector(
      'button[aria-label*="option" i], button[aria-label*="more" i], button[aria-label*="Control" i], .feed-shared-control-menu, button[aria-label*="Dismiss" i]'
    );
    container.style.right = menuBtn ? '48px' : '12px';

    var radioBtn = document.createElement('div');
    radioBtn.className = 'jobmail-radio-button';
    radioBtn.setAttribute('role', 'radio');

    var innerDot = document.createElement('div');
    innerDot.className = 'jobmail-radio-inner';
    radioBtn.appendChild(innerDot);
    container.appendChild(radioBtn);

    container.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (state.selectedPostId === postId) {
        state.selectedPostId = null;
      } else {
        state.selectedPostId = postId;
      }
      var allContainers = document.querySelectorAll('.jobmail-radio-container');
      allContainers.forEach(function(c) {
        var pid = c.getAttribute('data-post-id');
        var isSel = (pid === state.selectedPostId && state.selectedPostId !== null);
        var rBtn = c.querySelector('.jobmail-radio-button');
        if (rBtn) {
          if (isSel) rBtn.classList.add('active'); else rBtn.classList.remove('active');
        }
        if (c.parentElement) {
          if (isSel) c.parentElement.classList.add('jobmail-post-highlight'); else c.parentElement.classList.remove('jobmail-post-highlight');
        }
      });
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SELECTION_CHANGED',
          postId: state.selectedPostId,
          isSelected: state.selectedPostId !== null,
          timestamp: Date.now()
        }));
      }
    }, true);

    post.appendChild(container);
    return true;
  }

  function scanAndInjectPosts(reason) {
    injectStyles();
    var posts = findFeedPosts();
    posts.forEach(function(post) {
      injectRadioButton(post);
    });
    if (posts.length !== state.lastScannedCount) {
      state.lastScannedCount = posts.length;
      sendLog('POSTS_SCANNED', {
        reason: reason || 'scan',
        postsDetected: posts.length,
        url: window.location.href
      });
    }
  }

  window.__JOBMAIL_TRIGGER_SCAN = function(reason) {
    scanAndInjectPosts(reason);
  };

  window.__jobmailDeselectAll = function() {
    state.selectedPostId = null;
    var allContainers = document.querySelectorAll('.jobmail-radio-container');
    allContainers.forEach(function(c) {
      var rBtn = c.querySelector('.jobmail-radio-button');
      if (rBtn) rBtn.classList.remove('active');
      if (c.parentElement) c.parentElement.classList.remove('jobmail-post-highlight');
    });
  };

  function setupEngine() {
    injectStyles();
    scanAndInjectPosts('setup');

    var targetNode = document.body || document.documentElement;
    if (!targetNode) {
      setTimeout(setupEngine, 150);
      return;
    }

    if (!state.observer) {
      state.observer = new MutationObserver(function() {
        if (state.scanDebounceTimer) clearTimeout(state.scanDebounceTimer);
        state.scanDebounceTimer = setTimeout(function() {
          scanAndInjectPosts('mutation');
        }, 100);
      });
      state.observer.observe(targetNode, { childList: true, subtree: true });
    }

    if (!state.intervalSet) {
      state.intervalSet = true;
      setInterval(function() { scanAndInjectPosts('interval'); }, 1200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEngine);
  } else {
    setupEngine();
  }
})();
true;
`;
