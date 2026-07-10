/* autumnchild.band — progressive enhancement layer.
   All content is static HTML; this file only adds inline audio
   playback, navigation behavior, and ambient animation. */

// ══════════════════════════════════════════════════════════
// SCROLL — always open at the very top
// ══════════════════════════════════════════════════════════
(function() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  function toTop() {
    var html = document.documentElement;
    var prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    html.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    html.style.scrollBehavior = prev;
  }
  if (!location.hash) {
    toTop();
    document.addEventListener('DOMContentLoaded', toTop);
    window.addEventListener('load', function() {
      toTop();
      setTimeout(toTop, 60);
      setTimeout(toTop, 250);
    });
    window.addEventListener('pageshow', function(e) { if (e.persisted) toTop(); });
  }
})();

(function() { var y = document.getElementById('footer-year'); if (y) y.textContent = new Date().getFullYear(); })();

// ══════════════════════════════════════════════════════════
// NAV
// ══════════════════════════════════════════════════════════
var _navToggle = document.getElementById('nav-toggle');
var _navDrawer = document.getElementById('nav-drawer');
var _navDebounce = 0;
function toggleNav() {
  var now = Date.now();
  if (now - _navDebounce < 200) return;
  _navDebounce = now;
  var open = _navDrawer.classList.toggle('open');
  _navToggle.setAttribute('aria-expanded', open);
  _navDrawer.setAttribute('aria-hidden', !open);
  _navToggle.textContent = open ? 'Close' : 'Menu';
}
function closeNav() {
  _navDrawer.classList.remove('open');
  _navDrawer.setAttribute('aria-hidden', 'true');
  _navToggle.setAttribute('aria-expanded', 'false');
  _navToggle.textContent = 'Menu';
}
_navToggle.addEventListener('click', toggleNav);
_navDrawer.querySelectorAll('a').forEach(function(a) { a.addEventListener('click', closeNav); });
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && _navDrawer.classList.contains('open')) {
    closeNav();
    _navToggle.focus();
  }
});

// ══════════════════════════════════════════════════════════
// UNIFIED SCROLL HANDLER — one rAF for reveals + nav spy
// ══════════════════════════════════════════════════════════
(function() {
  var reveals = document.querySelectorAll('.reveal');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var revealsActive = reveals.length && !reducedMotion;
  var revealsDone = false;
  if (reveals.length && reducedMotion) {
    reveals.forEach(function(el) { el.style.opacity = '1'; el.style.transform = 'none'; el.style.filter = 'none'; });
  }

  var ids = ['epk', 'contact', 'music', 'shows', 'about', 'support'];
  var links = {};
  ids.forEach(function(id) { links[id] = document.querySelector('.nav-links a[href="#' + id + '"]'); });
  var nav = document.querySelector('.nav');
  var navLogo = nav.querySelector('.nav-logo');
  if (navLogo) navLogo.addEventListener('click', function(e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  var heroEl = document.querySelector('.hero');

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function() {
      var vh = window.innerHeight;

      if (revealsActive && !revealsDone) {
        var rects = [];
        var doneCount = 0;
        for (var i = 0; i < reveals.length; i++) rects.push(reveals[i].getBoundingClientRect());
        for (var i = 0; i < reveals.length; i++) {
          var p = Math.max(0, Math.min(1, (vh - rects[i].top) / (vh * 0.7)));
          p = p * p * (3 - 2 * p);
          reveals[i].style.opacity = p;
          reveals[i].style.transform = 'translateY(' + ((1 - p) * 30).toFixed(1) + 'px)';
          reveals[i].style.filter = p >= 0.99 ? 'none' : 'blur(' + ((1 - p) * 4).toFixed(1) + 'px)';
          if (p >= 0.99) doneCount++;
        }
        if (doneCount === reveals.length) revealsDone = true;
      }

      var cur = '';
      if (vh + window.scrollY >= document.body.scrollHeight - 2) {
        cur = ids[ids.length - 1];
      } else {
        ids.forEach(function(id) {
          var el = document.getElementById(id);
          if (el && !el.hidden) {
            var top = el.getBoundingClientRect().top + window.scrollY;
            if (scrollY >= top - 140) cur = id;
          }
        });
      }
      ids.forEach(function(id) { if (links[id]) links[id].removeAttribute('aria-current'); });
      if (cur && links[cur]) links[cur].setAttribute('aria-current', 'page');
      var heroH = heroEl ? heroEl.offsetHeight : 400;
      var navIn = Math.min(1, Math.max(0, (scrollY - heroH * 0.3) / (heroH * 0.2)));
      if (navLogo) navLogo.style.opacity = navIn;
      nav.classList.toggle('scrolled', navIn > 0.5);

      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

// ══════════════════════════════════════════════════════════
// RELEASE DATA — playback metadata for the static release markup
// ══════════════════════════════════════════════════════════
var RELEASE_LIST = [
  { name: 'drain (Demo)', type: 'Single',
    art: 'Images/Releases/drain demo.png',
    file: 'Audio/drain (Demo)/drain (Demo).mp3',
    tracks: [
      { title: 'drain (Demo)', file: 'Audio/drain (Demo)/drain (Demo).mp3' }
    ]
  }
];
var pState = { playlist: [], plIdx: -1, shuffle: false, releaseIdx: -1 };
var _discCache = {};
(function() {
  var svg = document.querySelector('#plate-play-0 svg');
  if (svg) _discCache[0] = svg;
})();

// ══════════════════════════════════════════════════════════
// AUDIO PLAYER
// ══════════════════════════════════════════════════════════
var npAudio = document.getElementById('np-audio');
var npBar = document.getElementById('player-bar');
var _src = '';
var PLAY = '<polygon points="5,3 19,12 5,21"/>';
var PAUSE = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

function fmtT(s) {
  if (!isFinite(s)) return '·';
  var m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}
var _fabMusic = document.getElementById('fab-music');
var _npIcon = document.getElementById('np-icon');
var _npPlayBtn = document.getElementById('np-play');
var _npTrackEl = document.getElementById('np-track');
var _npAlbumEl = document.getElementById('np-album');
var _srAnnounce = document.getElementById('sr-announce');
var _npArt = document.getElementById('np-art');
function npShow() { npBar.classList.add('show'); document.body.classList.add('player-active'); if (_fabMusic) _fabMusic.classList.add('hidden'); }
function npHide() { npBar.classList.remove('show'); document.body.classList.remove('player-active'); if (_fabMusic) _fabMusic.classList.remove('hidden'); }
function npSetPlaying(p) {
  _npIcon.innerHTML = p ? PAUSE : PLAY;
  _npPlayBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
  var fp = document.getElementById('featured-play');
  if (fp && pState.releaseIdx === 0) {
    fp.querySelector('svg').innerHTML = p ? PAUSE : '<polygon points="6,3 20,12 6,21"/>';
    fp.setAttribute('aria-label', p ? 'Pause' : 'Play the single drain (Demo), duration 3 minutes 34 seconds');
  }
  updateDisc();
}
function updateDisc() {
  Object.keys(_discCache).forEach(function(rIdx) {
    var svg = _discCache[rIdx];
    var isPlaying = parseInt(rIdx) === pState.releaseIdx && !npAudio.paused;
    svg.innerHTML = isPlaying ? PAUSE : PLAY;
    svg.style.marginLeft = isPlaying ? '0' : '3px';
  });
}
function npGetArt() {
  if (pState.releaseIdx >= 0 && RELEASE_LIST[pState.releaseIdx]) return RELEASE_LIST[pState.releaseIdx].art;
  return '';
}
function npTrackLabel() {
  if (pState.releaseIdx >= 0 && RELEASE_LIST[pState.releaseIdx] && RELEASE_LIST[pState.releaseIdx].type === 'Single') return '';
  return (pState.plIdx >= 0 ? (pState.plIdx + 1) + '. ' : '');
}
function npLoad(track, album, src, autoplay) {
  _npTrackEl.textContent = npTrackLabel() + track;
  _npAlbumEl.textContent = album || '';
  var art = npGetArt();
  if (_npArt && art) _npArt.src = encodeURI(art);
  if (_srAnnounce) _srAnnounce.textContent = 'Now playing: ' + track + (album ? ' from ' + album : '');
  npAudio.src = src; _src = src;
  try { sessionStorage.setItem('ac_track', track); sessionStorage.setItem('ac_album', album || ''); sessionStorage.setItem('ac_src', src); sessionStorage.setItem('ac_rel', pState.releaseIdx); if (art) sessionStorage.setItem('ac_art', art); } catch (e) {}
  npShow();
  if (autoplay) { var intent = ++_playIntent; npAudio.play().then(function() { if (intent === _playIntent) npSetPlaying(true); }).catch(function() {}); }
}
var _playIntent = 0;
function npToggle() {
  var intent = ++_playIntent;
  if (npAudio.paused) {
    npAudio.play().then(function() { if (intent === _playIntent) npSetPlaying(true); }).catch(function() {});
  } else {
    npAudio.pause(); npSetPlaying(false);
  }
}
function npClose() { npAudio.pause(); npSetPlaying(false); npHide(); }

var _lastPlayClick = 0;
function playRelease(rIdx) {
  var now = Date.now();
  if (now - _lastPlayClick < 250) return;
  _lastPlayClick = now;
  if (rIdx === pState.releaseIdx && !npAudio.paused) {
    npAudio.pause(); npSetPlaying(false); return;
  }
  if (rIdx === pState.releaseIdx && npAudio.paused && _src) {
    var intent = ++_playIntent;
    npAudio.play().then(function() { if (intent === _playIntent) npSetPlaying(true); }).catch(function() {});
    return;
  }
  var rel = RELEASE_LIST[rIdx];
  pState.releaseIdx = rIdx;
  pState.playlist = rel.tracks.map(function(t, i) { return { title: t.title, file: t.file, releaseIdx: rIdx, trackIdx: i }; });
  pState.plIdx = 0;
  var t = pState.playlist[0];
  npLoad(t.title, rel.name, t.file, true);
  updateDisc();
}

var _skipDebounce = 0;
function npNext() {
  var now = Date.now();
  if (now - _skipDebounce < 150) return;
  _skipDebounce = now;
  if (!pState.playlist.length) return;
  if (!pState.shuffle && pState.plIdx >= pState.playlist.length - 1) return;
  pState.plIdx = pState.shuffle ? Math.floor(Math.random() * pState.playlist.length) : pState.plIdx + 1;
  var t = pState.playlist[pState.plIdx];
  var rel = RELEASE_LIST[t.releaseIdx];
  npLoad(t.title, rel ? rel.name : '', t.file, true);
  updateDisc();
}
function npPrev() {
  var now = Date.now();
  if (now - _skipDebounce < 150) return;
  _skipDebounce = now;
  if (!pState.playlist.length) return;
  if (npAudio.currentTime > 3) { npAudio.currentTime = 0; return; }
  pState.plIdx = (pState.plIdx - 1 + pState.playlist.length) % pState.playlist.length;
  var t = pState.playlist[pState.plIdx];
  var rel = RELEASE_LIST[t.releaseIdx];
  npLoad(t.title, rel ? rel.name : '', t.file, true);
  updateDisc();
}
function npShuffleToggle() {
  pState.shuffle = !pState.shuffle;
  document.getElementById('np-shuffle').classList.toggle('active', pState.shuffle);
  var fsSh = document.getElementById('fs-shuffle');
  if (fsSh) fsSh.classList.toggle('active', pState.shuffle);
}
function fabClick() {
  if (!_src) {
    if (!RELEASE_LIST.length) return;
    var rel = RELEASE_LIST[0];
    var t = rel.tracks[0];
    pState.releaseIdx = 0;
    pState.playlist = rel.tracks.map(function(tk, i) { return { title: tk.title, file: tk.file, releaseIdx: 0, trackIdx: i }; });
    pState.plIdx = 0;
    npLoad(t.title, rel.name, t.file, false);
    return;
  }
  npShow();
}

_npPlayBtn.addEventListener('click', npToggle);
document.getElementById('np-prev').addEventListener('click', npPrev);
document.getElementById('np-next').addEventListener('click', npNext);
document.getElementById('np-close').addEventListener('click', npClose);
document.getElementById('np-shuffle').addEventListener('click', npShuffleToggle);
if (_fabMusic) _fabMusic.addEventListener('click', fabClick);

var _featuredPlay = document.getElementById('featured-play');
if (_featuredPlay) _featuredPlay.addEventListener('click', function() { playRelease(0); });
var _platePlay = document.getElementById('plate-play-0');
if (_platePlay) _platePlay.addEventListener('click', function() { playRelease(0); });

var _lastTimeStore = 0;
var _npFill = document.getElementById('np-fill');
npAudio.addEventListener('timeupdate', function() {
  if (!npAudio.duration) return;
  _npFill.style.transform = 'scaleX(' + (npAudio.currentTime / npAudio.duration) + ')';
  var now = Date.now();
  if (now - _lastTimeStore > 1000) {
    try { sessionStorage.setItem('ac_time', npAudio.currentTime); } catch (e) {}
    _lastTimeStore = now;
  }
});
npAudio.addEventListener('ended', function() {
  if (pState.playlist.length > 0 && (pState.shuffle || pState.plIdx < pState.playlist.length - 1)) { npNext(); }
  else { npSetPlaying(false); }
});

// ── FULLSCREEN PLAYER ───────────────────────────────────────
(function() {
  var fs = document.getElementById('fs-player');
  var fsBg = document.getElementById('fs-bg');
  var fsArt = document.getElementById('fs-art');
  var fsTrack = document.getElementById('fs-track');
  var fsAlbum = document.getElementById('fs-album');
  var fsFill = document.getElementById('fs-fill');
  var fsCur = document.getElementById('fs-cur');
  var fsDur = document.getElementById('fs-dur');
  var fsPlayIcon = document.getElementById('fs-play-icon');
  var _fsOpen = false;

  function fsUpdateArt() {
    var art = npGetArt();
    var encoded = art ? encodeURI(art) : ((_npArt && _npArt.getAttribute('src')) || '');
    if (encoded) {
      fsArt.src = encoded;
      fsBg.style.backgroundImage = 'url("' + encoded + '")';
    }
  }
  function fsSync() {
    fsTrack.textContent = _npTrackEl.textContent;
    if (fsAlbum) fsAlbum.textContent = _npAlbumEl.textContent;
    fsUpdateArt();
    fsPlayIcon.innerHTML = npAudio.paused ? PLAY : PAUSE;
    document.getElementById('fs-play').setAttribute('aria-label', npAudio.paused ? 'Play' : 'Pause');
    if (npAudio.duration) {
      fsFill.style.transform = 'scaleX(' + (npAudio.currentTime / npAudio.duration) + ')';
      fsCur.textContent = fmtT(npAudio.currentTime);
      fsDur.textContent = fmtT(npAudio.duration);
    }
  }
  var _fsReturnFocus = null;
  function fsTrapFocus(e) {
    if (e.key === 'Escape') { fsClose(); return; }
    if (e.key !== 'Tab') return;
    var focusable = Array.from(fs.querySelectorAll('button')).filter(function(el) {
      return el.offsetParent !== null;
    });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }
  function fsOpen() {
    _fsReturnFocus = document.activeElement;
    fsSync(); fs.classList.add('open'); fs.setAttribute('aria-hidden', 'false'); _fsOpen = true;
    document.addEventListener('keydown', fsTrapFocus);
    setTimeout(function() { document.getElementById('fs-collapse').focus(); }, 100);
  }
  function fsClose() {
    fs.classList.remove('open'); fs.setAttribute('aria-hidden', 'true'); _fsOpen = false;
    document.removeEventListener('keydown', fsTrapFocus);
    if (_fsReturnFocus) { _fsReturnFocus.focus(); _fsReturnFocus = null; }
  }

  var npExpand = document.getElementById('np-expand');
  npExpand.addEventListener('click', fsOpen);
  npExpand.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fsOpen(); } });
  document.getElementById('fs-collapse').addEventListener('click', fsClose);
  document.getElementById('fs-play').addEventListener('click', function() { npToggle(); fsSync(); });
  document.getElementById('fs-prev').addEventListener('click', function() { npPrev(); setTimeout(fsSync, 50); });
  document.getElementById('fs-next').addEventListener('click', function() { npNext(); setTimeout(fsSync, 50); });
  document.getElementById('fs-shuffle').addEventListener('click', npShuffleToggle);
  var _fsBar = document.getElementById('fs-bar');
  function fsSeekFromEvent(e) {
    if (!npAudio.duration) return;
    var r = _fsBar.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX);
    npAudio.currentTime = Math.max(0, Math.min(1, (x - r.left) / r.width)) * npAudio.duration;
  }
  _fsBar.addEventListener('click', fsSeekFromEvent);
  _fsBar.addEventListener('touchstart', function(e) { e.preventDefault(); fsSeekFromEvent(e); }, { passive: false });
  _fsBar.addEventListener('touchmove', function(e) { e.preventDefault(); fsSeekFromEvent(e); }, { passive: false });

  npAudio.addEventListener('timeupdate', function() {
    if (!_fsOpen || !npAudio.duration) return;
    fsFill.style.transform = 'scaleX(' + (npAudio.currentTime / npAudio.duration) + ')';
    fsCur.textContent = fmtT(npAudio.currentTime);
  });
  npAudio.addEventListener('loadedmetadata', function() { if (_fsOpen) fsDur.textContent = fmtT(npAudio.duration); });
  npAudio.addEventListener('play', function() { if (_fsOpen) { fsPlayIcon.innerHTML = PAUSE; document.getElementById('fs-play').setAttribute('aria-label', 'Pause'); } });
  npAudio.addEventListener('pause', function() { if (_fsOpen) { fsPlayIcon.innerHTML = PLAY; document.getElementById('fs-play').setAttribute('aria-label', 'Play'); } });

  var _origNpLoad = npLoad;
  npLoad = function(track, album, src, autoplay) {
    _origNpLoad(track, album, src, autoplay);
    if (_fsOpen) setTimeout(fsSync, 50);
  };
})();

// ── SESSION RESUME ──────────────────────────────────────────
(function() {
  try {
    var src = sessionStorage.getItem('ac_src');
    var track = sessionStorage.getItem('ac_track') || '';
    var album = sessionStorage.getItem('ac_album') || '';
    var t = parseFloat(sessionStorage.getItem('ac_time') || '0');
    if (!src) return;
    // restore full player state so fullscreen art/controls survive reloads
    var relIdx = parseInt(sessionStorage.getItem('ac_rel'), 10);
    if (relIdx >= 0 && RELEASE_LIST[relIdx]) {
      pState.releaseIdx = relIdx;
      pState.playlist = RELEASE_LIST[relIdx].tracks.map(function(tk, i) { return { title: tk.title, file: tk.file, releaseIdx: relIdx, trackIdx: i }; });
      pState.plIdx = 0;
    }
    var savedArt = sessionStorage.getItem('ac_art') || '';
    if (savedArt && _npArt) _npArt.src = savedArt;
    npLoad(track, album, src, false);
    npAudio.addEventListener('loadedmetadata', function r() {
      if (t > 0) npAudio.currentTime = Math.min(t, npAudio.duration - 0.5);
      npAudio.removeEventListener('loadedmetadata', r);
    });
  } catch (e) {}
})();

// ══════════════════════════════════════════════════════════
// UPCOMING SHOWS — fetched from the API when a backend exists;
// the section and its nav links stay hidden otherwise
// ══════════════════════════════════════════════════════════
function escHTML(s) { if (!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
(function() {
  fetch('/api/shows').then(function(r) { return r.json(); }).then(function(data) {
    var shows = (data && data.shows) || [];
    if (!shows.length) return;
    var list = document.getElementById('shows-list');
    if (!list) return;
    list.innerHTML = shows.map(function(s) {
      var d = new Date(s.date + 'T12:00:00');
      var ds = isNaN(d) ? s.date : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return '<div class="show-row">' +
        '<span class="show-date">' + escHTML(ds) + '</span>' +
        '<span><span class="show-venue">' + escHTML(s.venue) + '</span><br/><span class="show-city">' + escHTML(s.city) + '</span></span>' +
        (s.ticket_url ? '<a class="btn btn-fill" href="' + escHTML(s.ticket_url) + '" target="_blank" rel="noopener">Tickets</a>' : '') +
        (s.details ? '<p class="show-details">' + escHTML(s.details) + '</p>' : '') +
      '</div>';
    }).join('');
    document.getElementById('shows').hidden = false;
    var li = document.getElementById('nav-shows-li');
    if (li) li.hidden = false;
    var dl = document.getElementById('drawer-shows-link');
    if (dl) dl.hidden = false;
  }).catch(function() {});
})();

// ══════════════════════════════════════════════════════════
// SHOW-ALERT SIGNUP — posts to /api/subscribe when a backend exists
// ══════════════════════════════════════════════════════════
(function() {
  var form = document.getElementById('sub-form');
  if (!form) return;
  var status = document.getElementById('sub-status');
  var submit = document.getElementById('sub-submit');
  var input = document.getElementById('sub-email');
  function setStatus(msg, cls) {
    status.textContent = msg;
    status.className = 'sub-status' + (cls ? ' ' + cls : '');
  }
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setStatus('Please enter a valid email address.', 'err');
      return;
    }
    submit.disabled = true;
    setStatus('One sec…');
    fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    }).then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
      .then(function(res) {
        if (res.ok) {
          form.reset();
          setStatus('You’re on the list. New shows and releases, straight to your inbox.', 'ok');
        } else {
          setStatus(res.data.error || 'Something went wrong. Please try again.', 'err');
        }
      })
      .catch(function() { setStatus('Could not reach the server. Please try again.', 'err'); })
      .finally(function() { submit.disabled = false; });
  });
})();

// ══════════════════════════════════════════════════════════
// SHARE
// ══════════════════════════════════════════════════════════
function showToast(msg) {
  var el = document.createElement('div');
  el.textContent = msg;
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:var(--bg-elevated);color:var(--text);font-family:var(--sans);font-size:.8rem;padding:.6rem 1.2rem;border-radius:var(--radius-sm);border:1px solid var(--border);box-shadow:0 4px 16px rgba(0,0,0,.5);z-index:999;opacity:0;transition:opacity .3s';
  document.body.appendChild(el);
  requestAnimationFrame(function() { el.style.opacity = '1'; });
  setTimeout(function() { el.style.opacity = '0'; setTimeout(function() { el.remove(); }, 300); }, 2200);
}
function sharePage() {
  var data = { title: 'Autumn Child', text: 'Autumn Child — Shoegaze / Dream Pop from Oklahoma City', url: window.location.href };
  if (navigator.share) {
    navigator.share(data).catch(function() {});
  } else {
    navigator.clipboard.writeText(window.location.href).then(function() {
      showToast('Link copied to clipboard');
    }).catch(function() {
      showToast('Could not copy link');
    });
  }
}
document.getElementById('share-btn').addEventListener('click', sharePage);
var shareMobile = document.getElementById('share-btn-mobile');
if (shareMobile) shareMobile.addEventListener('click', function() { sharePage(); closeNav(); });

// ══════════════════════════════════════════════════════════
// FALLING LEAVES — ambient animation, deferred to page load
// ══════════════════════════════════════════════════════════
window.addEventListener('load', function() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var layer = document.getElementById('leaves-layer');
  if (!layer) return;

  // Curated set — only these files exist in Images/Leaves/
  var LEAF_IDS = [1, 2, 13, 15, 17, 18, 20, 22, 23, 25, 26, 27, 28, 29, 30, 31, 37, 38, 39, 41, 46];
  var LEAF_COUNT = window.innerWidth < 768 ? 7 : 12;
  var leafSrcs = LEAF_IDS.map(function(n) { return 'Images/Leaves/Leaf ' + n + '.png'; });

  var leaves = [];
  var raf;
  var vw, vh;

  function resize() { vw = window.innerWidth; vh = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  function rand(a, b) { return a + Math.random() * (b - a); }

  function createLeaf() {
    var img = document.createElement('img');
    img.className = 'leaf';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.src = leafSrcs[Math.floor(Math.random() * leafSrcs.length)];
    var size = rand(28, 64);
    img.style.width = size + 'px';
    img.style.height = 'auto';
    img.style.opacity = rand(0.18, 0.4);
    layer.appendChild(img);

    return {
      el: img,
      x: rand(0, vw),
      y: rand(-vh, -40),
      size: size,
      fallSpeed: rand(0.08, 0.35),
      windAmp: rand(20, 80),
      windFreq: rand(0.002, 0.008),
      windPhase: rand(0, Math.PI * 2),
      rot: rand(0, 360),
      rotSpeed: rand(-0.25, 0.25),
      wobbleAmp: rand(5, 20),
      wobbleFreq: rand(0.008, 0.02),
      wobblePhase: rand(0, Math.PI * 2),
      t: 0
    };
  }

  function resetLeaf(l) {
    l.x = rand(-40, vw + 40);
    l.y = rand(-vh * 0.3, -40);
    l.fallSpeed = rand(0.08, 0.35);
    l.windAmp = rand(20, 80);
    l.windFreq = rand(0.002, 0.008);
    l.windPhase = rand(0, Math.PI * 2);
    l.rot = rand(0, 360);
    l.rotSpeed = rand(-0.25, 0.25);
    l.wobblePhase = rand(0, Math.PI * 2);
    l.t = 0;
    l.el.src = leafSrcs[Math.floor(Math.random() * leafSrcs.length)];
    var size = rand(28, 64);
    l.el.style.width = size + 'px';
    l.el.style.opacity = rand(0.18, 0.4);
    l.size = size;
  }

  for (var i = 0; i < LEAF_COUNT; i++) {
    var l = createLeaf();
    l.y = rand(-vh, vh);
    leaves.push(l);
  }

  function animate() {
    for (var i = 0; i < leaves.length; i++) {
      var l = leaves[i];
      l.t++;
      l.y += l.fallSpeed;
      var windX = Math.sin(l.t * l.windFreq + l.windPhase) * l.windAmp * 0.02;
      var wobbleX = Math.sin(l.t * l.wobbleFreq + l.wobblePhase) * l.wobbleAmp * 0.05;
      l.x += windX + wobbleX;
      l.rot += l.rotSpeed;

      if (l.y > vh + 60) resetLeaf(l);

      var scaleX = 0.7 + Math.abs(Math.sin(l.t * 0.006 + l.windPhase)) * 0.3;
      l.el.style.transform = 'translate3d(' + l.x.toFixed(1) + 'px,' + l.y.toFixed(1) + 'px,0) rotate(' + l.rot.toFixed(1) + 'deg) scaleX(' + scaleX.toFixed(2) + ')';
    }
    raf = requestAnimationFrame(animate);
  }

  var hidden = false;
  document.addEventListener('visibilitychange', function() {
    hidden = document.hidden;
    if (!hidden && !raf) animate();
    if (hidden && raf) { cancelAnimationFrame(raf); raf = null; }
  });
  animate();
});
