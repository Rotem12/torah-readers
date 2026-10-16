import { palette, sameSource, readSelection, rangesFor, sourceRows } from './study-dom.mjs';

let dotnet, client, config, configPromise, state, channel, presence, syncPromise, reconnect, retrying;
let segments=[], localSource, ready=false, following=true, active=false, retryTimer, pollTimer, retryCount=0, sessionGeneration=0;
let beacons=new Map(), overlay, lease, authListener, offset=0, paintFrame, connection=false, pendingCommand, lastSelection;
const tabId=crypto.randomUUID(), secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const messages={invalid_invite:'ההזמנה אינה תקפה. בקשו קישור חדש מהמארח.',expired:'המפגש הסתיים או שפג תוקפו.',
  full:'המפגש מלא (עד 25 משתתפים).',removed:'אין לך גישה למפגש הזה.',forbidden:'רק המנחה יכול לבצע פעולה זו.',
  conflict:'המקום המשותף השתנה. הפעולה לא נשלחה שוב; אפשר לנסות מהמקום החדש.',
  rate_limited:'נשלחו כמה פעולות קרובות זו לזו. המתינו רגע ונסו שוב.',highlight_limit:'המפגש הגיע למכסת הסימונים.',
  disabled:'הלימוד המשותף מושבת כרגע.',busy:'כל המפגשים הזמינים בשימוש. נסו שוב מאוחר יותר.',
  invalid:'הפעולה או המקור אינם נתמכים.',auth_required:'לא ניתן להתחבר כאורח.',unavailable:'החיבור למפגש אינו זמין. נסו שוב.',
  incompatible:'גרסת המפגש השתנתה. רעננו את הדף.'};
function fail(code) { const error=new Error(messages[code] || messages.unavailable); error.code=code; return error; }
function storageGet(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } }
function storageSet(key,value) { try { if(value===null) sessionStorage.removeItem(key); else sessionStorage.setItem(key,JSON.stringify(value)); } catch { } }
const report=(method,...args)=>dotnet?.invokeMethodAsync(method,...args).catch(()=>{});
function status(connected,text='') { connection=connected; report('OnStudyConnection',connected,text); }
export function initialize(reference) { dotnet=reference; window.addEventListener('resize',schedulePaint); window.addEventListener('scroll',schedulePaint,{passive:true});
  window.addEventListener('online',retry); window.addEventListener('offline',offline); document.addEventListener('visibilitychange',visible);
  document.addEventListener('selectionchange',rememberSelection); }
async function configuration() {
  if(!configPromise) configPromise=fetch(new URL('study-config.json',import.meta.url),{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
  config=await configPromise; return config;
}
export async function configured() {
  const c=await configuration();
  try { const url=new URL(c?.url); return !!(c.enabled && c.publishableKey && (url.protocol==='https:' ||
    (url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))); } catch { return false; }
}
async function provider() {
  if(!await configured()) throw fail('disabled');
  if(!client) {
    const {createClient}=await import('./vendor/supabase-js-2.117.3.mjs');
    client=createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},
      realtime:{params:{eventsPerSecond:3}},global:{headers:{'X-Client-Info':'torah-study/1'}}});
    authListener=client.auth.onAuthStateChange((event,session)=>{ if(session) client.realtime.setAuth(session.access_token); }).data.subscription;
  }
  return client;
}
async function authenticate() {
  const c=await provider();
  const signin=async()=>{
    const {data,error}=await c.auth.getSession(); if(error) throw fail('unavailable');
    if(data.session) { await c.realtime.setAuth(data.session.access_token); return; }
    const result=await c.auth.signInAnonymously();
    if(result.error || !result.data.session) throw fail('auth_required');
    await c.realtime.setAuth(result.data.session.access_token);
  };
  // Serialize first anonymous signup across tabs. The SDK owns token persistence and refresh.
  if(navigator.locks) await navigator.locks.request('torah-study-signin',signin); else await signin();
}
async function rpc(name,args) {
  const c=await provider(); const {data,error}=await c.rpc(name,args);
  if(error) throw fail(error.message==='rate_limited'?'rate_limited':'unavailable');
  if(data?.error) throw fail(data.error);
  return data;
}
async function roomSnapshot(roomId,known=state) {
  if(known?.room.id!==roomId) known=undefined;
  const result=await rpc('study_snapshot',{p_room:roomId,p_known_revision:known?.room.stateRevision ?? null,p_known_epoch:known?.room.epoch ?? null});
  return result.unchanged && known?{...known,serverTime:result.serverTime}:result;
}
export function entry(roomId) {
  if(!uuid.test(roomId || '')) return null;
  const value=window.studyEntry || storageGet('study-pending');
  if(value && value.expires<=Date.now()) { window.studyEntry=null; storageSet('study-pending',null); return null; }
  return value?.roomId===roomId && value.expires>Date.now()?{roomId,invite:value.invite,recovery:value.recovery}:null;
}
export function privateSpot(roomId,reader,json) {
  const key='study-private:'+roomId+':'+reader;
  if(json!==undefined) storageSet(key,json);
  return storageGet(key);
}
export async function preview(value) { await authenticate(); return rpc('study_preview',{p_room:value.roomId,p_secret:value.recovery||value.invite,p_recovery:!!value.recovery}); }
export async function create(focus,mode,name,color) {
  const generation=sessionGeneration;
  await authenticate();
  // Keep the same room/secrets if the response is lost. Nothing is exposed in the ordinary URL.
  let draft=storageGet('study-create');
  if(!draft || draft.expires<Date.now() || JSON.stringify(draft.focus)!==JSON.stringify(focus)) {
    draft={roomId:crypto.randomUUID(),invite:secret(),recovery:secret(),focus,expires:Date.now()+15*60000}; storageSet('study-create',draft);
  }
  const snapshot=await rpc('study_create',{p_room:draft.roomId,p_invite:draft.invite,p_recovery:draft.recovery,p_focus:focus,p_mode:mode,p_name:name,p_color:color});
  storageSet('study-secrets:'+draft.roomId,{invite:draft.invite,recovery:draft.recovery,expires:Date.parse(snapshot.room.expiresAt)+30*86400000});
  if(generation!==sessionGeneration) throw fail('unavailable');
  await activate(snapshot); storageSet('study-create',null);
  return {snapshot,invite:draft.invite,recovery:draft.recovery};
}
export async function join(value,name,color) {
  const generation=sessionGeneration;
  await authenticate();
  let nextRecovery;
  if(value.recovery) { const pending=storageGet('study-recover:'+value.roomId); nextRecovery=pending || secret(); storageSet('study-recover:'+value.roomId,nextRecovery); }
  const snapshot=await rpc('study_join',{p_room:value.roomId,p_secret:value.recovery||value.invite,p_name:name,p_color:color,p_recovery:!!value.recovery,p_new_recovery:nextRecovery||null});
  if(nextRecovery) { storageSet('study-secrets:'+value.roomId,{recovery:nextRecovery,expires:Date.parse(snapshot.room.expiresAt)+30*86400000}); storageSet('study-recover:'+value.roomId,null); }
  if(generation!==sessionGeneration) throw fail('unavailable');
  storageSet('study-pending',null); window.studyEntry=null; await activate(snapshot);
}
export async function resume(roomId) {
  const generation=sessionGeneration; await authenticate();
  const snapshot=await rpc('study_snapshot',{p_room:roomId});
  if(generation===sessionGeneration) await activate(snapshot);
}
function setState(snapshot) {
  if(snapshot.room.protocol!==1 || snapshot.room.focus.source.adapterVersion!==1) throw fail('incompatible');
  const changedFocus=state?.room.id!==snapshot.room.id || state?.room.focusRevision!==snapshot.room.focusRevision;
  if(state && state.room.id===snapshot.room.id && snapshot.room.stateRevision<state.room.stateRevision) return false;
  state=snapshot; offset=Date.parse(snapshot.serverTime)-Date.now();
  if(changedFocus) { beacons.clear(); lastSelection=undefined; ready=false; }
  report('OnStudyState',snapshot); schedulePaint();
  return true;
}
async function activate(snapshot) {
  const generation=await stopLive(); if(generation!==sessionGeneration) return;
  active=true; following=true; state=undefined; setState(snapshot);
  if(isOpen()) claimTab();
  await restart(generation);
}
function current(generation) { return active && generation===sessionGeneration; }
function claimTab() {
  if(typeof BroadcastChannel==='undefined') return;
  if(!lease) {
    lease=new BroadcastChannel('torah-study-tab'); lease.onmessage=event=>{
      if(event.data?.type==='claim' && event.data.tabId!==tabId && active) {
        stopLive(); status(false,'המפגש פתוח בלשונית אחרת. לחצו ״השתמש כאן״ כדי לחזור.'); schedulePaint();
      }
    };
  }
  lease.postMessage({type:'claim',tabId});
}
function isOpen() { return state && !state.room.endedAt && Date.parse(state.room.expiresAt)>Date.now()+offset; }
async function connect(generation=sessionGeneration) {
  if(!current(generation)) return;
  if(!isOpen()) { status(false,'המפגש הסתיים. הסימונים זמינים לקריאה.'); return; }
  const r=state.room, epoch=r.epoch, name='room:'+r.id+':'+epoch;
  let eventBuffer=[], buffering=true;
  const stillLive=()=>current(generation) && channel===events && state?.room.id===r.id;
  channel=client.channel(name+':events',{config:{private:true}})
    .on('broadcast',{event:'state'},({payload})=>{ if(!stillLive() || state?.room.epoch!==epoch) return;
      if(buffering) { eventBuffer.push(payload); if(eventBuffer.length>256) { eventBuffer=[]; resync(); } } else receive(payload); })
    .on('broadcast',{event:'point'},({payload})=>{ if(stillLive() && state?.room.epoch===epoch) pointReceived(payload); });
  presence=client.channel(name+':presence',{config:{private:true,presence:{key:state.selfId}}})
    .on('presence',{event:'sync'},()=>{ if(stillLive()) report('OnStudyPresence',Object.keys(people.presenceState())); });
  const events=channel, people=presence;
  try {
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(fail('unavailable')),12000);
      events.subscribe(s=>{
        if(!stillLive()) { clearTimeout(timeout); reject(fail('unavailable')); return; }
        if(s==='SUBSCRIBED') {
          clearTimeout(timeout); resolve();
          if(!buffering) resync().then(ok=>{ if(ok && stillLive() && isOpen()) { clearTimeout(retryTimer); retryCount=0; status(true); schedulePoll(generation); } });
        }
        if(s==='CHANNEL_ERROR' || s==='TIMED_OUT' || s==='CLOSED') { clearTimeout(timeout); reject(fail('unavailable')); if(!buffering) disconnected(); }
      });
    });
    if(!stillLive()) return;
    people.subscribe(s=>{ if(s==='SUBSCRIBED') setTimeout(()=>{ if(stillLive()) people.track({tabId}).catch(()=>{}); },Math.random()*3000); });
    const snapshot=await roomSnapshot(r.id);
    if(!stillLive()) return;
    if(snapshot.room.epoch!==epoch) { setState(snapshot); await removeChannels(); if(current(generation)) await connect(generation); return; }
    setState(snapshot); buffering=false;
    for(const event of eventBuffer) receive(event); eventBuffer=[];
    if(state.room.epoch!==epoch) { await removeChannels(); if(current(generation)) await connect(generation); return; }
    if(!isOpen()) { await removeChannels(); if(current(generation)) status(false,'המפגש הסתיים. הסימונים זמינים לקריאה.'); return; }
    if(!stillLive()) return;
    clearTimeout(retryTimer); retryCount=0; status(true); schedulePoll(generation);
  } catch(error) { if(stillLive()) handleConnectionError(error); }
}
function schedulePoll(generation=sessionGeneration) {
  clearTimeout(pollTimer);
  if(current(generation) && navigator.onLine && !document.hidden) pollTimer=setTimeout(async()=>{ await resync(); if(current(generation)) schedulePoll(generation); },30000);
}
function receive(event) {
  if(event.type==='revalidate') { resync(); return; }
  if(!state || event.protocol!==1 || event.roomId!==state.room.id || event.epoch!==state.room.epoch) { resync(); return; }
  apply(event.room,event.type,event.data);
}
function apply(room,type,data,serverTime) {
  if(!state || room.id!==state.room.id || room.stateRevision<=state.room.stateRevision) return;
  if(room.epoch!==state.room.epoch || room.stateRevision!==state.room.stateRevision+1 || type==='revalidate') { resync(); return; }
  let members=state.members, annotations=state.annotations;
  if(type==='member') members=[...members.filter(m=>m.id!==data.id),data];
  if(type==='annotation') annotations=[...annotations.filter(a=>a.id!==data.id),data];
  if(type==='delete') annotations=annotations.filter(a=>a.id!==data.id);
  setState({...state,room,members,annotations,serverTime:serverTime||new Date(Date.now()+offset).toISOString()});
}
async function resync() {
  if(!active || !state || !navigator.onLine) return false;
  const id=state.room.id, generation=sessionGeneration;
  if(syncPromise?.generation===generation) return syncPromise.promise;
  const operation={generation,promise:null};
  operation.promise=(async()=>{
    try {
      const snapshot=await roomSnapshot(id); if(!current(generation) || state?.room.id!==id) return false;
      const changedEpoch=snapshot.room.epoch!==state.room.epoch;
      if(!setState(snapshot)) return true;
      if(changedEpoch) await restart(generation);
      else if(!isOpen()) { await removeChannels(); if(current(generation)) status(false,'המפגש הסתיים. הסימונים זמינים לקריאה.'); }
      return current(generation);
    } catch(error) { if(current(generation)) handleConnectionError(error); return false; }
  })().finally(()=>{if(syncPromise===operation) syncPromise=undefined;});
  syncPromise=operation; return operation.promise;
}
async function removeChannels() { const old=[channel,presence].filter(Boolean); channel=presence=undefined;
  report('OnStudyPresence',[]);
  if(client) await Promise.allSettled(old.map(c=>client.removeChannel(c))); }
async function restart(generation=sessionGeneration) {
  if(!current(generation)) return;
  if(reconnect?.generation===generation) return reconnect.promise;
  const operation={generation,promise:null};
  status(false,'מתחבר למפגש…');
  operation.promise=(async()=>{ await removeChannels(); if(current(generation)) await connect(generation); })()
    .finally(()=>{if(reconnect===operation) reconnect=undefined;});
  reconnect=operation; return operation.promise;
}
function disconnected() { if(!active) return; status(false,'החיבור למפגש נותק. המקום והסימונים נשמרו; מתחבר שוב…'); scheduleRetry(); }
function handleConnectionError(error) {
  if(!active) return;
  status(false,error.message || messages.unavailable);
  if(['removed','invalid_invite','expired','disabled','incompatible'].includes(error.code)) { stopLive(); schedulePaint(); }
  else scheduleRetry();
}
function scheduleRetry() { clearTimeout(retryTimer); if(active && navigator.onLine) retryTimer=setTimeout(retry,Math.min(30000,1000*2**Math.min(retryCount++,5))+Math.random()*1000); }
export async function retry() {
  if(!state) return;
  if(retrying?.generation===sessionGeneration) return retrying.promise;
  const generation=++sessionGeneration, id=state.room.id, operation={generation,promise:null};
  active=true; clearTimeout(retryTimer); clearTimeout(pollTimer); status(false,'מתחבר למפגש…');
  if(isOpen()) claimTab();
  operation.promise=(async()=>{
    try {
      await removeChannels(); await authenticate(); if(!current(generation)) return;
      const snapshot=await rpc('study_snapshot',{p_room:id}); if(!current(generation)) return;
      setState(snapshot); await restart(generation);
    } catch(error) { if(current(generation)) handleConnectionError(error); }
  })().finally(()=>{if(retrying===operation) retrying=undefined;});
  retrying=operation; return operation.promise;
}
function offline() { clearTimeout(retryTimer); clearTimeout(pollTimer); if(active) status(false,'אין חיבור. אפשר להמשיך לקרוא; אפשר לשלוח פעולות שוב אחרי החיבור.'); }
function visible() { if(!document.hidden && active) { resync(); schedulePoll(); } else clearTimeout(pollTimer); }
export async function command(kind,data={}) {
  if(!active || !state || !connection || !isOpen()) throw fail('unavailable');
  if(['highlight','point'].includes(kind) && !ready) throw fail('invalid');
  if(['focus','control'].includes(kind) && (!localSource?.edition || !segments.length)) throw fail('invalid');
  const roomId=state.room.id, expected=state.room.focusRevision, generation=sessionGeneration;
  if(kind==='point') { await rpc('study_point',{p_room:roomId,p_focus:data.focus,p_expected:expected}); return; }
  if(kind==='rotate') {
    let next=storageGet('study-rotate:'+roomId); if(!next) {next=secret();storageSet('study-rotate:'+roomId,next);} data={secret:next};
  }
  // Retain one lost-response command for an explicit retry; never automatically replay offline focus.
  const identity=JSON.stringify({roomId,kind,data});
  const id=pendingCommand?.identity===identity?pendingCommand.id:crypto.randomUUID();
  const acceptedExpected=pendingCommand?.identity===identity?pendingCommand.expected:expected;
  pendingCommand={identity,id,expected:acceptedExpected};
  try {
    const result=await rpc('study_command',{p_room:roomId,p_id:id,p_kind:kind,p_data:data,p_expected:acceptedExpected});
    if(kind==='rotate') {const value=storageGet('study-secrets:'+roomId)||{};value.invite=data.secret;value.expires=Date.parse(result.room.expiresAt)+30*86400000;storageSet('study-secrets:'+roomId,value);storageSet('study-rotate:'+roomId,null);}
    if(pendingCommand?.id===id) pendingCommand=undefined;
    if(!current(generation)) return;
    apply(result.room,result.type,result.data,result.serverTime); if(result.type==='revalidate') await resync();
  } catch(error) { if(error.code!=='unavailable' && pendingCommand?.id===id) pendingCommand=undefined; if(error.code==='conflict' && current(generation)) await resync(); throw error; }
}
function rememberSelection() { if(ready) {const value=readSelection(segments);if(value)lastSelection={value,expires:performance.now()+15000};} }
export function selection() { if(!ready) return null; return readSelection(segments) || (lastSelection?.expires>performance.now()?lastSelection.value:null); }
export function setPage(source,rows,isReady) { if(!sameSource(source,localSource))lastSelection=undefined; localSource=source; segments=rows; ready=isReady && sameSource(source,state?.room.focus.source); beacons.clear(); schedulePaint(); }
export function setFollowing(value) { following=value; }
export function link(recovery=false) {
  if(!state || (!recovery && !isOpen())) return null; const values=storageGet('study-secrets:'+state.room.id);
  if(!values || values.expires<Date.now()) return null;
  const token=recovery?values.recovery:values.invite; if(!token) return null;
  const url=new URL(document.baseURI); url.searchParams.set('reader',state.room.focus.source.reader); url.searchParams.set('ref',state.room.focus.source.pageReference);
  url.searchParams.set('room',state.room.id); url.hash=(recovery?'recover=':'invite=')+token; return url.href;
}
function pointReceived(beacon) {
  const remaining=Math.min(6000,Date.parse(beacon.expiresAt)-(Date.now()+offset));
  if(!state || !ready || beacon.focusRevision!==state.room.focusRevision || !sameSource(beacon.focus?.source,localSource)
    || !state.members.some(m=>m.id===beacon.actorId) || !Number.isFinite(remaining) || remaining<=0) return;
  beacons.set(beacon.actorId,{...beacon,expires:performance.now()+remaining}); schedulePaint(); setTimeout(schedulePaint,remaining+100);
}
function schedulePaint() { if(!paintFrame) paintFrame=requestAnimationFrame(()=>{paintFrame=undefined;paint();}); }
export function paint() {
  const strip=document.querySelector('.study-strip');
  document.documentElement.style.setProperty('--study-strip-height',(strip?.getBoundingClientRect().height || 0)+'px');
  overlay?.remove(); overlay=undefined;
  if(!state || !localSource) return;
  const rows=sourceRows();
  overlay=document.createElement('div'); overlay.className='study-overlay'; overlay.setAttribute('aria-hidden','true'); document.body.append(overlay);
  function draw(anchor,color,label) {
    let first=true;
    for(const range of rangesFor(anchor,segments,rows)) for(const rect of range.getClientRects()) {
      if(!rect.width || !rect.height) continue;
      const box=document.createElement('span'); box.className=label?'study-beacon':'study-highlight';
      Object.assign(box.style,{left:rect.left+scrollX+'px',top:rect.top+scrollY+'px',width:rect.width+'px',height:rect.height+'px'});
      box.style.setProperty('--study-color',palette[color]||palette.amber);
      if(label && first) {const tag=document.createElement('span');tag.className='study-beacon-name';tag.textContent=label;box.append(tag);first=false;}
      overlay.append(box);
    }
  }
  for(const annotation of state.annotations) if(sameSource(annotation.source,localSource)) for(const anchor of annotation.anchors) draw(anchor,annotation.color);
  for(const [id,beacon] of beacons) { if(beacon.expires<performance.now()) {beacons.delete(id);continue;} const member=state.members.find(m=>m.id===id); draw(beacon.focus.anchor,member?.color,member?.name||'אורח'); }
}
async function stopLive() {
  const generation=++sessionGeneration; active=false; connection=false; clearTimeout(retryTimer);clearTimeout(pollTimer);
  lease?.close();lease=undefined;beacons.clear(); await removeChannels(); return generation;
}
export async function leave() {
  const generation=await stopLive(); if(generation!==sessionGeneration) return;
  state=undefined;segments=[];localSource=undefined;ready=false;following=true;pendingCommand=undefined;lastSelection=undefined;connection=false;overlay?.remove();overlay=undefined;
}
export async function dispose() { await leave();authListener?.unsubscribe();dotnet=undefined;
  window.removeEventListener('resize',schedulePaint);window.removeEventListener('scroll',schedulePaint);window.removeEventListener('online',retry);window.removeEventListener('offline',offline);document.removeEventListener('visibilitychange',visible);document.removeEventListener('selectionchange',rememberSelection); }
