// Shared utility functions

function formatNumber(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

// ---- Colour helpers (ported from iot-dashboard) ----

function interpolateColor(c1, c2, ratio) {
  return c1.map((v, i) => v + (c2[i] - v) * ratio);
}

// Gateway: blue → pink → purple → dark  (same as iot-dashboard)
function calculateGatewayColor(ageSeconds) {
  const THRESHOLD   = 3600 * 3;
  const GREY_AT     = 3600 * 24 * 2;
  const BYE_AT      = 3600 * 24 * 3;
  let color;
  if (ageSeconds <= THRESHOLD) {
    color = interpolateColor([100, 130, 200], [200, 120, 127], ageSeconds / THRESHOLD);
  } else if (ageSeconds <= GREY_AT) {
    color = interpolateColor([200, 120, 127], [159, 110, 135], (ageSeconds - THRESHOLD) / (GREY_AT - THRESHOLD));
  } else if (ageSeconds <= BYE_AT) {
    color = interpolateColor([159, 110, 135], [53, 37, 45], (ageSeconds - GREY_AT) / (BYE_AT - GREY_AT));
  } else {
    color = [51, 51, 51];
  }
  return '#' + color.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}

// Device: green → yellow → red → grey  (iot-dashboard style, fixed 6h threshold)
// Green at 0, fully red at 6h, grey at 2 days, dark at 3 days
function calculateDeviceColor(ageSeconds) {
  const THRESHOLD = 3600 * 6;
  const GREY_AT   = 3600 * 24 * 2;
  const BYE_AT    = 3600 * 24 * 3;
  let color;
  if (ageSeconds <= THRESHOLD) {
    const ratio = ageSeconds / THRESHOLD;
    if (ratio <= 0.5) {
      color = interpolateColor([120, 230, 160], [220, 230, 77], ratio * 2);
    } else {
      color = interpolateColor([220, 230, 77], [222, 0, 77], (ratio - 0.5) * 2);
    }
  } else if (ageSeconds <= GREY_AT) {
    color = interpolateColor([222, 0, 77], [136, 136, 136], (ageSeconds - THRESHOLD) / (GREY_AT - THRESHOLD));
  } else if (ageSeconds <= BYE_AT) {
    color = interpolateColor([136, 136, 136], [51, 51, 51], (ageSeconds - GREY_AT) / (BYE_AT - GREY_AT));
  } else {
    color = [51, 51, 51];
  }
  return '#' + color.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
}

// Apply colour as diagonal gradient — matches iot-dashboard applyDarkStyle
function applyCardColor(element, colorHex) {
  const r = parseInt(colorHex.slice(1, 3), 16);
  const g = parseInt(colorHex.slice(3, 5), 16);
  const b = parseInt(colorHex.slice(5, 7), 16);
  element.style.background = `linear-gradient(135deg, rgba(${r},${g},${b},0.12) 50%, rgba(${r},${g},${b},0.45))`;
  element.style.color = 'rgba(255,255,255,1)';
}

// ---- end colour helpers ----

// --- Shared gateway CS filter state ---
// Pages declare: let gateways = []; let filter = { mode: 'all', ... }; let selectedHours = 24;
// This module manages csGatewayStats and exposes getFilteredGateways() + refreshCsGatewayIds().

let csGatewayStats = null; // Map<gateway_id, packet_count> for CS mode, null = not loaded

function getFilteredGateways() {
  if (filter.mode === 'chirpstack' && csGatewayStats) {
    return gateways
      .filter(g => csGatewayStats.has(g.gateway_id))
      .map(g => ({ ...g, packet_count: csGatewayStats.get(g.gateway_id) }));
  }
  return gateways;
}

// onRefreshed(filteredGateways) — optional page-specific callback after CS stats reload
async function _refreshCsGatewayIds(onRefreshed) {
  if (filter.mode !== 'chirpstack') {
    if (csGatewayStats !== null) {
      csGatewayStats = null;
      if (onRefreshed) onRefreshed(getFilteredGateways());
    }
    return;
  }
  try {
    const data = await api(`/api/cs-gateway-ids?hours=${selectedHours}`);
    csGatewayStats = new Map((data.gateways || []).map(g => [g.gateway_id, g.packet_count]));
    if (onRefreshed) onRefreshed(getFilteredGateways());
  } catch (e) {
    console.error('Failed to load CS gateway stats:', e);
  }
}

// Populate just the group dropdown — used by pages without gateway tabs (e.g. monitoring)
function buildGroupFilter(gateways, selectedGroup) {
  const groupSelect = document.getElementById('group-filter');
  if (!groupSelect) return;
  const groups = [...new Set(gateways.map(gw => gw.group_name).filter(Boolean))].sort();
  const hasNoGroup = gateways.some(gw => !gw.group_name || gw.group_name.trim() === '') || selectedGroup === '__none__';
  groupSelect.innerHTML = '<option value="">All Groups</option>' +
    groups.map(g => `<option value="${g}">${g}</option>`).join('') +
    (hasNoGroup ? '<option value="__none__">No Group</option>' : '');
  groupSelect.value = selectedGroup || '';
}

// --- Shared gateway tab rendering ---
// Each page calls initGatewayTabs(onSelect) once, then buildGatewayTabs(gateways, selectedGateway, searchInputId) to render.

let _gwOnSelect = null;

function initGatewayTabs(onSelect, onGroupChange) {
  _gwOnSelect = onSelect;

  document.querySelector('.gateway-tab[data-gateway=""]').addEventListener('click', () => {
    onSelect(null);
    collapseGatewaySelector();
  });

  document.getElementById('group-filter').addEventListener('change', (e) => {
    if (onGroupChange) onGroupChange(e.target.value || null);
  });

  document.getElementById('gateway-expand-btn').addEventListener('click', toggleGatewayExpand);

  const scrollEl = document.querySelector('.gateway-tabs-scroll');
  document.getElementById('gateway-scroll-left').addEventListener('click', () => {
    scrollEl.scrollBy({ left: -600, behavior: 'smooth' });
  });
  document.getElementById('gateway-scroll-right').addEventListener('click', () => {
    scrollEl.scrollBy({ left: 600, behavior: 'smooth' });
  });

  document.addEventListener('click', (e) => {
    const selector = document.querySelector('.gateway-selector');
    const btn = document.getElementById('gateway-expand-btn');
    if (selector && selector.classList.contains('expanded') &&
        !selector.contains(e.target) && !btn.contains(e.target)) {
      collapseGatewaySelector();
    }
  });
}

function buildGatewayTabs(gateways, selectedGateway, searchInputId, selectedGroup) {
  const container = document.getElementById('gateway-tabs');

  // Populate group dropdown
  const groupSelect = document.getElementById('group-filter');
  if (groupSelect) {
    const groups = [...new Set(gateways.map(gw => gw.group_name).filter(Boolean))].sort();
    const hasNoGroup = gateways.some(gw => !gw.group_name || gw.group_name.trim() === '') || selectedGroup === '__none__';
    groupSelect.innerHTML = '<option value="">All Groups</option>' +
      groups.map(g => `<option value="${g}">${g}</option>`).join('') +
      (hasNoGroup ? '<option value="__none__">No Group</option>' : '');
    groupSelect.value = selectedGroup || '';
  }

  // Filter tabs by selected group (treat null and '' as ungrouped)
  const noGroup = gw => !gw.group_name || gw.group_name.trim() === '';
  const visible = selectedGroup === '__none__'
    ? gateways.filter(noGroup)
    : selectedGroup
      ? gateways.filter(gw => gw.group_name === selectedGroup)
      : gateways;

  container.innerHTML = visible.map(gw => {
    const label = gw.name || gw.gateway_id;
    const title = gw.name ? `${gw.name} (${gw.gateway_id})` : gw.gateway_id;
    return `<button class="gateway-tab px-3 py-1 rounded text-xs" data-gateway="${gw.gateway_id}" title="${title}">${label}<span class="text-gray-500 ml-1">${formatNumber(gw.packet_count)}</span></button>`;
  }).join('');

  container.querySelectorAll('.gateway-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      _gwOnSelect(tab.dataset.gateway || null);
      collapseGatewaySelector();
    });
  });

  // Apply active state across all tabs (static "All" + dynamic ones)
  const validSelected = selectedGateway && gateways.some(gw => gw.gateway_id === selectedGateway)
    ? selectedGateway : null;
  document.querySelectorAll('.gateway-tab').forEach(tab => {
    const gwId = tab.dataset.gateway || null;
    tab.classList.toggle('active', validSelected ? gwId === validSelected : gwId === null);
  });

  document.getElementById('gateway-expand-btn').style.display = gateways.length > 0 ? '' : 'none';
}

function toggleGatewayExpand() {
  const expanded = document.querySelector('.gateway-selector').classList.toggle('expanded');
  document.getElementById('gateway-expand-btn').classList.toggle('expanded');
  document.getElementById('gateway-scroll-left').style.display  = expanded ? 'none' : '';
  document.getElementById('gateway-scroll-right').style.display = expanded ? 'none' : '';
}

function collapseGatewaySelector() {
  document.querySelector('.gateway-selector').classList.remove('expanded');
  document.getElementById('gateway-expand-btn').classList.remove('expanded');
  document.getElementById('gateway-scroll-left').style.display  = '';
  document.getElementById('gateway-scroll-right').style.display = '';
}
