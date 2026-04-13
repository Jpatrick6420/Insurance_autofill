/* Popup controller: collect lead data from current tab, store it, and
   inject the filler scripts into Progressive / Foremost pages. */

const FIELDS = [
  "firstName", "lastName", "email", "phone",
  "dob", "address", "city", "state", "zip",
];

const STORAGE_KEY = "leadData";

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
  const { [STORAGE_KEY]: data } = await chrome.storage.local.get(STORAGE_KEY);
  if (data) writeForm(data);
}

async function saveForm() {
  await chrome.storage.local.set({ [STORAGE_KEY]: readForm() });
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
    if (!data) {
      setStatus("No data found on page.", "err");
      return;
    }
    const merged = { ...readForm(), ...cleanEmpty(data) };
    writeForm(merged);
    await saveForm();
    setStatus("Collected. Review / edit then click Fill.", "ok");
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
      which === "progressive" ? "fill-progressive.js" :
      which === "foremost"    ? "fill-foremost.js" :
                                "fill-auto.js";
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
  $("collectBtn").addEventListener("click", doCollect);
  $("fillProgressiveBtn").addEventListener("click", () => doFill("progressive"));
  $("fillForemostBtn").addEventListener("click", () => doFill("foremost"));
  $("fillAutoBtn").addEventListener("click", () => doFill("auto"));
});
