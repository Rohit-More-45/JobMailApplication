/**
 * JobMail - LinkedIn Feed Post Detection & Content Extraction Script (v5)
 *
 * Designed to reliably:
 * 1. Capture ONLY the main visible post with ZERO noise from adjacent posts or reaction counts.
 * 2. Climb DOM hierarchy to isolate the exact single-post container using single-actor boundaries.
 * 3. Automatically expand all "...see more" buttons to extract all full post text.
 * 4. Extract author, headline, clean body text, and attached photos.
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

  // Zoom Helper Function for Screen Zoom In / Zoom Out
  window.__JOBMAIL_SET_ZOOM = function(scale) {
    try {
      var s = parseFloat(scale) || 1.0;
      if (document.documentElement) {
        document.documentElement.style.zoom = s;
      }
      if (document.body) {
        document.body.style.zoom = s;
      }
      var meta = document.querySelector('meta[name="viewport"]');
      if (meta) {
        meta.content = 'width=device-width, initial-scale=' + s + ', minimum-scale=0.3, maximum-scale=3.0, user-scalable=yes';
      }
      return s;
    } catch(e) {
      return 1.0;
    }
  };

  function enableUserScalable() {
    try {
      var meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        (document.head || document.documentElement).appendChild(meta);
      }
      meta.content = 'width=device-width, initial-scale=1.0, minimum-scale=0.3, maximum-scale=3.0, user-scalable=yes';
    } catch(e) {}
  }

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
    var styleId = 'jobmail-injected-styles-v5';
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

  // 4. Find Post Card From Any Node using Single-Actor Boundary Climbing
  function findPostCardFromNode(node) {
    if (!node || node === document.body || node === document.documentElement) return null;

    var curr = node;
    var candidate = null;

    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.classList && (curr.classList.contains('jobmail-radio-container') || curr.id === 'jobmail-injected-styles-v5')) {
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
          // Parent is the feed container holding multiple posts.
          // Therefore, curr is the exact single post card!
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

  // 6. Locate STRICTLY the Main Post Currently Visible on User's Screen (Zero Noise)
  function getVisibleFeedPost() {
    // Priority 1: User explicitly selected post via radio button
    if (state.selectedPostId) {
      var selectedEl = document.querySelector('[data-jobmail-post-id="' + state.selectedPostId + '"]');
      if (selectedEl) return selectedEl;
    }

    var vHeight = window.innerHeight || document.documentElement.clientHeight || 640;
    var vCenter = vHeight / 2;

    // Priority 2: Find the actor/author header closest to screen vertical center
    var actors = document.querySelectorAll(
      '.update-components-actor, [class*="update-components-actor"], [class*="actor__name"], [class*="actor__title"], .feed-shared-actor'
    );
    var bestActor = null;
    var bestDist = Infinity;

    for (var i = 0; i < actors.length; i++) {
      var rect = actors[i].getBoundingClientRect();
      if (rect.bottom > 40 && rect.top < vHeight - 40) {
        var dist = Math.abs((rect.top + rect.bottom) / 2 - vCenter);
        if (dist < bestDist) {
          bestDist = dist;
          bestActor = actors[i];
        }
      }
    }

    // Climb from bestActor to the single post card boundary
    if (bestActor) {
      var curr = bestActor;
      var postCard = null;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        var parent = curr.parentElement;
        if (!parent) break;

        var actorsInParent = parent.querySelectorAll(
          '.update-components-actor, [class*="update-components-actor"], [class*="actor__name"], [class*="actor__title"], .feed-shared-actor'
        );
        if (actorsInParent.length > 1) {
          postCard = curr;
          break;
        }

        var vName = curr.getAttribute('data-view-name') || '';
        var cName = (curr.className || '').toString();
        var dUrn = curr.getAttribute('data-urn') || '';
        if (
          vName === 'feed-full-update' ||
          cName.indexOf('feed-shared-update') !== -1 ||
          dUrn.indexOf('urn:li:activity') !== -1 ||
          curr.tagName.toLowerCase() === 'article'
        ) {
          postCard = curr;
          break;
        }

        curr = parent;
      }
      return postCard || curr || bestActor;
    }

    // Priority 3: Sample elementFromPoint at center of screen
    var vWidth = window.innerWidth || 360;
    var centerX = vWidth / 2;
    var sampleFractions = [0.5, 0.4, 0.6, 0.3, 0.7];
    for (var s = 0; s < sampleFractions.length; s++) {
      var y = vHeight * sampleFractions[s];
      var elAtPoint = document.elementFromPoint(centerX, y);
      if (elAtPoint) {
        var card = findPostCardFromNode(elAtPoint);
        if (card) return card;
      }
    }

    // Priority 4: Any visible feed post
    var posts = findFeedPosts();
    for (var p = 0; p < posts.length; p++) {
      var pR = posts[p].getBoundingClientRect();
      if (pR.bottom > 80 && pR.top < vHeight - 80) {
        return posts[p];
      }
    }
    return posts.length > 0 ? posts[0] : null;
  }

  // 7. Extract Clean Single Post Content (Zero Noise)
  window.__JOBMAIL_EXTRACT_VISIBLE_POST = function() {
    var postEl = getVisibleFeedPost();
    var extractedData = null;

    if (postEl) {
      // Flash green confirmation highlight
      postEl.classList.add('jobmail-post-captured');
      setTimeout(function() {
        try { postEl.classList.remove('jobmail-post-captured'); } catch(e) {}
      }, 1500);

      // Expand all 'see more' buttons strictly inside this post
      try {
        var buttons = postEl.querySelectorAll('button, [role="button"], span');
        buttons.forEach(function(b) {
          var bText = (b.innerText || b.textContent || '').trim().toLowerCase();
          if (bText === '…see more' || bText === 'see more' || bText === '…more' || bText === 'more') {
            try { b.click(); } catch(e) {}
          }
        });
      } catch(e) {}

      // Extract Author Name
      var author = '';
      var authorEl = postEl.querySelector(
        '.update-components-actor__name, [class*="actor__name"], [class*="actor__title"], h3, h2, a[href*="/in/"]'
      );
      if (authorEl) {
        author = (authorEl.innerText || authorEl.textContent || '').trim();
      }

      // Extract Headline / Subtitle
      var headline = '';
      var headlineEl = postEl.querySelector(
        '.update-components-actor__description, [class*="actor__description"], [class*="actor__headline"], [class*="sub-description"]'
      );
      if (headlineEl) {
        headline = (headlineEl.innerText || headlineEl.textContent || '').trim();
      }

      // Extract Clean Body Text
      var postText = '';
      var textContainer = postEl.querySelector(
        '.update-components-text, [class*="update-components-text"], .feed-shared-update-v2__description-wrapper, [class*="commentary"], [data-view-name="feed-update-text"]'
      );
      if (textContainer) {
        postText = (textContainer.innerText || textContainer.textContent || '').trim();
      }

      // If text container not found, clone post and strip noise
      if (!postText || postText.length < 15) {
        var clone = postEl.cloneNode(true);
        // Remove noise: buttons, social actions, reaction counts, radio buttons, etc.
        var noiseSelectors = [
          'script', 'style', 'button',
          '[class*="social-counts"]', '[class*="social-details"]', '[class*="reactions"]',
          '[class*="social-action"]', '[class*="social-bar"]', '[class*="feed-shared-social-action-bar"]',
          '.jobmail-radio-container',
          '.update-components-actor', '[class*="update-components-actor"]',
          '[class*="control-menu"]'
        ];
        noiseSelectors.forEach(function(sel) {
          var els = clone.querySelectorAll(sel);
          els.forEach(function(el) { try { el.remove(); } catch(e) {} });
        });
        postText = (clone.innerText || clone.textContent || '').trim();
      }

      // Filter out any trailing reaction counts that leaked in
      postText = postText.replace(/\\b\\d+\\s*(likes?|comments?|reposts?)\\b/gi, '').trim();

      // Extract Photos
      var photoUrls = [];
      var images = postEl.querySelectorAll('img');
      images.forEach(function(img) {
        if (img.closest && img.closest('[class*="actor"], [class*="avatar"], .feed-shared-actor')) return;
        var src = img.currentSrc || img.src || img.getAttribute('data-delayed-url');
        if (src && src.indexOf('data:image') === -1) {
          var width = img.naturalWidth || img.width || img.offsetWidth;
          var height = img.naturalHeight || img.height || img.offsetHeight;
          if (width > 80 && height > 80 && photoUrls.indexOf(src) === -1) {
            photoUrls.push(src);
          }
        }
      });

      var postId = getPostId(postEl);

      var sections = [];
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
      // Fallback: Find largest text container in center
      var centerBlockText = '';
      var pTags = document.querySelectorAll('p, div[class*="text"]');
      pTags.forEach(function(p) {
        var r = p.getBoundingClientRect();
        if (r.top > 60 && r.bottom < (window.innerHeight || 640) - 60) {
          var t = (p.innerText || '').trim();
          if (t.length > centerBlockText.length && !t.includes('JobMail') && !t.includes('ChatGPT')) {
            centerBlockText = t;
          }
        }
      });

      extractedData = {
        author: 'LinkedIn Post',
        headline: '',
        text: centerBlockText,
        photos: [],
        fullContent: centerBlockText || 'LinkedIn post content',
        postId: 'visible_post_' + Date.now()
      };
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

  // 8. Radio Button Injection & Setup
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
    enableUserScalable();
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
