# לימוד תורה

[Open the readers](https://Rotem12.github.io/torah-readers/).

Six Hebrew RTL readers: Tur, Gemara, Mishnah, Rambam, Shulchan Arukh and Midrash Rabbah. Source text, colored commentary, linked texts, glossary help, saved reading positions and offline access to recently loaded pages. Tur and Gemara are the initial validation priorities.

This public repository contains only the compiled website. Source code and the native applications stay in the private development repository. There are no account keys, debug symbols, test fixtures, OCR features or bundled text corpus. Browser WebAssembly code is publicly downloadable.

Texts and commentary links are loaded directly from Sefaria; edition/license metadata appears in the reader. Reading state stays in the browser and does not sync across devices. Open a reader to restore its saved place; choose a book on first use. Uncached texts need internet. After the PWA shell installs, recently loaded pages can be reopened offline.

Publishing is handled by GitHub Pages Actions. The compiled website is built and tested in the private development project before deployment. GitHub Pages provides the project URL for free; normal Pages quotas apply.
