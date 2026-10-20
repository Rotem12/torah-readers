import { Text } from "./vendor/havarotjs-0.25.5.mjs";

const cache = new Map();
const clusterPattern = /[א-ת][\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7-\u05C9]*/gu;
const wordPattern = /[א-ת][\u0591-\u05C2\u05C4\u05C5\u05C7-\u05C9א-ת]*/gu;
const normal = value => value.normalize("NFD");

function analyzeClusters(word) {
  // Analyze traditional syllables, including qamats-qatan recognition. The
  // returned text is only for analysis; rendered source characters are never
  // replaced. Qamats qatan changes syllable boundaries and therefore shva.
  const analysis = new Text(word, {
    article: true, longVowels: true, qametsQatan: true,
    shevaAfterMeteg: true, shevaWithMeteg: true, sqnmlvy: true,
    wawShureq: true, holemHaser: "preserve", strict: true
  });
  // Read each syllable's own clusters: Text getters may materialize fresh
  // objects, so identity across separate getter calls is not a safe test.
  return analysis.syllables.flatMap(syllable => syllable.clusters.map((cluster, index) => ({
    text: normal(cluster.text),
    kind: !cluster.hasSheva ? "" : index === 0 ? "sheva-na" : "sheva-nach",
    qamatsQatan: cluster.text.includes("\u05C7")
  }))).filter(cluster => /[א-ת]/u.test(cluster.text));
}

export function marks(text) {
  if (cache.has(text)) return cache.get(text);
  const result = [];
  for (const word of text.matchAll(wordPattern)) {
    const clusters = [...word[0].matchAll(clusterPattern)];
    let syllables = [];
    try {
      syllables = analyzeClusters(word[0]);
    } catch { /* Unpointed, irregular and ketiv forms retain source rendering. */ }
    const aligned = syllables.length === clusters.length &&
      clusters.every((cluster, index) => normal(cluster[0]).replaceAll("\u05C7", "\u05B8") ===
        syllables[index].text.replaceAll("\u05C7", "\u05B8"));
    for (let index = 0; index < clusters.length; index++) {
      const cluster = clusters[index];
      let kind = cluster[0].includes("\u05C7") || aligned && syllables[index].qamatsQatan
        ? "qamats-qatan" : cluster[0].includes("\u05B8") ? "qamats" : "";
      if (cluster[0].includes("\u05C8")) kind = "sheva-na";
      else if (cluster[0].includes("\u05B0")) {
        // Havarot documents initial shva in שתים as an exception. Do not
        // confidently label that form or variants beginning with that cluster.
        const letters = word[0].replace(/[^א-ת]/gu, "");
        const exception = index === 0 && /^שת(?:י|ים)/u.test(letters);
        kind = aligned && !exception ? syllables[index].kind : "sheva-uncertain";
      }
      if (kind) result.push({ start: word.index + cluster.index, length: cluster[0].length, kind });
    }
  }
  if (cache.size >= 256) cache.delete(cache.keys().next().value);
  cache.set(text, result);
  return result;
}
