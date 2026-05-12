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

const ASSESSOR_BY_ZIP = (() => {
  const counties = [
    {
      url: "https://www.saltlakecounty.gov/assessor/",
      match: "*://*.saltlakecounty.gov/*",
      zips: ["84096","84074","84020","84119","84065","84120","84081","84118","84121","84088","84129","84123","84095","84009","84116","84047","84107","84106","84070","84084","84128","84092","84115","84044","84094","84104","84109","84117","84093","84105","84103","84124","84108","84098","84102","84111","84101","84153"],
    },
    {
      url: "https://webercountyutah.gov/parcelsearch/",
      match: "*://*.webercountyutah.gov/*",
      zips: ["84404","84401","84067","84403","84405","84414","84315","84310","84317","84408","84201","84402","84407","84412","84409","84415","84244"],
    },
    {
      url: "https://webportal.daviscountyutah.gov/App/PropertySearch/esri/map",
      match: "*://*.daviscountyutah.gov/*",
      zips: ["84015","84041","84010","84405","84037","84075","84040","84103","84025","84054","84014","84087","84315","84056","84011","84016","84089"],
    },
    {
      url: "https://erecord.boxeldercountyut.gov/eaglesoftware/web/login.jsp",
      match: "*://*.boxeldercountyut.gov/*",
      zips: ["84404","84302","84337","84312","84083","84307","84325","84340","83342","84306","84331","84324","84314","84311","84309","84316","84336","83312","84329","84313","84334","84301","84330"],
    },
    {
      url: "https://erecording.tooeleco.gov/eaglesoftware/web/login.jsp",
      match: "*://*.tooeleco.gov/*",
      zips: ["84074","84029","84083","84069","84022","84071","84628","84080","84034"],
    },
    {
      url: "https://www.utahcounty.gov/landrecords/AddressSearchForm.asp",
      match: "*://*.utahcounty.gov/*",
      zips: ["84043","84096","84020","84003","84660","84062","84604","84005","84057","84606","84045","84663","84058","84601","84651","84097","84059","84655","84042","84664","84004","84653","84526","84629","84602","84626","84013","84633","84628","84603","84605","84665"],
    },
    {
      url: "https://geoprodvm.washco.utah.gov/Html5Viewer/index.html?viewer=AssessorReport",
      match: "*://*.washco.utah.gov/*",
      zips: ["84790","84770","84780","84737","84738","84765","84745","84781","84774","84725","84746","84757","84733","84782","84767","84722","84779","84763","84771","84783","84784","84791"],
    },
    {
      url: "https://www.carbon.utah.gov/service/property-search/",
      match: "*://*.carbon.utah.gov/*",
      zips: ["84501","84526","84525","84527","84542","84539","84529","84520"],
    },
    {
      url: "https://apps.adacounty.id.gov/PropertyLookup/SearchProperty",
      match: "*://*.adacounty.id.gov/*",
      zips: ["83646","83709","83642","83704","83687","83706","83634","83616","83713","83705","83714","83702","83716","83703","83669","83712","83641","83721","83733","83730","83727","83725","83757","83724","83731","83680","83701","83708","83707","83711","83715","83717","83720","83719","83722","83726","83729","83728","83732","83756","83735","83799"],
    },
    {
      url: "https://id-kootenai.publicaccessnow.com/Assessor/PropertySearch.aspx",
      match: "*://*.publicaccessnow.com/*",
      zips: ["83854","83815","83814","83835","83858","83801","83869","83873","83876","83833","83810","83803","83842","83877","83816"],
    },
    {
      url: "https://cloudgisapps.bonnercountyid.gov/PropertySearch/",
      match: "*://*.bonnercountyid.gov/*",
      zips: ["83864","83860","83801","83856","83869","83888","83822","83804","83852","83811","83836","83813","83803","83821","83809","83825","83841","83848","83840","83865"],
    },
  ];
  const map = {};
  for (const c of counties) {
    for (const z of c.zips) {
      if (!map[z]) map[z] = c;
    }
  }
  return map;
})();

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
   Handles pasted formats including multi-line:
     "123 Main St, Springfield, IL 62704"
     "15305 N 5325 W\nRiverside, UT 84334"
     "15305 N 5325 W Riverside UT 84334"           */
function parseAddressString(raw) {
  const result = {};
  // Normalize: turn newlines into commas, collapse whitespace
  const text = raw
    .replace(/[\r\n]+/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/,\s*,/g, ",")
    .trim();

  // Find "ST 12345" at the end
  const szMatch = text.match(/,?\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$/i);
  if (szMatch) {
    result.state = szMatch[1].toUpperCase();
    result.zip = szMatch[2];
    const before = text.slice(0, szMatch.index).replace(/[,\s]+$/, "").trim();
    if (before) {
      const lastComma = before.lastIndexOf(",");
      if (lastComma > 0) {
        result.address = before.slice(0, lastComma).trim();
        result.city = before.slice(lastComma + 1).trim();
      } else {
        result.address = before;
      }
    }
  } else {
    // No state+zip found — store the whole thing as address
    result.address = text;
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

/* Open the county assessor site for the current ZIP code.
   Always reuses the same tab regardless of which county was last shown. */
let assessorTabId = null;

async function openAssessor() {
  const zip = $("zip").value.trim();
  if (!zip) {
    setStatus("No ZIP code — fill or collect data first.", "err");
    return;
  }
  const county = ASSESSOR_BY_ZIP[zip];
  if (!county) {
    setStatus("No assessor mapped for ZIP " + zip, "err");
    return;
  }
  const addr = $("address").value.trim();
  if (addr) {
    await navigator.clipboard.writeText(addr);
  }
  // Try to reuse the existing assessor tab
  if (assessorTabId !== null) {
    try {
      await chrome.tabs.update(assessorTabId, { url: county.url, active: false });
      setStatus("Opened assessor for ZIP " + zip + (addr ? " — address copied" : ""), "ok");
      return;
    } catch (_) {
      assessorTabId = null;
    }
  }
  const tab = await chrome.tabs.create({ url: county.url, active: false });
  assessorTabId = tab.id;
  setStatus("Opened assessor for ZIP " + zip + (addr ? " — address copied" : ""), "ok");
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
    // Try to collect data from the page — this can fail on pages where
    // the extension can't inject scripts, so don't let it block the
    // manual address flow.
    let data = null;
    try {
      const tab = await getActiveTab();
      data = await runInTab(tab, "collect.js");
    } catch (_) { /* page may not be injectable */ }

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
  $("assessorBtn").addEventListener("click", openAssessor);
  $("fillProgressiveBtn").addEventListener("click", () => doFill("progressive"));
  $("fillAutoBtn").addEventListener("click", () => doFill("auto"));
});
