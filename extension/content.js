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
          -webkit-font-smoothing: antialiased;
        }
        .banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 20px;
          background: linear-gradient(160deg, #5b4cdb 0%, #8b7cf7 50%, #a78bfa 100%);
          color: white;
          font-size: 13px;
          box-shadow: 0 2px 12px rgba(91,76,219,0.35);
          pointer-events: auto;
          transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .banner.minimized {
          transform: translateY(-100%);
        }
        .banner-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .logo {
          font-weight: 800;
          color: white;
          font-size: 13px;
          letter-spacing: -0.2px;
          opacity: 0.85;
        }
        .time-display {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .time-value {
          font-weight: 700;
          font-size: 14px;
          font-variant-numeric: tabular-nums;
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
          opacity: 0.65;
          font-size: 12px;
          font-weight: 500;
        }
        .banner-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .btn {
          background: rgba(255,255,255,0.18);
          border: 1px solid rgba(255,255,255,0.12);
          color: white;
          padding: 5px 12px;
          border-radius: 7px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          transition: all 0.2s;
        }
        .btn:hover {
          background: rgba(255,255,255,0.28);
          transform: translateY(-1px);
        }
        .close-btn {
          background: none;
          border: none;
          color: rgba(255,255,255,0.45);
          cursor: pointer;
          font-size: 18px;
          padding: 0 4px;
          line-height: 1;
          transition: color 0.2s;
        }
        .close-btn:hover {
          color: white;
        }
        .toggle-tab {
          position: fixed;
          top: 0;
          right: 20px;
          background: linear-gradient(160deg, #5b4cdb, #8b7cf7);
          color: white;
          padding: 3px 14px 5px;
          border-radius: 0 0 8px 8px;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          pointer-events: auto;
          box-shadow: 0 2px 8px rgba(91,76,219,0.3);
          display: none;
          transition: box-shadow 0.2s;
        }
        .toggle-tab:hover {
          box-shadow: 0 4px 12px rgba(91,76,219,0.4);
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
          -webkit-font-smoothing: antialiased;
        }
        .overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(160deg, #1a1040 0%, #2d1b69 40%, #4a2d8a 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          color: white;
        }
        .icon {
          font-size: 56px;
          margin-bottom: 20px;
          opacity: 0.9;
        }
        h1 {
          font-size: 34px;
          margin: 0 0 10px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }
        .subtitle {
          font-size: 17px;
          opacity: 0.7;
          margin-bottom: 36px;
          font-weight: 500;
        }
        .time-info {
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          padding: 24px 40px;
          margin-bottom: 36px;
          text-align: center;
          backdrop-filter: blur(8px);
        }
        .time-big {
          font-size: 38px;
          font-weight: 800;
          color: #f0abfc;
          letter-spacing: -1px;
          font-variant-numeric: tabular-nums;
        }
        .time-label {
          font-size: 13px;
          opacity: 0.55;
          margin-top: 6px;
          font-weight: 500;
        }
        .actions {
          display: flex;
          gap: 12px;
        }
        .btn {
          padding: 13px 28px;
          border-radius: 12px;
          border: none;
          font-size: 15px;
          cursor: pointer;
          font-weight: 700;
          transition: all 0.2s;
          letter-spacing: 0.1px;
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(0,0,0,0.3);
        }
        .btn-primary {
          background: linear-gradient(160deg, #6c5ce7, #a78bfa);
          color: white;
          box-shadow: 0 2px 12px rgba(108,92,231,0.4);
        }
        .btn-secondary {
          background: rgba(255,255,255,0.1);
          color: white;
          border: 1px solid rgba(255,255,255,0.12);
          backdrop-filter: blur(4px);
        }
        .btn-cheat {
          background: none;
          border: 1px solid rgba(255,255,255,0.12);
          color: rgba(255,255,255,0.35);
          margin-top: 20px;
          font-size: 13px;
          padding: 9px 18px;
          border-radius: 10px;
        }
        .btn-cheat:hover {
          color: rgba(255,255,255,0.6);
          border-color: rgba(255,255,255,0.2);
        }
        .logo-text {
          position: absolute;
          bottom: 28px;
          font-size: 13px;
          color: rgba(255,255,255,0.2);
          font-weight: 800;
          letter-spacing: -0.2px;
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
          -webkit-font-smoothing: antialiased;
        }
        .overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(160deg, #5b4cdb 0%, #8b7cf7 50%, #a78bfa 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          color: white;
        }
        .countdown {
          font-size: 80px;
          font-weight: 800;
          margin-bottom: 12px;
          letter-spacing: -2px;
          font-variant-numeric: tabular-nums;
          text-shadow: 0 2px 20px rgba(0,0,0,0.15);
        }
        .message {
          font-size: 19px;
          opacity: 0.9;
          font-weight: 500;
        }
        .submessage {
          font-size: 14px;
          opacity: 0.5;
          margin-top: 10px;
          font-weight: 500;
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
            <div style="text-align:center; padding:60px 20px; color:#6b7280; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; -webkit-font-smoothing:antialiased;">
              <div style="font-size:44px; margin-bottom:16px; opacity:0.8;">&#128218;</div>
              <div style="font-size:17px; font-weight:700; margin-bottom:8px; color:#374151; letter-spacing:-0.2px;">Feed hidden by HabitLab</div>
              <div style="font-size:14px; font-weight:500; opacity:0.6; line-height:1.5;">The news feed has been removed to help you stay focused.</div>
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
      background: linear-gradient(160deg, #dc2626, #ef4444);
      color: white; padding: 14px 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px; text-align: center;
      box-shadow: 0 -4px 20px rgba(220,38,38,0.25);
      display: flex; align-items: center; justify-content: center; gap: 16px;
      -webkit-font-smoothing: antialiased;
    `;
    warning.innerHTML = `
      <span style="font-weight:500;">&#x1F6D1; <strong style="font-weight:700;">Scroll limit reached!</strong> You've been scrolling a lot. Take a break?</span>
      <button id="habitlab-scroll-continue" style="
        background: rgba(255,255,255,0.18); border: 1px solid rgba(255,255,255,0.15); color: white;
        padding: 7px 16px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600;
        transition: background 0.2s;
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
