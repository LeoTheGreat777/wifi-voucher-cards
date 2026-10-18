# WiFi Voucher Cards

Turn guest Wi-Fi vouchers into good-looking cards, ready to hand out.

- **Add vouchers** by dropping in the PDF your firewall prints (FortiGate tested), a CSV/text file, or by typing them in.
- **Print on a Zebra label printer** (ZD421, 203 dpi, 90 × 50 mm labels) with a ready-made ZPL file, or through the normal printer driver.
- **Print on A4** for big batches: 10 cards per page with cut lines, or save as PDF.

Everything runs in the browser. PDFs are read on your computer and nothing is uploaded anywhere.

## Using it

1. Open the site.
2. Drop the voucher PDF on the page (or type/paste the vouchers). The validity line ("Valid for 12 hours") is filled in from the PDF when it has one.
3. Adjust the card if you like: title, notes, colours, logo, and an optional QR code that joins the Wi-Fi network.
4. Pick the output:
   - **Zebra label** → *Download ZPL file* and send it to the printer (see below), or *Print with driver*.
   - **A4 sheet** → *Print A4 / save as PDF*. Print at 100% (Actual size) with background graphics on.

Untick vouchers in the list to leave them out of a print run. Your card design is remembered in this browser; the voucher list is cleared when you close the tab.

## Sending the ZPL file to a ZD421

The ZPL file holds one label per voucher, each drawn as a 1-bit image at the printer's own resolution, so the label looks exactly like the preview.

- **Zebra Setup Utilities** (Windows): select the printer → *Open Communication With Printer* → *Send File*.
- **Shared printer on Windows**: `copy /b vouchers.zpl \\localhost\ZD421` (use the printer's share name).
- **Network printer**: `nc <printer-ip> 9100 < vouchers.zpl`.

Under *Printer settings* you can switch to 300 dpi, print more than one copy of each card, set darkness or speed, and shift the print if it isn't centred on the label.

If you print with the driver instead, set the paper size to 90 × 50 mm, scale 100%, and no margins.

## Input formats

| Source | Example |
| --- | --- |
| FortiGate voucher PDF | `User ID user0161` / `Password bexchzgf` / `Expiration 12 hour(s) and 0 minute(s)` |
| Labeled text | `Username: alice Password: s3cret` |
| CSV / one per line | `alice,s3cret` · `alice;s3cret` · `alice<TAB>s3cret` · `alice s3cret` |
| Code-only vouchers | `Voucher code: ABCD-1234`, or one code per line |

Scanned PDFs (pictures of text) can't be read; type those vouchers in instead.

## Development

No build step. Serve the folder with any static web server and open it:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # parser and ZPL tests (Node 20+)
```

| File | What it does |
| --- | --- |
| `js/parse.js` | Finds vouchers in text |
| `js/pdf-import.js` | Reads text from PDFs with pdf.js |
| `js/card.js` | The card layout (SVG, in millimetres) and the A4 sheet |
| `js/raster.js` | Draws a card as 1-bit dots for the Zebra |
| `js/zpl.js` | Builds compressed ZPL (`^GFA` graphic fields) |
| `js/main.js` | The page |

## Credits

- [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0), in `vendor/pdfjs`
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT), in `vendor/qrcode.mjs`
- [Inter](https://rsms.me/inter/) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) fonts (SIL Open Font License), in `vendor/fonts`
- The Hellenic Cables logo in `assets/` belongs to Hellenic Cables and is not covered by the MIT licence.
