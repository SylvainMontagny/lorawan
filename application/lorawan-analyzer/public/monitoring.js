// Monitoring page — gateway and device card grid

const BASE_PATH = window.location.pathname.replace(/\/[^/]*$/, '');

function api(path) {
  return fetch(BASE_PATH + path).then(r => r.json());
}

// ---- State ----
let currentView = document.body.dataset.view || 'gateways';
let selectedHours = 24;
let selectedGroup = null;
let searchQuery = '';
let sortBy = 'packets';
let filterMode = 'all';
let myPrefixes = [];

let allGateways = [];
let allDevices = [];
let devicesLoaded = false;

let ws = null;
let ageTimer = null;

const gatewayCardMap = new Map();
const deviceCardMap  = new Map();

// ---- Helpers ----
function formatAge(seconds) {
  if (seconds < 0) seconds = 0;
  if (seconds < 60)    return `${Math.round(seconds)}s`;
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function formatAirtime(ms) {
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(1)}h`;
  if (ms >= 60000)   return `${(ms / 60000).toFixed(1)}m`;
  if (ms >= 1000)    return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function rssiColor(rssi) {
  if (rssi >= -90)  return '#4ade80';
  if (rssi >= -105) return '#fbbf24';
  return '#f87171';
}

function parseRawNumber(s) {
  if (!s) return 0;
  s = s.trim();
  if (s.endsWith('M')) return parseFloat(s) * 1000000;
  if (s.endsWith('k')) return parseFloat(s) * 1000;
  return parseInt(s, 10) || 0;
}

// ---- Colour update (uses shared utils.js functions) ----
function applyAgeColor(card, ageS) {
  const hex = card.dataset.ageClass === 'gw'
    ? calculateGatewayColor(ageS)
    : calculateDeviceColor(ageS);
  applyCardColor(card, hex);
}

// ---- Flash animation — same as iot-dashboard ----
function triggerFlash(card) {
  const flash = card.querySelector('.mon-flash');
  if (!flash) return;
  // Restart animation by removing then re-adding class
  flash.classList.remove('active', 'restart');
  if (flash._animating) {
    flash.classList.add('restart');
  } else {
    void flash.offsetWidth; // reflow
    flash.classList.add('active');
  }
  flash._animating = true;
  flash.addEventListener('animationend', () => {
    flash._animating = false;
    flash.classList.remove('active', 'restart');
  }, { once: true });
}

// ---- Card builders ----
function buildGatewayCard(gw) {
  const lastSeen = new Date(gw.last_seen);
  const ageS = (Date.now() - lastSeen.getTime()) / 1000;
  const label = escHtml(gw.alias || gw.name || gw.gateway_id);
  const subName = (gw.alias && gw.name) ? escHtml(gw.name) : '';
  const airtime = gw.total_airtime_ms > 0 ? formatAirtime(gw.total_airtime_ms) : '—';

  const el = document.createElement('a');
  el.className = 'mon-card';
  el.href = `${BASE_PATH}/?gw=${encodeURIComponent(gw.gateway_id)}${selectedHours !== 24 ? `&hours=${selectedHours}` : ''}`;
  el.dataset.id = gw.gateway_id;
  el.dataset.lastSeen = lastSeen.getTime();
  el.dataset.ageClass = 'gw';
  el.innerHTML = `
    <div class="mon-alias">${label}</div>
    ${subName ? `<div class="mon-name">${subName}</div>` : ''}
    <div class="mon-id">${escHtml(gw.gateway_id)}</div>
    ${gw.group_name ? `<div class="mon-group">${escHtml(gw.group_name)}</div>` : ''}
    <div class="mon-age" data-age-el>${formatAge(ageS)}</div>
    <div class="mon-stats">
      <div class="mon-stat">
        <span class="mon-stat-label">Packets</span>
        <span class="mon-stat-value" data-field="packets">${formatNumber(gw.packet_count)}</span>
      </div>
      <div class="mon-stat">
        <span class="mon-stat-label">Devices</span>
        <span class="mon-stat-value" data-field="devices">${formatNumber(gw.unique_devices)}</span>
      </div>
      <div class="mon-stat">
        <span class="mon-stat-label">Airtime</span>
        <span class="mon-stat-value">${airtime}</span>
      </div>
    </div>
    <div class="mon-flash"></div>`;
  applyAgeColor(el, ageS);
  return el;
}

function buildDeviceCard(dev) {
  const lastSeen = new Date(dev.last_seen);
  const ageS = (Date.now() - lastSeen.getTime()) / 1000;
  const label = dev.device_name || dev.dev_addr;
  const sublabel = dev.device_name ? dev.dev_addr : null;
  const lossHtml = typeof dev.loss_percent === 'number' && dev.loss_percent > 0
    ? `<div class="mon-stat"><span class="mon-stat-label">Loss</span><span class="mon-stat-value" style="color:${dev.loss_percent > 20 ? '#f87171' : dev.loss_percent > 5 ? '#fbbf24' : '#4ade80'}">${dev.loss_percent.toFixed(0)}%</span></div>`
    : '';

  const el = document.createElement('div');
  el.className = 'mon-card';
  el.dataset.id = dev.dev_addr;
  el.dataset.lastSeen = lastSeen.getTime();
  el.dataset.ageClass = 'dev';
  el.innerHTML = `
    <div class="mon-alias">${escHtml(label)}</div>
    ${sublabel ? `<div class="mon-id">${escHtml(sublabel)}</div>` : ''}
    ${dev.operator ? `<span class="mon-operator-badge">${escHtml(dev.operator)}</span>` : ''}
    <div class="mon-age" data-age-el>${formatAge(ageS)}</div>
    <div class="mon-stats">
      <div class="mon-stat">
        <span class="mon-stat-label">Packets</span>
        <span class="mon-stat-value" data-field="packets">${formatNumber(dev.packet_count)}</span>
      </div>
      ${typeof dev.avg_rssi === 'number' ? `<div class="mon-stat"><span class="mon-stat-label">RSSI</span><span class="mon-stat-value mon-rssi" data-field="rssi" style="color:${rssiColor(dev.avg_rssi)}">${dev.avg_rssi.toFixed(0)} dBm</span></div>` : ''}
      ${lossHtml}
    </div>
    <div class="mon-flash"></div>`;
  el.addEventListener('click', () => {
    const target = (dev.dev_eui && filterMode === 'chirpstack') ? `eui=${encodeURIComponent(dev.dev_eui)}` : `addr=${encodeURIComponent(dev.dev_addr)}`;
    window.location.href = `${BASE_PATH}/device.html?${target}${selectedHours !== 24 ? `&hours=${selectedHours}` : ''}`;
  });
  applyAgeColor(el, ageS);
  return el;
}

// ---- Age update loop ----
function startAgeTimer() {
  if (ageTimer) clearInterval(ageTimer);
  ageTimer = setInterval(() => {
    const now = Date.now();
    document.querySelectorAll('.mon-card[data-last-seen]').forEach(card => {
      const ageS = (now - parseInt(card.dataset.lastSeen, 10)) / 1000;
      const ageEl = card.querySelector('[data-age-el]');
      if (ageEl) ageEl.textContent = formatAge(ageS);
      applyAgeColor(card, ageS);
    });
  }, 1000);
}

// ---- WebSocket ----
function connectWebSocket() {
  if (ws) { ws.close(); ws = null; }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams();
  if (selectedGroup) params.set('group_name', selectedGroup);
  if (filterMode === 'chirpstack') params.set('filter_mode', 'chirpstack');
  const qs = params.toString();
  ws = new WebSocket(`${protocol}//${location.host}${BASE_PATH}/api/live${qs ? '?' + qs : ''}`);
  ws.onmessage = (e) => handleLivePacket(JSON.parse(e.data));
  ws.onerror = (e) => console.error('Monitoring WS error:', e);
  ws.onclose = () => { if (ws) setTimeout(connectWebSocket, 5000); };
}

function handleLivePacket(pkt) {
  const now = Date.now();

  if (pkt.gateway_id) {
    const card = gatewayCardMap.get(pkt.gateway_id);
    if (card) {
      card.dataset.lastSeen = now;
      const ageEl = card.querySelector('[data-age-el]');
      if (ageEl) ageEl.textContent = '0s';
      applyAgeColor(card, 0);
      const pktsEl = card.querySelector('[data-field="packets"]');
      if (pktsEl) pktsEl.textContent = formatNumber(parseRawNumber(pktsEl.textContent) + 1);
      triggerFlash(card);
    }
  }

  if ((pkt.dev_addr || pkt.dev_eui) && (pkt.type === 'data' || pkt.type === 'join_request')) {
    const card = deviceCardMap.get(pkt.dev_eui) || deviceCardMap.get(pkt.dev_addr);
    if (card) {
      card.dataset.lastSeen = now;
      const ageEl = card.querySelector('[data-age-el]');
      if (ageEl) ageEl.textContent = '0s';
      applyAgeColor(card, 0);
      const pktsEl = card.querySelector('[data-field="packets"]');
      if (pktsEl) pktsEl.textContent = formatNumber(parseRawNumber(pktsEl.textContent) + 1);
      if (typeof pkt.rssi === 'number') {
        const rssiEl = card.querySelector('[data-field="rssi"]');
        if (rssiEl) { rssiEl.textContent = `${pkt.rssi.toFixed(0)} dBm`; rssiEl.style.color = rssiColor(pkt.rssi); }
      }
      triggerFlash(card);
    }
  }
}

// ---- Filter + sort ----
function matchSearch(text, query) {
  if (!query) return true;
  const lower = text.toLowerCase();
  return query.toLowerCase().split('|').some(part =>
    part.trim().split(/\s+/).every(w => lower.includes(w))
  );
}

function filteredGateways() {
  let items = allGateways;
  if (selectedGroup === '__none__') items = items.filter(g => !g.group_name || !g.group_name.trim());
  else if (selectedGroup)          items = items.filter(g => g.group_name === selectedGroup);
  if (searchQuery) items = items.filter(g => matchSearch(`${g.alias||''} ${g.name||''} ${g.gateway_id} ${g.group_name||''}`, searchQuery));
  return [...items].sort((a, b) => {
    if (sortBy === 'packets') return b.packet_count - a.packet_count;
    if (sortBy === 'devices') return b.unique_devices - a.unique_devices;
    if (sortBy === 'name')    return (a.alias||a.name||a.gateway_id).localeCompare(b.alias||b.name||b.gateway_id);
    return new Date(b.last_seen) - new Date(a.last_seen);
  });
}

function filteredDevices() {
  let items = allDevices;
  if (searchQuery) items = items.filter(d => matchSearch(`${d.dev_addr} ${d.operator||''}`, searchQuery));
  return [...items].sort((a, b) => {
    if (sortBy === 'packets') return b.packet_count - a.packet_count;
    if (sortBy === 'name')    return a.dev_addr.localeCompare(b.dev_addr);
    return new Date(b.last_seen) - new Date(a.last_seen);
  });
}

// ---- Render ----
function renderGrid() {
  const grid  = document.getElementById('monitoring-grid');
  const empty = document.getElementById('monitoring-empty');
  grid.innerHTML = '';
  gatewayCardMap.clear();
  deviceCardMap.clear();

  const items = currentView === 'gateways' ? filteredGateways() : filteredDevices();
  empty.classList.toggle('hidden', items.length > 0);

  items.forEach(item => {
    const card = currentView === 'gateways' ? buildGatewayCard(item) : buildDeviceCard(item);
    grid.appendChild(card);
    if (currentView === 'gateways') gatewayCardMap.set(item.gateway_id, card);
    else deviceCardMap.set(filterMode === 'chirpstack' ? (item.dev_eui || item.dev_addr) : item.dev_addr, card);
  });

  startAgeTimer();
}

// ---- Data loading ----
async function loadGateways() {
  const params = new URLSearchParams({ hours: selectedHours });
  const data = await api(`/api/gateways?${params}`);
  allGateways = data.gateways || [];
  buildGroupFilter(allGateways, selectedGroup);
}

async function loadDevices() {
  if (devicesLoaded) return;
  devicesLoaded = true;
  const params = new URLSearchParams({ hours: selectedHours });
  if (selectedGroup && selectedGroup !== '__none__') params.set('group_name', selectedGroup);
  else if (selectedGroup === '__none__') params.set('group_name', '__none__');
  if (filterMode === 'chirpstack') {
    params.set('source', 'chirpstack');
  } else if ((filterMode === 'owned' || filterMode === 'foreign') && myPrefixes.length) {
    params.set('filter_mode', filterMode);
    params.set('prefixes', myPrefixes.join(','));
  }
  const data = await api(`/api/devices?${params}`);
  allDevices = data.devices || [];
}

async function reloadAll() {
  devicesLoaded = false;
  allDevices = [];
  await Promise.all([
    loadGateways(),
    currentView === 'devices' ? loadDevices() : Promise.resolve(),
  ]);
  renderGrid();
}

// ---- URL state ----

function readUrlParams() {
  const p = new URLSearchParams(location.search);
if (p.get('hours')) selectedHours = parseInt(p.get('hours'), 10);
  if (p.has('group')) selectedGroup = p.get('group') || null;
  if (p.get('sort'))  sortBy        = p.get('sort');
  if (p.get('q'))     searchQuery   = p.get('q');
  if (p.get('mode'))  filterMode    = p.get('mode');
}

function pushUrlParams() {
  const p = new URLSearchParams(location.search);
  if (selectedHours !== 24)   p.set('hours', selectedHours);   else p.delete('hours');
  if (selectedGroup)          p.set('group', selectedGroup);   else p.delete('group');
  if (sortBy !== 'packets')   p.set('sort', sortBy);           else p.delete('sort');
  if (searchQuery)            p.set('q', searchQuery);         else p.delete('q');
  if (filterMode !== 'all')   p.set('mode', filterMode);       else p.delete('mode');
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  updateNavLinks();
}

function updateNavLinks() {
  const qs = location.search;
  document.querySelectorAll('nav a').forEach(a => {
    const base = a.href.split('?')[0];
    a.href = qs ? `${base}${qs}` : base;
  });
}

// ---- UI ----
function syncViewButtons() {
  document.getElementById('nav-gateways').classList.toggle('active', currentView === 'gateways');
  document.getElementById('nav-devices').classList.toggle('active', currentView === 'devices');
}

function syncTimeButtons() {
  document.querySelectorAll('.time-btn').forEach(btn =>
    btn.classList.toggle('active', parseInt(btn.dataset.hours, 10) === selectedHours)
  );
}

// ---- Events ----

document.querySelectorAll('.time-btn').forEach(btn => btn.addEventListener('click', () => {
  selectedHours = parseInt(btn.dataset.hours, 10); syncTimeButtons(); pushUrlParams(); reloadAll();
}));

document.getElementById('group-filter').addEventListener('change', async (e) => {
  selectedGroup = e.target.value || null;
  devicesLoaded = false; allDevices = [];
  pushUrlParams();
  if (currentView === 'devices') await loadDevices();
  renderGrid();
  connectWebSocket();
});

document.getElementById('device-filter-mode').addEventListener('change', async (e) => {
  filterMode = e.target.value;
  devicesLoaded = false; allDevices = [];
  pushUrlParams();
  if (currentView === 'devices') { await loadDevices(); renderGrid(); }
});

const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
searchInput.value = searchQuery;
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim();
  searchClear.classList.toggle('hidden', !searchQuery);
  pushUrlParams(); renderGrid();
});
searchClear.addEventListener('click', () => {
  searchQuery = ''; searchInput.value = ''; searchClear.classList.add('hidden');
  pushUrlParams(); renderGrid();
});

document.getElementById('reset-filters').addEventListener('click', () => {
  selectedHours = 24; selectedGroup = null; searchQuery = ''; sortBy = 'packets'; filterMode = 'all';
  searchInput.value = ''; searchClear.classList.add('hidden');
  document.getElementById('device-filter-mode').value = 'all';
  syncTimeButtons(); pushUrlParams(); reloadAll(); connectWebSocket();
});

// ---- Boot ----
readUrlParams();
syncViewButtons();
syncTimeButtons();
updateNavLinks();
document.getElementById('device-filter-mode').value = filterMode;

(async () => {
  // Load prefixes for owned/foreign filter
  try {
    const cfg = await api('/api/config/my-devices');
    myPrefixes = (cfg.ranges || []).filter(r => r.type === 'dev_addr').map(r => r.prefix);
  } catch (e) { /* optional config */ }

  await Promise.all([
    loadGateways(),
    currentView === 'devices' ? loadDevices() : Promise.resolve(),
  ]);
  renderGrid();
  connectWebSocket();
})();

// Auto-refresh every 30s
setInterval(async () => {
  const prev = allGateways.slice();
  await loadGateways();
  if (currentView === 'devices') { devicesLoaded = false; await loadDevices(); renderGrid(); return; }
  // Patch counts in-place for gateway view (no full re-render = no flash disruption)
  allGateways.forEach(gw => {
    const card = gatewayCardMap.get(gw.gateway_id);
    if (!card) return;
    const p = prev.find(x => x.gateway_id === gw.gateway_id);
    if (!p || gw.packet_count === p.packet_count) return;
    const el = card.querySelector('[data-field="packets"]');
    if (el) el.textContent = formatNumber(gw.packet_count);
    const devEl = card.querySelector('[data-field="devices"]');
    if (devEl) devEl.textContent = formatNumber(gw.unique_devices);
  });
}, 30000);
