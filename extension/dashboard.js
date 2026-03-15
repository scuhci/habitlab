// HabitLab - Dashboard Script

function formatTime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatTimeShort(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

function getProgressColor(ratio) {
  if (ratio < 0.5) return '#00b894';
  if (ratio < 0.75) return '#fdcb6e';
  if (ratio < 1.0) return '#e17055';
  return '#d63031';
}

// ============================================================
// Tab navigation
// ============================================================
document.querySelectorAll('nav .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('nav .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.panel}`).classList.add('active');

    // Refresh data when switching tabs
    loadData();
  });
});

// ============================================================
// Data loading
// ============================================================
async function loadData() {
  const [allStats, sites, interventions, interventionDefs, history] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_ALL_STATS' }),
    chrome.runtime.sendMessage({ type: 'GET_TRACKED_SITES' }),
    chrome.runtime.sendMessage({ type: 'GET_INTERVENTIONS' }),
    chrome.runtime.sendMessage({ type: 'GET_INTERVENTION_DEFINITIONS' }),
    chrome.runtime.sendMessage({ type: 'GET_HISTORY' }),
  ]);

  renderOverview(allStats);
  renderSites(sites, allStats);
  renderInterventions(interventionDefs, sites, interventions);
  renderHistory(history, sites);
}

// ============================================================
// Overview Panel
// ============================================================
function renderOverview(allStats) {
  const statsGrid = document.getElementById('statsGrid');
  const todayActivity = document.getElementById('todayActivity');

  let totalTime = 0;
  let totalLimit = 0;
  let sitesOverLimit = 0;
  let siteCount = 0;

  const entries = Object.entries(allStats || {});
  for (const [, stats] of entries) {
    totalTime += stats.timeSpentToday;
    totalLimit += stats.dailyLimitSeconds;
    if (stats.timeSpentToday >= stats.dailyLimitSeconds) sitesOverLimit++;
    siteCount++;
  }

  statsGrid.innerHTML = `
    <div class="stat-card">
      <span class="stat-icon">&#9201;</span>
      <div class="stat-value" style="color:#6c5ce7">${formatTime(totalTime)}</div>
      <div class="stat-label">Total time today</div>
    </div>
    <div class="stat-card">
      <span class="stat-icon">&#9888;&#65039;</span>
      <div class="stat-value" style="color:${sitesOverLimit > 0 ? '#dc2626' : '#059669'}">${sitesOverLimit}</div>
      <div class="stat-label">Sites over limit</div>
    </div>
    <div class="stat-card">
      <span class="stat-icon">&#127760;</span>
      <div class="stat-value" style="color:#374151">${siteCount}</div>
      <div class="stat-label">Sites tracked</div>
    </div>
    <div class="stat-card">
      <span class="stat-icon">&#128202;</span>
      <div class="stat-value" style="color:${totalTime < totalLimit ? '#059669' : '#dc2626'}">
        ${totalLimit > 0 ? Math.round((totalTime / totalLimit) * 100) : 0}%
      </div>
      <div class="stat-label">Daily budget used</div>
    </div>
  `;

  // Today's activity
  const sorted = entries
    .filter(([, s]) => s.timeSpentToday > 0)
    .sort(([, a], [, b]) => b.timeSpentToday - a.timeSpentToday);

  if (sorted.length === 0) {
    todayActivity.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:28px;font-weight:500;font-size:14px;">No activity yet today</p>';
    return;
  }

  todayActivity.innerHTML = sorted.map(([domain, stats]) => {
    const ratio = stats.timeSpentToday / stats.dailyLimitSeconds;
    const color = getProgressColor(ratio);
    return `
      <div class="site-item">
        <div class="site-color" style="background:${stats.color}"></div>
        <div class="site-details">
          <div class="name">${stats.name}</div>
          <div class="domain">${domain}</div>
        </div>
        <div class="site-progress-container">
          <div class="site-progress-bar">
            <div class="site-progress-fill" style="width:${Math.min(ratio * 100, 100)}%;background:${color}"></div>
          </div>
          <div class="site-progress-text">${Math.round(ratio * 100)}% of limit</div>
        </div>
        <div class="site-time" style="color:${color}">${formatTime(stats.timeSpentToday)}</div>
      </div>
    `;
  }).join('');
}

// ============================================================
// Sites Panel
// ============================================================
function renderSites(sites, allStats) {
  const sitesList = document.getElementById('sitesList');

  const entries = Object.entries(sites || {});
  if (entries.length === 0) {
    sitesList.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:28px;font-weight:500;font-size:14px;">No sites configured. Add one below!</p>';
    return;
  }

  sitesList.innerHTML = entries.map(([domain, config]) => {
    const stats = allStats[domain] || {};
    const timeSpent = stats.timeSpentToday || 0;
    const ratio = timeSpent / (config.dailyMinutes * 60);
    const color = getProgressColor(ratio);
    return `
      <div class="site-item" data-domain="${domain}">
        <div class="site-color" style="background:${config.color}"></div>
        <div class="site-details">
          <div class="name">${config.name}</div>
          <div class="domain">${domain}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="number" class="limit-input" value="${config.dailyMinutes}" min="1" max="480"
                 data-domain="${domain}" style="width:50px">
          <span style="font-size:12px;color:#9ca3af">min/day</span>
        </div>
        <label class="toggle" title="${config.enabled ? 'Enabled' : 'Disabled'}">
          <input type="checkbox" class="site-toggle" data-domain="${domain}" ${config.enabled ? 'checked' : ''}>
          <div class="toggle-track"></div>
        </label>
        <button class="btn btn-danger remove-site" data-domain="${domain}" style="padding:4px 8px;font-size:11px;">Remove</button>
      </div>
    `;
  }).join('');

  // Event listeners
  sitesList.querySelectorAll('.limit-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const domain = e.target.dataset.domain;
      const minutes = parseInt(e.target.value) || 20;
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SITE_LIMIT',
        domain,
        dailyMinutes: minutes,
      });
    });
  });

  sitesList.querySelectorAll('.site-toggle').forEach(toggle => {
    toggle.addEventListener('change', async (e) => {
      const domain = e.target.dataset.domain;
      const trackedSites = await chrome.runtime.sendMessage({ type: 'GET_TRACKED_SITES' });
      if (trackedSites[domain]) {
        trackedSites[domain].enabled = e.target.checked;
        await chrome.runtime.sendMessage({ type: 'SET_TRACKED_SITES', sites: trackedSites });
      }
    });
  });

  sitesList.querySelectorAll('.remove-site').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const domain = e.target.dataset.domain;
      if (confirm(`Remove ${domain} from tracking?`)) {
        await chrome.runtime.sendMessage({ type: 'REMOVE_SITE', domain });
        loadData();
      }
    });
  });

  // Add site
  document.getElementById('addSiteBtn').onclick = async () => {
    const domain = document.getElementById('newDomain').value.trim();
    const name = document.getElementById('newName').value.trim() || domain.replace('www.', '').split('.')[0];
    const limit = parseInt(document.getElementById('newLimit').value) || 20;

    if (!domain) {
      alert('Please enter a domain');
      return;
    }

    await chrome.runtime.sendMessage({
      type: 'ADD_SITE',
      domain,
      name,
      dailyMinutes: limit,
    });

    document.getElementById('newDomain').value = '';
    document.getElementById('newName').value = '';
    document.getElementById('newLimit').value = '20';
    loadData();
  };
}

// ============================================================
// Interventions Panel
// ============================================================
function renderInterventions(interventionDefs, sites, interventions) {
  const grid = document.getElementById('interventionGrid');
  const config = document.getElementById('siteInterventionConfig');

  // Intervention cards
  grid.innerHTML = Object.entries(interventionDefs || {}).map(([id, def]) => `
    <div class="intervention-card">
      <div class="name">${def.name}</div>
      <div class="desc">${def.description}</div>
      <span class="difficulty difficulty-${def.difficulty}">${def.difficulty}</span>
    </div>
  `).join('');

  // Per-site configuration
  const siteEntries = Object.entries(sites || {}).filter(([, s]) => s.enabled);
  if (siteEntries.length === 0) {
    config.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px;">Enable some sites first</p>';
    return;
  }

  config.innerHTML = siteEntries.map(([domain, siteConfig]) => {
    const siteInterventions = interventions[domain] || {};
    const rows = Object.entries(interventionDefs || {}).map(([id, def]) => `
      <div class="setting-row">
        <div>
          <div class="setting-label">${def.name}</div>
          <div class="setting-desc">${def.description}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" class="intervention-toggle"
                 data-domain="${domain}" data-intervention="${id}"
                 ${siteInterventions[id] ? 'checked' : ''}>
          <div class="toggle-track"></div>
        </label>
      </div>
    `).join('');

    return `
      <div style="margin-bottom:24px;">
        <h3 style="font-size:15px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
          <span style="width:10px;height:10px;border-radius:50%;background:${siteConfig.color};display:inline-block;"></span>
          ${siteConfig.name} <span style="font-weight:400;color:#9ca3af;font-size:12px;">${domain}</span>
        </h3>
        ${rows}
      </div>
    `;
  }).join('');

  // Event listeners
  config.querySelectorAll('.intervention-toggle').forEach(toggle => {
    toggle.addEventListener('change', async (e) => {
      await chrome.runtime.sendMessage({
        type: 'TOGGLE_INTERVENTION',
        domain: e.target.dataset.domain,
        intervention: e.target.dataset.intervention,
        enabled: e.target.checked,
      });
    });
  });
}

// ============================================================
// History Panel
// ============================================================
function renderHistory(history, sites) {
  const chart = document.getElementById('historyChart');
  const details = document.getElementById('historyDetails');

  // Get last 7 days
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Find max total for scaling
  let maxTotal = 1;
  const dayTotals = days.map(day => {
    const data = history[day] || {};
    const total = Object.values(data).reduce((sum, t) => sum + t, 0);
    maxTotal = Math.max(maxTotal, total);
    return { day, data, total };
  });

  chart.innerHTML = dayTotals.map(({ day, total }) => {
    const date = new Date(day + 'T12:00:00');
    const dayName = dayNames[date.getDay()];
    const height = Math.max((total / maxTotal) * 160, 2);
    const ratio = total / (Object.keys(sites || {}).length * 20 * 60 || 1); // rough ratio
    const color = total === 0 ? '#ddd' : getProgressColor(Math.min(ratio, 1));
    return `
      <div class="chart-bar-group">
        <div class="chart-value">${total > 0 ? formatTimeShort(total) : ''}</div>
        <div class="chart-bar" style="height:${height}px;background:${color}"></div>
        <div class="chart-label">${dayName}</div>
      </div>
    `;
  }).join('');

  // Detailed breakdown
  if (Object.keys(history || {}).length === 0) {
    details.innerHTML = '<p style="text-align:center;color:#9ca3af;padding:24px;">No history data yet. Check back tomorrow!</p>';
    return;
  }

  details.innerHTML = dayTotals.reverse().filter(d => d.total > 0).map(({ day, data, total }) => {
    const date = new Date(day + 'T12:00:00');
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    const siteRows = Object.entries(data)
      .sort(([, a], [, b]) => b - a)
      .map(([domain, seconds]) => {
        const siteConfig = sites[domain] || { name: domain, color: '#9ca3af' };
        return `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:12px;">
          <span style="width:6px;height:6px;border-radius:50%;background:${siteConfig.color};display:inline-block;"></span>
          ${siteConfig.name}: ${formatTime(seconds)}
        </span>`;
      }).join('');

    return `
      <div style="padding:12px 0;border-bottom:1px solid #f0ecff;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <strong style="font-size:14px;">${dateStr}</strong>
          <span style="font-size:14px;font-weight:600;color:#9ca3af;">${formatTime(total)}</span>
        </div>
        <div>${siteRows}</div>
      </div>
    `;
  }).join('');
}

// ============================================================
// Initialize
// ============================================================
loadData();

// Auto-refresh every 5 seconds
setInterval(loadData, 5000);
