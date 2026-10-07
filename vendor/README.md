# Browser text aid

`havarotjs-0.25.5.mjs` is a browser ESM bundle of [havarotjs 0.25.5](https://github.com/charlesLoder/havarotjs), copyright Charles Loder, MIT. Its license is included in `havarotjs-LICENSE.txt`. Built with esbuild from the npm package's `dist/index.js`, using `--bundle --minify --format=esm --platform=browser --target=es2022`. It runs locally without a CDN.

The pronunciation aid preserves the source text. Qamats qatan is taken only from the source's U+05C7. Shvas are classified by syllabification, comparing traditional defaults with conservative long-vowel/meteg/shureq settings. Disagreements, malformed/unpointed words and the library's documented initial-shva exception in שתים retain an unclassified shva. This is a reading aid, not an authoritative vocalization edition.

The [Noto Serif Hebrew](https://github.com/google/fonts/tree/main/ofl/notoserifhebrew) font is bundled unchanged in `../fonts`, under its accompanying SIL Open Font License. It supports source qamats qatan and cantillation. CSS distinguishes classified shvas without replacing characters with font-dependent new Unicode signs.
