/**
 * JobMail - LinkedIn Feed Post Detection & Radio Button Injection Script
 * 
 * Injected into React Native WebView to:
 * 1. Identify supported LinkedIn feed posts using multi-selector heuristics.
 * 2. Inject a custom circular radio button in the top-right corner of each post.
 * 3. Enforce single-post selection (selecting a new post deselects the previous one).
 * 4. Support toggle-to-deselect (tapping the selected post deselects it).
 * 5. Apply subtle visual highlight to the selected post.
 * 6. Use MutationObserver to dynamically attach radio buttons on scroll without duplicates.
 * 7. Communicate selection state to React Native via window.ReactNativeWebView.postMessage.
 */

export const LINKEDIN_INJECTION_SCRIPT = `
(function() {
  if (window.__JOBMAIL_INJECTED__) {
    return;
  }
  window.__JOBMAIL_INJECTED__ = true;

  var currentSelectedPostId = null;
  var postCounter = 0;
  var scanDebounceTimer = null;

  // 1. Inject Styles
  function injectStyles() {
    if (document.getElementById('jobmail-injected-styles')) return;
    
    var styleEl = document.createElement('style');
    styleEl.id = 'jobmail-injected-styles';
    styleEl.textContent = \`
      /* JobMail Post Highlight */
      .jobmail-post-highlight {
        outline: 2.5px solid #0a66c2 !important;
        outline-offset: -2px !important;
        background-color: rgba(10, 102, 194, 0.035) !important;
        box-shadow: 0 4px 16px rgba(10, 102, 194, 0.18) !important;
        transition: outline 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease !important;
      }

      /* Radio Container */
      .jobmail-radio-container {
        position: absolute !important;
        top: 10px !important;
        right: 48px !important;
        z-index: 9999 !important;
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
        border: 2px solid #64748b !important;
        background-color: #ffffff !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18) !important;
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
        box-shadow: 0 0 0 3px rgba(10, 102, 194, 0.25), 0 2px 8px rgba(0, 0, 0, 0.22) !important;
      }

      .jobmail-radio-button.active .jobmail-radio-inner {
        background-color: #0a66c2 !important;
      }
    \`;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  // 2. Extract or Assign Stable Post ID
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

    var urnLink = el.querySelector('a[href*="urn:li:activity:"]');
    if (urnLink && urnLink.href) {
      var match = urnLink.href.match(/urn:li:activity:\\d+/);
      if (match) {
        el.dataset.jobmailPostId = match[0];
        return match[0];
      }
    }

    var childWithUrn = el.querySelector('[data-urn*="urn:li:activity:"]');
    if (childWithUrn) {
      var cUrn = childWithUrn.getAttribute('data-urn');
      if (cUrn) {
        el.dataset.jobmailPostId = cUrn;
        return cUrn;
      }
    }

    postCounter++;
    var generatedId = 'jobmail_post_' + postCounter;
    el.dataset.jobmailPostId = generatedId;
    return generatedId;
  }

  // 3. Send Notification to React Native
  function notifyReactNative(selectedId) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SELECTION_CHANGED',
          postId: selectedId,
          isSelected: selectedId !== null,
          timestamp: Date.now()
        }));
      }
    } catch (err) {
      console.warn('[JobMail] RN postMessage error:', err);
    }
  }

  // 4. Update Visual State for All Posts
  function updateAllVisualStates() {
    var allPosts = document.querySelectorAll('.jobmail-post-container');
    allPosts.forEach(function(post) {
      var pid = post.dataset.jobmailPostId;
      var isSelected = (pid && pid === currentSelectedPostId && currentSelectedPostId !== null);
      
      if (isSelected) {
        post.classList.add('jobmail-post-highlight');
      } else {
        post.classList.remove('jobmail-post-highlight');
      }

      var radioBtn = post.querySelector('.jobmail-radio-button');
      if (radioBtn) {
        if (isSelected) {
          radioBtn.classList.add('active');
          radioBtn.setAttribute('aria-checked', 'true');
        } else {
          radioBtn.classList.remove('active');
          radioBtn.setAttribute('aria-checked', 'false');
        }
      }
    });
  }

  // 5. Toggle Selection Logic (Single selection + toggle deselect)
  function togglePostSelection(postId) {
    if (currentSelectedPostId === postId) {
      currentSelectedPostId = null;
    } else {
      currentSelectedPostId = postId;
    }

    updateAllVisualStates();
    notifyReactNative(currentSelectedPostId);
  }

  // 6. Find All Feed Post Elements
  function findFeedPosts() {
    var candidates = [];
    var seen = new Set();

    var postSelectors = [
      'div[data-urn*="urn:li:activity"]',
      'div[data-urn*="urn:li:ugcPost"]',
      'div[data-urn*="urn:li:share"]',
      'div[data-activity-urn]',
      'div[data-entity-urn*="urn:li:activity"]',
      'div[data-entity-urn*="urn:li:ugcPost"]',
      'div[data-id*="urn:li:activity"]',
      'div[data-id*="urn:li:ugcPost"]',
      'div[data-id*="urn:li:share"]',
      'div.feed-shared-update-v2',
      'div[data-view-name="feed-full-update"]',
      'article[data-activity-id]',
      'div.occludable-update',
      'div[data-chameleon-result-urn]'
    ];

    postSelectors.forEach(function(selector) {
      var elements = document.querySelectorAll(selector);
      elements.forEach(function(el) {
        if (!seen.has(el) && el.offsetWidth > 100 && el.offsetHeight > 80) {
          seen.add(el);
          candidates.push(el);
        }
      });
    });

    // Fallback detection via social interaction action bar
    var actionBars = document.querySelectorAll('div.feed-shared-social-action-bar, div.feed-shared-social-actions, [data-view-name="feed-social-actions"]');
    actionBars.forEach(function(bar) {
      var p = bar.parentElement;
      var postCard = null;
      while (p && p !== document.body && p !== document.documentElement) {
        if (
          p.getAttribute('data-urn') ||
          p.getAttribute('data-id') ||
          p.classList.contains('feed-shared-update-v2') ||
          p.classList.contains('feed-item') ||
          p.tagName.toLowerCase() === 'article' ||
          (p.parentElement && p.parentElement.getAttribute('role') === 'main')
        ) {
          postCard = p;
          break;
        }
        p = p.parentElement;
      }
      if (postCard && !seen.has(postCard) && postCard.offsetWidth > 100 && postCard.offsetHeight > 80) {
        seen.add(postCard);
        candidates.push(postCard);
      }
    });

    return candidates;
  }

  // 7. Inject Radio Button on a Post
  function injectRadioButton(post) {
    // Avoid double-injecting on nested child elements inside an existing post
    if (post.parentElement && post.parentElement.closest('.jobmail-post-container')) {
      return;
    }

    var postId = getPostId(post);
    post.classList.add('jobmail-post-container');

    // Ensure relative positioning for correct absolute anchoring
    var computedPos = window.getComputedStyle(post).position;
    if (computedPos === 'static') {
      post.style.position = 'relative';
    }

    // Check if container already exists
    var existingContainer = post.querySelector(':scope > .jobmail-radio-container');
    if (existingContainer) {
      // Synchronize visual state in case of DOM reuse
      var isSel = (postId && postId === currentSelectedPostId && currentSelectedPostId !== null);
      if (isSel) {
        post.classList.add('jobmail-post-highlight');
      } else {
        post.classList.remove('jobmail-post-highlight');
      }
      var existingBtn = existingContainer.querySelector('.jobmail-radio-button');
      if (existingBtn) {
        if (isSel) {
          existingBtn.classList.add('active');
          existingBtn.setAttribute('aria-checked', 'true');
        } else {
          existingBtn.classList.remove('active');
          existingBtn.setAttribute('aria-checked', 'false');
        }
      }
      return;
    }

    // Create custom circular radio button container
    var container = document.createElement('div');
    container.className = 'jobmail-radio-container';
    container.setAttribute('data-post-id', postId);

    // If post has a control/overflow menu button in header, offset neatly to its left
    var menuBtn = post.querySelector('button[aria-label*="option" i], button[aria-label*="more" i], button[aria-label*="Control" i], .feed-shared-control-menu, .feed-shared-update-v2__control-menu');
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

    var isSelected = (postId && postId === currentSelectedPostId && currentSelectedPostId !== null);
    if (isSelected) {
      post.classList.add('jobmail-post-highlight');
      radioBtn.classList.add('active');
      radioBtn.setAttribute('aria-checked', 'true');
    } else {
      radioBtn.setAttribute('aria-checked', 'false');
    }

    // Capture click before LinkedIn handlers
    container.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      togglePostSelection(postId);
    }, true);

    // Prevent touch bubble-up to LinkedIn feed
    container.addEventListener('touchstart', function(e) {
      e.stopPropagation();
    }, { passive: true });

    container.addEventListener('touchend', function(e) {
      e.stopPropagation();
    }, { passive: true });

    post.appendChild(container);
  }

  // 8. Main Scan and Inject Routine
  function scanAndInjectPosts() {
    injectStyles();
    var posts = findFeedPosts();
    posts.forEach(function(post) {
      injectRadioButton(post);
    });
  }

  // 9. Observer Setup (Dynamic Infinite Scrolling)
  function setupObserver() {
    scanAndInjectPosts();

    var targetNode = document.body || document.documentElement;
    if (!targetNode) {
      setTimeout(setupObserver, 200);
      return;
    }

    var observer = new MutationObserver(function() {
      if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
      scanDebounceTimer = setTimeout(scanAndInjectPosts, 60);
    });

    observer.observe(targetNode, {
      childList: true,
      subtree: true
    });

    // Safety fallback interval for virtualized list recycles
    setInterval(scanAndInjectPosts, 1500);
  }

  // 10. Deselect API exposed to React Native
  window.__jobmailDeselectAll = function() {
    currentSelectedPostId = null;
    updateAllVisualStates();
    notifyReactNative(null);
  };

  // Start initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupObserver);
  } else {
    setupObserver();
  }
})();
true;
`;
