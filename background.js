chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
  });

  if (reason === 'install') {
    await chrome.storage.local.set({
      mode: 'global',
      limits: { global: 30, youtube: 30, instagram: 30, facebook: 30 },
      usage: {},
      blocked: {},
      extensionsUsed: {}
    });
  }

  const existingAlarm = await chrome.alarms.get('daily-reset');
  if (!existingAlarm) {
    await chrome.alarms.create('daily-reset', { periodInMinutes: 60 });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'daily-reset') {
    const today = new Date().toISOString().split('T')[0];
    const { usage } = await chrome.storage.local.get('usage');
    for (const [platform, data] of Object.entries(usage || {})) {
      if (data.date !== today) {
        delete usage[platform];
      }
    }
    await chrome.storage.local.set({ usage });

    const { extensionsUsed } = await chrome.storage.local.get('extensionsUsed');
    for (const [platform, _] of Object.entries(extensionsUsed || {})) {
      delete extensionsUsed[platform];
    }
    await chrome.storage.local.set({ extensionsUsed });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATE') {
    chrome.storage.local.get(null).then(storage => sendResponse(storage));
    return true;
  }
  if (msg.type === 'SET_STORAGE') {
    chrome.storage.local.set(msg.data).then(() => sendResponse({ ok: true }));
    return true;
  }
});
