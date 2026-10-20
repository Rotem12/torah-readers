const observers = new WeakMap();
const columnWidth = 640;
const textSize = 32;
let pronunciationModule;

export async function analyzeWords(texts) {
  pronunciationModule ??= import("./nikud.mjs");
  const { marks } = await pronunciationModule;
  return texts.map(text => marks(text));
}

async function fontsReady(root) {
  const font = root.dataset.textFont === "noto-serif" ? '"Tikkun Noto Serif Hebrew"' : '"Tikkun Taamey Frank"';
  await document.fonts.load(`${textSize}px ${font}`);
  await document.fonts.ready;
}

function fit(root, zoom) {
  const viewport = root.querySelector(".tikkun-scroll-viewport");
  if (!viewport) return;
  const scale = Math.min(1, Math.max(200, viewport.clientWidth - 32) / columnWidth) * zoom / 100;
  for (const column of root.querySelectorAll(".tikkun-column")) {
    // Fit any unusually long source line once, including BOTH layers. A toggle
    // only changes visibility, so the word coordinates cannot move.
    for (const line of column.querySelectorAll(".tikkun-line")) {
      let size = textSize;
      line.style.fontSize = `${size}px`;
      const containers = [line, ...line.querySelectorAll(".tikkun-line-group,.tikkun-fragment")];
      // Song halves must each fit their own allotted width. Measuring only the
      // outer line misses a fragment overflowing into a paragraph/song gap.
      for (let attempt = 0; attempt < 12; attempt++) {
        const ratio = Math.min(1, ...containers.filter(container => container.clientWidth > 0)
          .map(container => container.scrollWidth > container.clientWidth + 1
            ? (container.clientWidth - 1) / container.scrollWidth : 1));
        if (ratio === 1) break;
        size *= Math.min(.98, ratio);
        line.style.fontSize = `${size}px`;
      }
    }
    column.style.transform = `scale(${scale})`;
    const shell = column.parentElement;
    shell.style.width = `${columnWidth * scale}px`;
    shell.style.height = `${column.offsetHeight * scale}px`;
  }
}

export async function layout(root, zoom) {
  await fontsReady(root);
  if (!root.isConnected) return;
  observers.get(root)?.disconnect();
  fit(root, zoom);
  const observer = new ResizeObserver(() => fit(root, zoom));
  observer.observe(root);
  observers.set(root, observer);
}

export async function relayoutAfterFont(root, zoom) {
  // Blazor applies the changed font attribute after the event handler returns.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await layout(root, zoom);
}

export function startPortion(root) {
  const word = root.querySelector("button.tikkun-word");
  if (!word) return;
  const toolbar = root.querySelector(".tikkun-toolbar").getBoundingClientRect().height;
  window.scrollTo({ top: window.scrollY + word.getBoundingClientRect().top - toolbar - 24, behavior: "instant" });
  root.querySelector(".tikkun-scroll-viewport").scrollLeft = 0;
}

export function unmount(root) {
  observers.get(root)?.disconnect();
  observers.delete(root);
}
