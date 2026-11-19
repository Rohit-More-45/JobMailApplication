/**
 * JobMail - LinkedIn Feed Post Detection & Content Extraction Script (v3)
 *
 * Capabilities:
 * 1. Multi-tier post detection & continuous observation via MutationObserver.
 * 2. Visual radio button support with tap interception and single selection.
 * 3. Content extraction: extracts all visible & non-visible text and attached photos
 *    from the post currently visible to the user on screen (or selected post).
 * 4. Communicates extracted content to React Native via window.ReactNativeWebView.postMessage.
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

  // 2. CSS Styles Injection
  function injectStyles() {
    var styleId = 'jobmail-injected-styles-v3';
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

      /* Flash Highlight on Captured Post */
      .jobmail-post-captured {
        outline: 3px solid #059669 !important;
        background-color: rgba(5, 150, 105, 0.08) !important;
        box-shadow: 0 0 20px rgba(5, 150, 105, 0.3) !important;
        transition: all 0.3s ease !important;
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

  // 4. Validate Post Element
  function isValidPostElement(el) {
    if (!el || el.nodeType !== 1) return false;

    var className = (el.className || '').toString();
    var id = (el.id || '').toString();
    var viewName = el.getAttribute('data-view-name') || '';

    if (
      (className.indexOf('comment') !== -1 && className.indexOf('feed-shared-update') === -1) ||
      viewName === 'comment' ||
      id.indexOf('comment') !== -1
    ) {
      return false;
    }

    if (
      className.indexOf('share-box') !== -1 ||
      viewName === 'feed-share-box' ||
      id.indexOf('share-box') !== -1
    ) {
      return false;
    }

    if (
      className.indexOf('scaffold-finite-scroll__content') !== -1 ||
      className.indexOf('feed-container') !== -1 ||
      el.tagName.toLowerCase() === 'main' ||
      el.tagName.toLowerCase() === 'body'
    ) {
      return false;
    }

    var hasPostMarkers = el.querySelector(
      '.update-components-actor, [class*="update-components-actor"], .feed-shared-actor, [class*="feed-shared-actor"], [data-view-name*="social"], [class*="social-actions"], a[href*="/in/"], a[href*="activity"]'
    ) !== null;

    return hasPostMarkers;
  }

  // 5. Upward climbing to enclosing post card
  function climbToPostCard(startEl) {
    var curr = startEl;
    var candidate = null;

    while (curr && curr !== document.body && curr !== document.documentElement) {
      var cName = (curr.className || '').toString();
      if (cName.indexOf('share-box') !== -1 || cName.indexOf('comment-item') !== -1) {
        return null;
      }

      if (
        curr.getAttribute('data-view-name') === 'feed-full-update' ||
        curr.classList.contains('feed-shared-update-v2') ||
        curr.getAttribute('data-urn') ||
        curr.getAttribute('data-id') ||
        curr.getAttribute('data-activity-urn') ||
        curr.tagName.toLowerCase() === 'article' ||
        (curr.parentElement && (
          curr.parentElement.classList.contains('scaffold-finite-scroll__content') ||
          curr.parentElement.getAttribute('role') === 'main'
        ))
      ) {
        candidate = curr;
        if (curr.parentElement && curr.parentElement.classList.contains('scaffold-finite-scroll__content')) {
          return curr;
        }
      }

      curr = curr.parentElement;
    }

    return candidate;
  }

  // 6. Find All Feed Posts
  function findFeedPosts() {
    var postsSet = [];

    function addIfValid(el) {
      if (el && isValidPostElement(el) && postsSet.indexOf(el) === -1) {
        postsSet.push(el);
      }
    }

    var directSelectors = [
      '[data-view-name="feed-full-update"]',
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

    var feedContainers = document.querySelectorAll(
      '.scaffold-finite-scroll__content, [data-view-name="scaffold-finite-scroll__content"], main [role="main"]'
    );
    for (var c = 0; c < feedContainers.length; c++) {
      var children = feedContainers[c].children;
      for (var ch = 0; ch < children.length; ch++) {
        var child = children[ch];
        if (child.classList.contains('occludable-update')) {
          var inner = child.querySelector('.feed-shared-update-v2, [data-view-name="feed-full-update"], [data-urn], [data-id]') || child.firstElementChild || child;
          addIfValid(inner);
        } else {
          addIfValid(child);
        }
      }
    }

    var actors = document.querySelectorAll(
      '.update-components-actor, [class*="update-components-actor"], .feed-shared-actor, [class*="feed-shared-actor"]'
    );
    for (var a = 0; a < actors.length; a++) {
      var cardFromActor = climbToPostCard(actors[a]);
      addIfValid(cardFromActor);
    }

    var socialBars = document.querySelectorAll(
      '[data-view-name="feed-social-actions"], .feed-shared-social-action-bar, [class*="feed-shared-social-actions"], [class*="social-actions"]'
    );
    for (var s = 0; s < socialBars.length; s++) {
      var cardFromSocial = climbToPostCard(socialBars[s]);
      addIfValid(cardFromSocial);
    }

    var menuButtons = document.querySelectorAll(
      'button[aria-label*="option" i], button[aria-label*="more" i], button[aria-label*="Control" i], .feed-shared-control-menu'
    );
    for (var m = 0; m < menuButtons.length; m++) {
      var cardFromMenu = climbToPostCard(menuButtons[m]);
      addIfValid(cardFromMenu);
    }

    var finalPosts = [];
    postsSet.forEach(function(el) {
      var isOuterWrapper = postsSet.some(function(other) {
        return other !== el && el.contains(other) && (
          el.classList.contains('occludable-update') ||
          el.classList.contains('scaffold-finite-scroll__content') ||
          el.getAttribute('role') === 'main'
        );
      });
      if (!isOuterWrapper) {
        finalPosts.push(el);
      }
    });

    return finalPosts;
  }

  // 7. Update Visual States
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

  // 8. Toggle Selection
  function togglePostSelection(postId) {
    if (state.selectedPostId === postId) {
      state.selectedPostId = null;
    } else {
      state.selectedPostId = postId;
    }

    updateAllVisualStates();

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

  // 9. Synchronize Button State
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

  // 10. Inject Radio Button
  function injectRadioButton(post) {
    var postId = getPostId(post);
    post.classList.add('jobmail-post-container');

    var computedPos = window.getComputedStyle(post).position;
    if (computedPos === 'static') {
      post.style.position = 'relative';
    }

    var existingContainer = null;
    for (var i = 0; i < post.children.length; i++) {
      if (post.children[i].classList && post.children[i].classList.contains('jobmail-radio-container')) {
        existingContainer = post.children[i];
        break;
      }
    }

    if (existingContainer) {
      syncButtonVisualState(post, existingContainer, postId);
      return false;
    }

    var container = document.createElement('div');
    container.className = 'jobmail-radio-container';
    container.setAttribute('data-post-id', postId);

    var menuBtn = post.querySelector(
      'button[aria-label*="option" i], button[aria-label*="more" i], button[aria-label*="Control" i], .feed-shared-control-menu, .feed-shared-update-v2__control-menu, button[aria-label*="Dismiss" i]'
    );
    if (menuBtn) {
      container.style.right = '48px';
    } else {
      container.style.right = '12px';
    }

    var radioBtn = document.createElement('div');
    radioBtn.className = 'jobmail-radio-button';
    radioBtn.setAttribute('role', 'radio');

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

    container.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      togglePostSelection(postId);
    }, true);

    container.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true });
    container.addEventListener('touchend', function(e) { e.stopPropagation(); }, { passive: true });

    post.appendChild(container);
    return true;
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

    if (posts.length !== state.lastScannedCount || newButtonsCount > 0) {
      state.lastScannedCount = posts.length;
      sendLog('POSTS_SCANNED', {
        reason: reason || 'scan',
        postsDetected: posts.length,
        newButtonsInserted: newButtonsCount,
        selectedPostId: state.selectedPostId,
        url: window.location.href
      });
    }
  }

  // 12. Find the Post Currently Visible on User's Screen
  function getVisibleFeedPost() {
    // If a post is selected, prioritize it
    if (state.selectedPostId) {
      var selectedEl = document.querySelector('[data-jobmail-post-id="' + state.selectedPostId + '"]');
      if (selectedEl) return selectedEl;
    }

    var posts = findFeedPosts();
    if (!posts || posts.length === 0) return null;

    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    var viewportCenter = viewportHeight / 2;

    var bestPost = null;
    var bestDist = Infinity;

    for (var i = 0; i < posts.length; i++) {
      var rect = posts[i].getBoundingClientRect();
      // Check if post overlaps viewport
      if (rect.bottom > 80 && rect.top < viewportHeight - 80) {
        var postCenter = (rect.top + rect.bottom) / 2;
        var dist = Math.abs(postCenter - viewportCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestPost = posts[i];
        }
      }
    }

    return bestPost || posts[0] || null;
  }

  // 13. Extract All Content from the Visible/Selected Post
  window.__JOBMAIL_EXTRACT_VISIBLE_POST = function() {
    var postEl = getVisibleFeedPost();
    if (!postEl) {
      sendLog('EXTRACT_FAILED', { reason: 'No visible post detected in feed' });
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'POST_EXTRACT_ERROR',
          message: 'No LinkedIn feed post is currently visible on screen. Please scroll to a post and try again.'
        }));
      }
      return;
    }

    // Flash captured effect on post card
    postEl.classList.add('jobmail-post-captured');
    setTimeout(function() {
      postEl.classList.remove('jobmail-post-captured');
    }, 1500);

    // 1. Expand all 'see more' buttons to reveal complete text
    try {
      var seeMoreButtons = postEl.querySelectorAll(
        'button[class*="see-more"], button[class*="show-more"], [class*="see-more-btn"], button[aria-label*="see more" i]'
      );
      seeMoreButtons.forEach(function(b) {
        try { b.click(); } catch(e) {}
      });
    } catch(e) {}

    // 2. Extract Author & Headline
    var author = '';
    var headline = '';
    var authorEl = postEl.querySelector(
      '.update-components-actor__name, [class*="actor__name"], .feed-shared-actor__name, [class*="actor__title"], h3, h2, a[href*="/in/"]'
    );
    if (authorEl) {
      author = (authorEl.innerText || authorEl.textContent || '').trim();
    }

    var headlineEl = postEl.querySelector(
      '.update-components-actor__description, [class*="actor__description"], .feed-shared-actor__sub-description, [class*="actor__headline"]'
    );
    if (headlineEl) {
      headline = (headlineEl.innerText || headlineEl.textContent || '').trim();
    }

    // 3. Extract Full Text (both visible & hidden)
    var postText = '';
    var textContainer = postEl.querySelector(
      '.update-components-text, .feed-shared-update-v2__description-wrapper, [class*="update-components-text"], [class*="commentary"], [data-view-name="feed-update-text"]'
    );
    if (textContainer) {
      postText = (textContainer.innerText || textContainer.textContent || '').trim();
    } else {
      var clone = postEl.cloneNode(true);
      var unwanted = clone.querySelectorAll(
        'script, style, button, [class*="social"], [class*="action"], .jobmail-radio-container'
      );
      unwanted.forEach(function(u) { u.remove(); });
      postText = (clone.innerText || clone.textContent || '').trim();
    }

    // 4. Extract Photos / Media
    var photoUrls = [];
    var images = postEl.querySelectorAll('img');
    images.forEach(function(img) {
      var src = img.currentSrc || img.src || img.getAttribute('data-delayed-url');
      if (src && src.indexOf('data:image') === -1) {
        var width = img.naturalWidth || img.width || img.offsetWidth;
        var height = img.naturalHeight || img.height || img.offsetHeight;
        var isContentImg = (width > 120 && height > 120) ||
          (img.closest && img.closest('[class*="image"], [class*="media"], [class*="article"], [class*="carousel"]'));
        if (isContentImg && photoUrls.indexOf(src) === -1) {
          photoUrls.push(src);
        }
      }
    });

    var postId = getPostId(postEl);

    // Format comprehensive output text for ChatGPT
    var sections = [];
    if (author) {
      sections.push('Author: ' + author + (headline ? ' (' + headline + ')' : ''));
    }
    if (postText) {
      sections.push('\\n' + postText);
    }
    if (photoUrls.length > 0) {
      sections.push('\\nPhotos Attached (' + photoUrls.length + '):\\n' + photoUrls.join('\\n'));
    }

    var fullContent = sections.join('\\n');

    sendLog('POST_EXTRACTED_SUCCESS', {
      author: author,
      hasText: postText.length > 0,
      photoCount: photoUrls.length,
      postId: postId
    });

    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'POST_EXTRACTED',
        data: {
          author: author,
          headline: headline,
          text: postText,
          photos: photoUrls,
          fullContent: fullContent,
          postId: postId
        }
      }));
    }
  };

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

  // 14. Setup Engine
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

    if (!state.intervalSet) {
      state.intervalSet = true;
      setInterval(function() {
        scanAndInjectPosts('interval');
      }, 1000);
    }

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupEngine);
  } else {
    setupEngine();
  }
})();
true;
`;
