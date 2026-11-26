/**
 * JobMail - LinkedIn Easy Apply Automation Script
 *
 * Runs inside a logged-in LinkedIn WebView for a single job URL.
 * Uses user's saved Ready Answers (phone, email, location, etc.) to step through
 * Easy Apply -> Next -> Review -> Submit Application without AI.
 * Posts back:
 * - { type: 'EASY_APPLY_RESULT', status: 'APPLIED' }
 * - { type: 'EASY_APPLY_RESULT', status: 'NOT_EASY_APPLY', reason: string }
 * - { type: 'EASY_APPLY_RESULT', status: 'NEEDS_MANUAL', reason: string }
 */

export function buildEasyApplyScript(savedFields = []) {
  const fieldsJson = JSON.stringify(savedFields);

  return `
(function() {
  if (window.__jobmailEasyApplyRunning) return;
  window.__jobmailEasyApplyRunning = true;

  var savedFields = ${fieldsJson} || [];
  var finished = false;
  var stepCount = 0;
  var maxSteps = 12;

  function postResult(status, reason) {
    if (finished) return;
    finished = true;
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'EASY_APPLY_RESULT',
          status: status,
          reason: reason || ''
        }));
      }
    } catch (_e) {}
  }

  function findSavedValue(keywords) {
    for (var i = 0; i < savedFields.length; i++) {
      var f = savedFields[i];
      if (!f || !f.name || !f.value) continue;
      var n = f.name.toLowerCase();
      for (var k = 0; k < keywords.length; k++) {
        if (n.indexOf(keywords[k]) !== -1) {
          return f.value;
        }
      }
    }
    return null;
  }

  function setNativeValue(el, val) {
    try {
      var proto = el.tagName.toLowerCase() === 'textarea'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) {
        desc.set.call(el, val);
      } else {
        el.value = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (_e) {}
  }

  function fillModalFields() {
    var modal = document.querySelector('.jobs-easy-apply-modal, [role="dialog"]');
    if (!modal) return;

    var inputs = modal.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea');
    inputs.forEach(function(el) {
      if (el.value && el.value.toString().trim().length > 0) return;

      var labelText = '';
      if (el.id) {
        var lbl = modal.querySelector('label[for="' + el.id + '"]');
        if (lbl) labelText += ' ' + (lbl.innerText || '');
      }
      var parentGroup = el.closest('.fb-dash-form-element, .artdeco-text-input--container, div');
      if (parentGroup) {
        var pLbl = parentGroup.querySelector('label');
        if (pLbl) labelText += ' ' + (pLbl.innerText || '');
      }
      labelText = (labelText + ' ' + (el.name || '') + ' ' + (el.placeholder || '')).toLowerCase();

      var val = null;
      if (labelText.indexOf('phone') !== -1 || labelText.indexOf('mobile') !== -1) {
        val = findSavedValue(['phone', 'mobile']);
        if (val) val = val.replace(/[^0-9+]/g, '');
      } else if (labelText.indexOf('email') !== -1) {
        val = findSavedValue(['email']);
      } else if (labelText.indexOf('city') !== -1 || labelText.indexOf('location') !== -1) {
        val = findSavedValue(['location', 'city']);
      } else if (labelText.indexOf('experience') !== -1 || labelText.indexOf('years') !== -1) {
        val = '2';
      } else if (labelText.indexOf('notice') !== -1) {
        val = '15';
      } else if (labelText.indexOf('salary') !== -1 || labelText.indexOf('ctc') !== -1) {
        val = findSavedValue(['salary', 'ctc']);
      }

      if (val) {
        setNativeValue(el, val);
      }
    });
  }

  function hasConfirmationMessage() {
    var bodyText = (document.body && document.body.innerText ? document.body.innerText : '').toLowerCase();
    return (
      bodyText.indexOf('application sent') !== -1 ||
      bodyText.indexOf('your application was sent') !== -1 ||
      bodyText.indexOf('already applied') !== -1 ||
      bodyText.indexOf('applied on ') !== -1
    );
  }

  function findButtonByText(container, patterns) {
    var root = container || document;
    var btns = root.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.disabled) continue;
      var txt = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
      for (var p = 0; p < patterns.length; p++) {
        if (txt.indexOf(patterns[p]) !== -1) {
          return b;
        }
      }
    }
    return null;
  }

  function tick() {
    if (finished) return;
    stepCount++;

    // 1. Check if already applied or application just sent
    if (hasConfirmationMessage()) {
      postResult('APPLIED', 'Application submitted');
      return;
    }

    // 2. Check for login wall
    if (
      window.location.href.indexOf('/login') !== -1 ||
      window.location.href.indexOf('/checkpoint') !== -1 ||
      document.querySelector('input[name="session_key"]')
    ) {
      postResult('NEEDS_MANUAL', 'Please sign in to LinkedIn in the LinkedIn tab');
      return;
    }

    // 3. Check if Easy Apply modal is currently open
    var modal = document.querySelector('.jobs-easy-apply-modal, [role="dialog"]');
    if (modal) {
      fillModalFields();

      // Check for Submit application button
      var submitBtn = findButtonByText(modal, ['submit application']);
      if (submitBtn) {
        submitBtn.click();
        setTimeout(function() {
          if (hasConfirmationMessage()) {
            postResult('APPLIED', 'Easy Apply submitted');
          } else {
            postResult('NEEDS_MANUAL', 'Could not confirm submission');
          }
        }, 2500);
        return;
      }

      // Check for Review or Next button
      var nextBtn = findButtonByText(modal, ['review', 'next', 'continue to next step']);
      if (nextBtn) {
        // Check if there are validation errors after clicking
        nextBtn.click();
        if (stepCount < maxSteps) {
          setTimeout(tick, 1800);
        } else {
          postResult('NEEDS_MANUAL', 'Additional screening questions required');
        }
        return;
      }

      postResult('NEEDS_MANUAL', 'Manual input required in Easy Apply modal');
      return;
    }

    // 4. Not in modal yet: Look for Easy Apply button on job page
    var easyApplyBtn = findButtonByText(document, ['easy apply']);
    if (easyApplyBtn) {
      easyApplyBtn.click();
      setTimeout(tick, 1800);
      return;
    }

    // 5. Check if external Apply button exists (non-Easy Apply)
    var externalApplyBtn = findButtonByText(document, ['apply now', 'apply on company', 'apply']);
    if (externalApplyBtn && stepCount >= 2) {
      postResult('NOT_EASY_APPLY', 'External application required');
      return;
    }

    if (stepCount < 6) {
      setTimeout(tick, 1500);
    } else {
      postResult('NOT_EASY_APPLY', 'Easy Apply button not found');
    }
  }

  // Wait briefly for SPA hydration before starting
  setTimeout(tick, 2200);

  // Hard safety timeout (25s)
  setTimeout(function() {
    if (!finished) {
      postResult('NEEDS_MANUAL', 'Auto-apply timed out');
    }
  }, 25000);
})();
true;
`;
}
