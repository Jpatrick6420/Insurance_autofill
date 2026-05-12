/* Collect lead data from the current page (the dialer callback script).
 * Returns { firstName, lastName, email, phone, dob, address, city, state, zip }.
 *
 * Strategy:
 *   1. Try to read known form inputs (DOB, etc.) by label / name.
 *   2. Fall back to regex parsing of the visible page text.
 *
 * This must be the last expression evaluated so executeScript returns it.
 */
(() => {
  const data = {};

  /* ---------- helpers ---------- */

  function textOf(el) {
    return (el && (el.value || el.textContent || "")).trim();
  }

  // Find an input whose associated label / name / id / placeholder matches.
  function findInputByLabel(pattern) {
    // 1. <label for="..."> ... </label>
    const labels = document.querySelectorAll("label");
    for (const label of labels) {
      if (!pattern.test(label.textContent || "")) continue;
      if (label.htmlFor) {
        const el = document.getElementById(label.htmlFor);
        if (el) return el;
      }
      const nested = label.querySelector("input, textarea, select");
      if (nested) return nested;
      // Sibling / parent search
      const parent = label.parentElement;
      if (parent) {
        const near = parent.querySelector("input, textarea, select");
        if (near) return near;
      }
    }
    // 2. By attributes (name/id/placeholder/aria-label/etc.).
    const inputs = document.querySelectorAll("input, textarea, select");
    for (const el of inputs) {
      const hay = [
        el.name, el.id, el.placeholder, el.getAttribute("aria-label"),
        el.getAttribute("data-label"), el.getAttribute("title"),
        el.getAttribute("ng-reflect-name"),
      ].filter(Boolean).join(" ");
      if (pattern.test(hay)) return el;
    }
    // 3. DOM-proximity fallback for dynamic forms (Angular ng-repeat,
    //    etc.) where the input has no identifying attributes and the
    //    label is a sibling element.  Walk up from each input and, at
    //    each ancestor level, check "label-like" children — direct text
    //    nodes and small child elements that don't themselves contain
    //    form controls.  Stop walking up once we hit an ancestor that
    //    contains more than one form control (we've left the row).
    for (const el of inputs) {
      if (el.type === "hidden" || el.disabled) continue;
      let p = el.parentElement;
      for (let depth = 0; depth < 5 && p; depth++, p = p.parentElement) {
        const controls = p.querySelectorAll(
          "input:not([type=hidden]), textarea, select"
        );
        if (controls.length > 1) break; // past the row
        for (const child of p.childNodes) {
          let txt = "";
          if (child.nodeType === 3 /* text */) {
            txt = child.textContent || "";
          } else if (
            child.nodeType === 1 /* element */ &&
            child !== el &&
            !child.contains(el) &&
            !child.querySelector("input, textarea, select")
          ) {
            txt = child.textContent || "";
          }
          txt = txt.replace(/\s+/g, " ").trim();
          if (!txt || txt.length > 40) continue;
          if (pattern.test(txt)) return el;
        }
      }
    }
    return null;
  }

  /* ---------- 1. Try known input fields ---------- */

  const dobInput = findInputByLabel(/dob|date\s*of\s*birth|birth/i);
  if (dobInput) data.dob = textOf(dobInput);

  const emailInput = findInputByLabel(/e-?mail/i);
  if (emailInput) data.email = textOf(emailInput);

  const phoneInput = findInputByLabel(/phone|mobile|cell/i);
  if (phoneInput) data.phone = textOf(phoneInput);

  const firstInput = findInputByLabel(/first\s*name/i);
  if (firstInput) data.firstName = textOf(firstInput);

  const lastInput = findInputByLabel(/last\s*name/i);
  if (lastInput) data.lastName = textOf(lastInput);

  // Address fields are handled by the regex approach below (not by
  // input search) because input search can grab wrong addresses from
  // form fields belonging to other contacts on the page.

  /* ---------- 2. Fallback: parse the visible page text ---------- */

  const pageText = document.body ? document.body.innerText : "";

  // Split into trimmed non-empty lines so we can match labels line-by-line.
  const lines = pageText
    .split(/\r?\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Words/phrases that look like labels on a dialer script page but are NOT a
  // customer name, address, etc. Used to reject bad matches.
  const NOT_A_NAME =
    /\b(direct\s*mail|new\s*lead|lead|campaign|script|call(?:er|back)?|dial(?:er)?|customer|caller|prospect|source|status|type|inbound|outbound|note|agent|representative|rep|account|mail|phone|email|address|city|state|zip|dob|birth|born)\b/i;

  // Find the first value associated with a label, scanning lines.  The value
  // may be on the same line ("DOB: 01/02/1980") or the next line.
  function valueForLabel(labelRe) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(labelRe);
      if (!m) continue;
      // Inline: strip the label + any separator and return the remainder.
      const after = line.slice(m.index + m[0].length).replace(/^[\s:\-–—]+/, "").trim();
      if (after) return after;
      // Otherwise the value is likely on the next non-empty line.
      if (i + 1 < lines.length) return lines[i + 1];
    }
    return null;
  }

  // Helper: find all regex matches in text, return the one whose position
  // is closest to `anchorIdx` (the lead name location).  Falls back to
  // the first match when we have no anchor.
  function closestMatch(re, text, anchorIdx) {
    const all = [...text.matchAll(re)];
    if (!all.length) return null;
    if (anchorIdx < 0 || all.length === 1) return all[0];
    all.sort(
      (a, b) => Math.abs(a.index - anchorIdx) - Math.abs(b.index - anchorIdx)
    );
    return all[0];
  }

  const nameAnchor = (() => {
    const n = [data.firstName, data.lastName].filter(Boolean).join(" ");
    return n ? pageText.indexOf(n) : -1;
  })();

  if (!data.email) {
    const m = closestMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/g, pageText, nameAnchor);
    if (m) data.email = m[0];
  }

  if (!data.phone) {
    const m = closestMatch(
      /(?:\+?1[\s.\-]?)?\(?(\d{3})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})/g,
      pageText,
      nameAnchor,
    );
    if (m) data.phone = m[1] + m[2] + m[3];
  }

  // DOB: require a birth/DOB label nearby so we don't grab a random date
  // (call date, appointment, lead-created, etc.).
  if (!data.dob) {
    const dateRe = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})/;
    const dobVal = valueForLabel(/\b(date\s*of\s*birth|d\.?o\.?b\.?|birth\s*date|birthday|born)\b/i);
    let m = dobVal && dobVal.match(dateRe);
    if (!m) {
      // Last resort: find a date whose line mentions birth/dob explicitly.
      for (const line of lines) {
        if (/\b(dob|birth|born)\b/i.test(line)) {
          const mm = line.match(dateRe);
          if (mm) { m = mm; break; }
        }
      }
    }
    if (m) {
      let [, mo, dy, yr] = m;
      if (yr.length === 2) yr = (parseInt(yr, 10) > 30 ? "19" : "20") + yr;
      data.dob = mo.padStart(2, "0") + "/" + dy.padStart(2, "0") + "/" + yr;
    }
  }

  // Address parsing: regex approach — find "123 ... ST 12345" nearest the
  // lead name, then split into street / city / state / zip.
  if (!data.address || !data.city || !data.state || !data.zip) {
    const DIR = "(?:N|S|E|W|NE|NW|SE|SW)";
    const STREET_SUFFIX =
      "(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|" +
      "Way|Wy|Ct|Court|Pl|Place|Ter|Terrace|Cir|Circle|Pkwy|Parkway|" +
      "Trl|Trail|Hwy|Highway|Route|Rte|Loop|Row|Run|Xing|Crossing|" +
      "Sq|Square|Plz|Plaza|Aly|Alley|Expy|Expressway)";

    function splitStreetCity(text) {
      text = text.replace(/\s+/g, " ").trim().replace(/,+/g, "");
      let re = new RegExp(
        "^(\\d+\\s+.*?\\b" + STREET_SUFFIX + "\\.?(?:\\s+" + DIR + "\\b)?)\\s+(.+)$", "i"
      );
      let m = text.match(re);
      if (m) return { street: m[1].trim(), city: m[2].trim() };
      re = new RegExp(
        "^(\\d+\\s+" + DIR + "\\s+\\d+\\s+" + DIR + ")\\s+(.+)$", "i"
      );
      m = text.match(re);
      if (m) return { street: m[1].trim(), city: m[2].trim() };
      re = new RegExp("^(\\d+\\s+" + DIR + "\\s+\\d+)\\s+(.+)$", "i");
      m = text.match(re);
      if (m) return { street: m[1].trim(), city: m[2].trim() };
      m = text.match(/^(\d+\s+\S+(?:\s+\S+){0,2})\s+(.+)$/);
      if (m) return { street: m[1].trim(), city: m[2].trim() };
      return null;
    }

    const addrRe = /\d+\s+.+?\s+(UT|ID)\s+(\d{5})(?:-\d{4})?/g;
    const m = closestMatch(addrRe, pageText, nameAnchor);
    if (m) {
      if (!data.state) data.state = m[1];
      if (!data.zip) data.zip = m[2];
      const before = m[0]
        .replace(/\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?$/, "")
        .replace(/[,\s]+$/, "")
        .trim();
      if (before && (!data.address || !data.city)) {
        const split = splitStreetCity(before);
        if (split) {
          if (!data.address) data.address = split.street;
          if (!data.city) data.city = split.city;
        } else if (!data.address) {
          data.address = before;
        }
      }
    }
  }

  // Title-case a name like "ron vos" -> "Ron Vos".
  function titleCase(s) {
    return s
      .toLowerCase()
      .replace(/\b([a-z])([a-z'\-]*)/g, (_, a, b) => a.toUpperCase() + b);
  }

  // Accept a raw "first last [middle]" string and write it into data.
  // Returns true if accepted.
  function acceptName(raw) {
    if (!raw) return false;
    const txt = raw.replace(/\s+/g, " ").trim();
    if (txt.length > 50) return false;
    if (NOT_A_NAME.test(txt)) return false;
    // 2-4 alphabetic tokens (letters, apostrophes, hyphens, periods).
    if (!/^[A-Za-z][A-Za-z'\-.]*(\s+[A-Za-z][A-Za-z'\-.]*){1,3}$/.test(txt)) {
      return false;
    }
    const parts = titleCase(txt).split(/\s+/);
    if (!data.firstName) data.firstName = parts[0];
    if (!data.lastName) data.lastName = parts.slice(1).join(" ");
    return true;
  }

  // 1. Prefer an explicit "Name:" label in page text.
  if (!data.firstName || !data.lastName) {
    const nameVal = valueForLabel(
      /\b(lead\s*name|customer\s*name|client\s*name|full\s*name|insured|contact(?:\s*name)?|name)\b/i
    );
    if (nameVal) acceptName(nameVal);
  }

  // 2. Fall back to prominent headings / likely name elements.  Case-
  //    insensitive so lowercase names like "ron vos" still match.
  if (!data.firstName || !data.lastName) {
    const candidates = [];
    document
      .querySelectorAll(
        "h1, h2, h3, h4, .lead-name, .name, .lead-header, " +
        ".contact-name, .customer-name, .client-name"
      )
      .forEach((el) => candidates.push((el.textContent || "").trim()));
    for (const raw of candidates) {
      if (acceptName(raw)) break;
    }
  }

  // Normalize DOB to MM/DD/YYYY zero-padded
  if (data.dob) {
    const m = data.dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const pad = (s) => (s.length === 1 ? "0" + s : s);
      data.dob = pad(m[1]) + "/" + pad(m[2]) + "/" + m[3];
    }
  }

  // Strip leading country code from phone
  if (data.phone) {
    const digits = data.phone.replace(/\D/g, "");
    data.phone = digits.length === 11 && digits[0] === "1"
      ? digits.slice(1)
      : digits;
  }

  return data;
})();
