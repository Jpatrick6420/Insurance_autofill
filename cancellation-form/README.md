# Farmers Cancellation Form Filler

A tiny, self-contained tool that fills the **Farmers Insurance policy
cancellation letter** (a flat, scanned one-page PDF) with typed values and
hands back a completed PDF ready to send for signature via **DocuSign**.

Because the source is a flat scan with no form fields, values are *stamped*
onto the page at fixed coordinates rather than typed into fillable fields.

## What it fills

| Field | Notes |
|-------|-------|
| Date | Date at the top of the letter |
| Name | Insured's name |
| Address | Insured's address (single line) |
| Insurance Company | The carrier being cancelled |
| Policy Number(s) | Up to 4 lines |
| Date on Cancellation | Effective cancellation date |

The **Insured's Signature** line is intentionally left blank — it is signed in
DocuSign.

## Use

1. Open `index.html` in any browser (double-click it, or host it).
2. Type the values into the form.
3. Click **Generate & Download Filled PDF**.
4. `Farmers-Cancellation.pdf` downloads — upload that to DocuSign for signing.

> Requires an internet connection the first time so the page can load the
> `pdf-lib` library from a CDN. Everything else (including the blank form) is
> embedded in the page, so no upload or server is needed.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The form UI and fill/download logic |
| `template-pdf.js` | The blank Farmers form, embedded as base64 |
| `farmers-cancellation-blank.pdf` | The original blank form (source of the embed) |

## Adjusting field positions

Coordinates live in the `FIELDS` map in `index.html`. Each entry is the text
**baseline** measured from the **top-left** of the page, in PDF points
(the page is 613.44 × 792 pt). They are converted to pdf-lib's bottom-left
origin at draw time (`y = pageHeight - yTop`). Increase `yTop` to move a value
down; increase `x` to move it right.
