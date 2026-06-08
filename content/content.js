const PLATFORMS = [
  {
    name: 'youtube',
    test: () => location.hostname.includes('youtube.com') && location.pathname.startsWith('/shorts/'),
    label: 'YouTube Shorts'
  },
  {
    name: 'instagram',
    test: () => location.hostname.includes('instagram.com') && (location.pathname.startsWith('/reels/') || location.pathname.startsWith('/reel/')),
    label: 'Instagram Reels'
  },
  {
    name: 'facebook',
    test: () => location.hostname.includes('facebook.com') && location.pathname.startsWith('/reel/'),
    label: 'Facebook Reels'
  }
];

let currentPlatform = null;
let currentLabel = '';
let remainingSeconds = 0;
let totalLimitSeconds = 0;
let timerInterval = null;
let syncInterval = null;
let videoCheckInterval = null;
let overlayContainer = null;
let warningShown = false;
let isExtending = false;

function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function sbGet(keys) {
  try { return await chrome.storage.local.get(keys); } catch { return {}; }
}

async function sbSet(data) {
  try { await chrome.storage.local.set(data); } catch {}
}

function detectPlatform() {
  for (const p of PLATFORMS) {
    if (p.test()) return p;
  }
  return null;
}

async function getLimitForPlatform(platformName) {
  const { mode, limits } = await sbGet(['mode', 'limits']);
  if (mode === 'global') return (limits?.global || 30) * 60;
  return (limits?.[platformName] || 30) * 60;
}

async function getUsedSeconds(platformName) {
  const { usage } = await sbGet('usage');
  const today = getToday();
  const pUsage = usage?.[platformName];
  if (pUsage?.date === today) return pUsage.usedSeconds || 0;
  return 0;
}

async function isManuallyBlocked(platformName) {
  const { blocked } = await sbGet('blocked');
  return blocked?.[platformName] || false;
}

async function isBlockedToday(platformName) {
  const { blockedToday = {} } = await sbGet('blockedToday');
  const entry = blockedToday[platformName];
  return entry?.date === getToday() && entry.blocked;
}

async function markBlockedToday(platformName) {
  const { blockedToday = {} } = await sbGet('blockedToday');
  blockedToday[platformName] = { date: getToday(), blocked: true };
  await sbSet({ blockedToday });
}

function isOverlayBlocked() {
  return !!document.getElementById('sb-block-overlay');
}

function pauseAllVideos() {
  document.querySelectorAll('video').forEach(v => {
    if (!v.paused) v.pause();
  });
}

function startVideoMonitor() {
  stopVideoMonitor();
  pauseAllVideos();
  videoCheckInterval = setInterval(pauseAllVideos, 400);
}

function stopVideoMonitor() {
  if (videoCheckInterval) {
    clearInterval(videoCheckInterval);
    videoCheckInterval = null;
  }
}

function blockKeyboardNav(e) {
  if (isOverlayBlocked() && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function cleanupTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
}

function removeOverlay() {
  if (overlayContainer && overlayContainer.parentNode) {
    overlayContainer.parentNode.removeChild(overlayContainer);
  }
  overlayContainer = null;
}

function removeBlockOverlay() {
  const el = document.getElementById('sb-block-overlay');
  if (el && el.parentNode) el.parentNode.removeChild(el);
  stopVideoMonitor();
}

function cleanup() {
  cleanupTimer();
  removeOverlay();
  removeBlockOverlay();
  stopVideoMonitor();
  currentPlatform = null;
  currentLabel = '';
  warningShown = false;
}

async function syncUsedTime() {
  if (!currentPlatform) return;
  const used = totalLimitSeconds - remainingSeconds;
  const { usage } = await sbGet('usage');
  const today = getToday();
  if (!usage[currentPlatform]) {
    usage[currentPlatform] = { date: today, usedSeconds: 0 };
  } else if (usage[currentPlatform].date !== today) {
    usage[currentPlatform] = { date: today, usedSeconds: 0 };
  }
  usage[currentPlatform].usedSeconds = Math.max(usage[currentPlatform].usedSeconds, used);
  await sbSet({ usage });
}

function showTimerOverlay() {
  if (overlayContainer) removeOverlay();
  overlayContainer = document.createElement('div');
  overlayContainer.id = 'sb-overlay-container';
  overlayContainer.innerHTML = `
    <div id="sb-timer">${formatTime(remainingSeconds)}</div>
    <div id="sb-label">${currentLabel}</div>
  `;
  document.body.appendChild(overlayContainer);
}

function updateTimerDisplay() {
  const el = document.getElementById('sb-timer');
  if (el) {
    el.textContent = formatTime(remainingSeconds);
    el.className = remainingSeconds <= 300 ? 'sb-warning' : '';
  }
}

function showFiveMinWarning() {
  warningShown = true;
  let toast = document.getElementById('sb-warning-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sb-warning-toast';
    toast.textContent = '⚠️ 5 minutes remaining!';
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
  }
}

function showBlockOverlay(html, extraClass) {
  removeBlockOverlay();
  const el = document.createElement('div');
  el.id = 'sb-block-overlay';
  if (extraClass) el.classList.add(extraClass);
  el.innerHTML = html;
  document.body.appendChild(el);
  startVideoMonitor();
}

function showManualBlocked() {
  cleanupTimer();
  removeOverlay();
  showBlockOverlay(`
    <div class="sb-blocked-icon">&#128274;</div>
    <div class="sb-blocked-title">${currentLabel}</div>
    <div class="sb-blocked-sub">Manually blocked</div>
    <div class="sb-blocked-remaining">Time remaining: ${formatTime(remainingSeconds)}</div>
    <button class="sb-action-btn sb-unblock-btn" data-action="unblock">Unblock</button>
  `, 'sb-manual-block');
}

function showTimedOut() {
  cleanupTimer();
  removeOverlay();
  showBlockOverlay(`
    <div class="sb-blocked-icon">&#9200;</div>
    <div class="sb-blocked-title">Time's up for ${currentLabel} today!</div>
    <div class="sb-blocked-sub">You've used your daily limit.</div>
    <div class="sb-extend-label">Extend by:</div>
    <div class="sb-extend-buttons">
      <button class="sb-action-btn" data-action="extend" data-minutes="5">5 min</button>
      <button class="sb-action-btn" data-action="extend" data-minutes="10">10 min</button>
      <button class="sb-action-btn" data-action="extend" data-minutes="15">15 min</button>
      <button class="sb-action-btn" data-action="extend" data-minutes="20">20 min</button>
    </div>
  `, 'sb-timed-out');
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    remainingSeconds--;
    updateTimerDisplay();
    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      showTimedOut();
    } else if (remainingSeconds === 300 && !warningShown) {
      showFiveMinWarning();
    }
  }, 1000);
}

function startSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(syncUsedTime, 15000);
  syncUsedTime();
}

async function extendTime(minutes) {
  if (isExtending) return;
  isExtending = true;

  const { extensionsUsed, usage, blockedToday } = await sbGet(['extensionsUsed', 'usage', 'blockedToday']);
  const today = getToday();

  const exts = (extensionsUsed && extensionsUsed._date === today) ? extensionsUsed : { _date: today };
  if (exts[currentPlatform]) {
    isExtending = false;
    alert('Extension already used for today (1/1).');
    return;
  }

  const capped = Math.min(minutes, 20);
  const extSeconds = capped * 60;

  if (!usage[currentPlatform]) {
    usage[currentPlatform] = { date: today, usedSeconds: 0 };
  }
  usage[currentPlatform].usedSeconds = Math.max(0, (usage[currentPlatform].usedSeconds || 0) - extSeconds);

  if (blockedToday && blockedToday[currentPlatform]) {
    delete blockedToday[currentPlatform];
  }

  exts[currentPlatform] = 1;
  exts._date = today;

  await sbSet({ usage, blockedToday, extensionsUsed: exts });

  removeBlockOverlay();
  isExtending = false;

  totalLimitSeconds = await getLimitForPlatform(currentPlatform);
  remainingSeconds = Math.max(0, totalLimitSeconds - usage[currentPlatform].usedSeconds);
  warningShown = false;
  showTimerOverlay();
  startTimer();
  startSync();
}

async function handleBlockOverlayClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'extend') {
    await extendTime(parseInt(btn.dataset.minutes));
  } else if (action === 'unblock') {
    const { blocked } = await sbGet('blocked');
    if (currentPlatform) {
      blocked[currentPlatform] = false;
      await sbSet({ blocked });
    }
  }
}

async function init(force) {
  const detected = detectPlatform();
  if (!detected) {
    if (currentPlatform) cleanup();
    return;
  }
  if (!force && isOverlayBlocked() && currentPlatform === detected.name) {
    return;
  }
  await syncUsedTime();
  cleanup();
  currentPlatform = detected.name;
  currentLabel = detected.label;
  if (await isManuallyBlocked(currentPlatform)) {
    totalLimitSeconds = await getLimitForPlatform(currentPlatform);
    const usedSeconds = await getUsedSeconds(currentPlatform);
    remainingSeconds = Math.max(0, totalLimitSeconds - usedSeconds);
    showManualBlocked();
    return;
  }
  totalLimitSeconds = await getLimitForPlatform(currentPlatform);
  const usedSeconds = await getUsedSeconds(currentPlatform);
  remainingSeconds = Math.max(0, totalLimitSeconds - usedSeconds);
  if (remainingSeconds <= 0) {
    await markBlockedToday(currentPlatform);
    showTimedOut();
    return;
  }
  if (await isBlockedToday(currentPlatform)) {
    showTimedOut();
    return;
  }
  showTimerOverlay();
  startTimer();
  startSync();
}

document.addEventListener('yt-navigate-finish', () => {
  setTimeout(init, 500);
});

let lastUrl = location.href;
const spaObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(init, 800);
  }
});
if (document.body) {
  spaObserver.observe(document.body, { childList: true, subtree: true });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    spaObserver.observe(document.body, { childList: true, subtree: true });
  });
}

window.addEventListener('popstate', () => {
  setTimeout(init, 500);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    syncUsedTime();
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  } else {
    init();
  }
});

window.addEventListener('beforeunload', syncUsedTime);

document.addEventListener('click', handleBlockOverlayClick);
document.addEventListener('keydown', blockKeyboardNav, { capture: true });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (isExtending) return;
  if (!currentPlatform) return;
  if (changes.blocked || changes.extensionsUsed || changes.usage || changes.limits || changes.mode) {
    if (isOverlayBlocked() || changes.blocked || changes.limits || changes.mode) {
      init(!!changes.blocked);
    }
  }
});

init();
