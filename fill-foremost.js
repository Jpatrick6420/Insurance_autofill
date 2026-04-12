/* Fill the Foremost STAR quote flow.
 *
 * The Foremost STAR quote is a multi-page wizard (Location, Applicant,
 * Eligibility, Losses, Dwelling, Coverages). This filler attempts to populate
 * any matching text field on whichever page is currently showing. It will not
 * navigate between pages, click buttons, or change dropdowns.
 *
 * Use: advance to each page, then click "Fill Foremost" in the extension.
 */
(async () => {
  const F = window.__leadFill;
  if (!F) return { ok: false, error: "fill-common.js not loaded" };

  const lead = await F.getLeadData();
  if (!lead || Object.keys(lead).length === 0) {
    return { ok: false, error: "No lead data stored. Click Collect Data first." };
  }

  const mapping = [
    // Applicant / Named Insured page
    { key: "firstName", pattern: /^\s*first\s*name/i },
    { key: "lastName",  pattern: /^\s*last\s*name/i  },
    { key: "dob",       pattern: /date\s*of\s*birth|^\s*dob\b|birth\s*date/i },
    { key: "email",     pattern: /e-?mail/i },
    { key: "phone",     pattern: /phone\s*number|home\s*phone|^\s*phone\b/i },

    // Location / Dwelling page
    { key: "address",   pattern: /^\s*address\b(?!\s*line\s*2)|street\s*address|mailing\s*address\s*line\s*1/i },
    { key: "city",      pattern: /^\s*city\b/i },
    { key: "zip",       pattern: /zip\s*code|^\s*zip\b|postal/i },
    // State / Roof Material / Year Built / Square Footage intentionally skipped.
  ];

  try {
    const filled = await F.applyMap(mapping, lead);
    return { ok: true, filled };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
})();
