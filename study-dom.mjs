export const palette = { amber:'#f59e0b', blue:'#3b82f6', green:'#22c55e', rose:'#f43f5e', purple:'#a855f7' };
const boundaryCache=new WeakMap();
export function sameSource(a,b) {
  return !!a && !!b && a.reader === b.reader && a.pageReference === b.pageReference && a.edition === b.edition &&
    a.language === b.language && a.adapterVersion === b.adapterVersion;
}
export function snap(text,start,end) {
  const boundaries = [...new Intl.Segmenter('he',{granularity:'grapheme'}).segment(text)].map(item=>item.index).concat(text.length);
  return { start:boundaries.filter(n=>n<=start).at(-1) ?? 0, end:boundaries.find(n=>n>=end) ?? text.length };
}
export function sourceRows() {
  return [...document.querySelectorAll('.passages > .passage')].map(element => ({element,
    text:element.querySelector(':scope > .original-text > .reader-text[data-canonical="true"]')})).filter(item=>item.text);
}
export function readSelection(segments) {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0), rows = sourceRows();
  const sourceRun = node => (node.nodeType === 1 ? node : node.parentElement)?.closest('[data-study-run]');
  const first = sourceRun(range.startContainer), last = sourceRun(range.endContainer);
  if (!first?.closest('[data-canonical="true"]') || !last?.closest('[data-canonical="true"]')) return null;
  // A selection inside another context must never acquire main-text coordinates.
  if ([...document.querySelectorAll('.note-panel:not([hidden]),.source-block:not([hidden]),.inline-citation,.translation')]
    .some(element => range.intersectsNode(element) && element.textContent.trim())) return null;
  const anchors = [];
  for (const row of rows) {
    const segment = segments.find(s=>s.reference === row.element.dataset.reference);
    if (!segment || !range.intersectsNode(row.text)) continue;
    let start = Infinity, end = -1;
    for (const run of row.text.querySelectorAll('[data-study-run]')) {
      if (!range.intersectsNode(run)) continue;
      const base = Number(run.dataset.start), length = Number(run.dataset.length);
      if (!Number.isSafeInteger(base) || !Number.isSafeInteger(length) || run.textContent.length !== length) return null;
      let a = 0, b = length;
      if (run.contains(range.startContainer)) { const r = document.createRange(); r.selectNodeContents(run); r.setEnd(range.startContainer,range.startOffset); a=r.toString().length; }
      if (run.contains(range.endContainer)) { const r = document.createRange(); r.selectNodeContents(run); r.setEnd(range.endContainer,range.endOffset); b=r.toString().length; }
      if (b>a) { start=Math.min(start,base+a); end=Math.max(end,base+b); }
    }
    if (end<start) continue;
    const boundary = snap(segment.text,start,end);
    anchors.push({reference:segment.reference,fingerprint:segment.fingerprint,start:segment.start+boundary.start,end:segment.start+boundary.end});
  }
  if (anchors.length === 0 || anchors.length > 8) return null;
  const indices=anchors.map(a=>segments.findIndex(s=>s.reference===a.reference));
  if (indices.some((n,i)=>i>0 && n!==indices[i-1]+1)) return null;
  return {anchors};
}
export function rangesFor(anchor,segments,rows=sourceRows()) {
  const segment=segments.find(s=>s.reference===anchor.reference && s.fingerprint===anchor.fingerprint);
  if (!segment || anchor.start<segment.start || anchor.end<=anchor.start || anchor.end>segment.start+segment.text.length) return [];
  let boundaries=boundaryCache.get(segment);
  if(!boundaries) {
    boundaries=new Set([...new Intl.Segmenter('he',{granularity:'grapheme'}).segment(segment.text)].map(item=>item.index).concat(segment.text.length));
    boundaryCache.set(segment,boundaries);
  }
  if(!boundaries.has(anchor.start-segment.start) || !boundaries.has(anchor.end-segment.start)) return [];
  const row=rows.find(item=>item.element.dataset.reference===anchor.reference);
  if (!row) return [];
  const output=[];
  for (const run of row.runs ??= [...row.text.querySelectorAll('[data-study-run]')]) {
    const start=segment.start+Number(run.dataset.start), length=Number(run.dataset.length);
    const a=Math.max(0,anchor.start-start), b=Math.min(length,anchor.end-start);
    if (b<=a || run.textContent.length!==length) continue;
    const walker=document.createTreeWalker(run,NodeFilter.SHOW_TEXT); const nodes=[]; let node;
    while ((node=walker.nextNode())) nodes.push(node);
    function location(offset) { for (const n of nodes) { if(offset<=n.length) return [n,offset]; offset-=n.length; } return null; }
    const first=location(a),last=location(b);
    if (first && last) { const range=document.createRange(); range.setStart(...first); range.setEnd(...last); output.push(range); }
  }
  return output;
}
