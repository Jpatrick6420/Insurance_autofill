/* Fill the Progressive (For Agents Only) "Named Insured / Quoting" page.
 *
 * Only fills plain text inputs. Never touches dropdowns (Gender, State,
 * Suffix, disclosure) or checkboxes — per user request, and because
 * triggering select/change programmatically on Progressive has historically
 * crashed the flow.
 *
 * Every field is typed one character at a time via window.__leadFill.typeInto
 * so the page's validators see real keydown/keypress/input/keyup events.
 */
(async () => {
  const F = window.__leadFill;
  if (!F) return { ok: false, error: "fill-common.js not loaded" };

  const lead = await F.getLeadData();
  if (!lead || Object.keys(lead).length === 0) {
    return { ok: false, error: "No lead data stored. Click Collect Data first." };
  }

  // Pair key -> pattern. Order matters: the more specific go first so a
  // generic /address/ doesn't grab the wrong field.
  const mapping = [
    { key: "firstName", pattern: /^\s*first\s*name/i },
    { key: "lastName",  pattern: /^\s*last\s*name/i  },
    { key: "dob",       pattern: /date\s*of\s*birth|^\s*dob\b/i },
    { key: "email",     pattern: /customer\s*email|e-?mail/i },
    { key: "phone",     pattern: /phone\s*(type\/)?\s*number|phone\s*number|^\s*phone\b/i },
    { key: "address",   pattern: /mailing\s*address\s*line\s*1|address\s*line\s*1|street\s*address|^\s*address\s*1\b/i },
    { key: "city",      pattern: /^\s*city\b/i },
    { key: "zip",       pattern: /zip\s*code|^\s*zip\b|postal/i },
    // State is intentionally skipped (dropdown).
  ];

  try {
    const filled = await F.applyMap(mapping, lead);
    return { ok: true, filled };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
})();
