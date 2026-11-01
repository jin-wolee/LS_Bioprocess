# Fonts of the explainer

The explainer (`../index.html`) serves its own fonts, so a visitor's browser asks no other origin for anything. `../build.py` writes the `@font-face` rules (relative addresses, `font-display: swap`) and
`../../../scripts/assemble_site.py` copies this folder to `fonts/` of the published site, with the two licence texts beside the files.

Nothing here is edited: the files are the woff2 files that Google Fonts serves for these two families, stored byte for byte on 2026-11-01. They are the same files, at the same versions, that the page loaded
from `fonts.gstatic.com` before (the stylesheet request `https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap`, read with a desktop
Chrome user agent). Google Fonts splits each family by script; the subsets `latin` and `latin-ext` are kept, with the `unicode-range` of Google's stylesheet, so the browser asks for the same characters from
the same files as before. The page's own text uses `latin` alone. The other subsets (vietnamese, cyrillic) are not shipped, and Hangul stays with the system fonts, as it always did.

## Families

| Family | Version (name table of the file; Google Fonts path) | Axes the page uses | Upstream | Licence |
|---|---|---|---|---|
| Archivo | Version 2.001; `/s/archivo/v25/` | one variable file per subset: weight 400 to 800, width 62% to 125% (the font has weight 100 to 900) | https://github.com/Omnibus-Type/Archivo, Copyright 2020 The Archivo Project Authors | SIL Open Font License, Version 1.1: `OFL-Archivo.txt`, copy of https://github.com/google/fonts/tree/main/ofl/archivo |
| IBM Plex Mono | Version 2.3; `/s/ibmplexmono/v20/` | four static files per subset: weights 400, 500, 600, 700 | https://github.com/IBM/plex, Copyright 2017 IBM Corp. with Reserved Font Name "Plex" | SIL Open Font License, Version 1.1: `OFL-IBM-Plex-Mono.txt`, copy of https://github.com/google/fonts/tree/main/ofl/ibmplexmono |

Only these fonts are under the SIL Open Font License 1.1; the repository's own code and documents have the licences of ADR-0008. The OFL lets the files be bundled, embedded and redistributed with software
as long as the copyright notice and the licence text travel with them, and forbids selling them on their own. The Reserved Font Name "Plex" is the reason the files are kept unmodified. The licence texts are
copies of `OFL.txt` of the two families in https://github.com/google/fonts (branch `main`, read on 2026-11-01), unchanged; the Plex text keeps its CRLF line endings.

## Files

| File | Bytes | SHA-256 | Source |
|---|---|---|---|
| `archivo-latin.woff2` | 90096 | 4c98b9d490d1698ec95f2ff17a6c7d0e72691864c0c5d7bc2a2c161b45afe5ad | https://fonts.gstatic.com/s/archivo/v25/k3kQo8UDI-1M0wlSfdnoLmvDIaI.woff2 |
| `archivo-latin-ext.woff2` | 85856 | a75c792f980dc1dbe0e85efb721808267e32d2e7ef6c4a99d525c842d8712a08 | https://fonts.gstatic.com/s/archivo/v25/k3kQo8UDI-1M0wlSfdfoLmvDIaK18A.woff2 |
| `ibm-plex-mono-400-latin.woff2` | 10052 | c36f509c0a8f9f85f29cb44bc8701d8a9e0b14c499e77a884f789ead7093a7ac | https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q131nj-o.woff2 |
| `ibm-plex-mono-400-latin-ext.woff2` | 8860 | f1050dc5317b43434c0aeda599d4624c774ffc162e87a8cf204b949b6a85816d | https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1iEq131nj-otFQ.woff2 |
| `ibm-plex-mono-500-latin.woff2` | 10060 | a76f53ca6612e7b3828eec2311098675b7f9849ae4169a8bcef6302aec02a6c0 | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgsAXHNk.woff2 |
| `ibm-plex-mono-500-latin-ext.woff2` | 8848 | 77f03e26f981c582bdba3a7abed4baa2d3149211c01366bb3ab3ba7622ec4ae5 | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwl5FgsAXHNlYzg.woff2 |
| `ibm-plex-mono-600-latin.woff2` | 10120 | ad4580d8cb4b5f627c2d18457656732f7f7b070f7837fbc380e08054157e6f6c | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3vAOwlBFgsAXHNk.woff2 |
| `ibm-plex-mono-600-latin-ext.woff2` | 8960 | 1b6b18fd0fd240bc6d5850f4df621484722d4b5d3650ebdd1e3a8bbd81c75854 | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3vAOwl5FgsAXHNlYzg.woff2 |
| `ibm-plex-mono-700-latin.woff2` | 10128 | 9e1455e6e9c5866f607e464fffb7855486dcf575b7e69b83a3d234e587fce41b | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3pQPwlBFgsAXHNk.woff2 |
| `ibm-plex-mono-700-latin-ext.woff2` | 8748 | 099842414ddad0cb366cf984641b14e75c01a2c6e3f42fa13a6e89d1f4c3fc20 | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3pQPwl5FgsAXHNlYzg.woff2 |

The five `latin` files (130456 bytes) are what a cold load of the page fetches; the five `latin-ext` files (121272 bytes) are fetched only if the page ever shows a character of that subset. woff2 is
already Brotli-compressed, so gzip does not shrink it. `tests/test_explainer_fonts.py` checks every row of this table against the files.
