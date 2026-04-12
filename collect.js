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

  if (!data.dob) {
    const m = pageText.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
    if (m) data.dob = m[1];
  }

  // Try to find an address string: "### street ... City ST 12345"
  if (!data.address || !data.city || !data.state || !data.zip) {
    const addrRe =
      /(\d+\s+[NSEW]?\.?\s*[\w.\s-]+?)\s+([A-Z][A-Za-z.\s-]+?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?/;
    const m = pageText.match(addrRe);
    if (m) {
      if (!data.address) data.address = m[1].trim();
      if (!data.city) data.city = m[2].trim();
      if (!data.state) data.state = m[3].trim();
      if (!data.zip) data.zip = m[4].trim();
    }
  }

  // Try to find a "First Last" name. Prefer headings, then labeled spans.
  if (!data.firstName || !data.lastName) {
    const candidates = [];
    document
      .querySelectorAll("h1, h2, h3, h4, .lead-name, .name, .lead-header")
      .forEach((el) => candidates.push((el.textContent || "").trim()));
    for (const raw of candidates) {
      // strip surrounding punctuation
      const txt = raw.replace(/\s+/g, " ").trim();
      // name-ish: 2-3 words, only letters/apostrophes/hyphens/spaces,
      // not something obviously a page label.
      if (
        /^[A-Za-z][A-Za-z'\-]+(\s+[A-Za-z][A-Za-z'\-]+){1,2}$/.test(txt) &&
        txt.length < 50 &&
        !/call|script|lead|note|dial|campaign/i.test(txt)
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
