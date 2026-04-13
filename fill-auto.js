/* Auto-detect the current site and run the appropriate filler mapping.
 *
 * Detection is based on hostname:
 *   - *foragentsonly* / *progressive*  -> Progressive mapping
 *   - *foremost*                        -> Foremost mapping
 *   - otherwise                         -> try a generic mapping
 *
 * Like the other fillers, this only types into plain text inputs. It never
 * touches dropdowns, checkboxes, or buttons.
 */
(async () => {
  const F = window.__leadFill;
  if (!F) return { ok: false, error: "fill-common.js not loaded" };

  const lead = await F.getLeadData();
  if (!lead || Object.keys(lead).length === 0) {
    return { ok: false, error: "No lead data stored. Click Collect Data first." };
  }

  const host = (location && location.hostname) || "";
  const isProgressive = /foragentsonly|progressive/i.test(host);
  const isForemost    = /foremost/i.test(host);

  const progressiveMap = [
    { key: "firstName", pattern: /^\s*first\s*name/i },
    { key: "lastName",  pattern: /^\s*last\s*name/i  },
    { key: "dob",       pattern: /date\s*of\s*birth|^\s*dob\b/i },
    { key: "email",     pattern: /customer\s*email|e-?mail/i },
    { key: "phone",     pattern: /phone\s*(type\/)?\s*number|phone\s*number|^\s*phone\b/i },
    { key: "address",   pattern: /mailing\s*address\s*line\s*1|address\s*line\s*1|street\s*address/i },
    { key: "city",      pattern: /^\s*city\b/i },
    { key: "zip",       pattern: /zip\s*code|^\s*zip\b|postal/i },
  ];

  const foremostMap = [
    { key: "firstName", pattern: /^\s*first\s*name/i },
    { key: "lastName",  pattern: /^\s*last\s*name/i  },
    { key: "dob",       pattern: /date\s*of\s*birth|^\s*dob\b|birth\s*date/i },
    { key: "email",     pattern: /e-?mail/i },
    { key: "phone",     pattern: /phone\s*number|home\s*phone|^\s*phone\b/i },
    { key: "address",   pattern: /^\s*address\b(?!\s*line\s*2)|street\s*address/i },
    { key: "city",      pattern: /^\s*city\b/i },
    { key: "zip",       pattern: /zip\s*code|^\s*zip\b|postal/i },
  ];

  const genericMap = foremostMap;

  const mapping = isProgressive ? progressiveMap
                : isForemost    ? foremostMap
                                : genericMap;

  try {
    const filled = await F.applyMap(mapping, lead);
    return {
      ok: true,
      filled,
      site: isProgressive ? "progressive" : isForemost ? "foremost" : "generic",
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
})();
