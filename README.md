# Insurance Lead Autofill — Chrome Extension

A small Manifest V3 extension that:

1. **Collects** basic lead data (name, address, phone, DOB, email) from the
   current tab (the dialer / callback-script page) and stores it locally in
   `chrome.storage.local`.
2. **Fills** the visible text fields on the Progressive (For Agents Only) and
   Foremost STAR quote pages using **simulated typing** — not `.value =` —
   so the target site's client-side validators (especially Progressive) see
   real `keydown` / `keypress` / `input` / `keyup` events and do not crash.

Only these five pieces of lead data are ever collected or filled:

- Name (first + last)
- Address (street / city / state / ZIP)
- Phone number
- Date of birth
- Email

Dropdowns, checkboxes, radio buttons, and submit buttons are **never** touched.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Toggle on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder.
4. Pin the extension so its popup is one click away.

## Use

1. Open the lead in your dialer's callback-script page.
2. Click the extension icon → **Collect Data**. Review / tweak any fields in
   the popup — edits are saved automatically.
3. Switch to the Progressive (For Agents Only) or Foremost STAR tab.
4. Click **Fill Progressive**, **Fill Foremost**, or **Fill Current Page
   (auto)**.

The filler will type the lead's name, address, phone, email, and DOB into any
matching text inputs that exist on the currently visible page. For Foremost's
multi-page wizard, advance to each page and click Fill again.

## Files

| File                  | Purpose                                               |
|-----------------------|-------------------------------------------------------|
| `manifest.json`       | MV3 manifest                                          |
| `popup.html` / `.css` | Popup UI (Collect + Fill buttons + editable fields)   |
| `popup.js`            | Popup controller; injects the other scripts          |
| `collect.js`          | Scrapes lead data from the current tab                |
| `fill-common.js`      | Simulated-typing helpers shared by the fillers        |
| `fill-progressive.js` | Field mapping for Progressive For Agents Only         |
| `fill-foremost.js`    | Field mapping for Foremost STAR                       |
| `fill-auto.js`        | Detects site by hostname and runs the right mapping   |

## Why simulated typing?

Setting `el.value = "…"` bypasses React / Angular change tracking, and on
Progressive's For Agents Only portal it also lets validators get into an
inconsistent state that can crash the page on submit. `fill-common.js` instead:

- uses the native `value` property setter (so React sees the change),
- dispatches `keydown`, `keypress`, `input`, and `keyup` for every character,
- fires `focus` / `change` / `blur` to commit the field the same way a real
  user would.
