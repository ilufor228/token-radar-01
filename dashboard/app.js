'use strict';
// The board page: sort, filter and open one protocol. All data comes from window.RADAR,
// which main.ts writes beside the page, so nothing here reaches the network.

const view = {
  rows: [],
  sort: 'implied_value_usd',
  direction: -1,
  chain: '',
  category: '',
  watchlist: false,
  floor: 0,
  query: '',
};

const usd = (n) => (n === null || n === undefined ? '-' : `$${Math.round(n).toLocaleString('en-US')}`);
const compact = (n) => {
  if (n === null || n === undefined) return '-';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
};
// The snapshot's change_7d is already a percentage (-2.19 is a 2.19% fall).
const pct = (n) => (n === null || n === undefined ? '-' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const age = (days) => (days === null || days === undefined ? '-' : days >= 365 ? `${(days / 365).toFixed(1)}y` : `${days}d`);
const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function boot() {
  const data = window.RADAR;
  const status = document.getElementById('status');
  if (!data || !Array.isArray(data.rows)) {
    status.textContent = 'no board beside this page: run main.ts, which writes data.js';
    return;
  }
  view.rows = data.rows;
  document.getElementById('model').textContent = data.model;
  document.getElementById('asof').textContent = data.as_of || 'unknown';
  document.getElementById('tally-rows').textContent = String(data.rows.length);
  document.getElementById('tally-watch').textContent = String(data.rows.filter((r) => r.watchlist).length);
  document.getElementById('tally-top').textContent = compact(data.rows[0]?.implied_value_usd ?? null);
  fillSelect('chain', (r) => r.chains);
  fillSelect('category', (r) => [r.category]);
  wire();
  render();
}

function fillSelect(id, valuesOf) {
  const select = document.getElementById(id);
  const seen = new Set();
  for (const row of view.rows) for (const value of valuesOf(row)) seen.add(value);
  for (const value of [...seen].sort((a, b) => a.localeCompare(b))) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function wire() {
  document.getElementById('controls').addEventListener('input', (event) => {
    const field = event.target;
    if (field.id === 'watchlist') view.watchlist = field.checked;
    else if (field.id === 'q') view.query = field.value.trim().toLowerCase();
    else if (field.id === 'floor') view.floor = Number(field.value) * 1e6;
    else if (field.id === 'chain' || field.id === 'category') view[field.id] = field.value;
    render();
  });
  document.getElementById('controls').addEventListener('reset', () => {
    setTimeout(() => {
      Object.assign(view, { chain: '', category: '', watchlist: false, floor: 0, query: '' });
      render();
    }, 0);
  });
  for (const head of document.querySelectorAll('th[data-sort]')) {
    head.tabIndex = 0;
    const flip = () => {
      const key = head.dataset.sort;
      view.direction = view.sort === key ? -view.direction : -1;
      view.sort = key;
      render();
    };
    head.addEventListener('click', flip);
    head.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        flip();
      }
    });
  }
  document.getElementById('close').addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
}

function visibleRows() {
  return view.rows.filter((row) => {
    if (view.watchlist && !row.watchlist) return false;
    if (view.chain && !row.chains.includes(view.chain)) return false;
    if (view.category && row.category !== view.category) return false;
    if (view.floor && row.tvl_usd < view.floor) return false;
    if (view.query && !row.name.toLowerCase().includes(view.query)) return false;
    return true;
  });
}

function compare(a, b, key) {
  const left = a[key];
  const right = b[key];
  if (key === 'chains') return (a.chains.length - b.chains.length) * view.direction;
  if (typeof left === 'number' && typeof right === 'number') return (left - right) * view.direction;
  return String(left ?? '').localeCompare(String(right ?? '')) * view.direction;
}

function render() {
  const rows = visibleRows().sort((a, b) => compare(a, b, view.sort));
  const body = document.querySelector('#board tbody');
  body.textContent = '';

  for (const head of document.querySelectorAll('th[data-sort]')) {
    if (head.dataset.sort === view.sort) head.setAttribute('aria-sort', view.direction === 1 ? 'ascending' : 'descending');
    else head.removeAttribute('aria-sort');
  }

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    const change = row.change_7d === null ? 'dim' : row.change_7d >= 0 ? 'rise' : 'fall';
    tr.innerHTML =
      `<td class="num">${row.rank}</td>` +
      `<td class="name${row.watchlist ? ' on-watch' : ''}">${escape(row.name)}</td>` +
      `<td class="dim">${escape(row.category)}</td>` +
      `<td class="num">${compact(row.tvl_usd)}</td>` +
      `<td class="num ${change}">${pct(row.change_7d)}</td>` +
      `<td class="num">${age(row.age_days)}</td>` +
      `<td class="num">${row.chains.length}</td>` +
      `<td class="num">${row.score.toFixed(2)}</td>` +
      `<td class="num">${usd(row.implied_value_usd)}</td>`;
    tr.addEventListener('click', () => openDetail(row));
    tr.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') openDetail(row);
    });
    body.append(tr);
  }

  const status = document.getElementById('status');
  const watch = rows.filter((r) => r.watchlist).length;
  status.textContent = `${rows.length} of ${view.rows.length} rows, ${watch} on the watchlist, sorted by ${view.sort} ${view.direction === 1 ? 'ascending' : 'descending'}`;
}

function bar(label, value) {
  const width = Math.max(0, Math.min(1, value)) * 100;
  return `<div class="bar"><span>${label}</span><span class="track"><span class="fill" style="width:${width.toFixed(1)}%"></span></span><span>${value.toFixed(3)}</span></div>`;
}

function openDetail(row) {
  const detail = document.getElementById('detail');
  const signals = row.signals;
  detail.innerHTML =
    `<h2>${escape(row.name)}</h2>` +
    `<p class="sub">rank ${row.rank} of ${view.rows.length} &middot; ${escape(row.category)}${row.watchlist ? ' &middot; watchlist' : ''}</p>` +
    `<dl class="kv">` +
    `<dt>Implied value</dt><dd>${usd(row.implied_value_usd)}</dd>` +
    `<dt>TVL</dt><dd>${compact(row.tvl_usd)}</dd>` +
    `<dt>Value / TVL</dt><dd>${row.multiple === null ? '-' : `${row.multiple.toFixed(2)}x`}</dd>` +
    `<dt>7d TVL change</dt><dd>${pct(row.change_7d)}</dd>` +
    `<dt>Listed</dt><dd>${row.listed_at === null ? 'not recorded' : `${escape(row.listed_at)} (${age(row.age_days)})`}</dd>` +
    `<dt>Token</dt><dd>${row.token_status}</dd>` +
    `<dt>Chains</dt><dd>${escape(row.chains.join(', ') || 'not recorded')}</dd>` +
    `<dt>Score</dt><dd>${row.score.toFixed(2)} / 100</dd>` +
    `</dl>` +
    `<h3>What moved the score</h3><div class="bars">` +
    bar('scale 55%', signals.scale) +
    bar('momentum 25%', signals.momentum) +
    bar('tenure 15%', signals.tenure) +
    bar('breadth 5%', signals.breadth) +
    `</div>` +
    `<h3>Farm plan, ${row.farm_steps.length} steps</h3><ol class="steps">${row.farm_steps.map((step) => `<li>${escape(step)}</li>`).join('')}</ol>`;
  const drawer = document.getElementById('drawer');
  drawer.hidden = false;
  document.getElementById('close').focus();
}

function close() {
  document.getElementById('drawer').hidden = true;
}

boot();
