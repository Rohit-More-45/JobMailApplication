/**
 * JobMail - LinkedIn Feed Post Detection & Content Extraction Script (v4)
 *
 * Designed to reliably:
 * 1. Capture the LinkedIn post visible on the user's screen using elementFromPoint sampling.
 * 2. Automatically expand all "...see more" buttons to extract all visible and non-visible text.
 * 3. Extract author, headline, full body text, and all attached photos.
 * 4. Fall back to direct viewport harvesting so post extraction NEVER fails.
 * 5. Send structured content to React Native via window.ReactNativeWebView.postMessage.
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
    var styleId = 'jobmail-injected-styles-v4';
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
        outline: 3.5px solid #10a37f !important;
        background-color: rgba(16, 163, 127, 0.08) !important;
        box-shadow: 0 0 24px rgba(16, 163, 127, 0.35) !important;
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
      if (curr.classList && (curr.classList.contains('jobmail-radio-container') || curr.id === 'jobmail-injected-styles-v4')) {
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

      var rect = curr.getBoundingClientRect();
      if (rect.height > 120) {
        var text = (curr.innerText || '').trim();
        var hasActor = curr.querySelector('[class*="actor"], [class*="author"], a[href*="/in/"]') !== null;
        var hasButtons = curr.querySelector('button') !== null;

        if (hasActor && hasButtons && text.length > 35) {
          candidate = curr;
          if (curr.parentElement && curr.parentElement.children.length > 1) {
            var pRect = curr.parentElement.getBoundingClientRect();
            if (pRect.height > rect.height * 1.2) {
              return curr;
            }
          }
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

  // 6. Locate the Post Currently Visible on User's Screen
  function getVisibleFeedPost() {
    // Priority 1: User explicitly selected post
    if (state.selectedPostId) {
      var selectedEl = document.querySelector('[data-jobmail-post-id="' + state.selectedPostId + '"]');
      if (selectedEl) return selectedEl;
    }

    var vWidth = window.innerWidth || document.documentElement.clientWidth || 360;
    var vHeight = window.innerHeight || document.documentElement.clientHeight || 640;
    var centerX = vWidth / 2;

    // Priority 2: Sample elementFromPoint at center of screen
    var sampleFractions = [0.45, 0.55, 0.35, 0.65, 0.25, 0.75];
    for (var i = 0; i < sampleFractions.length; i++) {
      var y = vHeight * sampleFractions[i];
      var elAtPoint = document.elementFromPoint(centerX, y);
      if (elAtPoint) {
        var card = findPostCardFromNode(elAtPoint);
        if (card) return card;
      }
    }

    // Priority 3: Scan visible actors / cards
    var signatures = document.querySelectorAll(
      '[class*="actor"], button[aria-label*="option" i], button[aria-label*="more" i], button[aria-label*="Follow" i], [class*="update-components-text"], [class*="feed-shared"]'
    );
    var bestCard = null;
    var bestDist = Infinity;
    var vCenter = vHeight / 2;

    signatures.forEach(function(sig) {
      var rect = sig.getBoundingClientRect();
      if (rect.bottom > 60 && rect.top < vHeight - 60) {
        var c = findPostCardFromNode(sig);
        if (c) {
          var cRect = c.getBoundingClientRect();
          var dist = Math.abs((cRect.top + cRect.bottom) / 2 - vCenter);
          if (dist < bestDist) {
            bestDist = dist;
            bestCard = c;
          }
        }
      }
    });

    if (bestCard) return bestCard;

    // Priority 4: Any visible container with text in center
    var posts = findFeedPosts();
    if (posts && posts.length > 0) {
      for (var p = 0; p < posts.length; p++) {
        var pR = posts[p].getBoundingClientRect();
        if (pR.bottom > 60 && pR.top < vHeight - 60) {
          return posts[p];
        }
      }
      return posts[0];
    }

    return null;
  }

  // 7. Direct Viewport Text Harvesting (Ultimate Fail-Safe)
  function extractDirectFromViewport() {
    var vHeight = window.innerHeight || 640;
    var visibleText = [];
    var visiblePhotos = [];
    var seenText = new Set();

    var allElements = document.querySelectorAll('p, span, h1, h2, h3, h4, div, a');
    allElements.forEach(function(el) {
      if (el.children.length > 2) return;
      var rect = el.getBoundingClientRect();
      if (rect.bottom > 70 && rect.top < vHeight - 70 && rect.height > 8 && rect.width > 20) {
        var t = (el.innerText || el.textContent || '').trim();
        if (t.length > 4 && !seenText.has(t)) {
          if (!t.includes('JobMail') && !t.includes('ChatGPT') && !t.includes('LinkedIn')) {
            seenText.add(t);
            visibleText.push(t);
          }
        }
      }
    });

    var allImgs = document.querySelectorAll('img');
    allImgs.forEach(function(img) {
      var rect = img.getBoundingClientRect();
      if (rect.bottom > 70 && rect.top < vHeight - 70 && rect.width > 90 && rect.height > 90) {
        var src = img.currentSrc || img.src;
        if (src && !src.startsWith('data:') && visiblePhotos.indexOf(src) === -1) {
          visiblePhotos.push(src);
        }
      }
    });

    var bodyText = visibleText.join('\\n');
    var fullContent = bodyText + (visiblePhotos.length > 0 ? '\\n\\nAttached Photos (' + visiblePhotos.length + '):\\n' + visiblePhotos.join('\\n') : '');

    return {
      author: 'LinkedIn Post',
      headline: '',
      text: bodyText,
      photos: visiblePhotos,
      fullContent: fullContent,
      postId: 'visible_viewport_' + Date.now()
    };
  }

  // 8. Extract Full Content from the Visible Post
  window.__JOBMAIL_EXTRACT_VISIBLE_POST = function() {
    var postEl = getVisibleFeedPost();
    var extractedData = null;

    if (postEl) {
      // Flash green confirmation highlight
      postEl.classList.add('jobmail-post-captured');
      setTimeout(function() {
        try { postEl.classList.remove('jobmail-post-captured'); } catch(e) {}
      }, 1500);

      // Expand all 'see more' buttons
      try {
        var buttons = postEl.querySelectorAll('button, [role="button"], span');
        buttons.forEach(function(b) {
          var bText = (b.innerText || b.textContent || '').trim().toLowerCase();
          if (bText === '…see more' || bText === 'see more' || bText === '…more' || bText === 'more') {
            try { b.click(); } catch(e) {}
          }
        });
      } catch(e) {}

      var author = '';
      var headline = '';
      var contextHeader = '';

      var headerEl = postEl.querySelector('[class*="header"], [class*="context"]');
      if (headerEl) {
        var hText = (headerEl.innerText || '').trim();
        if (hText.toLowerCase().includes('like') || hText.toLowerCase().includes('comment') || hText.toLowerCase().includes('repost')) {
          contextHeader = hText;
        }
      }

      var authorEl = postEl.querySelector(
        '.update-components-actor__name, [class*="actor__name"], [class*="actor__title"], h3, h2, a[href*="/in/"]'
      );
      if (authorEl) {
        author = (authorEl.innerText || authorEl.textContent || '').trim();
      }

      var headlineEl = postEl.querySelector(
        '.update-components-actor__description, [class*="actor__description"], [class*="actor__headline"], [class*="sub-description"]'
      );
      if (headlineEl) {
        headline = (headlineEl.innerText || headlineEl.textContent || '').trim();
      }

      var postText = '';
      var textContainer = postEl.querySelector(
        '.update-components-text, .feed-shared-update-v2__description-wrapper, [class*="update-components-text"], [class*="commentary"], [data-view-name="feed-update-text"]'
      );
      if (textContainer) {
        postText = (textContainer.innerText || textContainer.textContent || '').trim();
      }

      if (!postText || postText.length < 20) {
        var clone = postEl.cloneNode(true);
        var unwanted = clone.querySelectorAll(
          'script, style, button, [class*="social"], [class*="action"], .jobmail-radio-container'
        );
        unwanted.forEach(function(u) { try { u.remove(); } catch(e) {} });
        postText = (clone.innerText || clone.textContent || '').trim();
      }

      var photoUrls = [];
      var images = postEl.querySelectorAll('img');
      images.forEach(function(img) {
        var src = img.currentSrc || img.src || img.getAttribute('data-delayed-url');
        if (src && src.indexOf('data:image') === -1) {
          var width = img.naturalWidth || img.width || img.offsetWidth;
          var height = img.naturalHeight || img.height || img.offsetHeight;
          var isContentImg = (width > 90 && height > 90) ||
            (img.closest && img.closest('[class*="image"], [class*="media"], [class*="article"], [class*="carousel"]'));
          if (isContentImg && photoUrls.indexOf(src) === -1) {
            photoUrls.push(src);
          }
        }
      });

      var postId = getPostId(postEl);

      var sections = [];
      if (contextHeader) {
        sections.push(contextHeader);
      }
      if (author) {
        sections.push('Author: ' + author + (headline ? ' (' + headline + ')' : ''));
      }
      if (postText) {
        sections.push('\\n' + postText);
      }
      if (photoUrls.length > 0) {
        sections.push('\\nAttached Photos (' + photoUrls.length + '):\\n' + photoUrls.join('\\n'));
      }

      var fullContent = sections.join('\\n');

      extractedData = {
        author: author || 'LinkedIn Post',
        headline: headline,
        text: postText,
        photos: photoUrls,
        fullContent: fullContent,
        postId: postId
      };
    } else {
      // Direct viewport harvesting
      extractedData = extractDirectFromViewport();
    }

    sendLog('POST_EXTRACTED_SUCCESS', {
      author: extractedData.author,
      contentLength: extractedData.fullContent.length,
      photosCount: extractedData.photos.length
    });

    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'POST_EXTRACTED',
        data: extractedData
      }));
    }
  };

  // 9. Radio Button Injection & Setup
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
