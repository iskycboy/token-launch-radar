// Token Launch Radar — dashboard (model radar-2).
// Reads window.RADAR (written beside dashboard/ by main.ts) and renders the ranked board, a
// filterable and sortable table, a per-protocol detail view with the model's own arithmetic and
// the protocol's farm plan, a comparison tab for protocols whose token already trades, and the
// method in plain words. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var M = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'pre', sort: 'rank', dir: 1, selected: null };

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
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // The model, recomputed in the page from the row's own figures, so the number on screen can be
  // checked against board.json: implied = TVL x category multiple x growth x maturity x breadth.
  // The multiple is the median market-cap/TVL of the tokens that already trade in the row's
  // category (or of all traded tokens when the category has too few), computed by lib/model.ts
  // from the same snapshot and carried in the row.
  function impliedOf(row) {
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, M.growth_floor, M.growth_cap);
    var growthMult = clamp(1 + (growth / 100) * M.growth_weight, 0.6, 1.35);
    var age = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var maturity = M.maturity_floor + (clamp(age, 0, M.maturity_days) / M.maturity_days) * M.maturity_range;
    var breadth = 1 + M.breadth_per_chain * Math.min(Math.max(row.chains.length - 1, 0), M.breadth_max_extra);
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
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

  // The farm plan, the same derivation lib/model.ts writes to board.json: category picks the two
  // core actions, the first chain picks the gas note, TVL picks the capital, age picks the hold.
  // No protocol name is ever special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasNote(chain) {
    var c = String(chain).toLowerCase();
    if (c === 'ethereum') return 'about $4-8 of gas per transaction at ordinary fees';
    if (c === 'bitcoin') return 'about $1-3 of network fees per transaction';
    if (c === 'solana') return 'under $0.05 of fees per transaction';
    return 'about $0.10-0.50 of gas per transaction on this chain';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionsFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return [
      'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' so the wallet starts earning supply history.',
      'Borrow about 30% against the supply once, repay it within a week, and repeat monthly so the wallet shows real borrowing activity, not a parked deposit.'];
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return [
      'Provide $' + capital + " of liquidity to " + name + "'s highest-volume pool on " + chain + ', split evenly between the two pool assets.',
      'Make two small swaps a week through ' + name + "'s own interface so the wallet builds genuine trading volume, and claim any pool fees weekly."];
    if (c.indexOf('bridge') >= 0) return [
      'Bridge $' + capital + ' of USDC from Ethereum to ' + chain + ' through ' + name + '.',
      'Use the bridged funds in one app on ' + chain + ' the same day, then bridge a small amount back a week later so both directions are on record.'];
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return [
      "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the liquid receipt token in the same wallet.',
      'Use the receipt token once in a lending or liquidity app that ' + name + ' lists as a partner, so the wallet shows composed activity.'];
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return [
      'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position (long and short the same asset in equal size).',
      'Trade a few small positions each week to build volume history, keeping total open risk under 10% of the deposit.'];
    if (c.indexOf('prediction') >= 0) return [
      'Fund $' + capital + ' and place one position in ' + name + "'s most liquid market.",
      "Place one or two small positions a week in different markets so the wallet's history is broad, not a single bet."];
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return [
      'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' with a track record of at least 90 days and keep the vault shares.',
      'Add a second, smaller deposit after two weeks so the wallet shows repeat deposits rather than one touch.'];
    if (c.indexOf('stable') >= 0) return [
      'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it in the farming wallet.',
      'Use the stable asset once in a partner lending or liquidity app named on ' + name + "'s own page, then return it to the wallet."];
    if (c.indexOf('rwa') >= 0) return [
      'Mint $' + capital + ' of ' + name + "'s yield asset on " + chain + ' and hold it in the farming wallet.',
      "Hold through at least two yield distributions so the wallet's holding period is visible in snapshots."];
    if (c.indexOf('insurance') >= 0) return [
      'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for the longest term offered and keep the policy active.',
      'Renew or extend the cover once before it lapses so the wallet shows continuing participation.'];
    return [
      'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.',
      "Repeat the core action once a week in a small amount so the wallet's activity spans several snapshots."];
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasNote(chain);
    var acts = actionsFor(p, capital, chain);
    var raw = [
      { text: 'Set up one fresh wallet for ' + p.name + ' only, fund it from an exchange withdrawal, and keep its seed phrase offline.', cost: 'the withdrawal fee only, usually under $2', time: '10 minutes' },
      { text: acts[0], cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: acts[1], cost: gas + ' per action', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days and keep the wallet active in at least four separate weeks, so the activity survives more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Check " + p.name + "'s own site and official social account once a week for a points, quests or rewards page; join only what the protocol itself publishes.", cost: 'nothing to check, and never pay anyone to claim', time: '5 minutes a week' },
      { text: 'Log every transaction hash, date and amount in a farm log for this wallet, so the position can be repeated, audited or unwound later.', cost: 'nothing but the log', time: '5 minutes a week' },
      { text: "If a token or claim is announced, claim only from the link on " + p.name + "'s official site, then decide to hold or sell with the position's full cost in front of you.", cost: 'one claim transaction at the gas note above', time: '20 minutes when it happens' }
    ];
    return raw.map(function (s) {
      var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
      return t.length > 600 ? t.slice(0, 596) + '...' : t;
    });
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { r.chains.forEach(function (c) { seen[c] = true; }); });
    return Object.keys(seen).sort();
  }
  function visible() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var k = state.sort;
      var va = k === 'name' ? a.name.toLowerCase() : a[k];
      var vb = k === 'name' ? b.name.toLowerCase() : b[k];
      if (va === vb) return a.rank - b.rank;
      return (va < vb ? -1 : 1) * state.dir;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', null,
        el('h1', null, 'TOKEN LAUNCH RADAR', el('span', { class: 'dot', text: ' ●' })),
        el('p', { class: 'tagline', text: 'Protocols that record no token yet, ranked by what a launch would be worth — and exactly how to farm each one before it happens. Values are this radar\u2019s own model, stated below, never a promise.' })),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'ranked' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.watchlist_size) }), el('span', { text: 'watchlist' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'early finds' })),
        el('div', { class: 'stat' }, el('b', { text: DATA.as_of }), el('span', { text: 'snapshot' }))));
  }

  function controls(count) {
    var catSel = el('select', { 'aria-label': 'Category', onchange: function () { state.category = catSel.value; render(); } },
      el('option', { value: 'all', text: 'All categories' }),
      categories().map(function (c) { return el('option', { value: c, text: c, selected: state.category === c ? 'selected' : null }); }));
    var chainSel = el('select', { 'aria-label': 'Chain', onchange: function () { state.chain = chainSel.value; render(); } },
      el('option', { value: 'all', text: 'All chains' }),
      chains().map(function (c) { return el('option', { value: c, text: c, selected: state.chain === c ? 'selected' : null }); }));
    var search = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search',
      oninput: function () { state.q = search.value; renderTable(); } });
    var watch = el('input', { type: 'checkbox', onchange: function () { state.watchOnly = watch.checked; render(); } });
    if (state.watchOnly) watch.setAttribute('checked', 'checked');
    return el('div', { class: 'controls' }, search, catSel, chainSel,
      el('label', { class: 'check' }, watch, 'Watchlist only'),
      el('span', { class: 'count', text: count + ' shown' }));
  }

  function tabs() {
    function tab(id, label) {
      return el('button', { 'aria-selected': state.tab === id ? 'true' : 'false', onclick: function () { state.tab = id; render(); }, text: label });
    }
    return el('div', { class: 'tabs' }, tab('pre', 'Pre-token board'), tab('live', 'Already trading (comparison)'));
  }

  var tableHost = el('div');
  var detailHost = el('div');

  function sortHead(label, key, num) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
    return el('th', { class: 'sortable' + (num ? ' num' : ''), onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      renderTable();
    }, text: label + arrow });
  }

  function renderTable() {
    tableHost.textContent = '';
    if (state.tab === 'live') {
      var lt = el('table', null,
        el('thead', null, el('tr', null,
          el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Market cap' }),
          el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'MCap / TVL' }), el('th', { class: 'num', text: '7d' }))),
        el('tbody', null, DATA.live.map(function (r) {
          return el('tr', null,
            el('td', null, el('span', { class: 'name', text: r.name }), ' ', el('span', { class: 'slug', text: r.slug })),
            el('td', { text: r.category || '—' }),
            el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
            el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
            el('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a' }),
            el('td', { class: 'num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : ''), text: fmtPct(r.change_7d) }));
        })));
      tableHost.appendChild(lt);
      tableHost.appendChild(el('p', { class: 'count', text: 'These protocols already trade. They are the comparison set the category multiples are medians of — never ranked, never mixed into the board.' }));
      return;
    }
    var rows = visible();
    var table = el('table', null,
      el('thead', null, el('tr', null,
        sortHead('#', 'rank', true), sortHead('Protocol', 'name'), el('th', { text: 'Category' }),
        el('th', { text: 'Chains' }), sortHead('TVL', 'tvl_usd', true), sortHead('7d', 'change_7d', true),
        sortHead('Multiple', 'multiple', true), sortHead('Implied value', 'implied_value_usd', true), sortHead('Ready', 'readiness', true))),
      el('tbody', null, rows.map(function (r) {
        return el('tr', { class: state.selected === r.slug ? 'selected' : '', onclick: function () { state.selected = r.slug; renderTable(); renderDetail(); } },
          el('td', { class: 'num', text: String(r.rank) }),
          el('td', null, el('span', { class: 'name', text: r.name }), ' ', el('span', { class: 'slug', text: r.slug })),
          el('td', { text: r.category || '—' }),
          el('td', null, r.chains.slice(0, 3).map(function (c) { return el('span', { class: 'chip', text: c }); }),
            r.watchlist ? el('span', { class: 'chip watch', text: 'watchlist' }) : null),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : ''), text: fmtPct(r.change_7d) }),
          el('td', { class: 'num', text: r.multiple.toFixed(2) + 'x' }),
          el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('td', { class: 'num' }, el('span', { class: 'ready' }, el('i', { style: 'width:' + r.readiness + '%' })), String(r.readiness)));
      })));
    tableHost.appendChild(table);
    var count = document.querySelector('.controls .count');
    if (count) count.textContent = rows.length + ' shown';
  }

  function renderDetail() {
    detailHost.textContent = '';
    var r = DATA.rows.find(function (x) { return x.slug === state.selected; });
    if (!r) {
      detailHost.appendChild(el('div', { class: 'detail' },
        el('p', { class: 'sub', text: 'Pick any row to see its model breakdown and its full farm plan.' })));
      return;
    }
    var check = impliedOf(r);
    var steps = farmSteps(r);
    detailHost.appendChild(el('div', { class: 'detail' },
      el('h2', { text: '#' + r.rank + ' ' + r.name }),
      el('p', { class: 'sub', text: r.slug + ' · ' + (r.category || 'uncategorised') + ' · on ' + r.chains.join(', ') +
        ' · tracked by DefiLlama for ' + fmtAge(r.age_days) + ' with no token recorded' + (r.watchlist ? ' · on the house watchlist' : ' · early find below the watchlist floor') }),
      el('div', { class: 'grid' },
        el('div', { class: 'cell' }, el('b', { text: fmtUsd(r.implied_value_usd) }), el('span', { text: 'implied launch value' })),
        el('div', { class: 'cell' }, el('b', { text: fmtUsd(r.tvl_usd) }), el('span', { text: 'TVL in snapshot' })),
        el('div', { class: 'cell' }, el('b', { text: r.multiple.toFixed(2) + 'x' }), el('span', { text: 'category multiple' })),
        el('div', { class: 'cell' }, el('b', { text: String(r.readiness) + ' / 100' }), el('span', { text: 'launch readiness' }))),
      el('h3', { text: 'How this value is derived' }),
      el('p', { class: 'formula', text: 'implied = TVL ' + fmtUsd(r.tvl_usd) + ' x multiple ' + r.multiple.toFixed(3) +
        ' (' + r.multiple_source + ') x growth ' + r.growth_multiplier.toFixed(3) + ' (7d ' + fmtPct(r.change_7d) +
        ') x maturity ' + r.maturity_multiplier.toFixed(3) + ' (age ' + fmtAge(r.age_days) + ') x breadth ' +
        r.breadth_multiplier.toFixed(3) + ' (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ') = ' +
        fmtUsd(r.implied_value_usd) + (check === r.implied_value_usd ? ' — recomputed in this page, matches board.json.' : '') }),
      el('h3', { text: 'Farm plan' }),
      el('ol', null, steps.map(function (s) { return el('li', { text: s }); }))));
  }

  function method() {
    return el('section', { class: 'method' },
      el('h2', { text: 'The method — model ' + DATA.model_version }),
      el('p', { text: 'Source: ' + DATA.source + '. The board covers all ' + DATA.watchlist_size + ' watchlist protocols (TVL at or above ' + fmtUsd(DATA.floor_usd) + ', no token recorded, not a wrapped or staked product of a traded token) plus ' + DATA.early_size + ' early finds below that floor chosen by TVL.' }),
      el('p', null, 'Implied value = ', el('code', { text: 'TVL x category multiple x growth x maturity x breadth' }),
        ' The multiple is the trimmed median market-cap/TVL of the protocols in the same category whose token already trades (the global median when a category has fewer than three), clamped to 0.05x–3x. Growth follows the seven-day TVL change, maturity follows the days tracked with no token, breadth follows the chain count. No name is special-cased; the same function scores every row, and this page recomputes each value from the row\u2019s own figures.'),
      el('p', { text: 'Readiness (0–100) mixes age without a token, size against the floor, seven-day momentum and chain breadth. It is shown for triage only — rank is implied value alone. A protocol here records no token on DefiLlama; that is the record, not proof none exists. An implied value is this radar\u2019s claim about what a launch would be worth if the record held — not a prediction that a token will come.' }));
  }

  function render() {
    app.textContent = '';
    app.appendChild(header());
    app.appendChild(controls(visible().length));
    app.appendChild(tabs());
    app.appendChild(tableHost);
    app.appendChild(detailHost);
    app.appendChild(method());
    app.appendChild(el('footer', { text: 'Token Launch Radar · built by @floryn for make.fun\u2019s token-radar-01 bounty · static page, no network, data as of ' + DATA.as_of }));
    renderTable();
    renderDetail();
    app.setAttribute('aria-busy', 'false');
  }

  render();
})();
