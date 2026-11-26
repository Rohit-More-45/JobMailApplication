/**
 * JobMail - LinkedIn Logged-In Job Search & Description Extractor
 *
 * Runs inside a WebView sharing cookies with the user's logged-in LinkedIn tab.
 * 1. Extracts job cards from https://www.linkedin.com/jobs/search/...
 * 2. Fetches each job's full description using the logged-in session (same-origin fetch).
 * 3. Filters jobs so ONLY jobs whose title or description contains the required terms
 *    (e.g. ".net", "dotnet") are returned.
 * No AI used.
 */

export function buildSearchExtractionScript(mustContainStr = '') {
  const mustJson = JSON.stringify(mustContainStr || '');

  return `
(function() {
  if (window.__jobmailSearchExtracting) return;
  window.__jobmailSearchExtracting = true;

  var mustContainRaw = ${mustJson};
  var done = false;
  var attempts = 0;
  var maxAttempts = 20;

  function parseTerms(raw) {
    if (!raw || typeof raw !== 'string') return [];
    return raw
      .split(',')
      .map(function(s) { return s.trim().toLowerCase(); })
      .filter(function(s) { return s.length > 0; });
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  }

  function matchesTerms(text, terms) {
    if (!terms || terms.length === 0) return true;
    var hay = (text || '').toLowerCase();
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i];
      if (term.charAt(0) === '.') {
        // Dot-prefixed terms like ".net": match "asp.net", "vb.net", ".net", ".net/angular", but not ".network"
        var dotRe = new RegExp(escapeRegExp(term) + '(?=$|[^a-z0-9])', 'i');
        if (dotRe.test(hay)) {
          return true;
        }
      } else {
        var re = new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(term) + '(?=$|[^a-z0-9])', 'i');
        if (re.test(hay)) {
          return true;
        }
        if (term.length >= 4 && hay.indexOf(term) !== -1) {
          return true;
        }
      }
    }
    return false;
  }

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

    var cardSelectors = [
      'li[data-occludable-job-id]',
      '.job-card-container',
      '.jobs-search-results__list-item',
      '.scaffold-layout__list-item',
      '.base-search-card',
      'div[data-job-id]'
    ];
    var nodes = document.querySelectorAll(cardSelectors.join(', '));

    function tryAddCard(card, linkOverride) {
      try {
        var id =
          (card && (card.getAttribute('data-occludable-job-id') || card.getAttribute('data-job-id'))) ||
          '';

        if (!id && card) {
          var urn = card.getAttribute('data-entity-urn') || '';
          var urnMatch = urn.match(/jobPosting:(\\d+)/);
          if (urnMatch) id = urnMatch[1];
        }

        var linkEl =
          linkOverride ||
          (card && (
            card.querySelector('a[href*="/jobs/view/"]') ||
            card.querySelector('a.job-card-list__title--link') ||
            card.querySelector('a.job-card-container__link') ||
            card.querySelector('a.base-card__full-link')
          ));

        if (!id && linkEl && linkEl.href) {
          var hrefMatch = linkEl.href.match(/\\/jobs\\/view\\/(?:[^\\/]*-)?(\\d+)/);
          if (hrefMatch) id = hrefMatch[1];
        }

        if (!id || seen[id]) return;
        seen[id] = true;

        var titleEl = card && (
          card.querySelector('.job-card-list__title--link strong') ||
          card.querySelector('.job-card-list__title') ||
          card.querySelector('.artdeco-entity-lockup__title') ||
          card.querySelector('.base-search-card__title') ||
          linkEl
        );
        if (!titleEl && linkEl) titleEl = linkEl;

        var companyEl = card && (
          card.querySelector('.artdeco-entity-lockup__subtitle') ||
          card.querySelector('.job-card-container__primary-description') ||
          card.querySelector('.base-search-card__subtitle')
        );

        var locationEl = card && (
          card.querySelector('.job-card-container__metadata-wrapper li') ||
          card.querySelector('.artdeco-entity-lockup__caption') ||
          card.querySelector('.job-search-card__location')
        );

        var timeEl = card && card.querySelector('time');

        var title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
        title = title.split('\\n')[0].trim() || ('LinkedIn Job #' + id);

        var company = companyEl ? (companyEl.innerText || companyEl.textContent || '').trim() : 'Company';
        company = company.split('\\n')[0].trim();

        var location = locationEl ? (locationEl.innerText || locationEl.textContent || '').trim() : '';
        location = location.split('\\n')[0].trim();

        var timeText = timeEl ? (timeEl.innerText || timeEl.textContent || '').trim() : 'Recently posted';
        var cardText = (card ? (card.innerText || card.textContent || '') : '').toLowerCase();
        var isEasyApply = cardText.indexOf('easy apply') !== -1;

        jobs.push({
          id: String(id),
          title: title,
          company: company,
          location: location,
          timeText: timeText,
          url: 'https://www.linkedin.com/jobs/view/' + id,
          isEasyApply: isEasyApply
        });
      } catch (_err) {}
    }

    nodes.forEach(function(card) {
      tryAddCard(card, null);
    });

    // Mobile/SPA fallback: scan all /jobs/view/ links directly if card selectors didn't catch them
    if (jobs.length === 0) {
      var links = document.querySelectorAll('a[href*="/jobs/view/"]');
      links.forEach(function(a) {
        var container = a.closest('li') || a.closest('div') || a;
        tryAddCard(container, a);
      });
    }

    return jobs;
  }

  function stripHtmlToText(html) {
    if (!html) return '';
    return html
      .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
      .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  function fetchDescriptionForJob(job) {
    // Use logged-in same-origin fetch first, fallback to guest jobPosting endpoint
    return fetch('https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/' + job.id, {
      credentials: 'include'
    })
      .then(function(r) {
        if (!r.ok) {
          return fetch('https://www.linkedin.com/jobs/view/' + job.id + '/', { credentials: 'include' });
        }
        return r;
      })
      .then(function(r) {
        return r && r.ok ? r.text() : '';
      })
      .then(function(html) {
        var text = stripHtmlToText(html);
        var hasEasyInDetail = /easy apply/i.test(text);
        return {
          text: text,
          isEasyApply: job.isEasyApply || hasEasyInDetail
        };
      })
      .catch(function() {
        return { text: '', isEasyApply: job.isEasyApply };
      });
  }

  function filterJobsByDescription(jobs) {
    var terms = parseTerms(mustContainRaw);
    if (!terms.length || !jobs.length) {
      postResults(jobs, null);
      return;
    }

    // Check top 15 jobs in small batches of 5 so it stays fast and avoids rate limits
    var candidates = jobs.slice(0, 15);
    var matched = [];
    var idx = 0;

    function nextBatch() {
      if (done) return;
      if (idx >= candidates.length) {
        postResults(matched, null);
        return;
      }

      var batch = candidates.slice(idx, idx + 5);
      idx += 5;

      Promise.all(
        batch.map(function(job) {
          return fetchDescriptionForJob(job).then(function(detail) {
            var combinedText = job.title + ' ' + job.company + ' ' + detail.text;
            if (matchesTerms(combinedText, terms)) {
              job.isEasyApply = detail.isEasyApply;
              matched.push(job);
            }
          });
        })
      ).then(nextBatch);
    }

    nextBatch();
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

    // Scroll list container slightly to trigger lazy rendering of job cards
    try {
      var listEl = document.querySelector('.jobs-search-results-list, main, body');
      if (listEl && listEl.scrollTop !== undefined) {
        listEl.scrollTop = Math.min(400, attempts * 100);
      }
    } catch (_s) {}

    var jobs = extractCards();
    if (jobs.length > 0) {
      if (attempts < 4) {
        setTimeout(function() {
          filterJobsByDescription(extractCards());
        }, 900);
      } else {
        filterJobsByDescription(jobs);
      }
      return;
    }

    if (attempts < maxAttempts) {
      setTimeout(poll, 750);
    } else {
      postResults([], null);
    }
  }

  setTimeout(poll, 1400);

  // Hard safety timeout (28s)
  setTimeout(function() {
    if (!done) {
      postResults([], 'SEARCH_TIMEOUT');
    }
  }, 28000);
})();
true;
`;
}
