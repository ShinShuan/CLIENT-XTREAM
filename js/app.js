/* ═══════════════════════════════════════════════════════
   Xtream IPTV Client - 100% statique (pas de backend)
   Utilise corsproxy.io pour contourner les limitations CORS.
   ═══════════════════════════════════════════════════════ */

const CORS_PROXIES = [
  // Essai direct d'abord (serveur peut supporter CORS)
  u => u,
  // Proxies CORS publics (fallbacks)
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://corsproxy.org/?.${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];
let corsIdx = 0;

async function corsFetch(url) {
  const proxyFn = CORS_PROXIES[corsIdx % CORS_PROXIES.length];
  try {
    const res = await fetch(proxyFn(url));
    if (!res.ok && corsIdx < CORS_PROXIES.length - 1) { corsIdx++; return corsFetch(url); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } catch (e) {
    if (corsIdx < CORS_PROXIES.length - 1) { corsIdx++; return corsFetch(url); }
    throw e;
  }
}

const state = {
  serverUrl: '', username: '', password: '', userInfo: null, serverInfo: null,
  activeTab: 'live',
  categories: { live: [], vod: [], series: [] },
  streams: { live: [], vod: [], series: [] },
  currentCategoryId: null,
};

const $ = (s, c) => (c||document).querySelector(s);
const $$ = (s, c) => (c||document).querySelectorAll(s);
const esc = s => { const d=document.createElement('div'); d.textContent=String(s||''); return d.innerHTML; };

async function apiCall(action, extra = {}) {
  const p = new URLSearchParams({ username: state.username, password: state.password, action, ...extra });
  const res = await corsFetch(`${state.serverUrl.replace(/\/+$/,'')}/player_api.php?${p}`);
  if (res.headers.get('content-type')?.includes('json')) return res.json();
  const t = await res.text(); try { return JSON.parse(t); } catch { return t; }
}

async function handleLogin(e) {
  e.preventDefault();
  const serverUrl = $('#serverUrl').value.trim(), username = $('#username').value.trim(), password = $('#password').value.trim();
  if (!serverUrl || !username || !password) return;
  showLoading(true); hideError();
  try {
    const baseUrl = serverUrl.replace(/\/+$/,'');
    const data = await apiCall('', {});
    if (data?.user_info?.auth === 1) {
      Object.assign(state, { serverUrl: baseUrl, username, password, userInfo: data.user_info, serverInfo: data.server_info });
      localStorage.setItem('xtream_session', JSON.stringify({ serverUrl: baseUrl, username, password, userInfo: data.user_info, serverInfo: data.server_info }));
      showLoading(false); enterApp();
    } else { showLoading(false); showError('Authentification échouée.'); }
  } catch(err) { showLoading(false); showError(`Erreur : ${err.message}`); }
}

function restoreSession() {
  try { const s = JSON.parse(localStorage.getItem('xtream_session') || '{}'); if (s.serverUrl) { Object.assign(state, s); return true; } } catch {}
  return false;
}

function logout() {
  localStorage.removeItem('xtream_session');
  Object.assign(state, { serverUrl:'', username:'', password:'', userInfo:null, serverInfo:null, categories:{live:[],vod:[],series:[]}, streams:{live:[],vod:[],series:[]}, activeTab:'live', currentCategoryId:null });
  $('#loginScreen').classList.add('active'); $('#mainScreen').classList.remove('active');
  $('#sideNav').classList.remove('open'); $('#menuToggle').classList.remove('active');
}

async function enterApp() {
  $('#loginScreen').classList.remove('active'); $('#mainScreen').classList.add('active');
  renderUserBadge(); showContentLoading(true);
  try {
    const [lc, vc, sc] = await Promise.all([
      apiCall('get_live_categories').catch(()=>[]),
      apiCall('get_vod_categories').catch(()=>[]),
      apiCall('get_series_categories').catch(()=>[]),
    ]);
    state.categories.live = Array.isArray(lc) ? lc : [];
    state.categories.vod = Array.isArray(vc) ? vc : [];
    state.categories.series = Array.isArray(sc) ? sc : [];
  } catch(_) {}
  switchTab('live'); showContentLoading(false);
}

function switchTab(tab) {
  state.activeTab = tab; state.currentCategoryId = null;
  $$('.nav-item, .bottom-nav-item').forEach(e => e.classList.toggle('active', e.dataset.tab === tab));
  $('#pageTitle').textContent = { live:'Live TV', vod:'Films', series:'Séries' }[tab] || '';
  $('#sideNav').classList.remove('open'); $('#menuToggle').classList.remove('active');
  renderCategories(); loadStreams();
}

function renderCategories() {
  const cats = state.categories[state.activeTab] || [];
  const row = $('#categoriesRow');
  row.innerHTML = '<button class="chip active" data-id="">Tous</button>' + cats.map(c => `<button class="chip" data-id="${c.category_id}">${esc(c.category_name)}</button>`).join('');
  row.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    row.querySelectorAll('.chip').forEach(x => x.classList.remove('active')); c.classList.add('active');
    state.currentCategoryId = c.dataset.id || null; loadStreams();
  }));
}

async function loadStreams() {
  showContentLoading(true);
  const tab = state.activeTab, catId = state.currentCategoryId;
  try {
    let data;
    if (tab === 'live') { data = await apiCall('get_live_streams', catId ? {category_id:catId} : {}); state.streams.live = Array.isArray(data)?data:[]; }
    else if (tab === 'vod') { data = await apiCall('get_vod_streams', catId ? {category_id:catId} : {}); state.streams.vod = Array.isArray(data)?data:[]; }
    else { data = await apiCall('get_series', catId ? {category_id:catId} : {}); state.streams.series = Array.isArray(data)?data:[]; }
    renderStreams();
  } catch(err) {
    $('#contentGrid').innerHTML = `<div class="empty-state"><p>Erreur : ${esc(err.message)}<br>Vérifie que le serveur est accessible depuis l'extérieur.</p></div>`;
  }
  showContentLoading(false);
}

function renderStreams() {
  const items = state.streams[state.activeTab] || [];
  const grid = $('#contentGrid');
  if (!items.length) { grid.innerHTML = '<div class="empty-state"><p>Aucun contenu</p></div>'; return; }
  grid.innerHTML = items.map(item => {
    const name = item.name||item.title||'Sans titre', poster = item.stream_icon||item.cover||'', year = item.year||item.release_date||'', id = item.stream_id??item.series_id??'';
    return `<div class="card" data-id="${id}" data-type="${state.activeTab}">
      ${poster ? `<img class="card-poster" src="${esc(poster)}" alt="${esc(name)}" loading="lazy" onerror="this.parentNode.innerHTML='<div class=\\'card-poster-placeholder\\'>📺</div>'">` : '<div class="card-poster-placeholder">📺</div>'}
      <div class="card-play-overlay"><div class="play-icon">▶</div></div>
      <div class="card-body"><div class="card-title">${esc(name)}</div>${year ? `<div class="card-sub">${esc(year)}</div>` : ''}</div>
    </div>`;
  }).join('');
  grid.querySelectorAll('.card').forEach(c => c.addEventListener('click', () => {
    const id = c.dataset.id, type = c.dataset.type;
    if (type === 'series') openSeriesEpisodes(parseInt(id));
    else openPlayer(id);
  }));
}

function buildUrl(id, ext='ts') { return `${state.serverUrl.replace(/\/+$/,'')}/live/${state.username}/${state.password}/${id}.${ext}`; }
function buildSeriesUrl(id, ext='ts') { return `${state.serverUrl.replace(/\/+$/,'')}/series/${state.username}/${state.password}/${id}.${ext}`; }
function guessExt(url) { return (url.split('?')[0].split('.').pop()||'ts').toLowerCase(); }

function openPlayer(id) {
  const sid = parseInt(id), url = buildUrl(sid, 'ts'), ext = guessExt(url);
  const item = (state.streams[state.activeTab]||[]).find(i => i.stream_id===sid||i.series_id===sid);
  const title = item?.name||item?.title||`Flux #${sid}`;
  $('#playerTitle').textContent = title; $('#playerUrl').textContent = url;
  if (isAndroid()) $('#playVlcBtn').href = `intent://play?url=${encodeURIComponent(url)}#Intent;package=org.videolan.vlc;end`;
  else if (isIOS()) $('#playVlcBtn').href = `vlc://${url}`;
  else $('#playVlcBtn').href = url;
  const proxyUrl = CORS_PROXIES[0](url);
  $('#playBrowserBtn').onclick = () => { $('#playerOverlay').classList.add('hidden'); playInBrowser(proxyUrl, ext, url); };
  $('#copyUrlBtn').onclick = () => {
    navigator.clipboard.writeText(url)
      .then(() => { $('#copyUrlBtn').textContent='✅ Copié !'; setTimeout(()=>{$('#copyUrlBtn').innerHTML=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copier l'URL`;},2000); })
      .catch(() => { navigator.clipboard.writeText(url); });
  };
  $('#closePlayerBtn').onclick = () => $('#playerOverlay').classList.add('hidden');
  $('#playerOverlay').classList.remove('hidden');
}

function playInBrowser(proxyUrl, ext, originalUrl) {
  const win = window.open('', '_blank', 'width=800,height=600');
  if (!win) { alert('Autorisez les popups.'); return; }
  const isHls = ext === 'm3u8';
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Xtream Player</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;display:flex;justify-content:center;min-height:100vh;font-family:sans-serif}video{max-width:100%;max-height:100vh;width:100%}.m{color:#9e9e9e;text-align:center;padding:40px;align-self:center}.m a{color:#00B4D8}.e{color:#cf6679}</style></head><body>
${isHls ? `<div class="m" id="s">Chargement HLS...</div><video id="v" controls autoplay playsinline></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"><\/script><script>
var u=${JSON.stringify(proxyUrl)},v=document.getElementById('v'),s=document.getElementById('s');
if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=u;s.remove()}
else if(typeof Hls!=='undefined'&&Hls.isSupported()){var h=new Hls({enableWorker:true});h.loadSource(u);h.attachMedia(v);h.on(Hls.Events.MANIFEST_PARSED,function(){s.remove();v.play().catch(function(){})});h.on(Hls.Events.ERROR,function(e,d){if(d.fatal){s.className='m e';s.innerHTML='Erreur HLS.<br><a href="${originalUrl}" target="_blank">Ouvrir dans VLC</a>'}})}
else{s.className='m e';s.innerHTML='HLS non supporté.<br><a href="${originalUrl}" target="_blank">VLC</a>'}
<\/script>`
: `<video id="v" controls autoplay playsinline src="${proxyUrl}"></video><div class="m" id="s">Si rien ne s'affiche : <a href="${originalUrl}" target="_blank">Ouvrir dans VLC</a></div><script>document.getElementById('v').addEventListener('error',function(){document.getElementById('s').innerHTML='Lecture impossible. <a href="${originalUrl}" target="_blank">VLC</a>'})<\/script>`}
</body></html>`);
  win.document.close();
}

async function openSeriesEpisodes(seriesId) {
  showContentLoading(true);
  try {
    const data = await apiCall('get_series_info', { series_id: seriesId });
    const series = state.streams.series.find(s => s.series_id === seriesId);
    const title = series?.name || `Série #${seriesId}`;
    if (!data?.seasons?.length) { alert('Aucun épisode.'); showContentLoading(false); return; }
    let html = `<div class="modal-overlay" id="seriesModal"><div class="modal-content"><div class="modal-header"><h3>${esc(title)}</h3><button class="icon-btn" onclick="this.closest('.modal-overlay').remove()">✕</button></div>`;
    data.seasons.forEach(s => {
      html += `<div class="season-title">${esc(s.name||`Saison ${s.season_number||''}`)}</div>`;
      (s.episodes||[]).forEach(ep => {
        const epNum = ep.num||'', epTitle = ep.title||`Ép ${epNum}`, epPlot = ep.info?.plot?.substring(0,80)+(ep.info?.plot?.length>80?'…':'')||'';
        html += `<div class="episode-item" data-id="${ep.id}" data-ext="${ep.container_extension||'ts'}">
          <div class="episode-num">${epNum}</div>
          <div class="episode-info"><div class="episode-title">${esc(epTitle)}</div>${epPlot?`<div class="episode-plot">${esc(epPlot)}</div>`:''}</div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>`;
      });
    });
    html += `</div></div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    document.querySelectorAll('.episode-item').forEach(el => {
      el.addEventListener('click', () => {
        const epId = el.dataset.id, ext = el.dataset.ext||'ts', streamUrl = buildSeriesUrl(parseInt(epId), ext);
        const epTitle = el.querySelector('.episode-title')?.textContent||`Épisode #${epId}`;
        document.getElementById('seriesModal')?.remove();
        $('#playerTitle').textContent = epTitle; $('#playerUrl').textContent = streamUrl;
        if (isAndroid()) $('#playVlcBtn').href = `intent://play?url=${encodeURIComponent(streamUrl)}#Intent;package=org.videolan.vlc;end`;
        else if (isIOS()) $('#playVlcBtn').href = `vlc://${streamUrl}`;
        else $('#playVlcBtn').href = streamUrl;
        const proxyUrl = CORS_PROXIES[0](streamUrl);
        $('#playBrowserBtn').onclick = () => { $('#playerOverlay').classList.add('hidden'); playInBrowser(proxyUrl, ext, streamUrl); };
        $('#copyUrlBtn').onclick = () => { navigator.clipboard.writeText(streamUrl).then(()=>$('#copyUrlBtn').textContent='✅ Copié !'); };
        $('#playerOverlay').classList.remove('hidden');
      });
    });
  } catch(err) { alert(`Erreur : ${err.message}`); }
  showContentLoading(false);
}

function showLoading(on) { $('#loginBtnText').classList.toggle('hidden', on); $('#loginSpinner').classList.toggle('hidden', !on); $('#loginBtn').disabled = on; }
function showError(m) { const e=$('#loginError'); e.textContent=m; e.classList.remove('hidden'); }
function hideError() { $('#loginError').classList.add('hidden'); }
function showContentLoading(on) { $('#loadingOverlay').classList.toggle('hidden', !on); }
function renderUserBadge() { $('#userBadge').textContent = `${state.userInfo?.username||'User'}${state.userInfo?.exp_date?` · Exp: ${new Date(parseInt(state.userInfo.exp_date)*1000).toLocaleDateString('fr-FR')}`:''}`; }
function isAndroid() { return /android/i.test(navigator.userAgent); }
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }

document.addEventListener('DOMContentLoaded', () => {
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#logoutBtn').addEventListener('click', logout);
  $('#menuToggle').addEventListener('click', () => { $('#sideNav').classList.toggle('open'); $('#menuToggle').classList.toggle('active'); });
  $$('.nav-item, .bottom-nav-item').forEach(e => e.addEventListener('click', () => switchTab(e.dataset.tab)));
  if (restoreSession()) enterApp();
});