import { parseBooleanExpression } from '../utils/booleanFilter';

/**
 * JobMail - LinkedIn Logged-In Job Search & Description Extractor
 *
 * Runs inside a WebView sharing cookies with the user's logged-in LinkedIn tab.
 * 1. Extracts job cards from https://www.linkedin.com/jobs/search/...
 * 2. Fetches each job's description using the logged-in session when either:
 *    - a Boolean description condition AST is provided, OR
 *    - maxExperienceYears > 0 (verifies job description allows <= maxExperienceYears, e.g. 3 years).
 * No AI used.
 */

export function buildSearchExtractionScript(descriptionCondition = '', maxExperienceYears = 3) {
  const parsed = parseBooleanExpression(descriptionCondition || '');
  const astJson = JSON.stringify(parsed.valid ? parsed.ast : null);
  const maxExp = Number(maxExperienceYears) > 0 ? Number(maxExperienceYears) : 0;

  return `
(function() {
  if (window.__jobmailSearchExtracting) return;
  window.__jobmailSearchExtracting = true;

  var conditionAst = ${astJson};
  var maxExperienceYears = ${maxExp};
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

  /**
   * Checks if the job description allows <= maxYears of experience.
   * Returns 'allow', 'quarantine', or 'reject'.
   *
   * Patterns handled (case-insensitive):
   *   "Experience: 6–9 Years"           -> min=6
   *   "Experience: 6-9 Years"           -> min=6
   *   "Experience: 2 to 5 Years"        -> min=2
   *   "Experience: 8+ years"            -> min=8
   *   "Exp: 5 to 10 Years"              -> min=5
   *   "Experince Range - 5 plus Years"  -> min=5
   *   "0–3 years experience"            -> min=0, max=3
   *   "1–3 Years"                       -> min=1, max=3
   *   "4 years of experience"           -> single=4
   *   "minimum 5 years"                 -> min=5
   *   "5+ years"                        -> min=5
   *
   * Logic:
   *   - If min > maxYears -> 'reject'
   *   - If range straddles (min <= maxYears AND max > maxYears+1) -> 'quarantine'
   *   - Else -> 'allow'
   *   - No experience info found -> 'allow'
   */
  function allowsExperience(text, maxYears) {
    if (!maxYears || maxYears <= 0 || !text) return 'allow';
    var hay = text.toLowerCase();

    var result = 'allow';

    // Helper: extract number from string
    function toNum(s) { return s ? parseInt(s, 10) : NaN; }

    // Pattern A: "X+ years", "X plus years", "X or more years"
    // e.g. "8+ years", "5 plus years", "3 or more years"
    var reA = /(\\d{1,2})\\s*(?:\\+|plus|or\\s+more)\\s*(?:years?|yrs?)/gi;
    var m;
    while ((m = reA.exec(hay)) !== null) {
      var n = toNum(m[1]);
      if (!isNaN(n) && n >= 0 && n <= 40) {
        if (n > maxYears) return 'reject';
      }
    }

    // Pattern B: "X to Y years" or "X–Y years" (em-dash, en-dash, or hyphen)
    // e.g. "2 to 5 Years", "6–9 Years", "1-3 Years"
    // Note: hyphen used as range separator between digits (not "X-year" compound)
    var reB = /(\\d{1,2})\\s*(?:to|\\u2013|\\u2014|-)\\s*(\\d{1,2})\\s*(?:years?|yrs?)/gi;
    while ((m = reB.exec(hay)) !== null) {
      var lo = toNum(m[1]);
      var hi = toNum(m[2]);
      if (!isNaN(lo) && !isNaN(hi) && lo >= 0 && hi <= 40 && lo <= hi) {
        if (lo > maxYears) return 'reject';
        // Allow ranges up to maxYears+2 (e.g. 3 to 5 years when maxYears=3);
        // wider straddling ranges (e.g. 2 to 7) go to quarantine so we don't lose them
        if (hi > maxYears + 2 && result === 'allow') result = 'quarantine';
      }
    }

    // Pattern C: "experience: X" or "exp: X" or "experience of X years"
    // "Experience: 6–9" already caught by B; this catches "experience: 4 years"
    // Also catches "Experince Range - 5 plus Years" and "Exp - 5 plus"
    var reC = /(?:experience|exp(?:erience|rince)?)\\s*(?:range)?\\s*[:\\u2013\\-]?\\s*(\\d{1,2})\\s*(?:years?|yrs?)/gi;
    while ((m = reC.exec(hay)) !== null) {
      var n2 = toNum(m[1]);
      if (!isNaN(n2) && n2 >= 0 && n2 <= 40) {
        if (n2 > maxYears) return 'reject';
      }
    }

    // Pattern D: "minimum X years", "min X years", "at least X years"
    var reD = /(?:minimum|min\\.?|at\\s+least)\\s+(\\d{1,2})\\s*(?:years?|yrs?)/gi;
    while ((m = reD.exec(hay)) !== null) {
      var n3 = toNum(m[1]);
      if (!isNaN(n3) && n3 >= 0 && n3 <= 40) {
        if (n3 > maxYears) return 'reject';
      }
    }

    // Pattern E: "X years of experience" (single value, no range)
    // Only match if it's NOT already a range (the range pattern B would have caught "X-Y years")
    var reE = /(\\d{1,2})\\s*(?:years?|yrs?)\\s+(?:of\\s+)?(?:relevant\\s+|work\\s+|hands.on\\s+|professional\\s+|industry\\s+|total\\s+)?experience/gi;
    while ((m = reE.exec(hay)) !== null) {
      var n4 = toNum(m[1]);
      if (!isNaN(n4) && n4 >= 0 && n4 <= 40) {
        if (n4 > maxYears) return 'reject';
      }
    }

    return result;
  }

  function postResults(jobs, quarantineJobs, error) {
    if (done) return;
    done = true;
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'JOB_SEARCH_RESULTS',
          jobs: jobs || [],
          quarantineJobs: quarantineJobs || [],
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

  function filterJobsByDescription(jobs) {
    if ((!conditionAst && !maxExperienceYears) || !jobs.length) {
      postResults(jobs, [], null);
      return;
    }

    var candidates = jobs.slice(0, 10);
    var matched = [];
    var quarantined = [];
    var idx = 0;

    function nextBatch() {
      if (done) return;
      if (idx >= candidates.length) {
        postResults(matched, quarantined, null);
        return;
      }

      var batch = candidates.slice(idx, idx + 3);
      idx += 3;

      Promise.all(
        batch.map(function(job) {
          return fetchDescriptionForJob(job).then(function(detail) {
            var combinedText = job.title + ' ' + job.company + ' ' + detail.text;
            var passesCondition = !conditionAst || evaluateAst(conditionAst, combinedText);
            if (!passesCondition) return; // description condition filter: drop it

            var expResult = maxExperienceYears ? allowsExperience(combinedText, maxExperienceYears) : 'allow';
            job.isEasyApply = detail.isEasyApply;

            if (expResult === 'reject') {
              // Too much experience required: silently drop
            } else if (expResult === 'quarantine') {
              // Unclear range: keep for manual review
              job.quarantineReason = 'Experience range unclear — apply manually';
              quarantined.push(job);
            } else {
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
      postResults([], [], 'AUTH_REQUIRED');
      return;
    }

    var bodyText = (document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();
    if (
      bodyText.indexOf('no matching jobs found') !== -1 ||
      bodyText.indexOf('did not match any jobs') !== -1
    ) {
      postResults([], [], null);
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
      postResults([], [], null);
    }
  }

  setTimeout(poll, 1400);

  setTimeout(function() {
    if (!done) {
      postResults([], [], 'SEARCH_TIMEOUT');
    }
  }, 28000);
})();
true;
`;
}
