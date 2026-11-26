import { parseBooleanExpression } from '../utils/booleanFilter';

/**
 * JobMail - LinkedIn Logged-In Job Search & Description Extractor
 *
 * Runs inside a WebView sharing cookies with the user's logged-in LinkedIn tab.
 * 1. Extracts job cards from https://www.linkedin.com/jobs/search/...
 * 2. If a Boolean description condition AST is provided, fetches each job's description
 *    using the logged-in session and evaluates the group condition (AND / OR / NOT / parentheses).
 * No AI used.
 */

export function buildSearchExtractionScript(descriptionCondition = '') {
  const parsed = parseBooleanExpression(descriptionCondition || '');
  const astJson = JSON.stringify(parsed.valid ? parsed.ast : null);

  return `
(function() {
  if (window.__jobmailSearchExtracting) return;
  window.__jobmailSearchExtracting = true;

  var conditionAst = ${astJson};
  var done = false;
  var attempts = 0;
  var maxAttempts = 20;

  function escapeRegExp(str) {
    return str.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  }

  function matchTerm(text, term) {
    if (!term) return true;
    var hay = (text || '').toLowerCase();
    var t = term.trim().toLowerCase();
    if (!t) return true;
    if (t.charAt(0) === '.') {
      var dotRe = new RegExp(escapeRegExp(t) + '(?=$|[^a-z0-9])', 'i');
      return dotRe.test(hay);
    }
    var re = new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(t) + '(?=$|[^a-z0-9])', 'i');
    return re.test(hay);
  }

  function evaluateAst(ast, text) {
    if (!ast) return true;
    if (ast.type === 'TERM') return matchTerm(text, ast.value);
    if (ast.type === 'NOT') return !evaluateAst(ast.operand, text);
    if (ast.type === 'AND') return evaluateAst(ast.left, text) && evaluateAst(ast.right, text);
    if (ast.type === 'OR') return evaluateAst(ast.left, text) || evaluateAst(ast.right, text);
    return true;
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

  function filterJobsByCondition(jobs) {
    if (!conditionAst || !jobs.length) {
      postResults(jobs, null);
      return;
    }

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
            if (evaluateAst(conditionAst, combinedText)) {
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
          filterJobsByCondition(extractCards());
        }, 900);
      } else {
        filterJobsByCondition(jobs);
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

  setTimeout(function() {
    if (!done) {
      postResults([], 'SEARCH_TIMEOUT');
    }
  }, 28000);
})();
true;
`;
}
