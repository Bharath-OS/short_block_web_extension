const STATE = {};

async function loadState() {
  const storage = await chrome.storage.local.get(null);
  STATE.mode = storage.mode || 'global';
  STATE.limits = storage.limits || { global: 30, youtube: 30, instagram: 30, facebook: 30 };
  STATE.usage = storage.usage || {};
  STATE.blocked = storage.blocked || {};
  return storage;
}

function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return '--:--';
  const m = Math.floor(Math.abs(seconds) / 60);
  const s = Math.abs(seconds) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getRemainingSeconds(platform) {
  const limitMin = STATE.mode === 'global'
    ? (STATE.limits.global || 30)
    : (STATE.limits[platform] || 30);
  const limitSec = limitMin * 60;
  const today = getToday();
  const pUsage = STATE.usage[platform];
  const usedSec = (pUsage && pUsage.date === today) ? (pUsage.usedSeconds || 0) : 0;
  return Math.max(0, limitSec - usedSec);
}

function getUsedSeconds(platform) {
  const today = getToday();
  const pUsage = STATE.usage[platform];
  return (pUsage && pUsage.date === today) ? (pUsage.usedSeconds || 0) : 0;
}

function updateModeUI() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === STATE.mode);
  });
  document.getElementById('global-section').style.display = STATE.mode === 'global' ? 'block' : 'none';
  document.getElementById('individual-section').style.display = STATE.mode === 'individual' ? 'block' : 'none';
}

function updateLimitsUI() {
  const limit = STATE.mode === 'global' ? STATE.limits.global : null;
  document.querySelectorAll('#global-presets button').forEach(btn => {
    btn.classList.toggle('active', limit !== null && parseInt(btn.dataset.value) === limit);
  });

  ['youtube', 'instagram', 'facebook'].forEach(platform => {
    const platLimit = STATE.limits[platform] || 30;
    document.querySelectorAll(`.preset-sm[data-platform="${platform}"]`).forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.value) === platLimit);
    });
  });
}

function updateStatusUI() {
  ['youtube', 'instagram', 'facebook'].forEach(platform => {
    const remaining = getRemainingSeconds(platform);
    const isBlocked = STATE.blocked[platform] || false;
    const row = document.querySelector(`.status-row[data-platform="${platform}"]`);
    if (!row) return;

    const timeEl = row.querySelector('.status-time');
    const btnEl = row.querySelector('.block-toggle');

    if (isBlocked) {
      timeEl.textContent = formatTime(remaining);
      timeEl.className = 'status-time';
      btnEl.innerHTML = '&#128308; Blocked';
      btnEl.classList.add('blocked');
    } else {
      timeEl.textContent = formatTime(remaining);
      if (remaining <= 60) {
        timeEl.className = 'status-time danger';
      } else if (remaining <= 300) {
        timeEl.className = 'status-time warning';
      } else {
        timeEl.className = 'status-time';
      }
      btnEl.innerHTML = '&#128994; Allow';
      btnEl.classList.remove('blocked');
    }
  });
}

async function saveLimit(platform, minutes) {
  const key = platform === 'global' ? 'global' : platform;
  STATE.limits[key] = Math.max(1, parseInt(minutes) || 30);
  await chrome.storage.local.set({ limits: STATE.limits });
  updateLimitsUI();
  updateStatusUI();
}

async function toggleBlock(platform) {
  STATE.blocked[platform] = !STATE.blocked[platform];
  await chrome.storage.local.set({ blocked: STATE.blocked });
  updateStatusUI();
}

function setupEventListeners() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      STATE.mode = btn.dataset.mode;
      await chrome.storage.local.set({ mode: STATE.mode });
      updateModeUI();
      updateLimitsUI();
      updateStatusUI();
    });
  });

  document.querySelectorAll('#global-presets button').forEach(btn => {
    btn.addEventListener('click', () => saveLimit('global', btn.dataset.value));
  });

  document.getElementById('global-save').addEventListener('click', () => {
    const val = document.getElementById('global-custom').value;
    if (val) saveLimit('global', val);
  });

  document.getElementById('global-custom').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value;
      if (val) saveLimit('global', val);
    }
  });

  document.querySelectorAll('.preset-sm').forEach(btn => {
    btn.addEventListener('click', () => saveLimit(btn.dataset.platform, btn.dataset.value));
  });

  document.querySelectorAll('.save-sm').forEach(btn => {
    btn.addEventListener('click', () => {
      const plat = btn.dataset.platform;
      const input = document.querySelector(`.plat-custom[data-platform="${plat}"]`);
      if (input && input.value) saveLimit(plat, input.value);
    });
  });

  document.querySelectorAll('.plat-custom').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const plat = input.dataset.platform;
        if (input.value) saveLimit(plat, input.value);
      }
    });
  });

  document.querySelectorAll('.block-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleBlock(btn.dataset.platform));
  });
}

async function init() {
  await loadState();
  updateModeUI();
  updateLimitsUI();
  updateStatusUI();
  setupEventListeners();

  chrome.storage.onChanged.addListener(() => {
    loadState().then(() => {
      updateModeUI();
      updateLimitsUI();
      updateStatusUI();
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
