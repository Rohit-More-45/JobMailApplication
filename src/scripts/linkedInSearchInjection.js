/**
 * JobMail - LinkedIn Logged-In Job Search Extractor
 *
 * Runs inside a WebView sharing cookies with the LinkedIn tab.
 * Extracts job cards from https://www.linkedin.com/jobs/search/...
 * directly from the rendered DOM (same results the user sees in browser).
 * No AI used.
 */

export const LINKEDIN_SEARCH_EXTRACTION_SCRIPT = `
(function() {
  if (window.__jobmailSearchExtracting) return;
  window.__jobmailSearchExtracting = true;

  var done = false;
  var attempts = 0;
  var maxAttempts = 18;

  function postResults(jobs, error) {
    if (done) return;
    done = true;
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'JOB_SEARCH_RESULTS',
          jobs: jobs || [],
          error: error || null
        }));
      }
    } catch (_e) {}
  }

  function extractCards() {
    var jobs = [];
    var seen = {};

    // Support both desktop/mobile logged-in LinkedIn job cards and guest cards
    var cardSelectors = [
      'li[data-occludable-job-id]',
      '.job-card-container',
      '.jobs-search-results__list-item',
      '.base-search-card',
      'div[data-job-id]'
    ];
    var nodes = document.querySelectorAll(cardSelectors.join(', '));

    nodes.forEach(function(card) {
      try {
        var id =
          card.getAttribute('data-occludable-job-id') ||
          card.getAttribute('data-job-id') ||
          '';

        if (!id) {
          var urn = card.getAttribute('data-entity-urn') || '';
          var urnMatch = urn.match(/jobPosting:(\\d+)/);
          if (urnMatch) id = urnMatch[1];
        }

        var linkEl =
          card.querySelector('a[href*="/jobs/view/"]') ||
          card.querySelector('a.job-card-list__title--link') ||
          card.querySelector('a.job-card-container__link') ||
          card.querySelector('a.base-card__full-link');

        if (!id && linkEl && linkEl.href) {
          var hrefMatch = linkEl.href.match(/\\/jobs\\/view\\/(?:[^\\/]*-)?(\\d+)/);
          if (hrefMatch) id = hrefMatch[1];
        }

        if (!id || seen[id]) return;
        seen[id] = true;

        var titleEl =
          card.querySelector('.job-card-list__title--link strong') ||
          card.querySelector('.job-card-list__title') ||
          card.querySelector('.artdeco-entity-lockup__title') ||
          card.querySelector('.base-search-card__title') ||
          linkEl;

        var companyEl =
          card.querySelector('.artdeco-entity-lockup__subtitle') ||
          card.querySelector('.job-card-container__primary-description') ||
          card.querySelector('.base-search-card__subtitle');

        var locationEl =
          card.querySelector('.job-card-container__metadata-wrapper li') ||
          card.querySelector('.artdeco-entity-lockup__caption') ||
          card.querySelector('.job-search-card__location');

        var timeEl = card.querySelector('time');

        var title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
        if (!title) title = 'LinkedIn Job #' + id;
        // Clean duplicate lines in title
        title = title.split('\\n')[0].trim();

        var company = companyEl ? (companyEl.innerText || companyEl.textContent || '').trim() : 'Company';
        company = company.split('\\n')[0].trim();

        var location = locationEl ? (locationEl.innerText || locationEl.textContent || '').trim() : '';
        location = location.split('\\n')[0].trim();

        var timeText = timeEl ? (timeEl.innerText || timeEl.textContent || '').trim() : 'Recently posted';
        var cardText = (card.innerText || card.textContent || '').toLowerCase();
        var isEasyApply = cardText.indexOf('easy apply') !== -1;

        var url = 'https://www.linkedin.com/jobs/view/' + id;

        jobs.push({
          id: String(id),
          title: title,
          company: company,
          location: location,
          timeText: timeText,
          url: url,
          isEasyApply: isEasyApply
        });
      } catch (_err) {}
    });

    return jobs;
  }

  function poll() {
    if (done) return;
    attempts++;

    var href = window.location.href || '';
    if (
      href.indexOf('/login') !== -1 ||
      href.indexOf('/uas/login') !== -1 ||
      href.indexOf('/authwall') !== -1 ||
      document.querySelector('input[name="session_key"]')
    ) {
      postResults([], 'AUTH_REQUIRED');
      return;
    }

    var bodyText = (document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();
    if (
      bodyText.indexOf('no matching jobs found') !== -1 ||
      bodyText.indexOf('did not match any jobs') !== -1
    ) {
      postResults([], null);
      return;
    }

    var jobs = extractCards();
    if (jobs.length > 0) {
      // Wait 1 extra tick for any lazy-loaded cards
      if (attempts < 4) {
        setTimeout(function() {
          postResults(extractCards(), null);
        }, 900);
      } else {
        postResults(jobs, null);
      }
      return;
    }

    if (attempts < maxAttempts) {
      setTimeout(poll, 700);
    } else {
      postResults([], null);
    }
  }

  setTimeout(poll, 1200);

  // Hard safety timeout (16s)
  setTimeout(function() {
    if (!done) {
      postResults(extractCards(), null);
    }
  }, 16000);
})();
true;
`;
