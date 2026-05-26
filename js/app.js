/* ═══════════════════════════════════════════════════════
   Xtream IPTV Client v3 - 100% statique (0 backend)
   Multiples proxies CORS publics pour les appels API.
   Lecture VLC : URL directe. Navigateur : via proxy.
   ═══════════════════════════════════════════════════════ */

const PROXIES = [
  u => u,
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function fetchViaProxy(url) {
  for (const fn of PROXIES) {
    try {
      const res = await fetch(fn(url), { mode: 'cors' });
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json')) return res.json();
        const t = await res.text();
        try { return JSON.parse(t); } catch { return t; }
      }
    } catch (_) {}
  }
  throw new Error('Connexion impossible (tous les proxies ont échoué)');
}

const state = {
  serverUrl:'', username:'', password:'', userInfo:null, serverInfo:null,
  activeTab:'live',
  categories:{live:[],vod:[],series:[]},
  streams:{live:[],vod:[],series:[]},
  currentCategoryId:null,
};

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => { const d=document.createElement('div'); d.textContent=String(s||''); return d.innerHTML; };

function apiUrl(action, extra={}) {
  const p = new URLSearchParams({ username:state.username, password:state.password, ...extra });
  if (action) p.set('action', action);
  return `${state.serverUrl.replace(/\/+$/,'')}/player_api.php?${p}`;
}
async function apiCall(action, extra) { return fetchViaProxy(apiUrl(action, extra)); }

async function handleLogin(e) {
  e.preventDefault();
  const srv = $('#serverUrl').value.trim(), usr = $('#username').value.trim(), pwd = $('#password').value.trim();
  if (!srv||!usr||!pwd) return;
  document.getElementById('loginBtn').disabled = true;
  $('#loginBtnText').classList.add('hidden');
  $('#loginSpinner').classList.remove('hidden');
  hideError();
  try {
    const base = srv.replace(/\/+$/,'');
    state.serverUrl = base; state.username = usr; state.password = pwd;
    const data = await apiCall('');
    if (data?.user_info?.auth === 1) {
      state.userInfo = data.user_info; state.serverInfo = data.server_info;
      localStorage.setItem('xt', JSON.stringify({serverUrl:base,username:usr,password:pwd,userInfo:data.user_info,serverInfo:data.server_info}));
      document.getElementById('loginBtn').disabled = false;
      $('#loginBtnText').classList.remove('hidden');
      $('#loginSpinner').classList.add('hidden');
      enterApp();
    } else {
      document.getElementById('loginBtn').disabled = false;
      $('#loginBtnText').classList.remove('hidden');
      $('#loginSpinner').classList.add('hidden');
      showError('Authentification échouée.');
    }
  } catch(err) {
    document.getElementById('loginBtn').disabled = false;
    $('#loginBtnText').classList.remove('hidden');
    $('#loginSpinner').classList.add('hidden');
    showError(`Erreur : ${err.message}`);
  }
}

function restoreSession() {
  try { const d = JSON.parse(localStorage.getItem('xt')||'{}'); if(d.serverUrl){ Object.assign(state,d); return true; } } catch {}
  return false;
}

function logout() {
  localStorage.removeItem('xt');
  Object.assign(state, {serverUrl:'',username:'',password:'',userInfo:null,serverInfo:null,categories:{live:[],vod:[],series:[]},streams:{live:[],vod:[],series:[]},activeTab:'live',currentCategoryId:null});
  $('#loginScreen').classList.add('active');
  $('#mainScreen').classList.remove('active');
  $('#sideNav').classList.remove('open');
}

async function enterApp() {
  $('#loginScreen').classList.remove('active');
  $('#mainScreen').classList.add('active');
  $('#userBadge').textContent = state.userInfo?.username||'User';
  $('#loadingOverlay').classList.remove('hidden');
  try {
    const [lc,vc,sc] = await Promise.all([
      apiCall('get_live_categories').catch(()=>[]),
      apiCall('get_vod_categories').catch(()=>[]),
      apiCall('get_series_categories').catch(()=>[]),
    ]);
    state.categories = {live:Array.isArray(lc)?lc:[], vod:Array.isArray(vc)?vc:[], series:Array.isArray(sc)?sc:[]};
  } catch(_) {}
  $('#loadingOverlay').classList.add('hidden');
  switchTab('live');
}

function switchTab(tab) {
  state.activeTab=tab; state.currentCategoryId=null;
  $$('.nav-item,.bottom-nav-item').forEach(e=>e.classList.toggle('active',e.dataset.tab===tab));
  $('#pageTitle').textContent={live:'Live TV',vod:'Films',series:'Séries'}[tab]||'';
  $('#sideNav').classList.remove('open');
  renderCategories();
  loadStreams();
}

function renderCategories() {
  const cats = state.categories[state.activeTab]||[];
  const row = $('#categoriesRow');
  row.innerHTML = '<button class="chip active" data-id="">Tous</button>'+cats.map(c=>`<button class="chip" data-id="${c.category_id}">${esc(c.category_name)}</button>`).join('');
  row.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>{
    row.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
    c.classList.add('active');
    state.currentCategoryId=c.dataset.id||null;
    loadStreams();
  }));
}

async function loadStreams() {
  $('#loadingOverlay').classList.remove('hidden');
  const tab=state.activeTab, catId=state.currentCategoryId;
  try {
    let data;
    if(tab==='live'){data=await apiCall('get_live_streams',catId?{category_id:catId}:{});state.streams.live=Array.isArray(data)?data:[];}
    else if(tab==='vod'){data=await apiCall('get_vod_streams',catId?{category_id:catId}:{});state.streams.vod=Array.isArray(data)?data:[];}
    else{data=await apiCall('get_series',catId?{category_id:catId}:{});state.streams.series=Array.isArray(data)?data:[];}
    renderStreams();
  } catch(err) {
    $('#contentGrid').innerHTML=`<div class="empty-state"><p>Erreur : ${esc(err.message)}</p></div>`;
  }
  $('#loadingOverlay').classList.add('hidden');
}

function renderStreams() {
  const items=state.streams[state.activeTab]||[];
  const grid=$('#contentGrid');
  if(!items.length){grid.innerHTML='<div class="empty-state"><p>Aucun contenu trouvé</p></div>';return;}
  grid.innerHTML=items.map(item=>{
    const name=item.name||item.title||'Sans titre', poster=item.stream_icon||item.cover||'', year=item.year||item.release_date||'', id=item.stream_id??item.series_id??'';
    return `<div class="card" data-id="${id}">${
      poster?`<img class="card-poster" src="${esc(poster)}" alt="${esc(name)}" loading="lazy" onerror="this.parentNode.innerHTML='<div class=\\'card-poster-placeholder\\'>📺</div>'">`:'<div class="card-poster-placeholder">📺</div>'}
      <div class="card-play-overlay"><div class="play-icon">▶</div></div>
      <div class="card-body"><div class="card-title">${esc(name)}</div>${year?`<div class="card-sub">${esc(year)}</div>`:''}</div></div>`;
  }).join('');
  grid.querySelectorAll('.card').forEach(c=>c.addEventListener('click',()=>{
    const id=c.dataset.id;
    if(state.activeTab==='series')openSeriesEpisodes(parseInt(id));
    else openPlayer(parseInt(id));
  }));
}

function streamUrl(id,ext='ts'){return `${state.serverUrl.replace(/\/+$/,'')}/live/${state.username}/${state.password}/${id}.${ext}`;}

function openPlayer(id) {
  const url=streamUrl(id,'ts'), ext=(url.split('?')[0].split('.').pop()||'ts').toLowerCase();
  const item=(state.streams[state.activeTab]||[]).find(i=>i.stream_id===id);
  const title=item?.name||item?.title||`Flux #${id}`;
  $('#playerTitle').textContent=title; $('#playerUrl').textContent=url;
  if(isAndroid())$('#playVlcBtn').href=`intent://play?url=${encodeURIComponent(url)}#Intent;package=org.videolan.vlc;end`;
  else if(isIOS())$('#playVlcBtn').href=`vlc://${url}`;
  else $('#playVlcBtn').href=url;
  $('#playBrowserBtn').onclick=()=>{$('#playerOverlay').classList.add('hidden');playInBrowser(PROXIES[1](url),ext,url);};
  $('#copyUrlBtn').onclick=()=>{navigator.clipboard.writeText(url);$('#copyUrlBtn').textContent='✅ Copié !';};
  $('#closePlayerBtn').onclick=()=>$('#playerOverlay').classList.add('hidden');
  $('#playerOverlay').classList.remove('hidden');
}

function playInBrowser(proxyUrl,ext,originalUrl) {
  const win=window.open('','_blank','width=800,height=600');
  if(!win){alert('Autorisez les popups.');return;}
  const hls=ext==='m3u8';
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Xtream Player</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;display:flex;justify-content:center;min-height:100vh;font-family:sans-serif}video{max-width:100%;max-height:100vh;width:100%}.m{color:#9e9e9e;text-align:center;padding:40px;align-self:center}.m a{color:#00B4D8}.e{color:#cf6679}</style></head><body>${
    hls?`<div class="m" id="s">Chargement...</div><video id="v" controls autoplay playsinline></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"><\/script><script>
var u=${JSON.stringify(proxyUrl)},v=document.getElementById('v'),s=document.getElementById('s');
if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=u;s.remove()}
else if(typeof Hls!=='undefined'&&Hls.isSupported()){var h=new Hls();h.loadSource(u);h.attachMedia(v);h.on(Hls.Events.MANIFEST_PARSED,function(){s.remove()});h.on(Hls.Events.ERROR,function(e,d){if(d.fatal){s.className='m e';s.innerHTML='<a href=\\"${originalUrl}\\" target=\\"_blank\\">Ouvrir dans VLC</a>'}})}
else{s.innerHTML='<a href=\\"${originalUrl}\\" target=\\"_blank\\">Ouvrir dans VLC</a>'}
<\/script>`:
`<video id="v" controls autoplay playsinline src="${proxyUrl}"></video><div class="m" id="s"><a href="${originalUrl}" target="_blank">Ouvrir dans VLC</a></div><script>document.getElementById('v').addEventListener('error',function(){document.getElementById('s').innerHTML='<a href=\\"${originalUrl}\\" target=\\"_blank\\">Ouvrir dans VLC</a>'})<\/script>`}
</body></html>`);
  win.document.close();
}

async function openSeriesEpisodes(seriesId) {
  $('#loadingOverlay').classList.remove('hidden');
  try {
    const data=await apiCall('get_series_info',{series_id:seriesId});
    const series=state.streams.series.find(s=>s.series_id===seriesId);
    if(!data?.seasons?.length){alert('Aucun épisode.');$('#loadingOverlay').classList.add('hidden');return;}
    let html=`<div class="modal-overlay" id="seriesModal"><div class="modal-content"><div class="modal-header"><h3>${esc(series?.name||`Série #${seriesId}`)}</h3><button class="icon-btn" onclick="this.closest('.modal-overlay').remove()">✕</button></div>`;
    data.seasons.forEach(s=>{
      html+=`<div class="season-title">${esc(s.name||`Saison ${s.season_number||''}`)}</div>`;
      (s.episodes||[]).forEach(ep=>{
        html+=`<div class="episode-item" data-id="${ep.id}" data-ext="${ep.container_extension||'ts'}">
          <div class="episode-num">${ep.num||''}</div>
          <div class="episode-info"><div class="episode-title">${esc(ep.title||`Ép ${ep.num||''}`)}</div></div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`;
      });
    });
    html+=`</div></div>`;
    document.body.insertAdjacentHTML('beforeend',html);
    document.querySelectorAll('.episode-item').forEach(el=>{
      el.addEventListener('click',()=>{
        const epId=el.dataset.id, ext=el.dataset.ext||'ts';
        const url=`${state.serverUrl.replace(/\/+$/,'')}/series/${state.username}/${state.password}/${epId}.${ext}`;
        const epTitle=el.querySelector('.episode-title')?.textContent||`Épisode #${epId}`;
        document.getElementById('seriesModal')?.remove();
        $('#playerTitle').textContent=epTitle; $('#playerUrl').textContent=url;
        if(isAndroid())$('#playVlcBtn').href=`intent://play?url=${encodeURIComponent(url)}#Intent;package=org.videolan.vlc;end`;
        else if(isIOS())$('#playVlcBtn').href=`vlc://${url}`;
        else $('#playVlcBtn').href=url;
        $('#playBrowserBtn').onclick=()=>{$('#playerOverlay').classList.add('hidden');playInBrowser(PROXIES[1](url),ext,url);};
        $('#copyUrlBtn').onclick=()=>{navigator.clipboard.writeText(url);$('#copyUrlBtn').textContent='✅ Copié !';};
        $('#playerOverlay').classList.remove('hidden');
      });
    });
  } catch(err){alert(`Erreur : ${err.message}`);}
  $('#loadingOverlay').classList.add('hidden');
}

function showError(m){const e=$('#loginError');e.textContent=m;e.classList.remove('hidden');}
function hideError(){$('#loginError').classList.add('hidden');}
function isAndroid(){return /android/i.test(navigator.userAgent);}
function isIOS(){return /iphone|ipad|ipod/i.test(navigator.userAgent);}

document.addEventListener('DOMContentLoaded',()=>{
  $('#loginForm').addEventListener('submit',handleLogin);
  $('#logoutBtn').addEventListener('click',logout);
  $('#menuToggle').addEventListener('click',()=>{$('#sideNav').classList.toggle('open');$('#menuToggle').classList.toggle('active');});
  $$('.nav-item,.bottom-nav-item').forEach(e=>e.addEventListener('click',()=>switchTab(e.dataset.tab)));
  if(restoreSession())enterApp();
});