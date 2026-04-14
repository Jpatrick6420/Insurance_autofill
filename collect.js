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
    // <label for="..."> ... </label>
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
    // By attributes
    const inputs = document.querySelectorAll("input, textarea");
    for (const el of inputs) {
      const hay = [
        el.name, el.id, el.placeholder, el.getAttribute("aria-label"),
        el.getAttribute("data-label"), el.getAttribute("title"),
      ].filter(Boolean).join(" ");
      if (pattern.test(hay)) return el;
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

  // Address: scan lines for a "City, ST 12345" (or "City ST 12345") line,
  // then walk backward for the nearest line that starts with a street number.
  if (!data.address || !data.city || !data.state || !data.zip) {
    const cityStateZipRe =
      /^(.+?)[,\s]+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$/;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(cityStateZipRe);
      if (!m) continue;
      const cityPart = m[1].replace(/,$/, "").trim();
      // Require the city to be words (not itself starting with a street #).
      if (!/^[A-Za-z][A-Za-z.\s'-]*$/.test(cityPart)) continue;
      if (!data.city) data.city = cityPart;
      if (!data.state) data.state = m[2];
      if (!data.zip) data.zip = m[3];

      if (!data.address) {
        // Prefer the previous line if it looks like a street address.
        for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
          if (/^\d+\s+\S/.test(lines[j]) && !cityStateZipRe.test(lines[j])) {
            data.address = lines[j].replace(/[,\s]+$/, "");
            break;
          }
        }
        // Or, it may be on the same line before the city, e.g.
        // "123 Main St Springfield IL 62704".
        if (!data.address) {
          const inline = lines[i].match(
            /^(\d+\s+[^,]+?)[,\s]+([A-Z][A-Za-z.\s'-]+?)[,\s]+([A-Z]{2})\s+(\d{5})/
          );
          if (inline) {
            data.address = inline[1].trim();
            if (!data.city || data.city === cityPart) data.city = inline[2].trim();
          }
        }
      }
      break;
    }
  }

  // Name: prefer an explicit "Name:" label in text; fall back to headings
  // with a stricter blacklist so things like "Direct Mail" don't match.
  if (!data.firstName || !data.lastName) {
    const nameVal = valueForLabel(
      /\b(lead\s*name|customer\s*name|client\s*name|full\s*name|insured|name)\b/i
    );
    if (nameVal && !NOT_A_NAME.test(nameVal)) {
      const parts = nameVal.replace(/\s+/g, " ").trim().split(/\s+/);
      if (
        parts.length >= 2 &&
        parts.length <= 4 &&
        parts.every((p) => /^[A-Za-z][A-Za-z'\-.]*$/.test(p))
      ) {
        if (!data.firstName) data.firstName = parts[0];
        if (!data.lastName) data.lastName = parts.slice(1).join(" ");
      }
    }
  }

  if (!data.firstName || !data.lastName) {
    const candidates = [];
    document
      .querySelectorAll("h1, h2, h3, h4, .lead-name, .name, .lead-header")
      .forEach((el) => candidates.push((el.textContent || "").trim()));
    for (const raw of candidates) {
      const txt = raw.replace(/\s+/g, " ").trim();
      if (
        /^[A-Z][A-Za-z'\-]+(\s+[A-Z][A-Za-z'\-]+){1,2}$/.test(txt) &&
        txt.length < 50 &&
        !NOT_A_NAME.test(txt)
      ) {
        const parts = txt.split(/\s+/);
        if (!data.firstName) data.firstName = parts[0];
        if (!data.lastName) data.lastName = parts.slice(1).join(" ");
        break;
      }
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
