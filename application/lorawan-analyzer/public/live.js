// Get base path from current URL
const BASE_PATH = window.location.pathname.replace(/\/[^/]*$/, '');

// Parse UTC timestamp from DB (comes without timezone info)
function parseUTCTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts === 'number') return new Date(ts);
  if (ts.includes('Z') || ts.includes('+')) return new Date(ts);
  return new Date(ts.replace(' ', 'T') + 'Z');
}

// State
let selectedGateway = null;
let selectedHours = 24;  // passed through from dashboard, not used by live
let selectedGroup = null;
let liveEntries = [];
let ws = null;
let gateways = [];
let filter = { mode: 'all', prefixes: [] };
let typeFilter = { up: true, join: true, down: true, ack: true };
let operatorColors = {};

// Resolve selectedGroup to a list of gateway IDs (null = no filter)
function resolveGroupToGatewayIds(group) {
  if (!group) return null;
  if (group === '__none__') return gateways.filter(gw => !gw.group_name || gw.group_name.trim() === '').map(gw => gw.gateway_id);
  return gateways.filter(gw => gw.group_name === group).map(gw => gw.gateway_id);
}

// --- URL state ---
function readUrlState() {
  const p = new URLSearchParams(location.search);
  selectedGateway = p.get('gw') || null;
  selectedHours   = parseInt(p.get('hours') || '24', 10) || 24;
  selectedGroup   = p.get('group') || null;
  typeFilter.up   = p.get('up')   !== '0';
  typeFilter.join = p.get('join') !== '0';
  typeFilter.down = p.get('down') !== '0';
  typeFilter.ack  = p.get('ack')  !== '0';
  filter.mode     = p.get('mode') || 'all';
  const search = p.get('search') || '';
  const rssiMin = p.get('rssi_min');
  const rssiMax = p.get('rssi_max');
  return { search, rssiMin, rssiMax };
}

function buildParams() {
  const p = new URLSearchParams(location.search);
  if (selectedGateway) p.set('gw', selectedGateway); else p.delete('gw');
  if (selectedHours !== 24) p.set('hours', selectedHours); else p.delete('hours');
  if (!typeFilter.up)   p.set('up',   '0'); else p.delete('up');
  if (!typeFilter.join) p.set('join', '0'); else p.delete('join');
  if (!typeFilter.down) p.set('down', '0'); else p.delete('down');
  if (!typeFilter.ack)  p.set('ack',  '0'); else p.delete('ack');
  if (filter.mode !== 'all') p.set('mode', filter.mode); else p.delete('mode');
  // Remove old toggle params
  p.delete('owned');
  p.delete('foreign');
  const searchVal = document.getElementById('search-input')?.value?.trim();
  if (searchVal) p.set('search', searchVal); else p.delete('search');
  if (selectedGroup) p.set('group', selectedGroup); else p.delete('group');
  const rssiLo = parseInt(document.getElementById('rssi-min')?.value, 10);
  const rssiHi = parseInt(document.getElementById('rssi-max')?.value, 10);
  if (rssiLo > -140) p.set('rssi_min', rssiLo); else p.delete('rssi_min');
  if (rssiHi < -30)  p.set('rssi_max', rssiHi); else p.delete('rssi_max');
  return p;
}

function pushUrlState() {
  const p = buildParams();
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  updateNavLinks();
}

// Keep all URL params in sync on nav links so cross-page navigation preserves state
function updateNavLinks() {
  const p = buildParams();
  const qs = p.toString();
  document.querySelectorAll('nav a').forEach(a => {
    const base = a.href.split('?')[0];
    a.href = qs ? `${base}?${qs}` : base;
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const { search: initSearch, rssiMin: initRssiMin, rssiMax: initRssiMax } = readUrlState();

  await Promise.all([loadMyDevicesConfig(), loadOperatorColors()]);

  // Apply URL state to UI
  document.getElementById('device-filter-mode').value = filter.mode;
  document.getElementById('toggle-up').classList.toggle('active', typeFilter.up);
  document.getElementById('toggle-join').classList.toggle('active', typeFilter.join);
  document.getElementById('toggle-down').classList.toggle('active', typeFilter.down);
  document.getElementById('toggle-ack').classList.toggle('active', typeFilter.ack);

  const searchEl = document.getElementById('search-input');
  const searchClearEl = document.getElementById('search-clear');
  if (initSearch) searchEl.value = initSearch;

  function updateSearchClear() {
    searchClearEl.classList.toggle('hidden', !searchEl.value);
  }
  updateSearchClear();

  searchEl.addEventListener('input', () => { updateSearchClear(); });
  searchClearEl.addEventListener('click', () => {
    searchEl.value = '';
    updateSearchClear();
    renderGatewayTabs();
    pushUrlState();
    reloadWithNewFilter();
  });

  // RSSI range slider
  const rssiMinEl = document.getElementById('rssi-min');
  const rssiMaxEl = document.getElementById('rssi-max');
  const rssiRangeLabel = document.getElementById('rssi-range-label');

  if (initRssiMin) rssiMinEl.value = initRssiMin;
  if (initRssiMax) rssiMaxEl.value = initRssiMax;

  function updateRssiLabel() {
    const lo = parseInt(rssiMinEl.value, 10);
    const hi = parseInt(rssiMaxEl.value, 10);
    if (lo <= -140 && hi >= -30) {
      rssiRangeLabel.textContent = 'off';
    } else if (lo <= -140) {
      rssiRangeLabel.textContent = `< ${hi}`;
    } else if (hi >= -30) {
      rssiRangeLabel.textContent = `> ${lo}`;
    } else {
      rssiRangeLabel.textContent = `${lo}..${hi}`;
    }
  }

  updateRssiLabel();

  rssiMinEl.addEventListener('input', () => {
    if (parseInt(rssiMinEl.value, 10) > parseInt(rssiMaxEl.value, 10)) {
      rssiMinEl.value = rssiMaxEl.value;
    }
    updateRssiLabel();
  });
  rssiMaxEl.addEventListener('input', () => {
    if (parseInt(rssiMaxEl.value, 10) < parseInt(rssiMinEl.value, 10)) {
      rssiMaxEl.value = rssiMinEl.value;
    }
    updateRssiLabel();
  });
  rssiMinEl.addEventListener('change', () => { pushUrlState(); reloadWithNewFilter(); });
  rssiMaxEl.addEventListener('change', () => { pushUrlState(); reloadWithNewFilter(); });

  // Init shared packet feed — filter bar is in the page header
  initPacketFeed('live-feed-container', {
    showGateway: true,
    showAddr: true,
    showOperator: true,
    clickable: true,
    csMode: filter.mode === 'chirpstack',
    noFilterBar: true,
    countEl: document.getElementById('packet-count'),
    isMyDevice,
    getOperatorStyle,
  });

  // Flush buffered packets when user scrolls back to top
  onPacketFeedResume(flushPendingEntries);

  await loadGateways();
  loadRecentPackets(selectedGateway);
  connectWebSocket(selectedGateway);

  // Packet type filter toggles
  ['up', 'join', 'down', 'ack'].forEach(key => {
    document.getElementById(`toggle-${key}`).addEventListener('click', (e) => {
      typeFilter[key] = !typeFilter[key];
      e.target.classList.toggle('active', typeFilter[key]);
      pushUrlState();
      reloadWithNewFilter();
    });
  });

  // Device filter mode dropdown
  document.getElementById('device-filter-mode').addEventListener('change', (e) => {
    filter.mode = e.target.value;
    setPacketFeedCsMode(filter.mode === 'chirpstack');
    pushUrlState();
    refreshCsGatewayIds();
    reloadWithNewFilter();
  });

  initGatewayTabs(gwId => selectGateway(gwId), group => {
    selectedGroup = group;
    pushUrlState();
    renderGatewayTabs();
    reloadWithNewFilter();
  });

  // Search input — debounced server-side filter (1000ms)
  let searchDebounceTimer = null;
  searchEl.addEventListener('input', () => {
    renderGatewayTabs();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => { pushUrlState(); reloadWithNewFilter(); }, 1000);
  });

  // Reset all filters
  document.getElementById('reset-filters').addEventListener('click', () => {
    selectedGateway = null;
    selectedHours = 24;
    selectedGroup = null;
    document.getElementById('group-filter').value = '';
    filter.mode = 'all';
    document.getElementById('device-filter-mode').value = 'all';
    typeFilter = { up: true, join: true, down: true, ack: true };
    searchEl.value = '';
    rssiMinEl.value = -140;
    rssiMaxEl.value = -30;
    updateRssiLabel();
    ['up', 'join', 'down', 'ack'].forEach(k => document.getElementById(`toggle-${k}`).classList.add('active'));
    refreshCsGatewayIds();
    renderGatewayTabs();
    updateGatewayColumnVisibility();
    pushUrlState();
    reloadWithNewFilter();
  });

  updateNavLinks();
});

// API Helper
async function api(path) {
  const res = await fetch(BASE_PATH + path);
  return res.json();
}

// My Devices Config
async function loadMyDevicesConfig() {
  try {
    const data = await api('/api/config/my-devices');
    filter.prefixes = (data.ranges || [])
      .filter(r => r.type === 'dev_addr')
      .map(r => r.prefix);
  } catch (e) {
    console.error('Failed to load my_devices config:', e);
  }
}

async function loadOperatorColors() {
  try {
    operatorColors = await api('/api/config/operator-colors');
  } catch (e) {
    console.error('Failed to load operator colors:', e);
  }
}

function isMyDevice(devAddr) {
  if (!devAddr || filter.prefixes.length === 0) return false;
  const addrNum = parseInt(devAddr.replace(/[^0-9A-Fa-f]/g, ''), 16);
  for (const prefixStr of filter.prefixes) {
    const parts = prefixStr.split('/');
    const prefixHex = parts[0].toUpperCase();
    const bits = parts[1] ? parseInt(parts[1], 10) : 32;
    const prefix = parseInt(prefixHex, 16);
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    if ((addrNum & mask) === (prefix & mask)) return true;
  }
  return false;
}

function getOperatorStyle(operator) {
  const color = operatorColors[operator];
  if (color) return `style="color: ${color}"`;
  if (operator === 'Unknown') return 'class="op-unknown"';
  return `style="color: rgba(255, 255, 255, 0.85)"`;
}

// Gateway Management
async function loadGateways() {
  const [gwData, csData] = await Promise.all([
    api('/api/gateways'),
    filter.mode === 'chirpstack'
      ? api(`/api/cs-gateway-ids?hours=${selectedHours}`)
      : Promise.resolve(null),
  ]);
  gateways = gwData.gateways || [];
  csGatewayStats = csData
    ? new Map((csData.gateways || []).map(g => [g.gateway_id, g.packet_count]))
    : null;
  renderGatewayTabs();
}

function renderGatewayTabs() {
  buildGatewayTabs(getFilteredGateways(), selectedGateway, 'search-input', selectedGroup);
  updateGatewayColumnVisibility();
}

function refreshCsGatewayIds() {
  return _refreshCsGatewayIds(() => renderGatewayTabs());
}

function updateGatewayColumnVisibility() {
  const showGwCol = !selectedGateway;
  document.querySelectorAll('.gateway-col').forEach(el => {
    el.style.display = showGwCol ? '' : 'none';
  });
}

function selectGateway(gatewayId) {
  selectedGateway = gatewayId;
  pushUrlState();
  renderGatewayTabs();
  updateGatewayColumnVisibility();

  // Clear and reload
  liveEntries = [];
  loadRecentPackets(gatewayId);
  connectWebSocket(gatewayId);
}

// Load recent packets from DB with server-side filtering
async function loadRecentPackets(gatewayId = null) {
  try {
    const params = new URLSearchParams({ limit: '500' });
    if (gatewayId) params.set('gateway_id', gatewayId);

    if (filter.mode === 'chirpstack') {
      params.set('source', 'chirpstack');
    } else if (filter.mode === 'owned') {
      params.set('filter_mode', 'owned');
      params.set('prefixes', filter.prefixes.join(','));
    } else if (filter.mode === 'foreign') {
      params.set('filter_mode', 'foreign');
      params.set('prefixes', filter.prefixes.join(','));
    } else {
      params.set('filter_mode', 'all');
    }

    // Add packet type filter
    const types = [];
    if (typeFilter.up) types.push('data');
    if (typeFilter.join) types.push('join_request');
    if (typeFilter.down) types.push('downlink');
    if (typeFilter.ack) types.push('tx_ack');
    if (types.length > 0 && types.length < 4) {
      params.set('packet_types', types.join(','));
    }

    // Add RSSI filter
    const rssiLo = parseInt(document.getElementById('rssi-min').value, 10);
    const rssiHi = parseInt(document.getElementById('rssi-max').value, 10);
    if (rssiLo > -140) params.set('rssi_min', rssiLo);
    if (rssiHi < -30) params.set('rssi_max', rssiHi);

    // Add search filter
    const searchVal = document.getElementById('search-input')?.value?.trim();
    if (searchVal) params.set('search', searchVal);

    // Add group filter (resolved to gateway IDs)
    const groupGwIds = resolveGroupToGatewayIds(selectedGroup);
    if (groupGwIds) params.set('gateway_ids', groupGwIds.join(','));

    const data = await api(`/api/packets/recent?${params}`);
    const packets = data.packets || [];

    // Convert DB format to live format
    for (const p of packets) {
      const freqMhz = p.frequency > 1000000 ? p.frequency / 1000000 : p.frequency;
      const dataRate = p.spreading_factor
        ? `SF${p.spreading_factor}BW${(p.bandwidth || 125000) / 1000}`
        : '-';
      const livePacket = {
        timestamp: parseUTCTimestamp(p.timestamp).getTime(),
        gateway_id: p.gateway_id || '',
        gateway_name: p.gateway_name || null,
        type: p.packet_type || 'data',
        dev_addr: p.dev_addr,
        f_cnt: p.f_cnt,
        f_port: p.f_port,
        join_eui: p.join_eui,
        dev_eui: p.dev_eui,
        operator: p.operator,
        data_rate: dataRate,
        frequency: freqMhz,
        rssi: p.rssi,
        snr: p.snr,
        payload_size: p.payload_size,
        airtime_ms: p.airtime_us ? p.airtime_us / 1000 : 0,
        tx_status: p.packet_type === 'tx_ack' ? p.operator : undefined,
        confirmed: p.confirmed,
        device_name: p.device_name || null,
        source: p.dev_eui && !p.gateway_id ? 'chirpstack' : undefined,
      };
      liveEntries.push(livePacket);
    }
    setPacketFeedData(liveEntries);
  } catch (e) {
    console.error('Failed to load recent packets:', e);
  }
}

// Reload packets when filter changes
function reloadWithNewFilter() {
  liveEntries = [];
  loadRecentPackets(selectedGateway);
  connectWebSocket(selectedGateway);
}

// WebSocket
function connectWebSocket(gatewayId = null) {
  if (ws) ws.close();

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let url = gatewayId
    ? `${protocol}//${location.host}${BASE_PATH}/api/live/${gatewayId}`
    : `${protocol}//${location.host}${BASE_PATH}/api/live`;

  const wsParams = new URLSearchParams();

  // Add packet type filter
  const types = [];
  if (typeFilter.up) types.push('data');
  if (typeFilter.join) types.push('join_request');
  if (typeFilter.down) types.push('downlink');
  if (typeFilter.ack) types.push('tx_ack');
  if (types.length > 0 && types.length < 4) {
    wsParams.set('types', types.join(','));
  }

  // Add RSSI filter
  const rssiLo = parseInt(document.getElementById('rssi-min').value, 10);
  const rssiHi = parseInt(document.getElementById('rssi-max').value, 10);
  if (rssiLo > -140) wsParams.set('rssi_min', rssiLo);
  if (rssiHi < -30) wsParams.set('rssi_max', rssiHi);

  // Add device filter mode
  if (filter.mode === 'chirpstack') {
    wsParams.set('filter_mode', 'chirpstack');
  } else if (filter.mode === 'owned') {
    wsParams.set('filter_mode', 'owned');
    wsParams.set('prefixes', filter.prefixes.join(','));
  } else if (filter.mode === 'foreign') {
    wsParams.set('filter_mode', 'foreign');
    wsParams.set('prefixes', filter.prefixes.join(','));
  }

  // Add search filter
  const searchVal = document.getElementById('search-input')?.value?.trim();
  if (searchVal) wsParams.set('search', searchVal);

  // Add group filter (resolved to gateway IDs)
  const groupGwIds = resolveGroupToGatewayIds(selectedGroup);
  if (groupGwIds) wsParams.set('gateway_ids', groupGwIds.join(','));

  const qs = wsParams.toString();
  if (qs) url += `?${qs}`;

  ws = new WebSocket(url);
  ws.onmessage = (event) => {
    const packet = JSON.parse(event.data);
    addLiveEntry(packet);
  };
  ws.onerror = (err) => console.error('WebSocket error:', err);
  ws.onclose = () => setTimeout(() => connectWebSocket(selectedGateway), 5000);
}

let pendingEntries = [];

function addLiveEntry(packet) {
  if (isPacketFeedScrolled()) {
    // Buffer while user is scrolled down
    pendingEntries.push(packet);
    return;
  }
  liveEntries.unshift(packet);
  if (liveEntries.length > 500) liveEntries = liveEntries.slice(0, 500);
  setPacketFeedData(liveEntries);
}

function flushPendingEntries() {
  if (pendingEntries.length === 0) return;
  // Prepend buffered entries (newest first)
  liveEntries = pendingEntries.reverse().concat(liveEntries);
  pendingEntries = [];
  if (liveEntries.length > 500) liveEntries = liveEntries.slice(0, 500);
  setPacketFeedData(liveEntries);
}
