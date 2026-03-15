// HabitLab - Content Script
// Runs on tracked sites and applies interventions

(function () {
  'use strict';

  // Avoid double-injection
  if (window.__habitlab_injected) return;
  window.__habitlab_injected = true;

  const domain = window.location.hostname;

  // ============================================================
  // State
  // ============================================================
  let currentInterventions = {};
  let timerBannerEl = null;
  let blockOverlayEl = null;
  let delayOverlayEl = null;
  let feedRemoved = false;
  let scrollLimiterActive = false;
  let scrollCount = 0;
  let scrollFrozen = false;
  let grayscaleActive = false;
  let snoozed = false;

  // ============================================================
  // Utility
  // ============================================================
  function formatTime(seconds) {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  function getProgressColor(ratio) {
    if (ratio < 0.5) return '#00b894';
    if (ratio < 0.75) return '#fdcb6e';
    if (ratio < 1.0) return '#e17055';
    return '#d63031';
  }

  // ============================================================
  // Intervention: Timer Banner
  // ============================================================
  function createTimerBanner() {
    if (timerBannerEl) return;

    const shadow = createShadowContainer('habitlab-timer-banner');
    timerBannerEl = shadow.host;

    shadow.root.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          pointer-events: none;
        }
        .banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 16px;
          background: linear-gradient(135deg, #2d3436 0%, #636e72 100%);
          color: white;
          font-size: 13px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          pointer-events: auto;
          transition: transform 0.3s ease;
        }
        .banner.minimized {
          transform: translateY(-100%);
        }
        .banner-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .logo {
          font-weight: 700;
          color: #a29bfe;
          font-size: 14px;
        }
        .time-display {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .time-value {
          font-weight: 600;
          font-size: 14px;
        }
        .progress-bar {
          width: 120px;
          height: 6px;
          background: rgba(255,255,255,0.2);
          border-radius: 3px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 1s linear, background-color 0.5s;
        }
        .limit-text {
          opacity: 0.7;
          font-size: 12px;
        }
        .banner-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .btn {
          background: rgba(255,255,255,0.15);
          border: none;
          color: white;
          padding: 4px 10px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: background 0.2s;
        }
        .btn:hover {
          background: rgba(255,255,255,0.25);
        }
        .close-btn {
          background: none;
          border: none;
          color: rgba(255,255,255,0.5);
          cursor: pointer;
          font-size: 16px;
          padding: 0 4px;
          line-height: 1;
        }
        .close-btn:hover {
          color: white;
        }
        .toggle-tab {
          position: fixed;
          top: 0;
          right: 20px;
          background: #2d3436;
          color: #a29bfe;
          padding: 2px 12px 4px;
          border-radius: 0 0 6px 6px;
          font-size: 11px;
          cursor: pointer;
          pointer-events: auto;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          display: none;
        }
      </style>
      <div class="banner" id="banner">
        <div class="banner-left">
          <span class="logo">HabitLab</span>
          <div class="time-display">
            <span class="time-value" id="timeValue">0s</span>
            <div class="progress-bar">
              <div class="progress-fill" id="progressFill"></div>
            </div>
            <span class="limit-text" id="limitText">/ 20m</span>
          </div>
        </div>
        <div class="banner-right">
          <button class="btn" id="snoozeBtn">Snooze 5m</button>
          <button class="btn" id="dashBtn">Dashboard</button>
          <button class="close-btn" id="closeBtn">&times;</button>
        </div>
      </div>
      <div class="toggle-tab" id="toggleTab">HabitLab</div>
    `;

    const banner = shadow.root.getElementById('banner');
    const toggleTab = shadow.root.getElementById('toggleTab');

    shadow.root.getElementById('closeBtn').addEventListener('click', () => {
      banner.classList.add('minimized');
      toggleTab.style.display = 'block';
    });

    toggleTab.addEventListener('click', () => {
      banner.classList.remove('minimized');
      toggleTab.style.display = 'none';
    });

    shadow.root.getElementById('snoozeBtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SNOOZE_SITE', domain, minutes: 5 });
      removeTimerBanner();
      removeBlockOverlay();
      removeGrayscale();
      snoozed = true;
      setTimeout(() => { snoozed = false; }, 5 * 60 * 1000);
    });

    shadow.root.getElementById('dashBtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'GET_TODAY_KEY' }); // Trigger keeping SW alive
      window.open(chrome.runtime.getURL('dashboard.html'), '_blank');
    });
  }

  function updateTimerBanner(timeSpent, dailyLimit) {
    if (!timerBannerEl) return;
    const shadow = timerBannerEl.shadowRoot;
    if (!shadow) return;

    const ratio = timeSpent / dailyLimit;
    const color = getProgressColor(ratio);

    const timeValue = shadow.getElementById('timeValue');
    const progressFill = shadow.getElementById('progressFill');
    const limitText = shadow.getElementById('limitText');

    if (timeValue) timeValue.textContent = formatTime(timeSpent);
    if (progressFill) {
      progressFill.style.width = `${Math.min(ratio * 100, 100)}%`;
      progressFill.style.backgroundColor = color;
    }
    if (limitText) limitText.textContent = `/ ${formatTime(dailyLimit)}`;
  }

  function removeTimerBanner() {
    if (timerBannerEl) {
      timerBannerEl.remove();
      timerBannerEl = null;
    }
  }

  // ============================================================
  // Intervention: Block After Interval
  // ============================================================
  function createBlockOverlay(siteName, timeSpent, dailyLimit) {
    if (blockOverlayEl) return;

    const shadow = createShadowContainer('habitlab-block-overlay');
    blockOverlayEl = shadow.host;

    shadow.root.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2147483646;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, #2d3436 0%, #636e72 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          color: white;
        }
        .icon {
          font-size: 64px;
          margin-bottom: 24px;
        }
        h1 {
          font-size: 32px;
          margin: 0 0 12px;
          font-weight: 700;
        }
        .subtitle {
          font-size: 18px;
          opacity: 0.8;
          margin-bottom: 32px;
        }
        .time-info {
          background: rgba(255,255,255,0.1);
          border-radius: 12px;
          padding: 20px 32px;
          margin-bottom: 32px;
          text-align: center;
        }
        .time-big {
          font-size: 36px;
          font-weight: 700;
          color: #ff7675;
        }
        .time-label {
          font-size: 14px;
          opacity: 0.7;
          margin-top: 4px;
        }
        .actions {
          display: flex;
          gap: 12px;
        }
        .btn {
          padding: 12px 24px;
          border-radius: 8px;
          border: none;
          font-size: 15px;
          cursor: pointer;
          font-weight: 600;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .btn-primary {
          background: #6c5ce7;
          color: white;
        }
        .btn-secondary {
          background: rgba(255,255,255,0.15);
          color: white;
        }
        .btn-cheat {
          background: none;
          border: 1px solid rgba(255,255,255,0.2);
          color: rgba(255,255,255,0.5);
          margin-top: 16px;
          font-size: 13px;
          padding: 8px 16px;
        }
        .logo-text {
          position: absolute;
          bottom: 24px;
          font-size: 14px;
          color: rgba(255,255,255,0.3);
          font-weight: 700;
        }
      </style>
      <div class="overlay">
        <div class="icon">&#9200;</div>
        <h1>Time's Up!</h1>
        <div class="subtitle">You've reached your daily limit on ${siteName}</div>
        <div class="time-info">
          <div class="time-big">${formatTime(timeSpent)}</div>
          <div class="time-label">spent today (limit: ${formatTime(dailyLimit)})</div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" id="closeTabBtn">Close Tab</button>
          <button class="btn btn-secondary" id="snoozeBtn">Snooze 5 min</button>
        </div>
        <button class="btn btn-cheat" id="cheatBtn">Let me in for 30 seconds...</button>
        <span class="logo-text">HabitLab</span>
      </div>
    `;

    shadow.root.getElementById('closeTabBtn').addEventListener('click', () => {
      window.close();
      // If window.close() doesn't work (not opened by script), navigate away
      window.location.href = 'https://www.google.com';
    });

    shadow.root.getElementById('snoozeBtn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'SNOOZE_SITE', domain, minutes: 5 });
      removeBlockOverlay();
      snoozed = true;
      setTimeout(() => { snoozed = false; }, 5 * 60 * 1000);
    });

    shadow.root.getElementById('cheatBtn').addEventListener('click', () => {
      removeBlockOverlay();
      // Re-show after 30 seconds
      setTimeout(() => {
        if (!snoozed) {
          createBlockOverlay(siteName, timeSpent, dailyLimit);
        }
      }, 30000);
    });
  }

  function removeBlockOverlay() {
    if (blockOverlayEl) {
      blockOverlayEl.remove();
      blockOverlayEl = null;
    }
  }

  // ============================================================
  // Intervention: Delay Load
  // ============================================================
  function createDelayOverlay(siteName) {
    if (delayOverlayEl) return;

    const shadow = createShadowContainer('habitlab-delay-overlay');
    delayOverlayEl = shadow.host;

    let countdown = 5;
    shadow.root.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          z-index: 2147483645;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          color: white;
        }
        .countdown {
          font-size: 72px;
          font-weight: 700;
          margin-bottom: 16px;
        }
        .message {
          font-size: 20px;
          opacity: 0.9;
        }
        .submessage {
          font-size: 14px;
          opacity: 0.6;
          margin-top: 8px;
        }
      </style>
      <div class="overlay">
        <div class="countdown" id="countdown">${countdown}</div>
        <div class="message">Taking a moment before visiting ${siteName}...</div>
        <div class="submessage">Do you really need to be here right now?</div>
      </div>
    `;

    const timer = setInterval(() => {
      countdown--;
      const el = shadow.root.getElementById('countdown');
      if (el) el.textContent = countdown;
      if (countdown <= 0) {
        clearInterval(timer);
        removeDelayOverlay();
      }
    }, 1000);
  }

  function removeDelayOverlay() {
    if (delayOverlayEl) {
      delayOverlayEl.remove();
      delayOverlayEl = null;
    }
  }

  // ============================================================
  // Intervention: Feed Remover
  // ============================================================
  const FEED_SELECTORS = {
    'www.facebook.com': ['[role="feed"]', '[data-pagelet="FeedUnit"]', '[data-pagelet="Feed"]'],
    'www.instagram.com': ['main article', 'main [role="presentation"]'],
    'www.youtube.com': ['#contents.ytd-rich-grid-renderer', 'ytd-browse #contents', '#related'],
    'www.reddit.com': ['.rpBJOHq2PR60pnwJlUyP0', '[data-testid="post-container"]', 'shreddit-feed'],
    'twitter.com': ['[data-testid="primaryColumn"] section', '[aria-label="Timeline: Your Home Timeline"]'],
    'x.com': ['[data-testid="primaryColumn"] section', '[aria-label="Timeline: Your Home Timeline"]'],
    'www.tiktok.com': ['[data-e2e="recommend-list-item-container"]', '#main-content-homepage_hot'],
  };

  function removeFeed() {
    const selectors = FEED_SELECTORS[domain];
    if (!selectors) return;

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (!el.dataset.habitlabHidden) {
          el.dataset.habitlabHidden = 'true';
          el.style.setProperty('display', 'none', 'important');

          // Insert placeholder
          const placeholder = document.createElement('div');
          placeholder.className = 'habitlab-feed-placeholder';
          placeholder.innerHTML = `
            <div style="text-align:center; padding:60px 20px; color:#636e72; font-family:-apple-system,sans-serif;">
              <div style="font-size:48px; margin-bottom:16px;">&#128218;</div>
              <div style="font-size:18px; font-weight:600; margin-bottom:8px;">Feed hidden by HabitLab</div>
              <div style="font-size:14px; opacity:0.7;">The news feed has been removed to help you stay focused.</div>
            </div>
          `;
          el.parentNode.insertBefore(placeholder, el.nextSibling);
        }
      });
    });
    feedRemoved = true;
  }

  function restoreFeed() {
    document.querySelectorAll('[data-habitlab-hidden]').forEach(el => {
      el.style.removeProperty('display');
      delete el.dataset.habitlabHidden;
    });
    document.querySelectorAll('.habitlab-feed-placeholder').forEach(el => el.remove());
    feedRemoved = false;
  }

  // ============================================================
  // Intervention: Scroll Limiter
  // ============================================================
  const SCROLL_LIMIT = 750;

  function enableScrollLimiter() {
    if (scrollLimiterActive) return;
    scrollLimiterActive = true;
    scrollCount = 0;

    window.addEventListener('scroll', onScroll, { passive: false });
    window.addEventListener('wheel', onWheel, { passive: false });
  }

  function disableScrollLimiter() {
    scrollLimiterActive = false;
    scrollFrozen = false;
    scrollCount = 0;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('wheel', onWheel);
    removeScrollWarning();
  }

  function onScroll() {
    if (!scrollLimiterActive) return;
    scrollCount++;
    if (scrollCount >= SCROLL_LIMIT && !scrollFrozen) {
      scrollFrozen = true;
      showScrollWarning();
    }
  }

  function onWheel(e) {
    if (scrollFrozen) {
      e.preventDefault();
    }
  }

  function showScrollWarning() {
    const existing = document.getElementById('habitlab-scroll-warning');
    if (existing) return;

    const warning = document.createElement('div');
    warning.id = 'habitlab-scroll-warning';
    warning.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 2147483647;
      background: linear-gradient(135deg, #d63031, #e17055);
      color: white; padding: 16px 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 15px; text-align: center;
      box-shadow: 0 -2px 10px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center; gap: 16px;
    `;
    warning.innerHTML = `
      <span>&#x1F6D1; <strong>Scroll limit reached!</strong> You've been scrolling a lot. Take a break?</span>
      <button id="habitlab-scroll-continue" style="
        background: rgba(255,255,255,0.2); border: none; color: white;
        padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px;
      ">Continue scrolling</button>
    `;
    document.body.appendChild(warning);

    document.getElementById('habitlab-scroll-continue').addEventListener('click', () => {
      scrollFrozen = false;
      scrollCount = 0;
      removeScrollWarning();
    });
  }

  function removeScrollWarning() {
    const el = document.getElementById('habitlab-scroll-warning');
    if (el) el.remove();
  }

  // ============================================================
  // Intervention: Grayscale
  // ============================================================
  function enableGrayscale() {
    if (grayscaleActive) return;
    grayscaleActive = true;
    document.documentElement.style.setProperty('filter', 'grayscale(100%)', 'important');
  }

  function removeGrayscale() {
    grayscaleActive = false;
    document.documentElement.style.removeProperty('filter');
  }

  // ============================================================
  // Shadow DOM helper (prevents site styles from affecting our UI)
  // ============================================================
  function createShadowContainer(tagName) {
    const host = document.createElement(tagName);
    const root = host.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(host);
    return { host, root };
  }

  // ============================================================
  // Message handler from background
  // ============================================================
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'HABITLAB_UPDATE') return;
    if (snoozed) return;

    const { timeSpentToday, dailyLimit, interventions, siteName } = message;
    currentInterventions = interventions || {};
    const limitExceeded = timeSpentToday >= dailyLimit;

    // Timer Banner
    if (currentInterventions.timer_banner) {
      createTimerBanner();
      updateTimerBanner(timeSpentToday, dailyLimit);
    } else {
      removeTimerBanner();
    }

    // Block After Interval
    if (currentInterventions.block_after_interval && limitExceeded) {
      createBlockOverlay(siteName, timeSpentToday, dailyLimit);
    }

    // Feed Remover
    if (currentInterventions.remove_feed && !feedRemoved) {
      removeFeed();
      // Re-run periodically since feeds often load dynamically
      if (!window.__habitlab_feed_observer) {
        window.__habitlab_feed_observer = new MutationObserver(() => {
          if (currentInterventions.remove_feed) removeFeed();
        });
        window.__habitlab_feed_observer.observe(document.body, { childList: true, subtree: true });
      }
    } else if (!currentInterventions.remove_feed && feedRemoved) {
      restoreFeed();
    }

    // Scroll Limiter
    if (currentInterventions.scroll_limiter) {
      enableScrollLimiter();
    } else {
      disableScrollLimiter();
    }

    // Grayscale
    if (currentInterventions.grayscale) {
      enableGrayscale();
    } else if (grayscaleActive) {
      removeGrayscale();
    }

    // Delay Load (only on first message)
    if (currentInterventions.delay_load && !window.__habitlab_delay_shown) {
      window.__habitlab_delay_shown = true;
      createDelayOverlay(siteName);
    }
  });

  // Request initial status
  chrome.runtime.sendMessage({ type: 'GET_STATUS', domain }, (response) => {
    if (response && response.tracked && response.interventions) {
      currentInterventions = response.interventions;
      if (currentInterventions.delay_load && !window.__habitlab_delay_shown) {
        window.__habitlab_delay_shown = true;
        createDelayOverlay(response.siteName);
      }
    }
  });

})();
