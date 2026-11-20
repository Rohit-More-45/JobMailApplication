/**
 * JobMail - Form Autofill Script
 *
 * Capabilities:
 * 1. Discovers input fields on standard web forms and Google Forms.
 * 2. Exact semantic matching: separates First Name, Last Name, and Full Name/Name so they
 *    never cross-match or fill into each other.
 * 3. Never overwrites fields containing user-entered information.
 * 4. Dispatches native input/change/blur events for React, Angular, and Google Forms compatibility.
 * 5. Highlights filled fields with a subtle confirmation flash.
 * 6. Never submits forms automatically.
 */

export function buildAutofillScript(savedFields = []) {
  const fieldsJson = JSON.stringify(savedFields);

  return `
(function() {
  var savedFields = ${fieldsJson} || [];

  function normalize(str) {
    if (!str) return '';
    return str.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Tokenize text on camelCase, underscores, hyphens, and whitespace
  function getTokens(str) {
    if (!str) return [];
    return str
      .toString()
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .trim()
      .split(/\\s+/)
      .filter(function(t) { return t.length > 0; });
  }

  // Strictly classify tokens and text into semantic categories
  function classifyTokens(tokens, rawText) {
    var tSet = {};
    for (var i = 0; i < tokens.length; i++) {
      tSet[tokens[i]] = true;
    }
    var text = (rawText || '').toLowerCase();

    // 1. Explicit First Name (never matches Last Name or generic Name)
    if (
      tSet['givenname'] ||
      tSet['fname'] ||
      tSet['first'] ||
      tSet['given'] ||
      tSet['forename'] ||
      text.indexOf('first name') !== -1 ||
      text.indexOf('given name') !== -1
    ) {
      return 'firstname';
    }

    // 2. Explicit Last Name (never matches First Name or generic Name)
    if (
      tSet['familyname'] ||
      tSet['surname'] ||
      tSet['lname'] ||
      tSet['last'] ||
      (tSet['family'] && tSet['name']) ||
      text.indexOf('last name') !== -1 ||
      text.indexOf('family name') !== -1
    ) {
      return 'lastname';
    }

    // 3. Middle Name
    if (tSet['middle'] || tSet['mname'] || text.indexOf('middle name') !== -1) {
      return 'middlename';
    }

    // 4. Organization / Company / School / College
    if (
      tSet['company'] ||
      tSet['organization'] ||
      tSet['org'] ||
      tSet['employer'] ||
      tSet['school'] ||
      tSet['college'] ||
      tSet['university']
    ) {
      return 'organization';
    }

    // 5. Username / Login
    if (tSet['username'] || (tSet['user'] && tSet['name']) || tSet['login']) {
      return 'username';
    }

    // 6. Full Name / Name
    // Matches if it has 'fullname' OR ('full' and 'name') OR just 'name' (and NOT first, last, user, company)
    if (
      tSet['fullname'] ||
      (tSet['full'] && tSet['name']) ||
      (tSet['name'] && !tSet['first'] && !tSet['last'] && !tSet['company'] && !tSet['user'])
    ) {
      return 'fullname';
    }

    // 7. Email
    if (tSet['email'] || tSet['mail'] || text.indexOf('email') !== -1 || text.indexOf('e-mail') !== -1) {
      return 'email';
    }

    // 8. Phone / Mobile
    if (tSet['phone'] || tSet['mobile'] || tSet['telephone'] || tSet['tel'] || tSet['cell']) {
      return 'phone';
    }

    // 9. Current / Street Address
    if (tSet['address'] || tSet['street'] || tSet['residence']) {
      return 'address';
    }

    // 10. City
    if (tSet['city'] || tSet['town'] || tSet['district']) {
      return 'city';
    }

    // 11. State / Province
    if (tSet['state'] || tSet['province'] || tSet['region']) {
      return 'state';
    }

    // 12. Country / Nationality
    if (tSet['country'] || tSet['nationality']) {
      return 'country';
    }

    // 13. PIN Code / ZIP
    if (
      tSet['pincode'] ||
      tSet['zipcode'] ||
      (tSet['pin'] && tSet['code']) ||
      (tSet['zip'] && tSet['code']) ||
      tSet['postal'] ||
      tSet['zip']
    ) {
      return 'pincode';
    }

    // 14. LinkedIn Profile
    if (tSet['linkedin'] || (tSet['linked'] && tSet['in']) || text.indexOf('linkedin') !== -1) {
      return 'linkedin';
    }

    // 15. Portfolio / Website / GitHub
    if (tSet['portfolio'] || tSet['github'] || tSet['website'] || (tSet['personal'] && tSet['site'])) {
      return 'portfolio';
    }

    return 'other';
  }

  function getDescriptor(el) {
    var tokens = [];

    if (el.name) tokens.push(el.name);
    if (el.id) tokens.push(el.id);
    if (el.placeholder) tokens.push(el.placeholder);
    var aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || '';
    if (aria) tokens.push(aria);
    var autocomplete = el.getAttribute('autocomplete') || '';
    if (autocomplete) tokens.push(autocomplete);

    // Associated label for input id
    if (el.id) {
      try {
        var labelEl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (labelEl) tokens.push(labelEl.innerText || labelEl.textContent || '');
      } catch(e) {}
    }

    // Parent label
    var parentLabel = el.closest('label');
    if (parentLabel) tokens.push(parentLabel.innerText || parentLabel.textContent || '');

    // Google Forms question container & heading
    var gContainer = el.closest('[role="listitem"], .freebirdFormviewerViewNumberedItemContainer, .geS5n, .m2');
    if (gContainer) {
      var gHeading = gContainer.querySelector('[role="heading"], .M7eMe, .HoDaOb');
      if (gHeading) tokens.push(gHeading.innerText || gHeading.textContent || '');
    }

    // Standard form-group or field container
    var fg = el.closest('.form-group, .form-row, .field, [class*="field"], [class*="group"], tr');
    if (fg && fg !== document.body) {
      var fgLabel = fg.querySelector('label, [class*="label"], [class*="title"], dt');
      if (fgLabel && fgLabel !== el) tokens.push(fgLabel.innerText || fgLabel.textContent || '');
    }

    return tokens.join(' ').toLowerCase();
  }

  function findMatchingValue(el, descriptor, fields) {
    if (!descriptor || !fields || fields.length === 0) return null;

    var elTokens = getTokens(descriptor);
    var elCategory = classifyTokens(elTokens, descriptor);

    // Priority 1: Exact direct match on normalized name
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!f || !f.name || !f.value) continue;
      var fTokens = getTokens(f.name);
      var fCategory = classifyTokens(fTokens, f.name);

      // Strict rule: Never cross-match generic "Name" to "First Name" or "Last Name"
      if (fCategory === 'fullname' && (elCategory === 'firstname' || elCategory === 'lastname')) {
        continue;
      }
      if (fCategory === 'firstname' && elCategory !== 'firstname') {
        continue;
      }
      if (fCategory === 'lastname' && elCategory !== 'lastname') {
        continue;
      }

      var normF = normalize(f.name);
      var normElName = normalize(el.name || '');
      var normElPlaceholder = normalize(el.placeholder || '');
      var normElId = normalize(el.id || '');
      var normElAria = normalize(el.getAttribute('aria-label') || '');

      if (
        (normElName && normElName === normF) ||
        (normElPlaceholder && normElPlaceholder === normF) ||
        (normElId && normElId === normF) ||
        (normElAria && normElAria === normF)
      ) {
        return f.value;
      }
    }

    // Priority 2: Semantic Category Match with strict isolation
    // firstname ONLY matches firstname
    // lastname ONLY matches lastname
    // fullname ONLY matches fullname (never firstname or lastname)
    if (elCategory !== 'other') {
      for (var c = 0; c < fields.length; c++) {
        var sf = fields[c];
        if (!sf || !sf.name || !sf.value) continue;
        var sfTokens = getTokens(sf.name);
        var sfCategory = classifyTokens(sfTokens, sf.name);

        if (sfCategory === elCategory) {
          return sf.value;
        }
      }
    }

    // Priority 3: Custom Field multi-token exact match (for unclassified custom fields)
    if (elCategory === 'other') {
      for (var m = 0; m < fields.length; m++) {
        var cf = fields[m];
        if (!cf || !cf.name || !cf.value) continue;
        var cfTokens = getTokens(cf.name);
        var cfCategory = classifyTokens(cfTokens, cf.name);
        if (cfCategory !== 'other') continue;

        if (cfTokens.length >= 2) {
          var allIn = true;
          for (var t = 0; t < cfTokens.length; t++) {
            if (elTokens.indexOf(cfTokens[t]) === -1) {
              allIn = false;
              break;
            }
          }
          if (allIn) {
            return cf.value;
          }
        }
      }
    }

    return null;
  }

  function setInputValue(el, value) {
    if (!el || value === undefined || value === null) return false;

    // RULE: Never overwrite existing user-entered text
    if (el.value && el.value.toString().trim().length > 0) {
      return false;
    }

    try {
      if (el.tagName.toLowerCase() === 'select') {
        var valNorm = normalize(value);
        for (var o = 0; o < el.options.length; o++) {
          var opt = el.options[o];
          if (normalize(opt.text).indexOf(valNorm) !== -1 || normalize(opt.value).indexOf(valNorm) !== -1) {
            el.selectedIndex = o;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
        return false;
      }

      // Input and Textarea (React / Angular / Google Forms prototype setter)
      var proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(el, value);
      } else {
        el.value = value;
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));

      // Subtle visual confirmation highlight
      var originalOutline = el.style.outline;
      var originalTransition = el.style.transition;
      el.style.transition = 'outline 0.2s ease, box-shadow 0.2s ease';
      el.style.outline = '2px solid #10a37f';
      el.style.boxShadow = '0 0 6px rgba(16, 163, 127, 0.4)';
      setTimeout(function() {
        try {
          el.style.outline = originalOutline || '';
          el.style.boxShadow = '';
          el.style.transition = originalTransition || '';
        } catch(e) {}
      }, 1500);

      return true;
    } catch(err) {
      console.warn('[JobMail:Autofill] error filling field:', err);
      return false;
    }
  }

  function runAutofill(fieldsList) {
    var fields = fieldsList || savedFields;
    if (!fields || fields.length === 0) return 0;

    var selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select';
    var elements = document.querySelectorAll(selector);
    var filledCount = 0;

    elements.forEach(function(el) {
      if (el.offsetWidth === 0 && el.offsetHeight === 0 && !el.classList.contains('whsOnd')) {
        return; // invisible element
      }
      var desc = getDescriptor(el);
      var matchVal = findMatchingValue(el, desc, fields);
      if (matchVal) {
        var ok = setInputValue(el, matchVal);
        if (ok) filledCount++;
      }
    });

    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'AUTOFILL_RESULT',
          count: filledCount
        }));
      }
    } catch(e) {}

    return filledCount;
  }

  window.__JOBMAIL_AUTOFILL_NOW = function(customFields) {
    return runAutofill(customFields || savedFields);
  };

  // Run automatically when DOM is ready
  runAutofill(savedFields);

  // Re-run on mutation if fields are rendered dynamically
  if (!window.__JOBMAIL_AUTOFILL_OBSERVER__) {
    var timer = null;
    window.__JOBMAIL_AUTOFILL_OBSERVER__ = new MutationObserver(function() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function() {
        runAutofill(savedFields);
      }, 350);
    });
    window.__JOBMAIL_AUTOFILL_OBSERVER__.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }
})();
true;
`;
}
