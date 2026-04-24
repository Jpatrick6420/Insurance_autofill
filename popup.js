/* Popup controller: collect lead data from current tab, store it, and
   inject the filler scripts into Progressive pages.  Collect Data also
   opens Zillow and Google Maps tabs for the manually-entered address
   (or, if blank, the address parsed from the page). */

const FIELDS = [
  "firstName", "lastName", "email", "phone",
  "dob", "address", "city", "state", "zip",
];

const STORAGE_KEY = "leadData";
const MANUAL_ADDRESS_KEY = "manualAddress";

const ZILLOW_URL = "https://www.zillow.com/homes/";
const ZILLOW_MATCH = "*://*.zillow.com/*";
const GMAPS_URL = "https://www.google.com/maps/place/";
const GMAPS_MATCH = "*://*.google.com/maps/*";

function $(id) { return document.getElementById(id); }

function setStatus(msg, kind) {
  const el = $("status");
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function readForm() {
  const data = {};
  for (const f of FIELDS) data[f] = $(f).value.trim();
  return data;
}

function writeForm(data) {
  for (const f of FIELDS) $(f).value = (data && data[f]) || "";
}

async function loadStored() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, MANUAL_ADDRESS_KEY]);
  if (stored[STORAGE_KEY]) writeForm(stored[STORAGE_KEY]);
  if (stored[MANUAL_ADDRESS_KEY]) $("manualAddress").value = stored[MANUAL_ADDRESS_KEY];
}

async function saveForm() {
  await chrome.storage.local.set({ [STORAGE_KEY]: readForm() });
}

async function saveManualAddress() {
  await chrome.storage.local.set({
    [MANUAL_ADDRESS_KEY]: $("manualAddress").value.trim(),
  });
}

/* Build a single-line "street, city, state zip" string from the parsed
   lead-data form.  Returns "" if there isn't enough data. */
function parsedAddressString() {
  const d = readForm();
  if (!d.address) return "";
  const parts = [d.address];
  const cityLine = [d.city, d.state].filter(Boolean).join(" ");
  const tail = [cityLine, d.zip].filter(Boolean).join(" ");
  if (tail) parts.push(tail);
  return parts.join(", ");
}

/* Parse a raw address string into { address, city, state, zip }.
   Handles formats like:
     "123 Main St, Springfield, IL 62704"
     "15305 N 5325 W Riverside UT 84334"
     "123 Main St Springfield IL 62704"            */
function parseAddressString(raw) {
  const result = {};
  const stateZip = raw.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$/i);
  if (!stateZip) return result;
  result.state = stateZip[1].toUpperCase();
  result.zip = stateZip[2];
  const before = raw.slice(0, stateZip.index).replace(/[,\s]+$/, "").trim();
  if (!before) return result;
  const commaIdx = before.lastIndexOf(",");
  if (commaIdx > 0) {
    result.address = before.slice(0, commaIdx).trim();
    result.city = before.slice(commaIdx + 1).trim();
  } else {
    result.address = before;
  }
  return result;
}

/* Open a URL in an existing tab matching `matchPattern` if one exists,
   otherwise create a new background tab. */
async function openOrUpdateTab(url, matchPattern) {
  try {
    const existing = await chrome.tabs.query({ url: matchPattern });
    if (existing && existing.length) {
      await chrome.tabs.update(existing[0].id, { url, active: false });
      return;
    }
  } catch (_) {
    /* fall through to create */
  }
  await chrome.tabs.create({ url, active: false });
}

/* Open Zillow + Google Maps for the given address. */
async function openLocationTabs(address) {
  const q = encodeURIComponent(address);
  await openOrUpdateTab(ZILLOW_URL + q, ZILLOW_MATCH);
  await openOrUpdateTab(GMAPS_URL + q, GMAPS_MATCH);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function runInTab(tab, files) {
  const arr = Array.isArray(files) ? files : [files];
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: arr,
  });
  // The return value of the last injected file is what we want.
  return results && results[results.length - 1] && results[results.length - 1].result;
}

async function doCollect() {
  setStatus("Collecting…");
  try {
    const tab = await getActiveTab();
    const data = await runInTab(tab, "collect.js");
    if (data) {
      const merged = { ...readForm(), ...cleanEmpty(data) };
      writeForm(merged);
      await saveForm();
    }

    // Manual address overrides BOTH Zillow/Maps AND the form fields
    // (address, city, state, zip) so autofill uses it too.
    const manual = $("manualAddress").value.trim();
    if (manual) {
      const parsed = parseAddressString(manual);
      if (parsed.address) $("address").value = parsed.address;
      if (parsed.city) $("city").value = parsed.city;
      if (parsed.state) $("state").value = parsed.state;
      if (parsed.zip) $("zip").value = parsed.zip;
      await saveForm();
    }

    const addressForLookup = manual || parsedAddressString();
    if (addressForLookup) {
      await openLocationTabs(addressForLookup);
      if (manual) $("manualAddress").value = "";
      await saveManualAddress();
      setStatus(
        (data ? "Collected. " : "") +
          "Opened Zillow + Maps for: " +
          addressForLookup,
        "ok"
      );
    } else if (data) {
      setStatus("Collected. Review / edit then click Fill.", "ok");
    } else {
      setStatus("No data found on page.", "err");
    }
  } catch (e) {
    setStatus("Collect failed: " + e.message, "err");
  }
}

function cleanEmpty(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") out[k] = v;
  }
  return out;
}

async function doFill(which) {
  setStatus("Filling " + which + "…");
  try {
    await saveForm();
    const tab = await getActiveTab();
    // Filler reads the saved lead data from chrome.storage.local, so we just
    // inject it and let it decide which form layout to handle.
    const siteFile =
      which === "progressive" ? "fill-progressive.js" : "fill-auto.js";
    const result = await runInTab(tab, ["fill-common.js", siteFile]);
    if (result && result.ok) {
      setStatus("Filled " + (result.filled || 0) + " field(s).", "ok");
    } else {
      setStatus(
        "Filler returned: " + ((result && result.error) || "no result"),
        "err"
      );
    }
  } catch (e) {
    setStatus("Fill failed: " + e.message, "err");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadStored();
  for (const f of FIELDS) {
    $(f).addEventListener("change", saveForm);
    $(f).addEventListener("blur", saveForm);
  }
  $("manualAddress").addEventListener("change", saveManualAddress);
  $("manualAddress").addEventListener("blur", saveManualAddress);
  $("collectBtn").addEventListener("click", doCollect);
  $("fillProgressiveBtn").addEventListener("click", () => doFill("progressive"));
  $("fillAutoBtn").addEventListener("click", () => doFill("auto"));
});
