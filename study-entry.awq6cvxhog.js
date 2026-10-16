// Capture capabilities before the app starts, then remove them from browser history.
(() => {
  const url = new URL(location.href), roomId = url.searchParams.get('room');
  const fragment = new URLSearchParams(url.hash.slice(1));
  const invite = fragment.get('invite'), recovery = fragment.get('recover');
  if (/^[a-f0-9-]{36}$/i.test(roomId || '') && (/^[a-f0-9]{64}$/.test(invite || '') || /^[a-f0-9]{64}$/.test(recovery || ''))) {
    const value = { roomId, invite, recovery, expires: Date.now() + 15 * 60000 };
    window.studyEntry = value;
    try { sessionStorage.setItem('study-pending', JSON.stringify(value)); } catch { }
    url.hash = ''; history.replaceState(history.state, '', url);
  }
})();
