/**
 * JobMail - LinkedIn Feed Post Detection & Radio Button Injection Script (v2)
 *
 * Designed to reliably:
 * 1. Execute inside LinkedIn WebView across page loads, redirects, and SPA client-side navigations.
 * 2. Multi-tier post detection:
 *    - Direct structural card selectors (feed-full-update, feed-shared-update-v2, data-urn, data-id)
 *    - Feed stream children (scaffold-finite-scroll__content > div)
 *    - Anchor-up traversal from author headers (update-components-actor) and social action bars
 * 3. Deduplicate posts and prevent duplicate radio buttons.
 * 4. Inject a custom circular radio button in the top-right corner of each post:
 *    - White background (#ffffff)
 *    - Blue border (2.5px solid #0a66c2)
 *    - Blue filled inner circle (#0a66c2) when selected
 * 5. Single-post selection + toggle-to-deselect.
 * 6. Subtle visual highlight on the selected post.
 * 7. Real-time debug logging via window.ReactNativeWebView.postMessage.
 */

export const LINKEDIN_INJECTION_SCRIPT = `
(function() {
  // Global state across multiple evaluations
  window.__JOBMAIL_STATE__ = window.__JOBMAIL_STATE__ || {
    selectedPostId: null,
    postCounter: 0,
    scanDebounceTimer: null,
    observer: null,
    isInitialized: false,
    lastScannedCount: 0
  };

  var state = window.__JOBMAIL_STATE__;

  // 1. Logging Helper (sends structured messages to React Native)
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

  // 2. Inject CSS Styles
  function injectStyles() {
    var styleId = 'jobmail-injected-styles-v2';
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

      /* Circular Radio Button: White background with blue border */
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

      /* Inner Dot: Transparent unselected, Blue filled circle when selected */
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
    if (el.dataset.jobmailPostId) {
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

    var childWithUrn = el.querySelector('[data-urn*="urn:li:activity:"], [data-id*="urn:li:activity:"]');
    if (childWithUrn) {
      var cUrn = childWithUrn.getAttribute('data-urn') || childWithUrn.getAttribute('data-id');
      if (cUrn) {
        el.dataset.jobmailPostId = cUrn;
        return cUrn;
      }
    }

    state.postCounter++;
    var fallbackId = 'jobmail_post_' + state.postCounter;
    el.dataset.jobmailPostId = fallbackId;
    return fallbackId;
  }

  // 4. Validate a candidate feed post.
  // LinkedIn changes its internal markup frequently. Treat its explicit
  // feed-card markers as authoritative; use content markers only as fallback.
  function isValidPostElement(el) {
    if (!el || el.nodeType !== 1) return false;

    var className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    var id = (el.id || '').toLowerCase();
    var viewName = (el.getAttribute('data-view-name') || '').toLowerCase();

    // Never attach controls to comments, the composer, or page-level wrappers.
    if (
      viewName === 'comment' ||
      id.indexOf('comment') !== -1 ||
      className.indexOf('comment-item') !== -1 ||
      className.indexOf('share-box') !== -1 ||
      viewName === 'feed-share-box' ||
      id.indexOf('share-box') !== -1 ||
      el.tagName.toLowerCase() === 'main' ||
      el.tagName.toLowerCase() === 'body' ||
      className.indexOf('scaffold-finite-scroll__content') !== -1 ||
      className.indexOf('feed-container') !== -1
    ) return false;

    // Strong markers used by several LinkedIn feed layouts.
    var strongCandidate =
      viewName === 'feed-full-update' ||
      el.classList.contains('feed-shared-update-v2') ||
      el.matches('article.feed-shared-update, article[data-activity-id]') ||
      (el.matches('[data-urn], [data-activity-urn], [data-entity-urn], [data-chameleon-result-urn]') &&
        /urn:li:(activity|ugcPost|share)/i.test(
          (el.getAttribute('data-urn') || '') + ' ' +
          (el.getAttribute('data-activity-urn') || '') + ' ' +
          (el.getAttribute('data-entity-urn') || '') + ' ' +
          (el.getAttribute('data-chameleon-result-urn') || '')
        ));

    if (strongCandidate) return true;

    // Fallback for feed variants that do not expose the older class names.
    return !!el.querySelector(
      '.update-components-actor, [class*="update-components-actor"], ' +
      '.feed-shared-actor, [class*="feed-shared-actor"], ' +
      '[data-view-name="feed-social-actions"], ' +
      '.feed-shared-social-action-bar, [class*="social-actions"]'
    );
  }

  // 5. Resolve a child element to its containing feed card.
  // Prefer the direct item inside LinkedIn's finite-scroll feed; this works
  // even when LinkedIn renames its internal actor/header classes.
  function climbToPostCard(startEl) {
    if (!startEl || !startEl.closest) return null;

    var feedRoot = startEl.closest(
      '.scaffold-finite-scroll__content, [data-view-name="scaffold-finite-scroll__content"]'
    );
    if (feedRoot) {
      var item = startEl;
      while (item.parentElement && item.parentElement !== feedRoot) {
        item = item.parentElement;
      }
      if (item.parentElement === feedRoot && isValidPostElement(item)) {
        return item;
      }
    }

    var curr = startEl;
    var candidate = null;
    var depth = 0;
    while (curr && curr !== document.body && curr !== document.documentElement && depth < 12) {
      var cName = (typeof curr.className === 'string' ? curr.className : '').toLowerCase();
      if (cName.indexOf('share-box') !== -1 || cName.indexOf('comment-item') !== -1) {
        return null;
      }

      if (
        curr.getAttribute('data-view-name') === 'feed-full-update' ||
        curr.classList.contains('feed-shared-update-v2') ||
        curr.matches('article[data-activity-id], article') ||
        /urn:li:(activity|ugcPost|share)/i.test(
          (curr.getAttribute('data-urn') || '') + ' ' +
          (curr.getAttribute('data-activity-urn') || '') + ' ' +
          (curr.getAttribute('data-entity-urn') || '')
        )
      ) {
        candidate = curr;
      }
      curr = curr.parentElement;
      depth++;
    }
    return candidate;
  }

  // 5b. Class-name-independent detection.
  // LinkedIn (esp. the mobile site) uses hashed/changing class names, so we
  // find each post's action bar (Like / Comment / Repost / Send buttons) by its
  // label, then climb until the next level up would contain a different post.
  var ACTION_RE = /^(react\\s+)?(like|comment|repost|send|share)\\b/i;

  function actionButtonsIn(root) {
    var out = [];
    var nodes = root.querySelectorAll('button, [role="button"], a[role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var label = (n.getAttribute('aria-label') || n.innerText || n.textContent || '').trim();
      if (label.length > 0 && label.length < 40 && ACTION_RE.test(label)) out.push(n);
    }
    return out;
  }

  function countLikeButtons(root) {
    var c = 0;
    var nodes = root.querySelectorAll('button, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var label = (nodes[i].getAttribute('aria-label') || nodes[i].innerText || '').trim();
      if (label.length < 40 && /^(react\\s+)?like\\b/i.test(label)) c++;
    }
    return c;
  }

  function findPostsByActionBar() {
    var found = [];
    var buttons = actionButtonsIn(document);
    var seenBars = [];
    buttons.forEach(function(btn) {
      var curr = btn;
      var depth = 0;
      // climb to the smallest ancestor that holds >= 2 distinct action buttons (the action bar)
      while (curr.parentElement && depth < 8) {
        if (actionButtonsIn(curr).length >= 2) break;
        curr = curr.parentElement;
        depth++;
      }
      if (actionButtonsIn(curr).length < 2) return;
      if (seenBars.indexOf(curr) !== -1) return;
      seenBars.push(curr);

      // climb while the parent still contains only THIS post's Like button
      var card = curr;
      var guard = 0;
      while (card.parentElement && guard < 25) {
        var parent = card.parentElement;
        var tag = parent.tagName.toLowerCase();
        if (tag === 'body' || tag === 'html' || tag === 'main' || parent.getAttribute('role') === 'main') break;
        if (countLikeButtons(parent) > 1) break;
        if (parent.querySelector('[class*="share-box"], [data-view-name="feed-share-box"]')) break;
        card = parent;
        guard++;
      }
      // sanity: a post card has some height and is not tiny
      if (card.offsetHeight >= 120 && found.indexOf(card) === -1) found.push(card);
    });
    return found;
  }

  // 6. Find All Feed Post Cards
  function findFeedPosts() {
    var postsSet = [];

    function addIfValid(el) {
      if (el && isValidPostElement(el) && postsSet.indexOf(el) === -1) {
        postsSet.push(el);
      }
    }

    // Strategy 1: Direct structural selectors
    var directSelectors = [
      '[data-view-name="feed-full-update"]',
      '[data-view-name*="feed"][data-view-name*="update"]',
      '.feed-shared-update-v2',
      'article[data-activity-id]',
      '[data-chameleon-result-urn]',
      'div.feed-shared-update-v2',
      'div[class*="feed-shared-update-v2"]',
      'div[data-urn*="urn:li:activity"]',
      'div[data-urn*="urn:li:ugcPost"]',
      'div[data-urn*="urn:li:share"]',
      'div[data-id*="urn:li:activity"]',
      'div[data-id*="urn:li:ugcPost"]',
      'div[data-id*="urn:li:share"]',
      'div[data-activity-urn]',
      'div[data-entity-urn*="urn:li:activity"]',
      'div[data-entity-urn*="urn:li:ugcPost"]',
      'article[data-activity-id]',
      'article[class*="feed-shared-update"]',
      'div.occludable-update .feed-shared-update-v2',
      'div[data-chameleon-result-urn]'
    ];

    directSelectors.forEach(function(sel) {
      try {
        var elements = document.querySelectorAll(sel);
        for (var i = 0; i < elements.length; i++) {
          addIfValid(elements[i]);
        }
      } catch (e) {}
    });

    // Strategy 2: Children of finite-scroll container
    var feedContainers = document.querySelectorAll(
      '.scaffold-finite-scroll__content, [data-view-name="scaffold-finite-scroll__content"], main [role="main"]'
    );
    for (var c = 0; c < feedContainers.length; c++) {
      var children = feedContainers[c].children;
      for (var ch = 0; ch < children.length; ch++) {
        var child = children[ch];
        if (child.classList.contains('occludable-update')) {
          var inner = child.querySelector('[data-view-name="feed-full-update"], .feed-shared-update-v2, [data-urn*="urn:li:activity"], [data-urn*="urn:li:ugcPost"], [data-urn*="urn:li:share"]') || child;
          addIfValid(inner);
        } else {
          addIfValid(child);
        }
      }
    }

    // Strategy 3: Upward traversal from Actor headers
    var actors = document.querySelectorAll(
      '.update-components-actor, [class*="update-components-actor"], .feed-shared-actor, [class*="feed-shared-actor"], [data-view-name*="actor"]'
    );
    for (var a = 0; a < actors.length; a++) {
      var cardFromActor = climbToPostCard(actors[a]);
      addIfValid(cardFromActor);
    }

    // Strategy 4: Upward traversal from Social Action Bars
    var socialBars = document.querySelectorAll(
      '[data-view-name="feed-social-actions"], .feed-shared-social-action-bar, [class*="feed-shared-social-actions"], [class*="social-actions"]'
    );
    for (var s = 0; s < socialBars.length; s++) {
      var cardFromSocial = climbToPostCard(socialBars[s]);
      addIfValid(cardFromSocial);
    }

    // Strategy 5: Upward traversal from Control menu buttons
    var menuButtons = document.querySelectorAll(
      'button[aria-label*="option" i], button[aria-label*="more" i], button[aria-label*="Control" i], .feed-shared-control-menu'
    );
    for (var m = 0; m < menuButtons.length; m++) {
      var cardFromMenu = climbToPostCard(menuButtons[m]);
      addIfValid(cardFromMenu);
    }

    // Strategy 6: label-based action-bar detection (works when class names change)
    try {
      findPostsByActionBar().forEach(function(el) {
        if (postsSet.indexOf(el) === -1 && !el.querySelector('.jobmail-radio-container')) {
          postsSet.push(el);
        } else if (postsSet.indexOf(el) === -1) {
          postsSet.push(el);
        }
      });
    } catch (e) { sendLog('ACTIONBAR_ERROR', String(e)); }

    // Filter out wrappers if inner card is present
    var finalPosts = [];
    postsSet.forEach(function(el) {
      var isOuterWrapper = postsSet.some(function(other) {
        return other !== el && el.contains(other);
      });
      if (!isOuterWrapper) {
        finalPosts.push(el);
      }
    });

    return finalPosts;
  }

  // 7. Update Visual State for All Posts
  function updateAllVisualStates() {
    var allContainers = document.querySelectorAll('.jobmail-radio-container');
    allContainers.forEach(function(container) {
      var pid = container.getAttribute('data-post-id');
      var isSelected = (pid && pid === state.selectedPostId && state.selectedPostId !== null);

      var radioBtn = container.querySelector('.jobmail-radio-button');
      if (radioBtn) {
        if (isSelected) {
          radioBtn.classList.add('active');
          radioBtn.setAttribute('aria-checked', 'true');
        } else {
          radioBtn.classList.remove('active');
          radioBtn.setAttribute('aria-checked', 'false');
        }
      }

      var post = container.parentElement;
      if (post) {
        if (isSelected) {
          post.classList.add('jobmail-post-highlight');
        } else {
          post.classList.remove('jobmail-post-highlight');
        }
      }
    });
  }

  // 8. Toggle Selection Logic (Single selection + toggle deselect)
  function togglePostSelection(postId) {
    if (state.selectedPostId === postId) {
      state.selectedPostId = null;
    } else {
      state.selectedPostId = postId;
    }

    updateAllVisualStates();

    // Notify React Native
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SELECTION_CHANGED',
          postId: state.selectedPostId,
          isSelected: state.selectedPostId !== null,
          timestamp: Date.now()
        }));
      }
    } catch (err) {}

    sendLog('SELECTION_TOGGLED', { selectedPostId: state.selectedPostId });
  }

  // 9. Synchronize Existing Button Visual State
  function syncButtonVisualState(post, container, postId) {
    var isSelected = (postId && postId === state.selectedPostId && state.selectedPostId !== null);
    if (isSelected) {
      post.classList.add('jobmail-post-highlight');
    } else {
      post.classList.remove('jobmail-post-highlight');
    }

    var radioBtn = container.querySelector('.jobmail-radio-button');
    if (radioBtn) {
      if (isSelected) {
        radioBtn.classList.add('active');
        radioBtn.setAttribute('aria-checked', 'true');
      } else {
        radioBtn.classList.remove('active');
        radioBtn.setAttribute('aria-checked', 'false');
      }
    }
  }

  // 10. Inject Radio Button on a Post
  function injectRadioButton(post) {
    var postId = getPostId(post);
    post.classList.add('jobmail-post-container');

    // Ensure relative positioning on the post card
    var computedPos = window.getComputedStyle(post).position;
    if (computedPos === 'static') {
      post.style.position = 'relative';
    }

    // Check if container already exists as a child of this post
    var existingContainer = null;
    for (var i = 0; i < post.children.length; i++) {
      if (post.children[i].classList && post.children[i].classList.contains('jobmail-radio-container')) {
        existingContainer = post.children[i];
        break;
      }
    }

    if (existingContainer) {
      syncButtonVisualState(post, existingContainer, postId);
      return false; // Already present, no duplicate
    }

    // Create radio container
    var container = document.createElement('div');
    container.className = 'jobmail-radio-container';
    container.setAttribute('data-post-id', postId);

    // Offset neatly to the left of existing LinkedIn 3-dots/options menu button
    var menuBtn = post.querySelector(
      'button[aria-label*="option" i], button[aria-label*="more" i], button[aria-label*="Control" i], .feed-shared-control-menu, .feed-shared-update-v2__control-menu, button[aria-label*="Dismiss" i]'
    );
    if (menuBtn) {
      container.style.right = '48px';
    } else {
      container.style.right = '12px';
    }

    // Circular radio button with white background and blue border
    var radioBtn = document.createElement('div');
    radioBtn.className = 'jobmail-radio-button';
    radioBtn.setAttribute('role', 'radio');

    // Inner circle (fills blue when active)
    var innerDot = document.createElement('div');
    innerDot.className = 'jobmail-radio-inner';
    radioBtn.appendChild(innerDot);
    container.appendChild(radioBtn);

    var isSelected = (postId && postId === state.selectedPostId && state.selectedPostId !== null);
    if (isSelected) {
      post.classList.add('jobmail-post-highlight');
      radioBtn.classList.add('active');
      radioBtn.setAttribute('aria-checked', 'true');
    } else {
      radioBtn.setAttribute('aria-checked', 'false');
    }

    // Tap/Click handling with event capture to prevent LinkedIn feed navigation
    container.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      togglePostSelection(postId);
    }, true);

    container.addEventListener('touchstart', function(e) {
      e.stopPropagation();
    }, { passive: true });

    container.addEventListener('touchend', function(e) {
      e.stopPropagation();
    }, { passive: true });

    post.appendChild(container);
    return true; // Newly inserted
  }

  // 11. Main Scan Routine
  function scanAndInjectPosts(reason) {
    injectStyles();
    var posts = findFeedPosts();
    var newButtonsCount = 0;

    posts.forEach(function(post) {
      var inserted = injectRadioButton(post);
      if (inserted) {
        newButtonsCount++;
      }
    });

    if (posts.length !== state.lastScannedCount || newButtonsCount > 0 || reason === 'initial_setup') {
      state.lastScannedCount = posts.length;
      sendLog('POSTS_SCANNED', {
        reason: reason || 'scan',
        postsDetected: posts.length,
        newButtonsInserted: newButtonsCount,
        feedRootCount: document.querySelectorAll('.scaffold-finite-scroll__content, [data-view-name="scaffold-finite-scroll__content"]').length,
        explicitFeedCardCount: document.querySelectorAll('[data-view-name="feed-full-update"], [data-view-name*="feed"][data-view-name*="update"], .feed-shared-update-v2, article[data-activity-id]').length,
        actorMarkerCount: document.querySelectorAll('.update-components-actor, [class*="update-components-actor"], .feed-shared-actor, [class*="feed-shared-actor"], [data-view-name*="actor"]').length,
        actionButtons: actionButtonsIn(document).length,
        selectedPostId: state.selectedPostId,
        url: window.location.href
      });
    }
  }

  // Expose trigger scan globally
  window.__JOBMAIL_TRIGGER_SCAN = function(reason) {
    scanAndInjectPosts(reason);
  };

  // Expose deselect all
  window.__jobmailDeselectAll = function() {
    state.selectedPostId = null;
    updateAllVisualStates();
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SELECTION_CHANGED',
          postId: null,
          isSelected: false,
          timestamp: Date.now()
        }));
      }
    } catch (e) {}
    sendLog('DESELECT_ALL', {});
  };

  // 12. Setup MutationObserver and SPA Hooks
  function setupEngine() {
    injectStyles();
    scanAndInjectPosts('initial_setup');

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
        }, 80);
      });

      state.observer.observe(targetNode, {
        childList: true,
        subtree: true
      });
    }

    // Safety fallback interval for virtualized list recycles and SPA scrolling
    if (!state.intervalSet) {
      state.intervalSet = true;
      setInterval(function() {
        scanAndInjectPosts('interval');
      }, 1000);
    }

    // Hook SPA navigations
    if (!state.spaHooked && window.history) {
      state.spaHooked = true;
      var originalPushState = window.history.pushState;
      if (originalPushState) {
        window.history.pushState = function() {
          var res = originalPushState.apply(this, arguments);
          setTimeout(function() { scanAndInjectPosts('pushState'); }, 300);
          return res;
        };
      }
      var originalReplaceState = window.history.replaceState;
      if (originalReplaceState) {
        window.history.replaceState = function() {
          var res = originalReplaceState.apply(this, arguments);
          setTimeout(function() { scanAndInjectPosts('replaceState'); }, 300);
          return res;
        };
      }
      window.addEventListener('popstate', function() {
        setTimeout(function() { scanAndInjectPosts('popstate'); }, 300);
      });
    }

    sendLog('INJECTION_READY', {
      url: window.location.href,
      readyState: document.readyState
    });
  }

  // Run initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEngine);
  } else {
    setupEngine();
  }
})();
true;
`;
