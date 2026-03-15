// HabitLab - Background Service Worker
// Tracks time spent on sites, manages goals, selects interventions

// ============================================================
// Default configuration
// ============================================================
const DEFAULT_SITES = {
  'www.facebook.com': { name: 'Facebook', color: '#1877F2', dailyMinutes: 20, enabled: true },
  'www.instagram.com': { name: 'Instagram', color: '#E4405F', dailyMinutes: 15, enabled: true },
  'www.youtube.com': { name: 'YouTube', color: '#FF0000', dailyMinutes: 20, enabled: true },
  'www.reddit.com': { name: 'Reddit', color: '#FF4500', dailyMinutes: 15, enabled: true },
  'twitter.com': { name: 'Twitter/X', color: '#1DA1F2', dailyMinutes: 15, enabled: true },
  'x.com': { name: 'Twitter/X', color: '#1DA1F2', dailyMinutes: 15, enabled: true },
  'www.tiktok.com': { name: 'TikTok', color: '#000000', dailyMinutes: 15, enabled: true },
  'www.twitch.tv': { name: 'Twitch', color: '#9146FF', dailyMinutes: 20, enabled: false },
  'www.netflix.com': { name: 'Netflix', color: '#E50914', dailyMinutes: 30, enabled: false },
};

// Available interventions with metadata
const INTERVENTIONS = {
  timer_banner: {
    name: 'Timer Banner',
    description: 'Shows time spent on site at the top of screen',
    difficulty: 'easy',
    default: true,
  },
  block_after_interval: {
    name: 'Site Blocker',
    description: 'Blocks the site after your daily time limit is reached',
    difficulty: 'hard',
    default: true,
  },
  remove_feed: {
    name: 'Feed Remover',
    description: 'Removes the news feed / recommendations to reduce endless scrolling',
    difficulty: 'medium',
    default: false,
  },
  scroll_limiter: {
    name: 'Scroll Limiter',
    description: 'Freezes scrolling after a certain amount to nudge you to stop',
    difficulty: 'hard',
    default: false,
  },
  grayscale: {
    name: 'Grayscale Mode',
    description: 'Makes the site grayscale to reduce visual appeal',
    difficulty: 'easy',
    default: false,
  },
  delay_load: {
    name: 'Loading Delay',
    description: 'Adds a 5-second delay before showing the site, making you reconsider',
    difficulty: 'medium',
    default: false,
  },
};

// ============================================================
// State
// ============================================================
let activeTabId = null;
let activeTabDomain = null;
let lastTickTime = null;

// ============================================================
// Storage helpers
// ============================================================
function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings || {};
}

async function setSettings(settings) {
  await chrome.storage.local.set({ settings });
}

async function getTrackedSites() {
  const { trackedSites } = await chrome.storage.local.get('trackedSites');
  if (!trackedSites) {
    // Initialize with defaults
    await chrome.storage.local.set({ trackedSites: DEFAULT_SITES });
    return { ...DEFAULT_SITES };
  }
  return trackedSites;
}

async function getSiteInterventions() {
  const { siteInterventions } = await chrome.storage.local.get('siteInterventions');
  if (!siteInterventions) {
    // Default: enable timer_banner and block_after_interval for all sites
    const defaults = {};
    for (const domain of Object.keys(DEFAULT_SITES)) {
      defaults[domain] = {};
      for (const [id, intervention] of Object.entries(INTERVENTIONS)) {
        defaults[domain][id] = intervention.default;
      }
    }
    await chrome.storage.local.set({ siteInterventions: defaults });
    return defaults;
  }
  return siteInterventions;
}

async function getTimeSpentToday() {
  const key = `timeSpent_${todayKey()}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || {};
}

async function addTimeSpent(domain, seconds) {
  const key = `timeSpent_${todayKey()}`;
  const timeSpent = await getTimeSpentToday();
  timeSpent[domain] = (timeSpent[domain] || 0) + seconds;
  await chrome.storage.local.set({ [key]: timeSpent });
  return timeSpent[domain];
}

async function getVisitCount(domain) {
  const key = `visits_${todayKey()}`;
  const result = await chrome.storage.local.get(key);
  const visits = result[key] || {};
  return visits[domain] || 0;
}

async function incrementVisitCount(domain) {
  const key = `visits_${todayKey()}`;
  const result = await chrome.storage.local.get(key);
  const visits = result[key] || {};
  visits[domain] = (visits[domain] || 0) + 1;
  await chrome.storage.local.set({ [key]: visits });
}

async function getDailyHistory() {
  const { dailyHistory } = await chrome.storage.local.get('dailyHistory');
  return dailyHistory || {};
}

async function saveDailySnapshot() {
  const today = todayKey();
  const timeSpent = await getTimeSpentToday();
  const history = await getDailyHistory();
  history[today] = timeSpent;
  // Keep only last 30 days
  const keys = Object.keys(history).sort();
  while (keys.length > 30) {
    delete history[keys.shift()];
  }
  await chrome.storage.local.set({ dailyHistory: history });
}

// ============================================================
// Session tracking
// ============================================================
async function getSessionData() {
  const { sessionData } = await chrome.storage.local.get('sessionData');
  return sessionData || {};
}

async function setSessionData(data) {
  await chrome.storage.local.set({ sessionData: data });
}

async function getOrCreateSession(domain) {
  const sessionData = await getSessionData();
  if (!sessionData[domain] || (Date.now() - sessionData[domain].lastActive) > 30000) {
    // New session (30 second gap = new session)
    sessionData[domain] = {
      startTime: Date.now(),
      lastActive: Date.now(),
      timeSpent: 0,
    };
    await incrementVisitCount(domain);
  }
  sessionData[domain].lastActive = Date.now();
  await setSessionData(sessionData);
  return sessionData[domain];
}

// ============================================================
// Core time tracking
// ============================================================
async function tick() {
  if (!activeTabDomain || !activeTabId) {
    lastTickTime = Date.now();
    return;
  }

  const sites = await getTrackedSites();
  if (!sites[activeTabDomain] || !sites[activeTabDomain].enabled) {
    lastTickTime = Date.now();
    return;
  }

  const now = Date.now();
  const elapsed = lastTickTime ? Math.min((now - lastTickTime) / 1000, 5) : 1;
  lastTickTime = now;

  const totalSeconds = await addTimeSpent(activeTabDomain, elapsed);
  const session = await getOrCreateSession(activeTabDomain);
  session.timeSpent += elapsed;
  const sessionData = await getSessionData();
  sessionData[activeTabDomain] = session;
  await setSessionData(sessionData);

  const limitSeconds = sites[activeTabDomain].dailyMinutes * 60;
  const interventionsList = await getSiteInterventions();
  const siteInterventions = interventionsList[activeTabDomain] || {};

  // Send update to content script
  try {
    await chrome.tabs.sendMessage(activeTabId, {
      type: 'HABITLAB_UPDATE',
      domain: activeTabDomain,
      siteName: sites[activeTabDomain].name,
      timeSpentToday: totalSeconds,
      sessionTimeSpent: session.timeSpent,
      dailyLimit: limitSeconds,
      interventions: siteInterventions,
      visitCount: await getVisitCount(activeTabDomain),
    });
  } catch (e) {
    // Tab might not have content script loaded
  }

  // Check if limit exceeded and notification needed
  if (totalSeconds >= limitSeconds && siteInterventions.block_after_interval) {
    const notifKey = `notified_${todayKey()}_${activeTabDomain}`;
    const { [notifKey]: alreadyNotified } = await chrome.storage.local.get(notifKey);
    if (!alreadyNotified) {
      chrome.notifications.create(`limit_${activeTabDomain}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'HabitLab - Time Limit Reached',
        message: `You've reached your daily limit of ${sites[activeTabDomain].dailyMinutes} minutes on ${sites[activeTabDomain].name}.`,
      });
      await chrome.storage.local.set({ [notifKey]: true });
    }
  }
}

// ============================================================
// Tab tracking
// ============================================================
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function updateActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const domain = extractDomain(tab.url);
      const sites = await getTrackedSites();
      if (domain && sites[domain]) {
        activeTabId = tab.id;
        activeTabDomain = domain;
      } else {
        activeTabId = null;
        activeTabDomain = null;
      }
    } else {
      activeTabId = null;
      activeTabDomain = null;
    }
  } catch {
    activeTabId = null;
    activeTabDomain = null;
  }
}

chrome.tabs.onActivated.addListener(async () => {
  await updateActiveTab();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    await updateActiveTab();
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    activeTabId = null;
    activeTabDomain = null;
  } else {
    await updateActiveTab();
  }
});

// ============================================================
// Alarm-based tick (runs every second via setInterval workaround)
// Service workers use alarms for persistence
// ============================================================
chrome.alarms.create('habitlab_tick', { periodInMinutes: 1 / 60 }); // Every 1 second
chrome.alarms.create('habitlab_daily_snapshot', { periodInMinutes: 60 }); // Every hour

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'habitlab_tick') {
    await tick();
  } else if (alarm.name === 'habitlab_daily_snapshot') {
    await saveDailySnapshot();
  }
});

// ============================================================
// Message handling from popup/dashboard/content scripts
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_STATUS': {
      const sites = await getTrackedSites();
      const domain = message.domain;
      if (!domain || !sites[domain]) {
        return { tracked: false };
      }
      const timeSpent = await getTimeSpentToday();
      const interventions = await getSiteInterventions();
      return {
        tracked: true,
        siteName: sites[domain].name,
        timeSpentToday: timeSpent[domain] || 0,
        dailyLimit: sites[domain].dailyMinutes * 60,
        interventions: interventions[domain] || {},
        visitCount: await getVisitCount(domain),
      };
    }

    case 'GET_ALL_STATS': {
      const sites = await getTrackedSites();
      const timeSpent = await getTimeSpentToday();
      const interventions = await getSiteInterventions();
      const stats = {};
      for (const [domain, config] of Object.entries(sites)) {
        if (config.enabled) {
          stats[domain] = {
            ...config,
            timeSpentToday: timeSpent[domain] || 0,
            dailyLimitSeconds: config.dailyMinutes * 60,
            interventions: interventions[domain] || {},
          };
        }
      }
      return stats;
    }

    case 'GET_TRACKED_SITES':
      return await getTrackedSites();

    case 'SET_TRACKED_SITES':
      await chrome.storage.local.set({ trackedSites: message.sites });
      return { success: true };

    case 'GET_INTERVENTIONS':
      return await getSiteInterventions();

    case 'SET_INTERVENTIONS':
      await chrome.storage.local.set({ siteInterventions: message.interventions });
      return { success: true };

    case 'GET_HISTORY':
      return await getDailyHistory();

    case 'GET_INTERVENTION_DEFINITIONS':
      return INTERVENTIONS;

    case 'ADD_SITE': {
      const sites = await getTrackedSites();
      const interventions = await getSiteInterventions();
      sites[message.domain] = {
        name: message.name || message.domain,
        color: message.color || '#6C5CE7',
        dailyMinutes: message.dailyMinutes || 20,
        enabled: true,
      };
      interventions[message.domain] = {};
      for (const [id, intervention] of Object.entries(INTERVENTIONS)) {
        interventions[message.domain][id] = intervention.default;
      }
      await chrome.storage.local.set({ trackedSites: sites, siteInterventions: interventions });
      return { success: true };
    }

    case 'REMOVE_SITE': {
      const sites = await getTrackedSites();
      const interventions = await getSiteInterventions();
      delete sites[message.domain];
      delete interventions[message.domain];
      await chrome.storage.local.set({ trackedSites: sites, siteInterventions: interventions });
      return { success: true };
    }

    case 'UPDATE_SITE_LIMIT': {
      const sites = await getTrackedSites();
      if (sites[message.domain]) {
        sites[message.domain].dailyMinutes = message.dailyMinutes;
        await chrome.storage.local.set({ trackedSites: sites });
      }
      return { success: true };
    }

    case 'TOGGLE_INTERVENTION': {
      const interventions = await getSiteInterventions();
      if (!interventions[message.domain]) {
        interventions[message.domain] = {};
      }
      interventions[message.domain][message.intervention] = message.enabled;
      await chrome.storage.local.set({ siteInterventions: interventions });
      return { success: true };
    }

    case 'GET_TODAY_KEY':
      return todayKey();

    case 'SNOOZE_SITE': {
      // Temporarily disable interventions for this site for N minutes
      const snoozeUntil = Date.now() + (message.minutes || 5) * 60 * 1000;
      const { snoozes } = await chrome.storage.local.get('snoozes');
      const s = snoozes || {};
      s[message.domain] = snoozeUntil;
      await chrome.storage.local.set({ snoozes: s });
      return { success: true };
    }

    case 'IS_SNOOZED': {
      const { snoozes } = await chrome.storage.local.get('snoozes');
      if (snoozes && snoozes[message.domain] && snoozes[message.domain] > Date.now()) {
        return { snoozed: true, until: snoozes[message.domain] };
      }
      return { snoozed: false };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// ============================================================
// Initialization
// ============================================================
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Initialize defaults
    await getTrackedSites();
    await getSiteInterventions();
    // Open dashboard on first install
    chrome.tabs.create({ url: 'dashboard.html' });
  }
});

// Initialize tracking
updateActiveTab();
lastTickTime = Date.now();
console.log('HabitLab background service worker started');
