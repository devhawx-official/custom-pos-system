/**
 * NEXUS — theme controller (dark / light).
 *
 * Three jobs:
 *   1. Apply the saved theme to <html data-theme="...">. The actual visual
 *      change is done entirely by assets/nexus-theme.css, which re-maps the
 *      dark palette classes the app uses — nothing here touches the DOM
 *      colours.
 *   2. Persist the choice so every page agrees (it is a plain multi-page
 *      app, so localStorage is the only shared memory we have).
 *   3. Mount a toggle button into the shared sidebar and announce changes
 *      via a `nexus:themechange` event so JS-drawn bits (Chart.js) can
 *      re-render with the new tokens.
 *
 * Loaded after assets/nexus-sidebar.js on every page.
 * Plain classic script so it also works from file://.
 */
(function () {
  'use strict';

  var KEY = 'nexus_theme';
  var THEMES = ['dark', 'light'];
  var EVENT = 'nexus:themechange';

  function read() {
    try {
      var saved = localStorage.getItem(KEY);
      return THEMES.indexOf(saved) >= 0 ? saved : 'dark';
    } catch (e) { /* storage blocked — fall back to the default look */ return 'dark'; }
  }

  function current() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  /**
   * @param {string} theme  'dark' | 'light'
   * @param {boolean} persist  write to localStorage
   */
  function apply(theme, persist) {
    if (THEMES.indexOf(theme) < 0) theme = 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) {
      try { localStorage.setItem(KEY, theme); } catch (e) { /* private mode */ }
    }
    try {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { theme: theme } }));
    } catch (e) { /* CustomEvent unsupported */ }
  }

  function toggle() { apply(current() === 'light' ? 'dark' : 'light', true); }

  /* --- button appearance ------------------------------------------- */
  function iconFor(theme) { return theme === 'light' ? 'fa-moon' : 'fa-sun'; }
  function titleFor(theme) {
    return theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  }

  function paint(btn) {
    var theme = current();
    var i = btn.querySelector('i');
    if (i) i.className = 'fa-solid ' + iconFor(theme);
    btn.title = titleFor(theme);
    btn.setAttribute('aria-label', titleFor(theme));
    btn.setAttribute('aria-pressed', String(theme === 'light'));
  }

  function mountButton() {
    // The brand row is already at capacity — logo + the stacked wordmark fill
    // the 264px sidebar, and a third flex child pushed the button outside the
    // sidebar. The footer has ~30px spare, so the toggle lives there.
    var footer = document.querySelector('#nx-sidebar .nx-footer');
    if (!footer || document.getElementById('nx-theme-btn')) return false;

    var btn = document.createElement('button');
    btn.id = 'nx-theme-btn';
    btn.className = 'nx-theme-btn';
    btn.type = 'button';
    // Create the icon BEFORE paint() — paint only updates an existing <i>.
    btn.innerHTML = '<i class="fa-solid ' + iconFor(current()) + '"></i>';
    paint(btn);
    // Repaint from the event, not from the click handler, so the button also
    // follows a theme change made programmatically (NexusTheme.apply/toggle).
    window.addEventListener(EVENT, function () { paint(btn); });
    btn.addEventListener('click', toggle);
    footer.appendChild(btn);
    return true;
  }

  /* --- wiring -------------------------------------------------------- */
  // The sidebar script is synchronous and inserts its markup before this
  // file runs, but retry briefly so a reordered <script> can't lose the
  // button.
  function mount() {
    if (mountButton()) return;
    var tries = 0;
    var timer = setInterval(function () {
      if (mountButton() || ++tries > 20) clearInterval(timer);
    }, 100);
  }

  // Apply before first paint so there is no flash of the wrong theme.
  apply(read(), false);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /** Convenience for pages: NexusTheme.onChange(fn) */
  function onChange(handler) {
    window.addEventListener(EVENT, function (e) {
      handler(e && e.detail ? e.detail.theme : current());
    });
  }

  window.NexusTheme = {
    current: current,
    apply: apply,
    toggle: toggle,
    onChange: onChange,
    EVENT: EVENT
  };
})();
