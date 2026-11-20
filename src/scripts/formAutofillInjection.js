/**
 * JobMail - Form Autofill Script
 *
 * Capabilities:
 * 1. Discovers input fields on standard web forms and Google Forms.
 * 2. Intelligently matches form fields against user-saved fields using labels, placeholders,
 *    accessible names, ids, and semantic categories.
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

  var ALIAS_MAP = {
    fullname: ['full name', 'fullname', 'your name', 'applicant name', 'candidate name', 'complete name', 'name'],
    firstname: ['first name', 'firstname', 'given name', 'fname'],
    lastname: ['last name', 'lastname', 'surname', 'family name', 'lname'],
    email: ['email', 'email address', 'e-mail', 'mail address', 'mail'],
    phone: ['phone', 'phone number', 'mobile', 'mobile number', 'telephone', 'contact number', 'cell', 'tel'],
    address: ['address', 'current address', 'street address', 'street', 'residence'],
    city: ['city', 'town', 'district'],
    state: ['state', 'province', 'region'],
    country: ['country', 'nationality'],
    pincode: ['pin code', 'pincode', 'postal code', 'postalcode', 'zip', 'zip code', 'zipcode', 'pin'],
    linkedin: ['linkedin', 'linkedin profile', 'linkedin url', 'linked in'],
    portfolio: ['portfolio', 'portfolio url', 'website', 'personal website', 'site', 'github', 'github url']
  };

  function normalize(str) {
    if (!str) return '';
    return str.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
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
      var gHeading = gContainer.querySelector('[role="heading"], .M7eMe, .HoDaOb, span');
      if (gHeading) tokens.push(gHeading.innerText || gHeading.textContent || '');
    }

    // Standard form-group or field container
    var fg = el.closest('.form-group, .form-row, .field, [class*="field"], [class*="group"], tr, div');
    if (fg && fg !== document.body) {
      var fgLabel = fg.querySelector('label, [class*="label"], [class*="title"], dt');
      if (fgLabel && fgLabel !== el) tokens.push(fgLabel.innerText || fgLabel.textContent || '');
    }

    return tokens.join(' ').toLowerCase();
  }

  function findMatchingValue(descriptor, fields) {
    if (!descriptor || !fields || fields.length === 0) return null;
    var normDesc = normalize(descriptor);

    // 1. Direct name match against user's saved fields
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (!f || !f.name || !f.value) continue;
      var normName = normalize(f.name);
      if (normName.length >= 3 && normDesc.indexOf(normName) !== -1) {
        return f.value;
      }
    }

    // 2. Semantic category alias match
    var keys = Object.keys(ALIAS_MAP);
    for (var k = 0; k < keys.length; k++) {
      var cat = keys[k];
      var aliases = ALIAS_MAP[cat];

      // Check if descriptor matches this category
      var descMatches = false;
      for (var a = 0; a < aliases.length; a++) {
        if (normDesc.indexOf(normalize(aliases[a])) !== -1) {
          descMatches = true;
          break;
        }
      }

      if (descMatches) {
        // Find if user has a saved field matching this category
        for (var sf = 0; sf < fields.length; sf++) {
          var saved = fields[sf];
          if (!saved || !saved.name || !saved.value) continue;
          var normSavedName = normalize(saved.name);

          for (var sa = 0; sa < aliases.length; sa++) {
            if (normSavedName.indexOf(normalize(aliases[sa])) !== -1) {
              return saved.value;
            }
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
      var matchVal = findMatchingValue(desc, fields);
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
