// Checkpoints are small and synchronous; text snapshots use bounded IndexedDB.
(() => {
  const prefix = "torah-reader-spot-v1|";
  const ttl = 24 * 60 * 60 * 1000;
  const maxRecordBytes = 4 * 1024 * 1024;
  const maxTotalBytes = 32 * 1024 * 1024;
  let dbPromise, currentSpot = null, scrollTimer, restoring = false;
  function openDb() {
    if (!dbPromise) dbPromise = new Promise(resolve => {
      if (!window.indexedDB) { resolve(null); return; }
      const request = indexedDB.open("torah-readers-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("entries", {keyPath:"id"});
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = request.onblocked = () => resolve(null);
    });
    return dbPromise;
  }
  const requestValue = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  function viewport() {
    const top = document.querySelector(".reader-toolbar")?.getBoundingClientRect().bottom || 0;
    const rows = [...document.querySelectorAll(".passage[data-reference]")];
    const row = rows.find(element => element.getBoundingClientRect().bottom > top + 2);
    return row ? {Reference:row.dataset.reference, Start:Number(row.dataset.start),
      Offset:Math.round((row.getBoundingClientRect().top - top) * 100)/100} : null;
  }
  function saveViewport() {
    if (!currentSpot || restoring) return;
    const view = viewport();
    if (view) {
      currentSpot.SourceReference = view.Reference;
      currentSpot.SourceStart = view.Start;
      currentSpot.Offset = view.Offset;
      try { localStorage.setItem(prefix + currentSpot.Reader, JSON.stringify(currentSpot)); } catch { }
    }
  }
  window.addEventListener("scroll", () => {
    clearTimeout(scrollTimer); scrollTimer = setTimeout(saveViewport, 250);
  }, {passive:true});
  window.addEventListener("pagehide", saveViewport);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveViewport(); });
  document.addEventListener("copy", event => {
    const selection = document.getSelection();
    const anchor = selection?.anchorNode;
    const element = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    if (!element?.closest?.('.reader[data-reader="torah"]')) return;
    const text = selection?.toString() ?? "";
    if (!text.includes("\u05C8") || !event.clipboardData) return;
    event.clipboardData.setData("text/plain", text.replace(/\u05C8/gu, "\u05B0"));
    event.preventDefault();
  });
  window.readerBrowser = {
    readBookmarks(reader, backup) {
      return localStorage.getItem('torah-reader-bookmarks-v1|' + reader + (backup ? '|backup' : ''));
    },
    writeBookmarks(reader, json, previous) {
      try {
        const key = 'torah-reader-bookmarks-v1|' + reader;
        localStorage.setItem(key + '|backup', previous);
        localStorage.setItem(key, json);
        return true;
      } catch { return false; }
    },
    visibleText() {
      return [...document.querySelectorAll('.passage[data-reference]')].map(row => ({
        key:row.dataset.key, reference:row.dataset.reference, start:Number(row.dataset.start),
        text:[...row.querySelectorAll('.reader-text,.translation')].map(text => text.textContent.replace(/\u05C8/gu, "\u05B0")).join('\n')
      }));
    },
    blurSearch() { document.querySelector('.reader-search input')?.blur(); },
    readSpot(reader) {
      try { return localStorage.getItem(prefix + reader); } catch { return null; }
    },
    saveSpot(reader, json) {
      try {
        const spot = JSON.parse(json);
        localStorage.setItem(prefix + reader, json); currentSpot = spot; return true;
      } catch { return false; }
    },
    stopCheckpoint() { saveViewport(); currentSpot = null; },
    viewport,
    async restoreAnchor(reference, start, offset) {
      restoring = true;
      try {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const candidates = [...document.querySelectorAll(".passage[data-reference]")]
          .filter(row => row.dataset.reference === reference);
        const row = candidates.filter(row => Number(row.dataset.start) <= start).at(-1) || candidates[0];
        if (row) {
          const top = document.querySelector(".reader-toolbar")?.getBoundingClientRect().bottom || 0;
          window.scrollTo(0, window.scrollY + row.getBoundingClientRect().top - top - offset);
        }
      } finally { restoring = false; }
    },
    async readCache(reader, key) {
      try {
        const db = await openDb(); if (!db) return null;
        const entry = await requestValue(db.transaction("entries").objectStore("entries").get(reader + "|" + key));
        return entry && entry.expires > Date.now() ? entry.json : null;
      } catch { return null; }
    },
    async writeCache(reader, key, json) {
      try {
        const bytes = new TextEncoder().encode(json).length;
        if (bytes > maxRecordBytes) return true; // Oversize content remains readable online.
        const db = await openDb(); if (!db) return false;
        const all = await requestValue(db.transaction("entries").objectStore("entries").getAll());
        const id = reader + "|" + key, kind = key.split("|")[0], now = Date.now();
        const capacity = kind === "page" ? 8 : 12;
        const alive = all.filter(item => item.id !== id && item.expires > now).sort((a,b) => b.created-a.created);
        const keep = new Set(); let total = bytes, siblings = 0;
        for (const entry of alive) {
          const sibling = entry.reader === reader && entry.kind === kind;
          if ((sibling && ++siblings >= capacity) || total + entry.bytes > maxTotalBytes) continue;
          keep.add(entry.id); total += entry.bytes;
        }
        return await new Promise(resolve => {
          const tx = db.transaction("entries", "readwrite"), store = tx.objectStore("entries");
          for (const entry of all) if (!keep.has(entry.id)) store.delete(entry.id);
          store.put({id, reader, kind, json, bytes, created:now, expires:now+ttl});
          tx.oncomplete = () => resolve(true);
          tx.onerror = tx.onabort = () => resolve(false);
        });
      } catch { return false; }
    },
    async nikudMarks(text) {
      const nikud = await import("./nikud.mjs");
      return nikud.marks(text);
    },
    async copy(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
    }
  };
})();
