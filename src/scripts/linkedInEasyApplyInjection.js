/**
 * JobMail - LinkedIn Easy Apply Automation Script (Self-Learning)
 *
 * Runs inside a logged-in LinkedIn WebView for a single job URL.
 * 1. Matches Easy Apply text inputs, textareas, <select> dropdowns, and radio groups
 *    against the user's saved Ready Answers & previously answered questions.
 * 2. If any required/empty question has no matching saved answer, collects the exact
 *    question (+ options if select/radio) and posts status: 'QUARANTINE' with unknownQuestions
 *    so the app saves them to Autofill for the user to answer later, and quarantines the job.
 * 3. Never uses AI.
 */

export function buildEasyApplyScript(savedFields = []) {
  const answeredFields = (Array.isArray(savedFields) ? savedFields : []).filter(
    (f) => f && f.name && f.value && f.value.toString().trim().length > 0
  );
  const fieldsJson = JSON.stringify(answeredFields);

  return `
(function() {
  if (window.__jobmailEasyApplyRunning) return;
  window.__jobmailEasyApplyRunning = true;

  var savedFields = ${fieldsJson} || [];
  var finished = false;
  var stepCount = 0;
  var maxSteps = 12;

  function postResult(status, reason, unknownQuestions) {
    if (finished) return;
    finished = true;
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'EASY_APPLY_RESULT',
          status: status,
          reason: reason || '',
          unknownQuestions: unknownQuestions || []
        }));
      }
    } catch (_e) {}
  }

  function normalize(str) {
    return (str || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function getTokens(str) {
    return (str || '')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(function(t) { return t.length > 1; });
  }

  function cleanLabel(str) {
    return (str || '')
      .replace(/\\*/g, '')
      .replace(/required/gi, '')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  // Match a question label against user's saved Q&A + Ready Answers
  function findAnswerForQuestion(questionLabel) {
    if (!questionLabel) return null;
    var normQ = normalize(questionLabel);
    if (!normQ) return null;

    // 1. Exact normalized match against saved questions
    for (var i = 0; i < savedFields.length; i++) {
      var f = savedFields[i];
      if (normalize(f.name) === normQ) {
        return f.value;
      }
    }

    // 2. High token-overlap match for saved custom questions (>= 75% of saved question words match)
    var qTokens = getTokens(questionLabel);
    for (var j = 0; j < savedFields.length; j++) {
      var sf = savedFields[j];
      var sfTokens = getTokens(sf.name);
      if (sfTokens.length >= 3) {
        var hits = 0;
        for (var k = 0; k < sfTokens.length; k++) {
          if (qTokens.indexOf(sfTokens[k]) !== -1) hits++;
        }
        if (hits / sfTokens.length >= 0.75) {
          return sf.value;
        }
      }
    }

    // 3. Semantic matching against standard Ready Answers
    var lower = questionLabel.toLowerCase();
    var semanticRules = [
      { test: ['phone', 'mobile', 'contact number'], keys: ['phone', 'mobile'], transform: function(v) { return v.replace(/[^0-9+]/g, ''); } },
      { test: ['email', 'e-mail'], keys: ['email'] },
      { test: ['city', 'location', 'reside', 'address'], keys: ['location', 'city'] },
      { test: ['notice period', 'how soon', 'days notice'], keys: ['notice'], transform: function(v) { var m = v.match(/\\d+/); return m ? m[0] : v; } },
      { test: ['expected salary', 'expected ctc', 'compensation', 'desired salary'], keys: ['salary', 'ctc'] },
      { test: ['authorized to work', 'work authorization', 'legally authorized'], keys: ['authorization', 'work authorization'] },
      { test: ['relocate', 'relocation'], keys: ['relocate', 'relocation'] },
      { test: ['cgpa', 'gpa'], keys: ['cgpa', 'gpa'] },
      { test: ['university', 'college', 'school', 'institute'], keys: ['college', 'university'] },
      { test: ['degree', 'education', 'qualification'], keys: ['education', 'degree'] },
      { test: ['current company', 'employer'], keys: ['company'] },
      { test: ['job title', 'designation', 'current role'], keys: ['job title', 'title'] },
      { test: ['linkedin'], keys: ['linkedin'] },
      { test: ['summary', 'cover letter', 'about yourself'], keys: ['summary'] }
    ];

    for (var r = 0; r < semanticRules.length; r++) {
      var rule = semanticRules[r];
      var matchedRule = false;
      for (var t = 0; t < rule.test.length; t++) {
        if (lower.indexOf(rule.test[t]) !== -1) {
          matchedRule = true;
          break;
        }
      }
      if (matchedRule) {
        for (var s = 0; s < savedFields.length; s++) {
          var fieldLower = savedFields[s].name.toLowerCase();
          for (var fk = 0; fk < rule.keys.length; fk++) {
            if (fieldLower.indexOf(rule.keys[fk]) !== -1) {
              var val = savedFields[s].value;
              return rule.transform ? rule.transform(val) : val;
            }
          }
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

  function getElementQuestionLabel(el, modal) {
    var text = '';
    if (el.id) {
      try {
        var lbl = modal.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lbl) text = lbl.innerText || lbl.textContent || '';
      } catch (_e) {}
    }
    if (!text) {
      var container = el.closest('.fb-dash-form-element, .artdeco-text-input--container, .jobs-easy-apply-form-element');
      if (container) {
        var pLbl = container.querySelector('label, span[data-test-form-element-label]');
        if (pLbl) text = pLbl.innerText || pLbl.textContent || '';
      }
    }
    if (!text) {
      text = el.getAttribute('aria-label') || el.placeholder || el.name || '';
    }
    return cleanLabel(text);
  }

  function processModalQuestions() {
    var modal = document.querySelector('.jobs-easy-apply-modal, [role="dialog"]');
    if (!modal) return [];

    var unknownQuestions = [];
    var seenUnknown = {};

    function recordUnknown(name, fieldType, options) {
      var clean = cleanLabel(name);
      if (!clean || clean.length < 3) return;
      var key = normalize(clean);
      if (seenUnknown[key]) return;
      seenUnknown[key] = true;
      unknownQuestions.push({
        name: clean,
        fieldType: fieldType,
        options: options || []
      });
    }

    // 1. Text inputs & textareas
    var textInputs = modal.querySelectorAll(
      'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea'
    );
    textInputs.forEach(function(el) {
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
      if (el.value && el.value.toString().trim().length > 0) return;

      var qLabel = getElementQuestionLabel(el, modal);
      var answer = findAnswerForQuestion(qLabel);
      if (answer) {
        setNativeValue(el, answer);
      } else if (qLabel) {
        recordUnknown(qLabel, 'text', []);
      }
    });

    // 2. <select> dropdowns
    var selects = modal.querySelectorAll('select');
    selects.forEach(function(sel) {
      if (sel.offsetWidth === 0 && sel.offsetHeight === 0) return;
      var currentOpt = sel.options[sel.selectedIndex];
      var currentText = currentOpt ? (currentOpt.text || '').trim().toLowerCase() : '';
      var isPlaceholder =
        !sel.value ||
        currentText === '' ||
        currentText.indexOf('select an option') !== -1 ||
        currentText.indexOf('choose') === 0;

      if (!isPlaceholder) return;

      var qLabel = getElementQuestionLabel(sel, modal);
      var optionTexts = [];
      for (var o = 0; o < sel.options.length; o++) {
        var optTxt = (sel.options[o].text || '').trim();
        if (optTxt && optTxt.toLowerCase().indexOf('select an option') === -1) {
          optionTexts.push(optTxt);
        }
      }

      var answer = findAnswerForQuestion(qLabel);
      var matchedOption = false;
      if (answer) {
        var normAns = normalize(answer);
        for (var idx = 0; idx < sel.options.length; idx++) {
          var opt = sel.options[idx];
          var optNorm = normalize(opt.text);
          if (optNorm && (optNorm === normAns || optNorm.indexOf(normAns) !== -1 || normAns.indexOf(optNorm) !== -1)) {
            sel.selectedIndex = idx;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            matchedOption = true;
            break;
          }
        }
      }

      if (!matchedOption && qLabel) {
        recordUnknown(qLabel, 'select', optionTexts.slice(0, 8));
      }
    });

    // 3. Radio button groups (fieldset)
    var fieldsets = modal.querySelectorAll('fieldset');
    fieldsets.forEach(function(fs) {
      var radios = fs.querySelectorAll('input[type="radio"]');
      if (!radios || radios.length === 0) return;

      var alreadyChecked = false;
      for (var r = 0; r < radios.length; r++) {
        if (radios[r].checked) {
          alreadyChecked = true;
          break;
        }
      }
      if (alreadyChecked) return;

      var legendEl = fs.querySelector('legend, span[data-test-form-element-label], .fb-dash-form-element__label');
      var qLabel = cleanLabel(legendEl ? (legendEl.innerText || legendEl.textContent || '') : '');

      var radioLabels = [];
      var radioPairs = [];
      radios.forEach(function(rad) {
        var lblText = '';
        if (rad.id) {
          try {
            var rLbl = fs.querySelector('label[for="' + CSS.escape(rad.id) + '"]');
            if (rLbl) lblText = (rLbl.innerText || rLbl.textContent || '').trim();
          } catch (_e) {}
        }
        if (!lblText) {
          var parentLbl = rad.closest('label');
          if (parentLbl) lblText = (parentLbl.innerText || parentLbl.textContent || '').trim();
        }
        if (!lblText) lblText = rad.value || '';
        if (lblText) {
          radioLabels.push(lblText);
          radioPairs.push({ radio: rad, label: lblText });
        }
      });

      var answer = findAnswerForQuestion(qLabel);
      var matchedRadio = false;
      if (answer) {
        var ansLower = answer.toLowerCase();
        for (var p = 0; p < radioPairs.length; p++) {
          var lblLow = radioPairs[p].label.toLowerCase();
          if (
            lblLow === ansLower ||
            (ansLower.indexOf('yes') === 0 && lblLow === 'yes') ||
            (ansLower.indexOf('no') === 0 && lblLow === 'no') ||
            ansLower.indexOf(lblLow) !== -1
          ) {
            radioPairs[p].radio.click();
            radioPairs[p].radio.dispatchEvent(new Event('change', { bubbles: true }));
            matchedRadio = true;
            break;
          }
        }
      }

      if (!matchedRadio && qLabel) {
        recordUnknown(qLabel, 'radio', radioLabels);
      }
    });

    return unknownQuestions;
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

    if (hasConfirmationMessage()) {
      postResult('APPLIED', 'Application submitted', []);
      return;
    }

    if (
      window.location.href.indexOf('/login') !== -1 ||
      window.location.href.indexOf('/checkpoint') !== -1 ||
      document.querySelector('input[name="session_key"]')
    ) {
      postResult('NEEDS_MANUAL', 'Please sign in to LinkedIn in the LinkedIn tab', []);
      return;
    }

    var modal = document.querySelector('.jobs-easy-apply-modal, [role="dialog"]');
    if (modal) {
      var unknownQuestions = processModalQuestions();
      if (unknownQuestions.length > 0) {
        postResult(
          'QUARANTINE',
          'Saved ' + unknownQuestions.length + ' new question(s) to Autofill',
          unknownQuestions
        );
        return;
      }

      var submitBtn = findButtonByText(modal, ['submit application']);
      if (submitBtn) {
        submitBtn.click();
        setTimeout(function() {
          if (hasConfirmationMessage()) {
            postResult('APPLIED', 'Easy Apply submitted', []);
          } else {
            postResult('QUARANTINE', 'Could not confirm Easy Apply submission', []);
          }
        }, 2500);
        return;
      }

      var nextBtn = findButtonByText(modal, ['review', 'next', 'continue to next step']);
      if (nextBtn) {
        nextBtn.click();
        if (stepCount < maxSteps) {
          setTimeout(tick, 1800);
        } else {
          postResult('QUARANTINE', 'Additional steps required — apply manually', []);
        }
        return;
      }

      postResult('QUARANTINE', 'Manual step required in Easy Apply modal', []);
      return;
    }

    var easyApplyBtn = findButtonByText(document, ['easy apply']);
    if (easyApplyBtn) {
      easyApplyBtn.click();
      setTimeout(tick, 1800);
      return;
    }

    var externalApplyBtn = findButtonByText(document, ['apply now', 'apply on company', 'apply']);
    if (externalApplyBtn && stepCount >= 2) {
      postResult('NOT_EASY_APPLY', 'External application required', []);
      return;
    }

    if (stepCount < 6) {
      setTimeout(tick, 1500);
    } else {
      postResult('NOT_EASY_APPLY', 'Easy Apply button not found', []);
    }
  }

  setTimeout(tick, 2200);

  setTimeout(function() {
    if (!finished) {
      postResult('QUARANTINE', 'Easy Apply timed out — apply manually', []);
    }
  }, 25000);
})();
true;
`;
}
