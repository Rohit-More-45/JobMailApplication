/**
 * JobMail - Form Autofill Script
 *
 * Capabilities:
 * 1. Discovers input fields on standard web forms and Google Forms.
 * 2. Exact semantic matching: separates First Name, Last Name, and Full Name/Name so they
 *    never cross-match or fill into each other.
 * 3. Supports all standard Job Application Ready Answers: Contact info, Education, College,
 *    CGPA, Graduation Year, Company, Job Title, Experience, Skills, Notice Period, Salary, etc.
 * 4. Never overwrites fields containing user-entered information.
 * 5. Dispatches native input/change/blur events for React, Angular, and Google Forms compatibility.
 * 6. Highlights filled fields with a subtle confirmation flash.
 * 7. Never submits forms automatically.
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
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
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

    // 4. CGPA / GPA / Percentage
    if (
      tSet['cgpa'] ||
      tSet['gpa'] ||
      tSet['percentage'] ||
      tSet['marks'] ||
      text.indexOf('cgpa') !== -1 ||
      text.indexOf('gpa') !== -1
    ) {
      return 'cgpa';
    }

    // 5. Graduation Year / Year of Passing / Batch
    if (
      (tSet['graduation'] && tSet['year']) ||
      (tSet['year'] && tSet['passing']) ||
      (tSet['passing'] && tSet['year']) ||
      tSet['graduationyear'] ||
      tSet['passout'] ||
      tSet['batch'] ||
      text.indexOf('graduation year') !== -1 ||
      text.indexOf('year of passing') !== -1 ||
      text.indexOf('passing year') !== -1
    ) {
      return 'graduation';
    }

    // 6. Notice Period / Availability
    if (
      tSet['notice'] ||
      tSet['noticeperiod'] ||
      (tSet['availability'] && !tSet['work']) ||
      text.indexOf('notice period') !== -1 ||
      text.indexOf('how soon') !== -1
    ) {
      return 'notice';
    }

    // 7. Expected Salary / CTC
    if (
      tSet['salary'] ||
      tSet['ctc'] ||
      tSet['compensation'] ||
      tSet['remuneration'] ||
      text.indexOf('expected salary') !== -1 ||
      text.indexOf('expected ctc') !== -1 ||
      text.indexOf('salary expectation') !== -1
    ) {
      return 'salary';
    }

    // 8. Work Authorization / Eligibility / Permit
    if (
      (tSet['work'] && tSet['authorization']) ||
      (tSet['authorized'] && tSet['work']) ||
      tSet['workpermit'] ||
      text.indexOf('work authorization') !== -1 ||
      text.indexOf('authorized to work') !== -1 ||
      text.indexOf('legally authorized') !== -1
    ) {
      return 'authorization';
    }

    // 9. Willing to Relocate
    if (
      tSet['relocate'] ||
      tSet['relocation'] ||
      text.indexOf('relocate') !== -1 ||
      text.indexOf('relocation') !== -1
    ) {
      return 'relocation';
    }

    // 10. Professional Summary / Bio / About Me / Cover Letter
    if (
      (tSet['professional'] && tSet['summary']) ||
      tSet['bio'] ||
      (tSet['about'] && tSet['me']) ||
      text.indexOf('professional summary') !== -1 ||
      text.indexOf('about yourself') !== -1 ||
      text.indexOf('cover letter') !== -1
    ) {
      return 'summary';
    }

    // 11. Key Skills / Technologies / Tech Stack
    if (
      tSet['skills'] ||
      tSet['skill'] ||
      tSet['techstack'] ||
      tSet['technologies'] ||
      text.indexOf('key skills') !== -1 ||
      text.indexOf('technical skills') !== -1
    ) {
      return 'skills';
    }

    // 12. Experience Duration / Work Experience
    if (
      (tSet['experience'] && !tSet['company']) ||
      tSet['exp'] ||
      (tSet['work'] && tSet['experience']) ||
      (tSet['total'] && tSet['experience']) ||
      text.indexOf('experience duration') !== -1 ||
      text.indexOf('years of experience') !== -1 ||
      text.indexOf('total experience') !== -1
    ) {
      return 'experience';
    }

    // 13. Current Job Title / Designation
    if (
      (tSet['current'] && tSet['title']) ||
      (tSet['job'] && tSet['title']) ||
      tSet['designation'] ||
      (tSet['current'] && tSet['role']) ||
      text.indexOf('current job title') !== -1 ||
      text.indexOf('job title') !== -1
    ) {
      return 'jobtitle';
    }

    // 14. Position Applied For
    if (
      (tSet['position'] && tSet['applied']) ||
      (tSet['role'] && tSet['applied']) ||
      text.indexOf('position applied') !== -1 ||
      text.indexOf('role applied') !== -1
    ) {
      return 'position';
    }

    // 15. College / University / Institute / School
    if (
      tSet['college'] ||
      tSet['university'] ||
      tSet['institute'] ||
      (tSet['school'] && !tSet['high']) ||
      text.indexOf('college') !== -1 ||
      text.indexOf('university') !== -1 ||
      text.indexOf('institute') !== -1
    ) {
      return 'college';
    }

    // 16. Highest Education / Degree / Qualification
    if (
      (tSet['highest'] && tSet['education']) ||
      tSet['qualification'] ||
      tSet['degree'] ||
      (tSet['education'] && !tSet['college'] && !tSet['university']) ||
      text.indexOf('highest education') !== -1 ||
      text.indexOf('highest degree') !== -1
    ) {
      return 'education';
    }

    // 17. Current Company / Employer / Organization
    if (
      (tSet['current'] && tSet['company']) ||
      (tSet['current'] && tSet['employer']) ||
      (tSet['company'] && !tSet['college'] && !tSet['school']) ||
      tSet['employer'] ||
      tSet['organization'] ||
      text.indexOf('current company') !== -1 ||
      text.indexOf('current employer') !== -1
    ) {
      return 'company';
    }

    // 18. Username / Login
    if (tSet['username'] || (tSet['user'] && tSet['name']) || tSet['login']) {
      return 'username';
    }

    // 19. Full Name / Name (excluding first, last, user, company)
    if (
      tSet['fullname'] ||
      (tSet['full'] && tSet['name']) ||
      (tSet['name'] && !tSet['first'] && !tSet['last'] && !tSet['company'] && !tSet['user'])
    ) {
      return 'fullname';
    }

    // 20. Email
    if (tSet['email'] || tSet['mail'] || text.indexOf('email') !== -1 || text.indexOf('e-mail') !== -1) {
      return 'email';
    }

    // 21. Phone / Mobile
    if (tSet['phone'] || tSet['mobile'] || tSet['telephone'] || tSet['tel'] || tSet['cell']) {
      return 'phone';
    }

    // 22. Current Location / Location
    if (
      (tSet['current'] && tSet['location']) ||
      tSet['location'] ||
      text.indexOf('current location') !== -1
    ) {
      return 'location';
    }

    // 23. Current / Street Address
    if (tSet['address'] || tSet['street'] || tSet['residence']) {
      return 'address';
    }

    // 24. City
    if (tSet['city'] || tSet['town'] || tSet['district']) {
      return 'city';
    }

    // 25. State / Province
    if (tSet['state'] || tSet['province'] || tSet['region']) {
      return 'state';
    }

    // 26. Country / Nationality
    if (tSet['country'] || tSet['nationality']) {
      return 'country';
    }

    // 27. PIN Code / ZIP
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

    // 28. LinkedIn Profile
    if (tSet['linkedin'] || (tSet['linked'] && tSet['in']) || text.indexOf('linkedin') !== -1) {
      return 'linkedin';
    }

    // 29. Portfolio / Website / GitHub
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
      if (!f || !f.name || (!f.value && !f.numericValue)) continue;
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
        return pickSavedValue(f, el);
      }
    }

    // Priority 2: Semantic Category Match with strict isolation
    // firstname ONLY matches firstname (or derives from multi-word fullname if no firstname saved)
    // lastname ONLY matches lastname (or derives from multi-word fullname if no lastname saved)
    // fullname ONLY matches fullname
    if (elCategory !== 'other') {
      var explicitMatch = null;
      var fullNameField = null;

      for (var c = 0; c < fields.length; c++) {
        var sf = fields[c];
        if (!sf || !sf.name || (!sf.value && !sf.numericValue)) continue;
        var sfTokens = getTokens(sf.name);
        var sfCategory = classifyTokens(sfTokens, sf.name);

        if (sfCategory === elCategory) {
          explicitMatch = pickSavedValue(sf, el);
          break;
        }

        if (sfCategory === 'fullname') {
          fullNameField = sf;
        }
      }

      if (explicitMatch) {
        return explicitMatch;
      }

      // Fallback derivation for First Name / Last Name if Full Name is available
      if (fullNameField && fullNameField.value) {
        var nameParts = fullNameField.value.trim().split(/\\s+/);
        if (elCategory === 'firstname' && nameParts.length >= 1) {
          return nameParts[0];
        }
        if (elCategory === 'lastname' && nameParts.length >= 2) {
          return nameParts.slice(1).join(' ');
        }
      }
    }

    // Priority 3: Custom Field multi-token exact match (for unclassified custom fields)
    if (elCategory === 'other') {
      for (var m = 0; m < fields.length; m++) {
        var cf = fields[m];
        if (!cf || !cf.name || (!cf.value && !cf.numericValue)) continue;
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
            return pickSavedValue(cf, el);
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

  function pickSavedValue(field, el) {
    if (!field) return null;
    var isNumericEl =
      el &&
      ((el.getAttribute('type') || '').toLowerCase() === 'number' ||
        (el.getAttribute('inputmode') || '').toLowerCase() === 'numeric' ||
        (el.getAttribute('inputmode') || '').toLowerCase() === 'decimal');
    if (isNumericEl && field.numericValue && field.numericValue.toString().trim().length > 0) {
      return field.numericValue.toString().trim();
    }
    if (field.value && field.value.toString().trim().length > 0) {
      return field.value.toString().trim();
    }
    if (field.numericValue && field.numericValue.toString().trim().length > 0) {
      return field.numericValue.toString().trim();
    }
    return null;
  }

  function getReadableFieldLabel(el) {
    var raw = '';
    if (el.id) {
      try {
        var lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lbl) raw = lbl.innerText || lbl.textContent || '';
      } catch (_e) {}
    }
    if (!raw) {
      var pLbl = el.closest('label');
      if (pLbl) raw = pLbl.innerText || pLbl.textContent || '';
    }
    if (!raw) {
      var gContainer = el.closest('[role="listitem"], .freebirdFormviewerViewNumberedItemContainer, .geS5n, .m2');
      if (gContainer) {
        var gHeading = gContainer.querySelector('[role="heading"], .M7eMe, .HoDaOb');
        if (gHeading) raw = gHeading.innerText || gHeading.textContent || '';
      }
    }
    if (!raw) {
      var fg = el.closest('.form-group, .form-row, .field, [class*="field"], [class*="group"], tr');
      if (fg && fg !== document.body) {
        var fgLabel = fg.querySelector('label, [class*="label"], [class*="title"], dt');
        if (fgLabel && fgLabel !== el) raw = fgLabel.innerText || fgLabel.textContent || '';
      }
    }
    if (!raw) {
      raw = el.getAttribute('aria-label') || el.placeholder || el.name || '';
    }
    return raw.replace(/\\*/g, '').replace(/\\s+/g, ' ').trim();
  }

  function runAutofill(fieldsList) {
    var fields = fieldsList || savedFields;
    if (!fields || fields.length === 0) return 0;

    var selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="search"]), textarea, select';
    var elements = document.querySelectorAll(selector);
    var filledCount = 0;
    var unknownFields = [];
    var seenUnknown = {};

    elements.forEach(function(el) {
      if (el.offsetWidth === 0 && el.offsetHeight === 0 && !el.classList.contains('whsOnd')) {
        return; // invisible element
      }
      if (el.disabled || el.readOnly) return;

      var desc = getDescriptor(el);
      var matchVal = findMatchingValue(el, desc, fields);
      if (matchVal) {
        var ok = setInputValue(el, matchVal);
        if (ok) filledCount++;
      } else if (!el.value || el.value.toString().trim().length === 0) {
        // Auto-detect new empty field on manual form and report back to Autofill tab
        var label = getReadableFieldLabel(el);
        var normLbl = normalize(label);
        if (
          label &&
          label.length >= 3 &&
          label.length <= 120 &&
          normLbl !== 'search' &&
          normLbl !== 'q' &&
          normLbl !== 'captcha' &&
          !seenUnknown[normLbl]
        ) {
          seenUnknown[normLbl] = true;
          var opts = [];
          if (el.tagName.toLowerCase() === 'select') {
            for (var o = 0; o < el.options.length && opts.length < 6; o++) {
              var ot = (el.options[o].text || '').trim();
              if (ot && ot.toLowerCase().indexOf('select') === -1) opts.push(ot);
            }
          }
          unknownFields.push({
            name: label,
            fieldType: el.tagName.toLowerCase() === 'select' ? 'select' : 'text',
            options: opts
          });
        }
      }
    });

    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'AUTOFILL_RESULT',
          count: filledCount,
          unknownFields: unknownFields
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
