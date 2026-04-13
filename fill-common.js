/* Shared helpers for the Progressive and Foremost fillers.
 *
 * Assigned onto window so later-injected files (fill-progressive.js /
 * fill-foremost.js) can use them.
 *
 * Key detail: Progressive (For Agents Only) runs client-side validation that
 * listens for real keyboard/input events. If we just set el.value the page
 * does not "see" the change and, worse, can crash on submit. So every field
 * write here goes through typeInto() which:
 *   - focuses the field,
 *   - clears it with a native value setter + input event,
 *   - types each character, firing keydown / keypress / input / keyup,
 *   - fires change + blur at the end.
 */
(() => {
  if (window.__leadFillCommonLoaded) return;
  window.__leadFillCommonLoaded = true;

  const STORAGE_KEY = "leadData";

  /* ---------- Native value setter (React / controlled inputs) ---------- */
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const protoSetter = Object.getOwnPropertyDescriptor(proto, "value");
    const ownSetter = Object.getOwnPropertyDescriptor(el, "value");
    if (ownSetter && protoSetter && ownSetter.set !== protoSetter.set) {
      protoSetter.set.call(el, value);
    } else if (protoSetter && protoSetter.set) {
      protoSetter.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- Simulated typing ---------- */
  async function typeInto(el, text, opts = {}) {
    if (!el) return false;
    const delay = opts.delay != null ? opts.delay : 18;
    text = text == null ? "" : String(text);

    // scroll into view and focus
    try { el.scrollIntoView({ block: "center" }); } catch (_) {}
    el.focus();
    el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    // Clear existing value.
    if (el.value) {
      // Select all and delete to mimic user clearing.
      try { el.setSelectionRange(0, el.value.length); } catch (_) {}
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      setNativeValue(el, "");
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "deleteContentBackward",
          data: null,
        })
      );
      el.dispatchEvent(new KeyboardEvent("keyup", { key: "Delete", bubbles: true }));
    }

    // Type each character.
    let current = "";
    for (const ch of text) {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true })
      );
      el.dispatchEvent(
        new KeyboardEvent("keypress", { key: ch, bubbles: true, cancelable: true })
      );
      current += ch;
      setNativeValue(el, current);
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: ch,
        })
      );
      el.dispatchEvent(
        new KeyboardEvent("keyup", { key: ch, bubbles: true, cancelable: true })
      );
      if (delay) await sleep(delay);
    }

    // Commit.
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    return true;
  }

  /* ---------- Field lookup ---------- */

  /**
   * Return the first visible input/textarea whose label, aria-label, name,
   * id, placeholder, or data-* attributes match the given RegExp.
   * Inputs of type hidden / button / submit / file are skipped.
   */
  function findField(pattern, opts = {}) {
    const skipTypes = new Set([
      "hidden", "button", "submit", "reset", "file",
      "checkbox", "radio", "image",
    ]);
    const isEligible = (el) => {
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      if (tag !== "input" && tag !== "textarea") return false;
      if (skipTypes.has((el.type || "").toLowerCase())) return false;
      if (el.disabled || el.readOnly) return false;
      if (el.offsetParent === null && el.getClientRects().length === 0) return false;
      return true;
    };

    // 1. <label for="...">
    const labels = document.querySelectorAll("label");
    for (const label of labels) {
      if (!pattern.test((label.textContent || "").trim())) continue;
      if (label.htmlFor) {
        const el = document.getElementById(label.htmlFor);
        if (isEligible(el)) return el;
      }
      const nested = label.querySelector("input, textarea");
      if (isEligible(nested)) return nested;
      const parent = label.parentElement;
      if (parent) {
        const near = parent.querySelector("input, textarea");
        if (isEligible(near)) return near;
      }
    }

    // 2. Attribute-based (aria-label, name, id, placeholder, data-label).
    const inputs = document.querySelectorAll("input, textarea");
    for (const el of inputs) {
      if (!isEligible(el)) continue;
      const attrs = [
        el.getAttribute("aria-label"),
        el.getAttribute("aria-labelledby"),
        el.name,
        el.id,
        el.placeholder,
        el.getAttribute("data-label"),
        el.getAttribute("data-test"),
        el.getAttribute("data-test-id"),
        el.getAttribute("title"),
        el.getAttribute("autocomplete"),
      ].filter(Boolean).join(" ");
      if (pattern.test(attrs)) return el;
    }

    // 3. Look for any element whose text matches, then find the closest input
    //    in the same row / parent.
    const all = document.querySelectorAll("span, div, td, th, p, strong, em, legend");
    for (const el of all) {
      const txt = (el.textContent || "").trim();
      if (!txt || txt.length > 80) continue;
      if (!pattern.test(txt)) continue;
      // walk up a few parents and try to find an input.
      let node = el;
      for (let i = 0; i < 4 && node; i++) {
        const found = node.querySelector && node.querySelector("input, textarea");
        if (isEligible(found)) return found;
        node = node.parentElement;
      }
    }
    return null;
  }

  /* ---------- Apply a mapping of {field: pattern} to lead data ---------- */
  async function applyMap(mapping, lead) {
    let filled = 0;
    for (const spec of mapping) {
      const value = lead[spec.key];
      if (!value) continue;
      let el = null;
      if (spec.selector) el = document.querySelector(spec.selector);
      if (!el && spec.pattern) el = findField(spec.pattern);
      if (!el) continue;
      await typeInto(el, value);
      filled++;
      await sleep(40);
    }
    return filled;
  }

  async function getLeadData() {
    const { [STORAGE_KEY]: data } = await chrome.storage.local.get(STORAGE_KEY);
    return data || {};
  }

  /* ---------- Export ---------- */
  window.__leadFill = {
    setNativeValue,
    typeInto,
    findField,
    applyMap,
    getLeadData,
    sleep,
  };
})();
