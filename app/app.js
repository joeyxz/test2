/* ────────────────────────────────────────────────────────────────
   RomM TizenBrew Module  –  app.js
   Supports: Basic Auth, Samsung TV remote navigation
   ──────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  /* ── Config stored in localStorage ── */
  var CFG_KEY = 'romm_config';

  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; }
    catch (e) { return null; }
  }

  function saveConfig(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }

  /* ── State ── */
  var state = {
    cfg: null,
    platforms: [],
    roms: [],
    filteredRoms: [],
    activePlatformId: 'all',
    focusZone: 'sidebar',   // sidebar | grid | detail | setup
    sidebarIdx: 0,
    gridIdx: 0,
    detailFocusIdx: 0,      // 0=download, 1=close
    openRom: null,
    searchTimeout: null
  };

  /* ── DOM refs ── */
  var $ = function (id) { return document.getElementById(id); };
  var setupScreen = $('setup-screen');
  var appEl       = $('app');
  var serverInput = $('server-url');
  var userInput   = $('username');
  var passInput   = $('password');
  var connectBtn  = $('connect-btn');
  var searchBar   = $('search-bar');
  var sidebar     = $('sidebar');
  var grid        = $('grid');
  var headerInfo  = $('header-info');
  var statusRight = $('status-right');
  var bcPlatform  = $('bc-platform');
  var detailPanel = $('detail-panel');
  var detailTitle   = $('detail-title');
  var detailPlatform= $('detail-platform');
  var detailMeta    = $('detail-meta');
  var detailCoverImg= $('detail-cover-img');
  var detailDlBtn   = $('detail-download-btn');
  var detailCloseBtn= $('detail-close-btn');
  var loadingEl   = $('loading');
  var loadingText = $('loading-text');
  var toastEl     = $('toast');

  /* ── Helpers ── */
  function showLoading(msg) {
    loadingText.textContent = msg || 'Loading…';
    loadingEl.classList.add('visible');
  }

  function hideLoading() { loadingEl.classList.remove('visible'); }

  var toastTimer;
  function showToast(msg, dur) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, dur || 3000);
  }

  function authHeader() {
    return 'Basic ' + btoa(state.cfg.username + ':' + state.cfg.password);
  }

  function apiUrl(path) {
    return state.cfg.serverUrl.replace(/\/$/, '') + path;
  }

  function apiFetch(path) {
    return fetch(apiUrl(path), {
      headers: { 'Authorization': authHeader(), 'Accept': 'application/json' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ── Setup ── */
  connectBtn.addEventListener('click', function () {
    var url  = serverInput.value.trim();
    var user = userInput.value.trim();
    var pass = passInput.value;
    if (!url || !user || !pass) { showToast('Please fill in all fields'); return; }
    var cfg = { serverUrl: url, username: user, password: pass };
    state.cfg = cfg;
    showLoading('Connecting…');
    apiFetch('/api/platforms')
      .then(function (platforms) {
        saveConfig(cfg);
        hideLoading();
        bootApp(platforms);
      })
      .catch(function (e) {
        hideLoading();
        showToast('Connection failed: ' + e.message, 4000);
      });
  });

  /* ── Boot ── */
  function bootApp(platforms) {
    setupScreen.style.display = 'none';
    appEl.style.display = 'flex';
    state.platforms = platforms || [];
    buildSidebar();
    loadRoms('all');
    state.focusZone = 'grid';
    registerTizenKeys();
  }

  /* ── Sidebar ── */
  function buildSidebar() {
    sidebar.innerHTML = '';
    var allItem = document.createElement('div');
    allItem.className = 'sidebar-item active';
    allItem.dataset.id = 'all';
    allItem.textContent = '🕹️ All Platforms';
    sidebar.appendChild(allItem);

    state.platforms.forEach(function (p) {
      var el = document.createElement('div');
      el.className = 'sidebar-item';
      el.dataset.id = p.id;
      el.textContent = (p.name || 'Platform ' + p.id);
      sidebar.appendChild(el);
    });

    updateSidebarFocus();
  }

  function sidebarItems() { return sidebar.querySelectorAll('.sidebar-item'); }

  function updateSidebarFocus() {
    var items = sidebarItems();
    items.forEach(function (el, i) {
      el.classList.toggle('focused', state.focusZone === 'sidebar' && i === state.sidebarIdx);
    });
  }

  function selectSidebarItem(idx) {
    var items = sidebarItems();
    if (idx < 0 || idx >= items.length) return;
    items.forEach(function (el) { el.classList.remove('active'); });
    items[idx].classList.add('active');
    state.sidebarIdx = idx;
    var platformId = items[idx].dataset.id;
    state.activePlatformId = platformId;
    bcPlatform.textContent = items[idx].textContent.replace(/^.{2}/, '').trim();
    loadRoms(platformId);
  }

  /* ── Load ROMs ── */
  function loadRoms(platformId) {
    showLoading('Loading ROMs…');
    var path = platformId === 'all' ? '/api/roms?limit=500' : '/api/roms?platform_id=' + platformId + '&limit=500';
    apiFetch(path)
      .then(function (data) {
        state.roms = Array.isArray(data) ? data : (data.items || data.roms || []);
        state.filteredRoms = state.roms.slice();
        renderGrid();
        headerInfo.textContent = state.roms.length + ' ROMs';
        hideLoading();
      })
      .catch(function (e) {
        hideLoading();
        showToast('Failed to load ROMs: ' + e.message, 4000);
      });
  }

  /* ── Search ── */
  searchBar.addEventListener('input', function () {
    clearTimeout(state.searchTimeout);
    state.searchTimeout = setTimeout(function () {
      var q = searchBar.value.toLowerCase().trim();
      state.filteredRoms = q
        ? state.roms.filter(function (r) { return (r.name || '').toLowerCase().indexOf(q) >= 0; })
        : state.roms.slice();
      state.gridIdx = 0;
      renderGrid();
    }, 300);
  });

  /* ── Grid ── */
  function renderGrid() {
    grid.innerHTML = '';
    if (!state.filteredRoms.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '😕 No ROMs found';
      grid.appendChild(empty);
      return;
    }

    state.filteredRoms.forEach(function (rom, i) {
      var card = document.createElement('div');
      card.className = 'card';
      card.dataset.idx = i;

      var coverDiv = document.createElement('div');
      coverDiv.className = 'card-cover';

      if (rom.path_cover_s || rom.url_cover) {
        var img = document.createElement('img');
        img.src = rom.path_cover_s
          ? apiUrl(rom.path_cover_s)
          : rom.url_cover;
        img.alt = '';
        img.onerror = function () {
          coverDiv.innerHTML = '<span class="placeholder">🎮</span>';
        };
        coverDiv.appendChild(img);
      } else {
        coverDiv.innerHTML = '<span class="placeholder">🎮</span>';
      }

      var info = document.createElement('div');
      info.className = 'card-info';
      var title = document.createElement('div');
      title.className = 'card-title';
      title.textContent = rom.name || rom.file_name || 'Unknown';
      var sub = document.createElement('div');
      sub.className = 'card-sub';
      sub.textContent = (rom.platform_name || '') + (rom.file_size_bytes ? ' · ' + fmtSize(rom.file_size_bytes) : '');

      info.appendChild(title);
      info.appendChild(sub);
      card.appendChild(coverDiv);
      card.appendChild(info);
      grid.appendChild(card);
    });

    updateGridFocus();
  }

  function fmtSize(bytes) {
    if (bytes > 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
    if (bytes > 1048576)    return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes > 1024)       return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  }

  function gridCards() { return grid.querySelectorAll('.card'); }

  function getGridCols() {
    var cards = gridCards();
    if (!cards.length) return 1;
    var firstTop = cards[0].getBoundingClientRect().top;
    var cols = 0;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getBoundingClientRect().top > firstTop) break;
      cols++;
    }
    return Math.max(cols, 1);
  }

  function updateGridFocus() {
    var cards = gridCards();
    cards.forEach(function (el, i) {
      el.classList.toggle('focused', state.focusZone === 'grid' && i === state.gridIdx);
    });
    if (state.focusZone === 'grid') {
      var focused = cards[state.gridIdx];
      if (focused) focused.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    statusRight.textContent = cards.length ? (state.gridIdx + 1) + ' / ' + cards.length : '';
  }

  /* ── Detail Panel ── */
  function openDetail(rom) {
    state.openRom = rom;
    detailTitle.textContent = rom.name || rom.file_name || 'Unknown ROM';
    detailPlatform.textContent = rom.platform_name || '';

    var meta = [];
    if (rom.file_name)         meta.push('File: ' + rom.file_name);
    if (rom.file_size_bytes)   meta.push('Size: ' + fmtSize(rom.file_size_bytes));
    if (rom.regions_no_intro)  meta.push('Region: ' + rom.regions_no_intro.join(', '));
    if (rom.revision)          meta.push('Revision: ' + rom.revision);
    if (rom.tags_no_intro)     meta.push('Tags: ' + rom.tags_no_intro.join(', '));
    detailMeta.textContent = meta.join('\n');

    detailCoverImg.innerHTML = '';
    var imgSrc = rom.path_cover_l || rom.path_cover_s || rom.url_cover;
    if (imgSrc) {
      var img = document.createElement('img');
      img.src = imgSrc.startsWith('http') ? imgSrc : apiUrl(imgSrc);
      img.onerror = function () { detailCoverImg.textContent = '🎮'; };
      detailCoverImg.appendChild(img);
    } else {
      detailCoverImg.textContent = '🎮';
    }

    state.focusZone = 'detail';
    state.detailFocusIdx = 0;
    updateDetailFocus();
    detailPanel.classList.add('visible');
  }

  function closeDetail() {
    detailPanel.classList.remove('visible');
    state.openRom = null;
    state.focusZone = 'grid';
    updateGridFocus();
  }

  function updateDetailFocus() {
    detailDlBtn.classList.toggle('focused', state.detailFocusIdx === 0);
    detailCloseBtn.classList.toggle('focused', state.detailFocusIdx === 1);
  }

  function downloadRom() {
    var rom = state.openRom;
    if (!rom) return;
    var url = apiUrl('/api/roms/' + rom.id + '/content/' + encodeURIComponent(rom.file_name || 'rom'));
    showToast('Preparing download…');
    // Open in Tizen's browser/downloader
    try {
      tizen.application.launchAppControl(
        new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', url),
        null, null, null
      );
    } catch (e) {
      // Fallback: build an anchor
      var a = document.createElement('a');
      a.href = url;
      a.download = rom.file_name || 'rom';
      a.click();
    }
  }

  detailDlBtn.addEventListener('click', downloadRom);
  detailCloseBtn.addEventListener('click', closeDetail);

  /* ── Key registration (Tizen) ── */
  function registerTizenKeys() {
    try {
      var keys = ['MediaPlay','MediaPause','MediaStop','MediaPlayPause',
        'ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue'];
      keys.forEach(function (k) {
        tizen.tvinputdevice.registerKey(k);
      });
    } catch (e) { /* not on TV or already registered */ }
  }

  /* ── Remote / Keyboard navigation ── */
  document.addEventListener('keydown', function (e) {
    var key = e.keyCode;

    // Key codes
    var UP    = 38, DOWN  = 40, LEFT  = 37, RIGHT = 39;
    var ENTER = 13, BACK  = 10009, ESC = 27;
    var RED   = 403, GREEN = 404, YELLOW = 405, BLUE = 406;

    if (state.focusZone === 'setup') return; // let browser handle

    /* ── Detail panel ── */
    if (state.focusZone === 'detail') {
      if (key === LEFT || key === RIGHT) {
        state.detailFocusIdx = state.detailFocusIdx === 0 ? 1 : 0;
        updateDetailFocus();
      } else if (key === ENTER) {
        if (state.detailFocusIdx === 0) downloadRom();
        else closeDetail();
      } else if (key === BACK || key === ESC) {
        closeDetail();
      }
      e.preventDefault();
      return;
    }

    /* ── Search bar active ── */
    if (document.activeElement === searchBar) {
      if (key === BACK || key === ESC) {
        searchBar.blur();
        state.focusZone = 'grid';
        updateGridFocus();
        e.preventDefault();
      }
      return; // let text input work
    }

    /* ── Sidebar zone ── */
    if (state.focusZone === 'sidebar') {
      if (key === UP) {
        state.sidebarIdx = Math.max(0, state.sidebarIdx - 1);
        updateSidebarFocus();
      } else if (key === DOWN) {
        state.sidebarIdx = Math.min(sidebarItems().length - 1, state.sidebarIdx + 1);
        updateSidebarFocus();
      } else if (key === RIGHT || key === ENTER) {
        selectSidebarItem(state.sidebarIdx);
        state.focusZone = 'grid';
        updateSidebarFocus();
        updateGridFocus();
      }
      e.preventDefault();
      return;
    }

    /* ── Grid zone ── */
    if (state.focusZone === 'grid') {
      var cards = gridCards();
      var cols  = getGridCols();
      var total = state.filteredRoms.length;

      if (key === LEFT) {
        if (state.gridIdx % cols === 0) {
          // move to sidebar
          state.focusZone = 'sidebar';
          updateSidebarFocus();
          updateGridFocus();
        } else {
          state.gridIdx = Math.max(0, state.gridIdx - 1);
          updateGridFocus();
        }
      } else if (key === RIGHT) {
        state.gridIdx = Math.min(total - 1, state.gridIdx + 1);
        updateGridFocus();
      } else if (key === UP) {
        var newIdx = state.gridIdx - cols;
        if (newIdx < 0) {
          // move focus to search bar
          searchBar.focus();
        } else {
          state.gridIdx = newIdx;
          updateGridFocus();
        }
      } else if (key === DOWN) {
        state.gridIdx = Math.min(total - 1, state.gridIdx + cols);
        updateGridFocus();
      } else if (key === ENTER) {
        if (total > 0) openDetail(state.filteredRoms[state.gridIdx]);
      } else if (key === BACK || key === ESC) {
        state.focusZone = 'sidebar';
        updateSidebarFocus();
        updateGridFocus();
      } else if (key === RED) {
        // Red = back to sidebar
        state.focusZone = 'sidebar';
        updateSidebarFocus();
        updateGridFocus();
      } else if (key === GREEN) {
        // Green = focus search
        searchBar.focus();
      }
      e.preventDefault();
      return;
    }
  });

  /* ── Init ── */
  var cfg = loadConfig();
  if (cfg) {
    state.cfg = cfg;
    showLoading('Connecting…');
    apiFetch('/api/platforms')
      .then(function (platforms) {
        hideLoading();
        bootApp(platforms);
      })
      .catch(function () {
        hideLoading();
        // Config invalid; show setup
        serverInput.value = cfg.serverUrl || '';
        userInput.value   = cfg.username  || '';
      });
  } else {
    state.focusZone = 'setup';
  }

})();
