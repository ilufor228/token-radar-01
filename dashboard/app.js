/* Token Radar: the page. Reads window.RADAR (written by main.ts), renders the board, and nothing
   here reaches the network. */

(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA || !Array.isArray(DATA.rows)) {
    document.body.innerHTML = '<p style="padding:40px;font-family:monospace">No data.js beside the page: run main.ts to write it.</p>';
    return;
  }

  var BASE_MODEL = DATA.model;
  var BASE_WEIGHTS = Object.assign({}, BASE_MODEL.weights);
  var state = {
    weights: Object.assign({}, BASE_WEIGHTS),
    sort: { key: 'rank', dir: 1 },
    q: '',
    category: '',
    chain: '',
    watchlist: false,
    gainers: false,
    open: null
  };

  var el = function (id) { return document.getElementById(id); };
  var rowsBody = el('rows');
  var drawer = el('drawer');
  var drawerBody = el('drawer-body');
  var scrim = el('scrim');

  // ---------------------------------------------------------------- formatting

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function compactUsd(n) {
    if (!isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e10 ? 0 : 2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function fullUsd(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '<span class="flat">—</span>';
    var cls = n > 0.005 ? 'up' : n < -0.005 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(2) + '%</span>';
  }

  function age(days) {
    if (days === null || days === undefined) return '<span class="flat">—</span>';
    if (days < 45) return days + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }

  function shortChain(list) {
    if (!list || list.length === 0) return '—';
    if (list.length <= 2) return list.join(', ');
    return list[0] + ' +' + (list.length - 1);
  }

  // ---------------------------------------------------------------- the model, again in the page

  function scoreOf(row, weights) {
    var w = weights;
    var total = w.scale + w.momentum + w.tenure + w.breadth;
    if (total <= 0) return 0;
    var s = row.signals;
    return (w.scale * s.scale + w.momentum * s.momentum + w.tenure * s.tenure + w.breadth * s.breadth) * (100 / total);
  }

  function multipleOf(score) {
    return BASE_MODEL.multiple_floor * Math.exp(BASE_MODEL.multiple_spread * Math.max(0, Math.min(100, score)) / 100);
  }

  function live(row) {
    var score = scoreOf(row, state.weights);
    var multiple = multipleOf(score);
    return {
      score: score,
      multiple: multiple,
      implied: Math.max(1, Math.round(row.tvl_usd * multiple))
    };
  }

  // ---------------------------------------------------------------- filtering and sorting

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (row) {
      if (state.watchlist && !row.watchlist) return false;
      if (state.gainers && !(row.change_7d > 0)) return false;
      if (state.category && row.category !== state.category) return false;
      if (state.chain && row.chains.indexOf(state.chain) === -1) return false;
      if (!q) return true;
      var hay = (row.name + ' ' + row.slug + ' ' + (row.category || '') + ' ' + row.chains.join(' ')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function sorted(list) {
    var key = state.sort.key;
    var dir = state.sort.dir;
    var copy = list.slice();
    copy.sort(function (a, b) {
      var av, bv;
      if (key === 'implied') { av = live(a).implied; bv = live(b).implied; }
      else if (key === 'multiple') { av = live(a).multiple; bv = live(b).multiple; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'change') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'chains') { av = a.chains.length; bv = b.chains.length; }
      else if (key === 'name') { return a.name.localeCompare(b.name) * dir; }
      else { av = a.rank; bv = b.rank; }
      if (av === bv) return a.rank - b.rank;
      return (av < bv ? -1 : 1) * dir;
    });
    return copy;
  }

  // ---------------------------------------------------------------- render the board

  function renderRows() {
    var list = sorted(filtered());
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      var v = live(row);
      var open = state.open === row.slug;
      html += '<tr tabindex="0" data-slug="' + esc(row.slug) + '" class="' + (open ? 'is-open' : '') + '">' +
        '<td class="num rank">' + row.rank + '</td>' +
        '<td class="left"><span class="name">' + esc(row.name) + '</span>' +
        (row.watchlist ? '<span class="badge">watchlist</span>' : '') +
        '<span class="sub">' + esc(row.category || 'uncategorised') + '</span></td>' +
        '<td class="num value">' + compactUsd(v.implied) + '</td>' +
        '<td class="num">' + v.multiple.toFixed(2) + '×</td>' +
        '<td class="num">' + compactUsd(row.tvl_usd) + '</td>' +
        '<td class="num">' + pct(row.change_7d) + '</td>' +
        '<td class="num">' + age(row.age_days) + '</td>' +
        '<td class="left chains">' + esc(shortChain(row.chains)) + '</td>' +
        '<td class="left"><button type="button" class="farm" data-plan="' + esc(row.slug) + '">Plan</button></td>' +
        '</tr>';
    }
    rowsBody.innerHTML = html;
    el('empty').hidden = list.length > 0;
    el('count').textContent = list.length === DATA.rows.length
      ? DATA.rows.length + ' protocols ranked'
      : list.length + ' of ' + DATA.rows.length + ' shown';
  }

  function renderSort() {
    var buttons = document.querySelectorAll('.grid thead button[data-sort]');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var th = b.closest('th') || b.parentNode;
      if (b.getAttribute('data-sort') === state.sort.key) {
        th.setAttribute('aria-sort', state.sort.dir === 1 ? 'ascending' : 'descending');
      } else {
        th.removeAttribute('aria-sort');
      }
    }
  }

  function renderAll() {
    renderRows();
    renderSort();
    if (state.open) renderDrawer(state.open);
  }

  // ---------------------------------------------------------------- the drawer

  function bySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  function signalBar(label, value, weight, warm) {
    return '<div class="signal">' +
      '<span class="signal-label">' + label + ' <span style="color:var(--dim)">w' + weight + '</span></span>' +
      '<span class="signal-bar"><span class="signal-fill' + (warm ? ' warm' : '') + '" style="width:' + Math.round(value * 100) + '%"></span></span>' +
      '<span class="signal-val">' + (value * 100).toFixed(0) + '</span>' +
      '</div>';
  }

  function renderDrawer(slug) {
    var row = bySlug(slug);
    if (!row) return;
    var v = live(row);
    var w = state.weights;
    var plan = '';
    for (var i = 0; i < row.plan.length; i++) {
      var step = row.plan[i];
      plan += '<li>' + esc(step.text) + '<span class="cost">' + esc(step.cost) + ' · ' + esc(step.time) + '</span></li>';
    }
    var facts = [
      ['TVL', fullUsd(row.tvl_usd)],
      ['7-day change', row.change_7d === null ? 'not reported' : (row.change_7d > 0 ? '+' : '') + row.change_7d.toFixed(2) + '%'],
      ['First tracked', row.listed_at || 'not reported'],
      ['Days with no token', row.age_days === null ? 'not reported' : row.age_days + ' days'],
      ['Chains', row.chains.length ? row.chains.join(', ') : 'not named'],
      ['DefiLlama rank on this board', '#' + row.rank + ' of ' + DATA.rows.length]
    ];
    var factHtml = '';
    for (var f = 0; f < facts.length; f++) {
      factHtml += '<div><dt>' + esc(facts[f][0]) + '</dt><dd>' + esc(facts[f][1]) + '</dd></div>';
    }
    drawerBody.innerHTML =
      '<p class="d-tag">' + (row.watchlist ? 'On the watchlist' : 'Below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor') + ' · records no token</p>' +
      '<h2 class="d-title" id="drawer-title">' + esc(row.name) + '</h2>' +
      '<p class="d-sub">' + esc(row.slug) + ' · ' + esc(row.category || 'uncategorised') + '</p>' +
      '<div class="d-value"><strong>' + compactUsd(v.implied) + '</strong>' +
      '<span>implied value · ' + v.multiple.toFixed(2) + '× TVL</span>' +
      '<span>radar score ' + v.score.toFixed(1) + ' / 100</span></div>' +
      '<h3 class="d-h">Why this score</h3>' +
      '<div class="signals">' +
      signalBar('scale', row.signals.scale, w.scale, false) +
      signalBar('momentum', row.signals.momentum, w.momentum, true) +
      signalBar('tenure', row.signals.tenure, w.tenure, false) +
      signalBar('breadth', row.signals.breadth, w.breadth, true) +
      '</div>' +
      '<h3 class="d-h">The record</h3>' +
      '<dl class="facts">' + factHtml + '</dl>' +
      '<h3 class="d-h">How to farm it before a token exists</h3>' +
      '<ol class="plan">' + plan + '</ol>' +
      '<p class="note">A protocol that records no token may still hold one this snapshot does not carry, and nothing here says a token is coming. The steps pay off only if one is issued.</p>';
    drawer.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;
    el('drawer-close').focus({ preventScroll: true });
  }

  function closeDrawer() {
    state.open = null;
    drawer.setAttribute('aria-hidden', 'true');
    scrim.hidden = true;
    var open = rowsBody.querySelector('tr.is-open');
    if (open) open.classList.remove('is-open');
  }

  function openDrawer(slug) {
    state.open = slug;
    var rows = rowsBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('is-open', rows[i].getAttribute('data-slug') === slug);
    renderDrawer(slug);
  }

  // ---------------------------------------------------------------- the model panel

  function syncSliders() {
    var inputs = document.querySelectorAll('#sliders input[data-weight]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      input.value = state.weights[input.getAttribute('data-weight')];
      input.parentNode.querySelector('output').textContent = String(input.value);
    }
    var changed = Object.keys(BASE_WEIGHTS).some(function (k) { return Number(state.weights[k]) !== BASE_WEIGHTS[k]; });
    el('weights-note').textContent = changed
      ? 'What-if weights: the board is re-ranked in the page only. board.json keeps radar-3: ' +
        BASE_WEIGHTS.scale + '/' + BASE_WEIGHTS.momentum + '/' + BASE_WEIGHTS.tenure + '/' + BASE_WEIGHTS.breadth + '.'
      : 'Moving a weight re-ranks the board in the page. board.json stays the model above; this is what-if only.';
    el('weights-reset').hidden = !changed;
  }

  // ---------------------------------------------------------------- wiring

  function setToggle(button, on) {
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  el('q').addEventListener('input', function (e) { state.q = e.target.value; renderRows(); });

  function fillSelect(select, values, allLabel) {
    for (var i = 0; i < values.length; i++) {
      var option = document.createElement('option');
      option.value = values[i];
      option.textContent = values[i];
      select.appendChild(option);
    }
    select.options[0].textContent = allLabel;
  }

  (function () {
    var categories = {}, chains = {};
    DATA.rows.forEach(function (row) {
      if (row.category) categories[row.category] = (categories[row.category] || 0) + 1;
      row.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; });
    });
    var catList = Object.keys(categories).sort(function (a, b) { return categories[b] - categories[a] || a.localeCompare(b); });
    var chainList = Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a] || a.localeCompare(b); });
    fillSelect(el('category'), catList, 'All categories');
    fillSelect(el('chain'), chainList, 'All chains');
  })();

  el('category').addEventListener('change', function (e) { state.category = e.target.value; renderRows(); });
  el('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderRows(); });

  el('toggle-watchlist').addEventListener('click', function (e) {
    state.watchlist = !state.watchlist;
    setToggle(e.target, state.watchlist);
    renderRows();
  });
  el('toggle-gainers').addEventListener('click', function (e) {
    state.gainers = !state.gainers;
    setToggle(e.target, state.gainers);
    renderRows();
  });

  el('reset').addEventListener('click', function () {
    state.q = '';
    state.category = '';
    state.chain = '';
    state.watchlist = false;
    state.gainers = false;
    state.weights = Object.assign({}, BASE_WEIGHTS);
    state.sort = { key: 'rank', dir: 1 };
    el('q').value = '';
    el('category').value = '';
    el('chain').value = '';
    setToggle(el('toggle-watchlist'), false);
    setToggle(el('toggle-gainers'), false);
    syncSliders();
    renderAll();
  });

  document.querySelector('.grid thead').addEventListener('click', function (e) {
    var button = e.target.closest('button[data-sort]');
    if (!button) return;
    var key = button.getAttribute('data-sort');
    if (state.sort.key === key) state.sort.dir = -state.sort.dir;
    else state.sort = { key: key, dir: key === 'rank' || key === 'name' ? 1 : -1 };
    renderRows();
    renderSort();
  });

  rowsBody.addEventListener('click', function (e) {
    var planButton = e.target.closest('button[data-plan]');
    if (planButton) {
      openDrawer(planButton.getAttribute('data-plan'));
      return;
    }
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDrawer(tr.getAttribute('data-slug'));
  });

  rowsBody.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    e.preventDefault();
    openDrawer(tr.getAttribute('data-slug'));
  });

  el('drawer-close').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.open) closeDrawer();
  });

  el('sliders').addEventListener('input', function (e) {
    var input = e.target.closest('input[data-weight]');
    if (!input) return;
    state.weights[input.getAttribute('data-weight')] = Number(input.value);
    syncSliders();
    renderRows();
    if (state.open) renderDrawer(state.open);
  });
  el('weights-reset').addEventListener('click', function () {
    state.weights = Object.assign({}, BASE_WEIGHTS);
    syncSliders();
    renderRows();
    if (state.open) renderDrawer(state.open);
  });

  // ---------------------------------------------------------------- masthead figures

  el('as-of').textContent = DATA.as_of;
  el('model-version').textContent = DATA.model_version;
  el('watchlist-covered').textContent = DATA.watchlist_size + ' / ' + DATA.watchlist_size;
  el('floor').textContent = compactUsd(DATA.floor_usd);
  el('fig-scanned').textContent = DATA.scanned.toLocaleString('en-US');
  el('fig-ranked').textContent = String(DATA.board_size);
  el('fig-top').textContent = compactUsd(DATA.top_implied_usd);
  el('fig-top-name').textContent = '#' + DATA.rows[0].name;
  el('fig-multiple').textContent = DATA.median_multiple.toFixed(2) + '× TVL';
  el('fig-comparable').textContent = DATA.median_comparable_ratio.toFixed(2) + '× for protocols already trading';
  el('panel-comparable').textContent = DATA.median_comparable_ratio.toFixed(2) + '× TVL';
  el('source').textContent = DATA.source;

  syncSliders();
  renderAll();
})();
