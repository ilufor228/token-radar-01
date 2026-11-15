// Token Radar's dark dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own score breakdown and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// The farm plan and the score below are the same derivation main.ts writes to board.json:
// category, chains, TVL and age decide the action, the capital, the hold and every cost and time.
// No name is special-cased, and the page recomputes each row to check the board's numbers.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', minTvl: 0, watchOnly: false, tab: 'pre-token', sort: 'rank', dir: 1, selected: null, liveSelected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The score in one function: log TVL, clamped growth, capped age, chain breadth, weighted.
  function scoreOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var tvl = Math.min(100, Math.max(0, 100 * (Math.log10(Math.max(1, row.tvl_usd)) - Math.log10(model.tvl_floor_usd)) / (Math.log10(model.tvl_cap_usd) - Math.log10(model.tvl_floor_usd))));
    var growthScore = Math.min(100, Math.max(0, 100 * (growth - model.growth_floor) / (model.growth_cap - model.growth_floor)));
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var ageScore = Math.min(100, Math.max(0, 100 * Math.min(Math.max(age, 0), model.age_cap_days) / model.age_cap_days));
    var breadth = Math.min(100, Math.max(0, 100 * Math.min((row.chains || []).length, model.chains_cap) / model.chains_cap));
    var total = model.weight_tvl * tvl + model.weight_growth * growthScore + model.weight_age * ageScore + model.weight_breadth * breadth;
    return { tvl: Math.round(tvl * 100) / 100, growth: Math.round(growthScore * 100) / 100, age: Math.round(ageScore * 100) / 100, breadth: Math.round(breadth * 100) / 100, total: Math.round(total * 100) / 100 };
  }
  function impliedOf(row, model) {
    var total = scoreOf(row, model).total;
    return Math.max(1, Math.round(model.implied_base_usd * Math.pow(10, total * model.implied_exponent)));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // --- Farm plan: the same derivation as lib/model.ts (category, chains, TVL, age) ---
  var GAS_USD = { ethereum: 4, solana: 0.05, base: 0.15, arbitrum: 0.3, optimism: 0.2, polygon: 0.05, binance: 0.25, avalanche: 0.3, 'hyperliquid l1': 0.05, monad: 0.05, plasma: 0.1, berachain: 0.1, sui: 0.05, aptos: 0.05, gnosis: 0.1, linea: 0.1, scroll: 0.15, zksync: 0.15, blast: 0.1, mode: 0.05, 'robinhood chain': 0.05, ink: 0.05, unichain: 0.1, worldchain: 0.1, sei: 0.05, near: 0.02, tron: 0.5, bitcoin: 2, 'lightning network': 0.01, katana: 0.1, arc: 0.1, tempo: 0.1, stable: 0.1, corn: 0.1, morph: 0.1, cronos: 0.1, celo: 0.05, 'arbitrum nova': 0.1, mantle: 0.1, taiko: 0.15 };
  function gasUsd(chain) { var g = GAS_USD[String(chain).toLowerCase()]; return g === undefined ? 1.5 : g; }
  function money(n) { return n < 1 ? '$' + n.toFixed(2) : '$' + Math.round(n); }
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 2.5e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trading') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var chain2 = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var gas = gasUsd(chain);
    var gas2 = chain2 === null ? gas : gasUsd(chain2);
    var capital = capitalFor(p);
    var secondCapital = capital >= 150 ? 50 : 25;
    var hold = holdDaysFor(p.age_days);
    var gas6 = money(gas * 6);
    var second = chain2 === null
      ? { text: 'Make a second qualifying action on ' + chain + ' in the same week, such as a swap, a borrow or a vote.', cost: 'about ' + money(gas) + ' of gas', time: '10 minutes' }
      : { text: 'Repeat a smaller $' + secondCapital + ' position on ' + chain2 + ' so the same wallet is active on a second chain.', cost: '$' + secondCapital + ' of capital and about ' + money(gas2) + ' of gas', time: '10 minutes' };
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and fund it with enough ' + chain + ' gas for about six transactions.', cost: 'about ' + gas6 + ' in gas', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about ' + money(gas) + ' of gas', time: '15 minutes to set up' },
      second,
      { text: 'Do one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet stays active across snapshots.', cost: 'about ' + money(gas) + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days, then open the protocol' + "'" + 's own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check; never pay to claim', time: hold + ' days of holding, 10 minutes to check' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log, and unwind in reverse order when you exit.', cost: 'about ' + money(gas) + ' of gas to unwind', time: '5 minutes to log, 10 minutes to exit' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('live')) state.liveSelected = params.get('live');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('min')) state.minTvl = Number(params.get('min')) || 0;
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.minTvl > 0) params.set('min', String(state.minTvl));
    if (state.watchOnly) params.set('watch', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    if (state.liveSelected) params.set('live', state.liveSelected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function matchesCommon(r, q) {
    if (state.category !== 'all' && r.category !== state.category) return false;
    if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
    if (!q) return true;
    var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      return matchesCommon(r, q);
    });
  }
  function liveList() {
    var q = state.q.trim().toLowerCase();
    return DATA.live.filter(function (r) { return matchesCommon(r, q); });
  }
  function sortKey(r) {
    if (state.sort === 'name') return r.name.toLowerCase();
    if (state.sort === 'tvl') return r.tvl_usd;
    if (state.sort === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (state.sort === 'age') return r.age_days === null ? Infinity : r.age_days;
    if (state.sort === 'implied') return r.implied_value_usd;
    return r.rank;
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av = sortKey(a), bv = sortKey(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar // ' + DATA.model_version })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, 'Floor ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null, 'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }), ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) }), ' rankable protocols below that floor — every one that passes the watchlist rule, not a hand-picked top 160. Implied value is a model, not a promise, and never a prediction that a token will launch.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var minSel = el('select', { id: 'min-tvl', 'aria-label': 'Minimum TVL' },
      [0, 5e6, 5e7, 1e8, 5e8, 1e9].map(function (v) {
        return el('option', { value: String(v), text: v === 0 ? 'Any TVL' : 'TVL >= ' + fmtUsd(v), selected: v === state.minTvl ? 'selected' : null });
      })
    );
    minSel.addEventListener('change', function () { state.minTvl = Number(minSel.value) || 0; writeHash(); render(); });
    var watch = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.watchOnly ? 'checked' : null, 'aria-label': 'Watchlist only' }),
      'Watchlist only'
    );
    watch.querySelector('input').addEventListener('change', function (e) { state.watchOnly = e.target.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'min-tvl', text: 'Min TVL' }), minSel),
      watch,
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : liveList().length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' || key === 'name' ? 1 : -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.minTvl = 0; state.watchOnly = false; writeHash(); render(); } })
      ));
    }
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String(r.score.total.toFixed(2)) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: r.watchlist ? 'badge watch' : 'badge', text: r.watchlist ? 'watchlist - no token' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its score breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            el('th', { scope: 'col', text: 'Score' }),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var list = liveList();
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No live-token protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', {
        'data-selected': state.liveSelected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openLiveDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLiveDetail(r.slug); } }
      },
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'badge live', text: 'already trades' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked: the board is every protocol that passes the watchlist rule.' }),
      el('div', { class: 'formula' },
        el('div', null, 'tvlScore = 100 x (log10(TVL) - log10(', el('b', { text: '$5M' }), ')) / (log10(', el('b', { text: '$3B' }), ') - log10(', el('b', { text: '$5M' }), '))'),
        el('div', null, 'growthScore = 100 x (clamp(7d, -60, +120) + 60) / 180'),
        el('div', null, 'ageScore = 100 x min(age_days, 1825) / 1825   (unknown age: 365 days)'),
        el('div', null, 'breadthScore = 100 x min(chains, 8) / 8'),
        el('div', null, 'total = ', el('b', { text: '0.55' }), ' x tvl + ', el('b', { text: '0.25' }), ' x growth + ', el('b', { text: '0.15' }), ' x age + ', el('b', { text: '0.05' }), ' x breadth'),
        el('div', null, 'implied = round(', el('b', { text: '$500,000' }), ' x 10^(total x 0.024)), then forced strictly decreasing down the ranks')
      ),
      el('p', { class: 'sub', text: 'TVL is scored on a log scale, so a $2.7B protocol is not worth 500x a $5M one as a launch. Age is the time since the protocol was first listed, the best record of how long it has run with no token. Wrapped, staked and bridged products, CEXs and versioned pools are left out by the same rule that defines the watchlist: WBTC is Bitcoin on Ethereum, not a launch. Implied value is this entry\u2019s model claim, never make.fun\u2019s, and it is not a prediction that a token will launch.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; state.liveSelected = null; writeHash(); });

  function scoreBar(label, weight, value) {
    return el('div', { class: 'scorebar' },
      el('span', { class: 'lab', text: label + ' (' + weight + ')' }),
      el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.round(value)) + '%' })),
      el('span', { class: 'val', text: value.toFixed(2) })
    );
  }

  function detailHead(title, sub, rankLabel) {
    return el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: rankLabel }),
        el('h2', { id: 'detail-title', text: title }),
        el('p', { class: 'sub', text: sub })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    );
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    state.liveSelected = null;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = scoreOf(row, DATA.model);
    var check = 'The page recomputes this row as total ' + recomputed.total.toFixed(2) + ' and ' + fmtUsd(impliedOf(row, DATA.model)) + (Math.abs(recomputed.total - row.score.total) < 0.01 ? ', the same score board.json carries.' : ', which differs from the board: the data would be stale.');
    dialog.appendChild(detailHead(row.name, (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain'), 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' - watchlist' : '')));
    dialog.appendChild(el('p', { class: 'warn', text: 'DefiLlama records no token for this protocol — that is not proof it has none. A token may exist that the record does not carry.' }));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'big', text: fmtUsd(row.implied_value_usd) }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) + (row.listed_at ? ' (since ' + row.listed_at + ')' : '') })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) }))
      ),
      el('p', { class: 'note', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. ' + check + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Score breakdown' }),
      scoreBar('TVL (log)', '55%', row.score.tvl),
      scoreBar('7d growth', '25%', row.score.growth),
      scoreBar('Age, no token', '15%', row.score.age),
      scoreBar('Chain breadth', '5%', row.score.breadth),
      el('div', { class: 'equation' }, el('div', null, el('span', { text: 'Weighted total' }), el('b', { class: 'num', text: row.score.total.toFixed(2) + ' / 100' })))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function openLiveDetail(slug) {
    var row = null;
    DATA.live.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.liveSelected = slug;
    state.selected = null;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(detailHead(row.name, (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain'), 'Live token - set aside from the ranking'));
    dialog.appendChild(el('p', { class: 'warn', text: 'This protocol already has a token that trades. There is no pre-token launch left to farm here.' }));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Market value' }),
      el('div', { class: 'big', text: fmtUsd(row.mcap_usd) }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Market cap' }), el('b', { class: 'num', text: fmtUsd(row.mcap_usd) })),
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) }))
      ),
      el('p', { class: 'note', text: 'The market cap is DefiLlama\u2019s recorded figure, a fact, not a model. No farm plan is given for a launch that has already happened.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    else if (state.liveSelected) openLiveDetail(state.liveSelected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
