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
let overlayContainer = null;
let warningShown = false;

function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function detectPlatform() {
  for (const p of PLATFORMS) {
    if (p.test()) return p;
  }
  return null;
}

async function getLimitForPlatform(platformName) {
  const { mode, limits } = await chrome.storage.local.get(['mode', 'limits']);
  if (mode === 'global') return (limits?.global || 30) * 60;
  return (limits?.[platformName] || 30) * 60;
}

async function getUsedSeconds(platformName) {
  const { usage } = await chrome.storage.local.get('usage');
  const today = getToday();
  const pUsage = usage?.[platformName];
  if (pUsage?.date === today) return pUsage.usedSeconds || 0;
  return 0;
}

async function isManuallyBlocked(platformName) {
  const { blocked } = await chrome.storage.local.get('blocked');
  return blocked?.[platformName] || false;
}

function isOverlayBlocked() {
  return !!document.getElementById('sb-block-overlay');
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
}

function cleanup() {
  cleanupTimer();
  removeOverlay();
  removeBlockOverlay();
  currentPlatform = null;
  currentLabel = '';
  warningShown = false;
}

async function syncUsedTime() {
  if (!currentPlatform) return;
  const used = totalLimitSeconds - remainingSeconds;
  const { usage } = await chrome.storage.local.get('usage');
  const today = getToday();
  if (!usage[currentPlatform]) {
    usage[currentPlatform] = { date: today, usedSeconds: 0 };
  } else if (usage[currentPlatform].date !== today) {
    usage[currentPlatform] = { date: today, usedSeconds: 0 };
  }
  usage[currentPlatform].usedSeconds = Math.max(usage[currentPlatform].usedSeconds, used);
  await chrome.storage.local.set({ usage });
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
  const { extensionsUsed, usage } = await chrome.storage.local.get(['extensionsUsed', 'usage']);
  const used = (extensionsUsed && extensionsUsed[currentPlatform]) || 0;
  if (used >= 3) {
    alert('Maximum extensions used for today (3/3).');
    return;
  }
  const capped = Math.min(minutes, 20);
  const extSeconds = capped * 60;
  if (usage && usage[currentPlatform]) {
    usage[currentPlatform].usedSeconds = Math.max(0, (usage[currentPlatform].usedSeconds || 0) - extSeconds);
    await chrome.storage.local.set({ usage });
  }
  const exts = extensionsUsed || {};
  exts[currentPlatform] = used + 1;
  await chrome.storage.local.set({ extensionsUsed: exts });
  removeBlockOverlay();
  init();
}

async function handleBlockOverlayClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'extend') {
    await extendTime(parseInt(btn.dataset.minutes));
  } else if (action === 'unblock') {
    const { blocked } = await chrome.storage.local.get('blocked');
    if (currentPlatform) {
      blocked[currentPlatform] = false;
      await chrome.storage.local.set({ blocked });
      init();
    }
  }
}

async function init() {
  const detected = detectPlatform();
  if (!detected) {
    if (currentPlatform) cleanup();
    return;
  }
  if (isOverlayBlocked() && currentPlatform === detected.name) {
    return;
  }
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!currentPlatform) return;
  if (changes.blocked || changes.extensionsUsed || changes.usage || changes.limits || changes.mode) {
    if (isOverlayBlocked() || changes.blocked || changes.limits || changes.mode) {
      init();
    }
  }
});

init();
