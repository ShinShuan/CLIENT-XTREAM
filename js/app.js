/* ═══════════════════════════════════════════════════════
   Xtream IPTV Client - Application Logic
   Utilise le proxy Vercel (/api/proxy) pour éviter CORS.
   ═══════════════════════════════════════════════════════ */

// ─── Config ──────────────────────────────────────────
const HLS_LIB = 'https://cdn.jsdelivr.net/npm/hls.js@latest';

// ─── State ───────────────────────────────────────────
const state = {
  serverUrl: '',
  username: '',
  password: '',
  userInfo: null,
  serverInfo: null,
  activeTab: 'live',
  categories: { live: [], vod: [], series: [] },
  streams: { live: [], vod: [], series: [] },
  currentCategoryId: null,
};

// ─── DOM helpers ─────────────────────────────────────
const $ = (sel, ctx) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx) => (ctx || document).querySelectorAll(sel);

// ─── Proxy fetch ─────────────────────────────────────
async function proxyFetch(url) {
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const e = await res.json(); msg = e.error || msg; } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

// ─── API ─────────────────────────────────────────────
async function apiCall(action, extra = {}) {
  const params = new URLSearchParams({
    username: state.username,
    password: state.password,
    action,
    ...extra,
  });
  const url = `${state.serverUrl.replace(/\/+$/, '')}/player_api.php?${params}`;
  return proxyFetch(url);
}

// ─── Login ───────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const serverUrl = $('#serverUrl').value.trim();
  const username = $('#username').value.trim();
  const password = $('#password').value.trim();
  if (!serverUrl || !username || !password) return;

  showLoading(true);
  hideError();

  try {
    const baseUrl = serverUrl.replace(/\/+$/, '');
    const params = new URLSearchParams({ username, password });
    const url = `${baseUrl}/player_api.php?${params}`;
    const data = await proxyFetch(url);

    if (data?.user_info?.auth === 1) {
      state.serverUrl = baseUrl;
      state.username = username;
      state.password = password;
      state.userInfo = data.user_info;
      state.serverInfo = data.server_info;

      localStorage.setItem('xtream_session', JSON.stringify({
        serverUrl: baseUrl, username, password,
        userInfo: data.user_info, serverInfo: data.server_info,
      }));

      showLoading(false);
      enterApp();
    } else {
      showLoading(false);
      showError('Authentification échouée. Vérifiez vos identifiants.');
    }
  } catch (err) {
    showLoading(false);
    showError(`Erreur de connexion : ${err.message}`);
  }
}

function restoreSession() {
  const raw = localStorage.getItem('xtream_session');
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    state.serverUrl = s.serverUrl;
    state.username = s.username;
    state.password = s.password;
    state.userInfo = s.userInfo;
    state.serverInfo = s.serverInfo;
    return true;
  } catch { return false; }
}

function logout() {
  localStorage.removeItem('xtream_session');
  Object.assign(state, {
    serverUrl: '', username: '', password: '',
    userInfo: null, serverInfo: null,
    categories: { live: [], vod: [], series: [] },
    streams: { live: [], vod: [], series: [] },
    activeTab: 'live', currentCategoryId: null,
  });
  $('#loginScreen').classList.add('active');
  $('#mainScreen').classList.remove('active');
  $('#sideNav').classList.remove('open');
  $('#menuToggle').classList.remove('active');
}

// ─── Enter app ───────────────────────────────────────
async function enterApp() {
  $('#loginScreen').classList.remove('active');
  $('#mainScreen').classList.add('active');
  renderUserBadge();
  showContentLoading(true);

  try {
    const [liveCats, vodCats, seriesCats] = await Promise.all([
      apiCall('get_live_categories').catch(() => []),
      apiCall('get_vod_categories').catch(() => []),
      apiCall('get_series_categories').catch(() => []),
    ]);
    state.categories.live = Array.isArray(liveCats) ? liveCats : [];
    state.categories.vod = Array.isArray(vodCats) ? vodCats : [];
    state.categories.series = Array.isArray(seriesCats) ? seriesCats : [];
  } catch (_) {}

  switchTab('live');
  showContentLoading(false);
}

// ─── Tabs ────────────────────────────────────────────
function switchTab(tab) {
  state.activeTab = tab;
  state.currentCategoryId = null;

  $$('.nav-item, .bottom-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  $('#pageTitle').textContent = { live: 'Live TV', vod: 'Films', series: 'Séries' }[tab] || '';

  $('#sideNav').classList.remove('open');
  $('#menuToggle').classList.remove('active');

  renderCategories();
  loadStreams();
}

// ─── Categories ──────────────────────────────────────
function renderCategories() {
  const cats = state.categories[state.activeTab] || [];
  const row = $('#categoriesRow');
  row.innerHTML = '<button class="chip active" data-id="">Tous</button>' +
    cats.map(c => `<button class="chip" data-id="${c.category_id}">${esc(c.category_name)}</button>`).join('');

  row.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      row.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.currentCategoryId = chip.dataset.id || null;
      loadStreams();
    });
  });
}

// ─── Load streams ────────────────────────────────────
async function loadStreams() {
  showContentLoading(true);
  const tab = state.activeTab;
  const catId = state.currentCategoryId;

  try {
    let data;
    switch (tab) {
      case 'live':
        data = await apiCall('get_live_streams', catId ? { category_id: catId } : {});
        state.streams.live = Array.isArray(data) ? data : [];
        break;
      case 'vod':
        data = await apiCall('get_vod_streams', catId ? { category_id: catId } : {});
        state.streams.vod = Array.isArray(data) ? data : [];
        break;
      case 'series':
        data = await apiCall('get_series', catId ? { category_id: catId } : {});
        state.streams.series = Array.isArray(data) ? data : [];
        break;
    }
    renderStreams();
  } catch (err) {
    $('#contentGrid').innerHTML = `<div class="empty-state"><p>Erreur : ${esc(err.message)}</p></div>`;
  }
  showContentLoading(false);
}

// ─── Render cards ────────────────────────────────────
function renderStreams() {
  const items = state.streams[state.activeTab] || [];
  const grid = $('#contentGrid');

  if (items.length === 0) {
    grid.innerHTML = '<div class="empty-state"><p>Aucun contenu trouvé</p></div>';
    return;
  }

  grid.innerHTML = items.map(item => {
    const name = item.name || item.title || 'Sans titre';
    const poster = item.stream_icon || item.cover || '';
    const year = item.year || item.release_date || '';
    const id = item.stream_id ?? item.series_id ?? '';
    const type = state.activeTab;
    return `<div class="card" data-id="${id}" data-type="${type}">
      ${poster
        ? `<img class="card-poster" src="${esc(poster)}" alt="${esc(name)}" loading="lazy" onerror="this.parentNode.innerHTML='<div class=\\'card-poster-placeholder\\'>📺</div>'">`
        : '<div class="card-poster-placeholder">📺</div>'}
      <div class="card-play-overlay"><div class="play-icon">▶</div></div>
      <div class="card-body">
        <div class="card-title">${esc(name)}</div>
        ${year ? `<div class="card-sub">${esc(year)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const type = card.dataset.type;
      if (type === 'series') openSeriesEpisodes(parseInt(id));
      else openPlayer(id, type);
    });
  });
}

// ─── Stream URLs (via proxy) ─────────────────────────
function buildStreamUrl(streamId, ext = 'ts') {
  const base = state.serverUrl.replace(/\/+$/, '');
  return `${base}/live/${state.username}/${state.password}/${streamId}.${ext}`;
}

function buildSeriesStreamUrl(episodeId, ext = 'ts') {
  const base = state.serverUrl.replace(/\/+$/, '');
  return `${base}/series/${state.username}/${state.password}/${episodeId}.${ext}`;
}

// ─── Player overlay ──────────────────────────────────
function openPlayer(id, type) {
  const streamId = parseInt(id);
  const streamUrl = buildStreamUrl(streamId, 'ts');
  const proxyUrl = `${window.location.origin}/api/proxy?url=${encodeURIComponent(streamUrl)}`;

  const items = state.streams[state.activeTab] || [];
  const item = items.find(i => (i.stream_id === streamId || i.series_id === streamId));
  const title = item?.name || item?.title || `Flux #${streamId}`;

  // Détection automatique du format
  const ext = guessExtension(streamUrl);

  $('#playerTitle').textContent = title;
  $('#playerUrl').textContent = streamUrl;

  // Bouton VLC
  const vlcBtn = $('#playVlcBtn');
  if (isAndroid()) {
    vlcBtn.href = `intent://play?url=${encodeURIComponent(streamUrl)}#Intent;package=org.videolan.vlc;end`;
  } else if (isIOS()) {
    vlcBtn.href = `vlc://${streamUrl}`;
  } else {
    vlcBtn.href = streamUrl;
  }

  // Bouton Navigateur
  $('#playBrowserBtn').onclick = () => {
    $('#playerOverlay').classList.add('hidden');
    playInBrowser(proxyUrl, ext);
  };

  // Copier URL
  $('#copyUrlBtn').onclick = () => {
    navigator.clipboard.writeText(streamUrl).then(() => {
      $('#copyUrlBtn').textContent = '✅ Copié !';
      setTimeout(() => {
        $('#copyUrlBtn').innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copier l'URL`;
      }, 2000);
    }).catch(() => {
      // Fallback
      navigator.permissions?.query?.({ name: 'clipboard-write' });
      const ta = document.createElement('textarea');
      ta.value = streamUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      $('#copyUrlBtn').textContent = '✅ Copié !';
    });
  };

  $('#closePlayerBtn').onclick = () => $('#playerOverlay').classList.add('hidden');
  $('#playerOverlay').classList.remove('hidden');
}

// ─── Browser playback ────────────────────────────────
function playInBrowser(url, ext) {
  const proxyUrl = `${window.location.origin}/api/proxy?url=${encodeURIComponent(url)}`;

  if (ext === 'm3u8') {
    // Le proxy réécrit automatiquement les URLs des segments .ts
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) { alert('Autorisez les popups pour la lecture navigateur.'); return; }
    win.document.write(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>Xtream Player</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;overflow:hidden}
    video{max-width:100%;max-height:100vh;width:100%}
    .error{color:#cf6679;text-align:center;padding:20px;font-family:sans-serif;width:100%}
    .info{color:#9e9e9e;text-align:center;padding:20px;font-family:sans-serif;font-size:14px}
  </style>
</head>
<body>
  <video id="v" controls autoplay playsinline></video>
  <div class="info">Chargement en cours... Laissez le temps au flux de démarrer.</div>
  <script src="${HLS_LIB}"><\/script>
  <script>
    (function(){
      var m3u8Url = ${JSON.stringify(proxyUrl)};
      var video = document.getElementById('v');
      var info = document.querySelector('.info');

      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = m3u8Url;
        info.remove();
      } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        var hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          maxBufferLength: 30,
          manifestLoadingTimeOut: 10000,
          levelLoadingTimeOut: 10000,
          fragLoadingTimeOut: 10000,
        });
        hls.loadSource(m3u8Url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function() {
          info.remove();
          video.play().catch(function(){});
        });
        hls.on(Hls.Events.ERROR, function(e, data) {
          if (data.fatal) {
            info.textContent = 'Erreur de lecture. Essayez VLC.';
            info.style.color = '#cf6679';
          }
        });
      } else {
        info.innerHTML = 'HLS non supporté.<br>Utilisez le bouton "Ouvrir dans VLC".';
        info.style.color = '#cf6679';
      }
    })();
  <\/script>
</body>
</html>
`);
    win.document.close();
  } else {
    // TS / MP4 → lecture native via proxy
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) { alert('Autorisez les popups pour la lecture navigateur.'); return; }
    win.document.write(`
<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Xtream Player</title>
<style>*{margin:0;box-sizing:border-box}
body{background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh}
video{max-width:100%;max-height:100vh;width:100%}</style></head>
<body><video id="v" controls autoplay playsinline src="${proxyUrl}"></video>
<script>document.querySelector('video').addEventListener('error',function(){
  document.body.innerHTML='<div style="color:#cf6679;text-align:center;padding:40px;font-family:sans-serif">Lecture impossible.<br>Utilisez le bouton VLC.</div>';
});<\/script>
</body></html>
`);
    win.document.close();
  }
}

// ─── Series episodes ─────────────────────────────────
async function openSeriesEpisodes(seriesId) {
  showContentLoading(true);
  try {
    const data = await apiCall('get_series_info', { series_id: seriesId });
    const series = state.streams.series.find(s => s.series_id === seriesId);
    const title = series?.name || `Série #${seriesId}`;

    if (!data?.seasons || data.seasons.length === 0) {
      alert('Aucun épisode trouvé.');
      showContentLoading(false);
      return;
    }

    let html = `<div class="modal-overlay" id="seriesModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>${esc(title)}</h3>
          <button class="icon-btn" onclick="this.closest('.modal-overlay').remove()">✕</button>
        </div>`;

    data.seasons.forEach(season => {
      const seasonName = season.name || `Saison ${season.season_number || ''}`;
      html += `<div class="season-title">${esc(seasonName)}</div>`;
      (season.episodes || []).forEach(ep => {
        const epNum = ep.num || '';
        const epTitle = ep.title || `Épisode ${epNum}`;
        const epPlot = ep.info?.plot
          ? ep.info.plot.substring(0, 80) + (ep.info.plot.length > 80 ? '…' : '')
          : '';
        html += `<div class="episode-item" data-id="${ep.id}" data-ext="${ep.container_extension || 'ts'}">
          <div class="episode-num">${epNum}</div>
          <div class="episode-info">
            <div class="episode-title">${esc(epTitle)}</div>
            ${epPlot ? `<div class="episode-plot">${esc(epPlot)}</div>` : ''}
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-cyan)" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </div>`;
      });
    });

    html += `</div></div>`;
    document.body.insertAdjacentHTML('beforeend', html);

    document.querySelectorAll('.episode-item').forEach(el => {
      el.addEventListener('click', () => {
        const epId = el.dataset.id;
        const ext = el.dataset.ext || 'ts';
        const streamUrl = buildSeriesStreamUrl(parseInt(epId), ext);
        const proxyUrl = `${window.location.origin}/api/proxy?url=${encodeURIComponent(streamUrl)}`;
        const epTitle = el.querySelector('.episode-title')?.textContent || `Épisode #${epId}`;
        document.getElementById('seriesModal')?.remove();

        $('#playerTitle').textContent = epTitle;
        $('#playerUrl').textContent = streamUrl;
        if (isAndroid()) {
          $('#playVlcBtn').href = `intent://play?url=${encodeURIComponent(streamUrl)}#Intent;package=org.videolan.vlc;end`;
        } else if (isIOS()) {
          $('#playVlcBtn').href = `vlc://${streamUrl}`;
        } else {
          $('#playVlcBtn').href = streamUrl;
        }
        $('#playBrowserBtn').onclick = () => {
          $('#playerOverlay').classList.add('hidden');
          playInBrowser(proxyUrl, ext);
        };
        $('#copyUrlBtn').onclick = () => {
          navigator.clipboard.writeText(streamUrl).then(() => {
            $('#copyUrlBtn').textContent = '✅ Copié !';
            setTimeout(() => {
              $('#copyUrlBtn').innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copier l'URL`;
            }, 2000);
          });
        };
        $('#playerOverlay').classList.remove('hidden');
      });
    });
  } catch (err) {
    alert(`Erreur : ${err.message}`);
  }
  showContentLoading(false);
}

// ─── Utilities ───────────────────────────────────────
function showLoading(on) {
  $('#loginBtnText').classList.toggle('hidden', on);
  $('#loginSpinner').classList.toggle('hidden', !on);
  $('#loginBtn').disabled = on;
}

function showError(msg) {
  const el = $('#loginError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError() { $('#loginError').classList.add('hidden'); }

function showContentLoading(on) {
  $('#loadingOverlay').classList.toggle('hidden', !on);
}

function renderUserBadge() {
  const name = state.userInfo?.username || 'Utilisateur';
  const exp = state.userInfo?.exp_date;
  const expStr = exp ? `Exp: ${new Date(parseInt(exp) * 1000).toLocaleDateString('fr-FR')}` : '';
  $('#userBadge').textContent = `${name}${expStr ? ` · ${expStr}` : ''}`;
}

function isAndroid() { return /android/i.test(navigator.userAgent); }
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }

function guessExtension(url) {
  const clean = url.split('?')[0].split('#')[0];
  const ext = clean.split('.').pop()?.toLowerCase() || 'ts';
  return ext;
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

// ─── Init ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#logoutBtn').addEventListener('click', logout);

  $('#menuToggle').addEventListener('click', () => {
    $('#sideNav').classList.toggle('open');
    $('#menuToggle').classList.toggle('active');
  });

  $$('.nav-item, .bottom-nav-item').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });

  // Close sidebar on backdrop click (mobile)
  $('#sideNav').addEventListener('click', (e) => {
    if (e.target === $('#sideNav')) {
      $('#sideNav').classList.remove('open');
      $('#menuToggle').classList.remove('active');
    }
  });

  if (restoreSession()) enterApp();
});