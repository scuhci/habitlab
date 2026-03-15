// HabitLab - Popup Script

function formatTime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function getProgressColor(ratio) {
  if (ratio < 0.5) return '#00b894';
  if (ratio < 0.75) return '#fdcb6e';
  if (ratio < 1.0) return '#e17055';
  return '#d63031';
}

const INTERVENTION_LABELS = {
  timer_banner: 'Timer Banner',
  block_after_interval: 'Site Blocker',
  remove_feed: 'Feed Remover',
  scroll_limiter: 'Scroll Limiter',
  grayscale: 'Grayscale Mode',
  delay_load: 'Loading Delay',
};

async function init() {
  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let currentDomain = null;
  try {
    currentDomain = new URL(tab.url).hostname;
  } catch {}

  // Get status for current site
  if (currentDomain) {
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS', domain: currentDomain });
    if (status && status.tracked) {
      document.getElementById('trackedInfo').style.display = 'block';
      document.getElementById('notTracked').style.display = 'none';
      document.getElementById('togglesSection').style.display = 'block';

      document.getElementById('siteName').textContent = status.siteName;
      document.getElementById('siteTime').textContent = formatTime(status.timeSpentToday);

      const ratio = status.timeSpentToday / status.dailyLimit;
      const color = getProgressColor(ratio);
      const bar = document.getElementById('siteProgress');
      bar.style.width = `${Math.min(ratio * 100, 100)}%`;
      bar.style.backgroundColor = color;

      document.getElementById('visitCount').textContent = `${status.visitCount} visit${status.visitCount !== 1 ? 's' : ''} today`;
      document.getElementById('limitText').textContent = `Limit: ${formatTime(status.dailyLimit)}`;

      // Render toggles
      const togglesList = document.getElementById('togglesList');
      togglesList.innerHTML = '';
      for (const [id, label] of Object.entries(INTERVENTION_LABELS)) {
        const enabled = status.interventions[id] || false;
        const row = document.createElement('div');
        row.className = 'toggle-row';
        row.innerHTML = `
          <span class="toggle-label">${label}</span>
          <label class="toggle-switch">
            <input type="checkbox" data-intervention="${id}" ${enabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        `;
        togglesList.appendChild(row);

        row.querySelector('input').addEventListener('change', async (e) => {
          await chrome.runtime.sendMessage({
            type: 'TOGGLE_INTERVENTION',
            domain: currentDomain,
            intervention: id,
            enabled: e.target.checked,
          });
        });
      }
    } else {
      document.getElementById('trackedInfo').style.display = 'none';
      document.getElementById('notTracked').style.display = 'block';

      document.getElementById('addSiteBtn').addEventListener('click', async () => {
        await chrome.runtime.sendMessage({
          type: 'ADD_SITE',
          domain: currentDomain,
          name: currentDomain.replace('www.', '').split('.')[0],
          dailyMinutes: 20,
        });
        // Reload popup
        window.location.reload();
      });
    }
  }

  // Summary of all sites today
  const allStats = await chrome.runtime.sendMessage({ type: 'GET_ALL_STATS' });
  const summaryList = document.getElementById('summaryList');
  const emptyState = document.getElementById('emptyState');

  const entries = Object.entries(allStats || {})
    .filter(([, s]) => s.timeSpentToday > 0)
    .sort(([, a], [, b]) => b.timeSpentToday - a.timeSpentToday);

  if (entries.length === 0) {
    emptyState.style.display = 'block';
    summaryList.style.display = 'none';
  } else {
    emptyState.style.display = 'none';
    summaryList.style.display = 'block';
    summaryList.innerHTML = '';

    for (const [domain, stats] of entries) {
      const ratio = stats.timeSpentToday / stats.dailyLimitSeconds;
      const color = getProgressColor(ratio);
      const row = document.createElement('div');
      row.className = 'site-row';
      row.innerHTML = `
        <div class="site-dot" style="background:${stats.color || '#6c5ce7'}"></div>
        <span class="site-row-name">${stats.name}</span>
        <span class="site-row-time">${formatTime(stats.timeSpentToday)}</span>
        <div class="site-row-bar">
          <div class="site-row-fill" style="width:${Math.min(ratio * 100, 100)}%;background:${color}"></div>
        </div>
      `;
      summaryList.appendChild(row);
    }
  }

  // Dashboard button
  document.getElementById('dashboardBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'dashboard.html' });
  });
}

init();
