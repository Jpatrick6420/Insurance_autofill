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
        el.getAttribute("ng-model"), el.getAttribute("ng-reflect-name"),
      ].filter(Boolean).join(" ");
      if (pattern.test(hay)) return el;
    }
    // 3. DOM-proximity fallback.  Many Angular / dynamic forms render each
    //    field via an ng-repeat where the input has no identifying
    //    attributes at all, and the label is a sibling element.  Walk up a
    //    few ancestor levels from each input and check if the ancestor's
    //    visible text (excluding other form controls) matches the label
    //    pattern.  Inputs' own values are NOT part of innerText, so the
    //    ancestor text is effectively just the label.
    for (const el of inputs) {
      if (el.type === "hidden" || el.disabled) continue;
      let p = el.parentElement;
      for (let depth = 0; depth < 5 && p; depth++, p = p.parentElement) {
        // Stop if we've walked up past a form boundary into something huge.
        const text = (p.innerText || p.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        if (!text) continue;
        if (text.length > 80) break; // too broad, we're past the row
        if (pattern.test(text)) return el;
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

  const addrInput = findInputByLabel(/address\s*(line\s*1|1)?|street/i);
  if (addrInput) data.address = textOf(addrInput);

  const cityInput = findInputByLabel(/city/i);
  if (cityInput) data.city = textOf(cityInput);

  const stateInput = findInputByLabel(/^state$|\bstate\b/i);
  if (stateInput) data.state = textOf(stateInput);

  const zipInput = findInputByLabel(/zip|postal/i);
  if (zipInput) data.zip = textOf(zipInput);

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

  if (!data.email) {
    const m = pageText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (m) data.email = m[0];
  }

  if (!data.phone) {
    // 10 or 11 digit phone, allow separators
    const m = pageText.match(
      /(?:\+?1[\s.\-]?)?\(?(\d{3})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})/
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

  // Address parsing.  Several layouts we have to support:
  //   (a) Multi-line:    "123 Main St\nSpringfield, IL 62704"
  //   (b) Inline commas: "123 Main St, Springfield, IL 62704"
  //   (c) Inline no-commas:        "123 Main St Springfield IL 62704"
  //   (d) Utah-style grid no-commas:
  //                      "5610 N 1400 W Saint George UT 84770"
  if (!data.address || !data.city || !data.state || !data.zip) {
    // Known street-type suffixes (end of the street portion of an address).
    const STREET_SUFFIX =
      "(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|" +
      "Way|Wy|Ct|Court|Pl|Place|Ter|Terrace|Cir|Circle|Pkwy|Parkway|" +
      "Trl|Trail|Hwy|Highway|Route|Rte|Loop|Row|Run|Xing|Crossing|" +
      "Sq|Square|Plz|Plaza|Aly|Alley|Expy|Expressway)";
    const DIR = "(?:N|S|E|W|NE|NW|SE|SW)";

    // Split a "street+city" string into { street, city } using suffix/grid
    // heuristics.  Returns null if we can't confidently split.
    function splitStreetCity(text) {
      text = text.replace(/\s+/g, " ").trim().replace(/,+/g, "");
      // 1. Street that ends in a known suffix (optionally followed by a
      //    directional).  City is everything after.
      let re = new RegExp(
        "^(\\d+\\s+.*?\\b" + STREET_SUFFIX + "\\.?(?:\\s+" + DIR + "\\b)?)\\s+(.+)$",
        "i"
      );
      let m = text.match(re);
      if (m) return { street: m[1].trim(), city: m[2].trim() };
      // 2. Utah-style grid: "5610 N 1400 W <city>" — street ends with a
      //    directional letter following a number.
      re = new RegExp(
        "^(\\d+\\s+" + DIR + "\\s+\\d+\\s+" + DIR + ")\\s+(.+)$",
        "i"
      );
      m = text.match(re);
      if (m) return { street: m[1].trim(), city: m[2].trim() };
      // 3. Simpler grid: "123 N 456 <city>" or "123 <Dir> <City>".
      re = new RegExp("^(\\d+\\s+" + DIR + "\\s+\\d+)\\s+(.+)$", "i");
      m = text.match(re);
      if (m) return { street: m[1].trim(), city: m[2].trim() };
      // 4. Last-ditch: take "<number> <1-3 tokens>" as street, rest as city.
      m = text.match(/^(\d+\s+\S+(?:\s+\S+){0,2})\s+(.+)$/);
      if (m) return { street: m[1].trim(), city: m[2].trim() };
      return null;
    }

    // Find a line (or the whole pageText) containing "ST 12345" and use it.
    const STATE_ZIP = /\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/;
    const candidates = lines.slice();
    // Also consider the raw pageText so we catch addresses not line-broken
    // the way we expect.
    if (!candidates.includes(pageText)) candidates.push(pageText);

    for (const line of candidates) {
      const szMatch = line.match(STATE_ZIP);
      if (!szMatch) continue;
      // Everything before "ST ZIP" on this same line is street+city.
      const before = line.slice(0, szMatch.index).replace(/[,\s]+$/, "").trim();
      if (!before) continue;

      // Case (a): "before" is just "City" (street is on the previous line).
      if (/^[A-Za-z][A-Za-z.\s'-]*$/.test(before)) {
        if (!data.city) data.city = before.replace(/,$/, "").trim();
        if (!data.state) data.state = szMatch[1];
        if (!data.zip) data.zip = szMatch[2];
        if (!data.address) {
          const idx = lines.indexOf(line);
          for (let j = idx - 1; j >= 0 && j >= idx - 3; j--) {
            if (/^\d+\s+\S/.test(lines[j])) {
              data.address = lines[j].replace(/[,\s]+$/, "");
              break;
            }
          }
        }
        break;
      }

      // Case (b/c/d): "before" contains both street and city.
      if (/^\d/.test(before)) {
        const split = splitStreetCity(before);
        if (split) {
          if (!data.address) data.address = split.street;
          if (!data.city) data.city = split.city;
          if (!data.state) data.state = szMatch[1];
          if (!data.zip) data.zip = szMatch[2];
          break;
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
