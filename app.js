// Money Envelopes: a YNAB-style envelope budget that runs fully offline.
// Phone version: data is kept in this phone's browser storage and never leaves the phone.
(function () {
  'use strict';

  const KEY = 'moneyEnvelopes.v1';
  const PALETTE = ['#d2ae5e', '#c8383d', '#2f8f7a', '#3b6fd8', '#8a4fd1', '#e07b28'];
  const { categorize, INCOME, IGNORE } = window.Rules;
  const HOME = ''; // "needs a home"

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-CA', { maximumFractionDigits: 0 });
  const money2 = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const monthName = (m) => new Date(m + '-15T12:00:00').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  const shortMonth = (m) => new Date(m + '-15T12:00:00').toLocaleDateString('en-CA', { month: 'short' });
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    }
    n.append(...kids);
    return n;
  };
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  // ---------- storage ----------
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  async function load() {
    try {
      if (hasChrome) return (await chrome.storage.local.get(KEY))[KEY] || null;
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        if (hasChrome) await chrome.storage.local.set({ [KEY]: state });
        else localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) { console.error('Could not save', e); }
    }, 150);
  }

  // ---------- state ----------
  let state;
  const merchantKey = (s) => s.toUpperCase().replace(/[0-9#*]+/g, ' ').replace(/\s+/g, ' ').trim();
  const txKey = (t) => `${t.a}|${t.d}|${t.s}|${t.v.toFixed(2)}`;

  function sortTx(t) {
    // A payee you gave a statement name wins, then what the app learned, then a payee whose name shows up
    const up = t.s.toUpperCase();
    const exact = payees().find((p) => p.match && p.env && up.includes(p.match.toUpperCase()));
    if (exact) return exact.env;
    const learned = state.learned[merchantKey(t.s)];
    if (learned !== undefined) return learned;
    const named = payees().find((p) => p.env && p.name.length >= 4 && up.includes(p.name.toUpperCase()));
    if (named) return named.env;
    const env = categorize(t);
    return env === null ? HOME : env;
  }

  function fromSeed() {
    const S = window.SEED;
    state = {
      income: S.income,
      plan: S.plan.map((p) => ({ line: p.line, group: p.group, plan: p.plan, note: p.note })),
      tx: [],
      learned: {},
      color: 2,
      byFill: false,
      month: null,
      tab: 'envelopes',
    };
    let id = 1;
    for (const t of S.tx) state.tx.push({ id: id++, d: t.d, a: t.a, s: t.s, v: t.v, env: null });
    state.nextId = id;
    state.tx.forEach((t) => { t.env = sortTx(t); });
    state.plan.forEach((p) => { p.alert = defaultAlert(p.group); });
    state.alerted = {};
    markAllAlerted();
  }

  const months = () => [...new Set(state.tx.map((t) => t.d.slice(0, 7)))].sort();
  const lines = () => state.plan.map((p) => p.line);
  function spentBy(month) {
    const out = {};
    for (const t of state.tx) {
      if (month && !t.d.startsWith(month)) continue;
      if (!t.env || t.env === INCOME || t.env === IGNORE) continue;
      out[t.env] = (out[t.env] || 0) - t.v;
    }
    return out;
  }
  const incomeIn = (month) => state.tx.filter((t) => t.d.startsWith(month) && t.env === INCOME).reduce((a, t) => a + t.v, 0);
  const planTotal = () => state.plan.reduce((a, p) => a + Number(p.plan || 0), 0);

  // ---------- tabs ----------
  function showTab(name) {
    state.tab = name;
    $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    render();
    save();
  }
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ---------- envelopes ----------
  function envelopeSvg(fill, color, idx) {
    const W = 120, H = 84, top = 8;
    const shown = Math.min(1, Math.max(0, fill)), over = fill > 1.0001;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H + 22}`, role: 'img' });
    const clipId = 'clip' + idx;
    const cp = svgEl('clipPath', { id: clipId });
    cp.append(svgEl('rect', { x: 2, y: top, width: W - 4, height: H - top - 2, rx: 7 }));
    svg.append(cp);
    svg.append(svgEl('rect', { x: 2, y: top, width: W - 4, height: H - top - 2, rx: 7, fill: 'var(--paper)', stroke: '#8a7a5a', 'stroke-width': 2 }));
    const fh = (H - top - 2) * shown;
    svg.append(svgEl('rect', { 'clip-path': `url(#${clipId})`, x: 2, y: H - 2 - fh, width: W - 4, height: fh, fill: color, opacity: 0.85 }));
    svg.append(svgEl('path', { d: `M5 ${top + 3} L${W / 2} ${top + 38} L${W - 5} ${top + 3}`, fill: 'none', stroke: '#7a6a4a', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    svg.append(svgEl('path', { d: `M5 ${H - 5} L${W / 2 - 15} ${top + 32} M${W - 5} ${H - 5} L${W / 2 + 15} ${top + 32}`, fill: 'none', stroke: '#7a6a4a', opacity: 0.4, 'stroke-width': 1.2 }));
    if (over) {
      svg.append(svgEl('rect', { x: W - 40, y: 0, width: 38, height: 17, rx: 4, fill: 'var(--bad)' }));
      const t = svgEl('text', { x: W - 21, y: 12.5, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#fff' });
      t.textContent = 'OVER';
      svg.append(t);
    }
    const pct = svgEl('text', { x: W / 2, y: H + 18, 'text-anchor': 'middle', 'font-size': 16, fill: over ? 'var(--bad)' : 'var(--muted)' });
    pct.textContent = fill > 9.99 ? '999%+' : Math.round(fill * 100) + '% full';
    svg.append(pct);
    return svg;
  }

  function renderEnvelopes() {
    const ms = months();
    if (!state.month || !ms.includes(state.month)) state.month = ms[ms.length - 1] || null;
    const pick = $('#month-pick');
    pick.replaceChildren(...ms.slice().reverse().map((m) => new Option(monthName(m), m)));
    pick.value = state.month || '';


    const spent = spentBy(state.month);
    const box = $('#envs');
    box.replaceChildren();
    let totalSpent = 0, overCount = 0;
    state.plan.forEach((p, i) => {
      const plan = Number(p.plan || 0), s = Math.max(0, spent[p.line] || 0);
      totalSpent += s;
      const fill = plan > 0 ? s / plan : (s > 0 ? 10 : 0);
      if (fill > 1.0001) overCount++;
      const color = state.byFill ? (fill > 1.0001 ? 'var(--bad)' : fill >= 0.8 ? 'var(--warn)' : 'var(--ok)') : PALETTE[state.color];
      const svg = envelopeSvg(fill, color, i);
      svg.setAttribute('aria-label', `${p.line}: ${money(s)} of ${money(plan)}`);
      const card = el('div', { class: 'env clickable', role: 'button', tabindex: '0', title: 'Click to see what went in this envelope' }, svg,
        el('div', { class: 'env-name', text: p.line }),
        el('div', { class: 'env-amt', text: `${money(s)} of ${money(plan)}` }));
      if (fill > 1.0001) card.append(el('div', { class: 'env-over', text: `Over by ${money(s - plan)}` }));
      else card.append(el('div', { class: 'env-left', text: `${money(plan - s)} left` }));
      card.addEventListener('click', () => explode(p.line, svg));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); explode(p.line, svg); } });
      box.append(card);
    });

    const inc = incomeIn(state.month);
    $('#t-income').textContent = money(inc);
    $('#t-plan').textContent = money(planTotal());
    $('#t-spent').textContent = money(totalSpent);
    $('#t-spent').className = 'tile-value ' + (totalSpent > planTotal() ? 'bad' : '');
    $('#t-over').textContent = String(overCount);
    $('#t-over').className = 'tile-value ' + (overCount ? 'bad' : 'good');

    $('#welcome').hidden = state.tx.length > 0;
    const homeless = state.tx.filter((t) => t.d.startsWith(state.month) && t.env === HOME).length;
    const note = $('#needs-home-note');
    note.hidden = !homeless;
    note.textContent = homeless ? `${homeless} transaction${homeless > 1 ? 's' : ''} this month ${homeless > 1 ? 'need' : 'needs'} an envelope. Open Transactions and choose "Needs a home" to sort them.` : '';
  }

  $('#month-pick').addEventListener('change', (e) => { state.month = e.target.value; save(); render(); wallpaperChanged(); });
  $('#swatches').append(...PALETTE.map((c, i) => {
    const b = el('button', { type: 'button', class: 'swatch', 'data-i': i, 'aria-label': `Envelope colour ${i + 1}`, 'aria-pressed': 'false' });
    b.style.background = c;
    b.addEventListener('click', () => { state.color = i; state.byFill = false; save(); render(); wallpaperChanged(); });
    return b;
  }));
  $('#by-fill').addEventListener('click', () => { state.byFill = !state.byFill; save(); render(); wallpaperChanged(); });

  // ---------- settings ----------
  function renderSettings() {
    $$('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(!state.byFill && Number(b.dataset.i) === state.color)));
    $('#by-fill').setAttribute('aria-pressed', String(state.byFill));
    if (window.desktop) { $('#wp-auto').checked = state.wpAuto !== false; $('#wp-hide').checked = !!state.wpHide; }
    // Three sample envelopes so you can see the colour without leaving this tab
    $('#colour-preview').replaceChildren(...[[0.35, 'Some spent'], [0.85, 'Nearly full'], [1.3, 'Over']].map(([fill, label], i) => {
      const color = state.byFill ? (fill > 1.0001 ? 'var(--bad)' : fill >= 0.8 ? 'var(--warn)' : 'var(--ok)') : PALETTE[state.color];
      return el('div', { class: 'env' }, envelopeSvg(fill, color, 900 + i), el('div', { class: 'env-name', text: label }));
    }));
  }

  // ---------- budget ----------
  function renderBudget() {
    const inp = $('#income-input');
    if (document.activeElement !== inp) inp.value = Number(state.income).toFixed(2);
    const total = planTotal(), left = state.income - total;
    $('#b-total').textContent = money2(total);
    $('#b-left').textContent = money2(left);
    $('#b-left').className = 'tile-value ' + (Math.abs(left) < 0.5 ? 'good' : left < 0 ? 'bad' : 'warn');
    $('#b-left-note').textContent = Math.abs(left) < 0.5 ? 'Every dollar has a job.' : left < 0 ? 'You have planned more than comes in. Trim a line.' : 'Give these dollars a job.';

    const body = $('#budget-table tbody');
    if (body.contains(document.activeElement)) return; // don't redraw under the cursor
    body.replaceChildren(...state.plan.map((p, i) => {
      const amount = el('input', { class: 'money-input', type: 'number', min: '0', step: '1', 'aria-label': `Plan for ${p.line}` });
      amount.value = p.plan;
      amount.addEventListener('input', () => { p.plan = Number(amount.value || 0); save(); renderBudget(); });
      amount.addEventListener('change', () => { render(); wallpaperChanged(); });
      const alertIn = el('input', { class: 'small-input', type: 'number', min: '1', max: '100', step: '1', 'aria-label': `Alert level for ${p.line}` });
      alertIn.value = p.alert ?? 80;
      alertIn.addEventListener('input', () => { p.alert = Math.min(100, Math.max(1, Number(alertIn.value || 80))); save(); });
      const note = el('input', { type: 'text', 'aria-label': `Note for ${p.line}` });
      note.value = p.note || '';
      note.style.width = '100%';
      note.addEventListener('input', () => { p.note = note.value; save(); });
      const del = el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${p.line}`, title: 'Remove this line', text: '✕' });
      del.addEventListener('click', () => {
        if (!window.confirm(`Remove "${p.line}"? Its transactions will move to "Needs a home".`)) return;
        state.plan.splice(i, 1);
        state.tx.forEach((t) => { if (t.env === p.line) t.env = HOME; });
        save(); render();
      });
      return el('tr', {}, el('td', { text: p.line }), el('td', { text: p.group }), el('td', { class: 'num' }, amount), el('td', { class: 'num' }, alertIn, ' %'), el('td', { class: 'note' }, note), el('td', {}, del));
    }));
  }
  $('#income-input').addEventListener('input', (e) => { state.income = Number(e.target.value || 0); save(); renderBudget(); });
  $('#add-line').addEventListener('click', () => {
    const name = $('#new-line-name').value.trim();
    if (!name || lines().includes(name) || name === INCOME || name === IGNORE) return;
    state.plan.push({ line: name, group: $('#new-line-group').value, plan: 0, note: '', alert: defaultAlert($('#new-line-group').value) });
    $('#new-line-name').value = '';
    save(); render();
  });

  // ---------- trends ----------
  function renderTrends() {
    const ms = months();
    const totals = ms.map((m) => {
      const s = spentBy(m);
      return { m, total: Object.values(s).reduce((a, b) => a + b, 0) };
    });
    const box = $('#trend-chart');
    box.replaceChildren();
    const W = Math.max(320, box.clientWidth || 700), H = 300, ml = 70, mb = 30, mt = 24;
    const max = Math.max(state.income, ...totals.map((t) => t.total), 1) * 1.1;
    const y = (v) => H - mb - (v / max) * (H - mb - mt);
    const band = (W - ml - 10) / Math.max(1, ms.length);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Spending per month' });
    const step = Math.pow(10, Math.floor(Math.log10(max))) / 2;
    const tick = max / step > 8 ? step * 2 : step;
    for (let v = 0; v <= max; v += tick) {
      svg.append(svgEl('line', { x1: ml, x2: W - 10, y1: y(v), y2: y(v), stroke: 'var(--grid)' }));
      const t = svgEl('text', { x: ml - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--muted)' });
      t.textContent = money(v);
      svg.append(t);
    }
    totals.forEach((t, i) => {
      const bw = Math.min(70, band * 0.6), x = ml + band * i + (band - bw) / 2;
      const over = t.total > state.income;
      svg.append(svgEl('rect', { x, y: y(t.total), width: bw, height: Math.max(0, y(0) - y(t.total)), rx: 4, fill: over ? 'var(--bad)' : PALETTE[state.color], opacity: 0.85 }));
      const lab = svgEl('text', { x: x + bw / 2, y: H - 10, 'text-anchor': 'middle', 'font-size': 13, fill: 'var(--muted)' });
      lab.textContent = shortMonth(t.m) + ' ' + t.m.slice(2, 4);
      const val = svgEl('text', { x: x + bw / 2, y: y(t.total) - 6, 'text-anchor': 'middle', 'font-size': 13, fill: 'var(--fg)' });
      val.textContent = money(t.total);
      svg.append(lab, val);
    });
    svg.append(svgEl('line', { x1: ml, x2: W - 10, y1: y(state.income), y2: y(state.income), stroke: 'var(--fg)', 'stroke-width': 2, 'stroke-dasharray': '6 4' }));
    const il = svgEl('text', { x: W - 12, y: y(state.income) - 6, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--fg)' });
    il.textContent = 'Income ' + money(state.income);
    svg.append(il);
    box.append(svg);

    const per = ms.map((m) => spentBy(m));
    $('#trend-table thead').replaceChildren(el('tr', {}, el('th', { text: 'Envelope' }), el('th', { class: 'num', text: 'Plan' }),
      ...ms.map((m) => el('th', { class: 'num', text: shortMonth(m) + ' ' + m.slice(2, 4) })), el('th', { class: 'num', text: 'Change' })));
    $('#trend-table tbody').replaceChildren(...state.plan.map((p) => {
      const vals = per.map((s) => s[p.line] || 0);
      const a = vals[vals.length - 2], b = vals[vals.length - 1];
      let ch = '', cls = 'num';
      if (vals.length > 1 && a > 0) { const c = (b - a) / a; ch = (c > 0 ? '+' : '') + Math.round(c * 100) + '%'; cls += c > 0.005 ? ' bad' : c < -0.005 ? ' good' : ''; }
      return el('tr', {}, el('td', { text: p.line }), el('td', { class: 'num', text: money(p.plan) }),
        ...vals.map((v) => el('td', { class: 'num' + (v > p.plan ? ' bad' : ''), text: money(v) })), el('td', { class: cls, text: ch }));
    }));
  }

  // ---------- transactions ----------
  function envOptions(current) {
    const sel = el('select', { 'aria-label': 'Envelope' });
    sel.append(new Option('Needs a home', HOME));
    lines().forEach((l) => sel.append(new Option(l, l)));
    sel.append(new Option(INCOME, INCOME), new Option(IGNORE, IGNORE));
    sel.value = current ?? HOME;
    return sel;
  }
  function renderTx() {
    const mode = $('#tx-filter').value;
    const q = $('#tx-search').value.trim().toUpperCase();
    let rows = state.tx.slice();
    if (mode === 'home') rows = rows.filter((t) => t.env === HOME);
    if (mode === 'month') rows = rows.filter((t) => t.d.startsWith(state.month));
    if (q) rows = rows.filter((t) => t.s.toUpperCase().includes(q) || (t.env || '').toUpperCase().includes(q));
    rows.sort((a, b) => b.d.localeCompare(a.d) || b.id - a.id);
    const shown = rows.slice(0, 600);
    $('#tx-table tbody').replaceChildren(...shown.map((t) => {
      const sel = envOptions(t.env);
      sel.addEventListener('change', () => {
        t.env = sel.value;
        const key = merchantKey(t.s);
        state.learned[key] = sel.value;
        // Move other unsorted or auto-sorted transactions from the same merchant too
        state.tx.forEach((o) => { if (o !== t && !o.manual && merchantKey(o.s) === key) o.env = sel.value; });
        t.manual = true;
        save(); render();
      });
      const desc = el('td', { text: t.s });
      if (t.byHand) {
        const del = el('button', { type: 'button', class: 'icon-btn', title: 'Delete this one', 'aria-label': `Delete ${t.s}`, text: '✕' });
        del.addEventListener('click', () => {
          if (!window.confirm(`Delete "${t.s}" ${money2(t.v)} from ${t.d}?`)) return;
          state.tx = state.tx.filter((o) => o !== t); save(); render();
        });
        desc.append(' ', el('span', { class: 'hand-tag', text: 'added by hand' }), del);
      }
      return el('tr', {}, el('td', { text: t.d }), el('td', { text: t.a }), desc,
        el('td', { class: 'num ' + (t.v > 0 ? 'good' : ''), text: money2(t.v) }), el('td', {}, sel));
    }));
    $('#tx-count').textContent = rows.length
      ? `Showing ${shown.length} of ${rows.length}. Changing an envelope also moves other transactions from the same place, and new ones from there will go to the same envelope.`
      : mode === 'home' ? 'Nothing needs a home. Everything is sorted.' : 'No transactions match.';
  }
  $('#tx-filter').addEventListener('change', renderTx);
  $('#tx-search').addEventListener('input', renderTx);

  // ---------- import ----------
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some((x) => x.trim() !== '')) rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur);
    if (row.some((x) => x.trim() !== '')) rows.push(row);
    return rows;
  }
  const pad = (n) => String(n).padStart(2, '0');
  function mdy(s) { const [m, d, y] = s.trim().split('/'); return `${y}-${pad(m)}-${pad(d)}`; }

  function toTransactions(rows) {
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (name) => head.indexOf(name);
    if (idx('account type') >= 0 && idx('cad$') >= 0) {
      // RBC online banking download
      return rows.slice(1).filter((r) => r[idx('cad$')] !== undefined && r[idx('cad$')].trim() !== '').map((r) => {
        const type = r[idx('account type')].trim();
        const a = /chequing/i.test(type) ? 'RBC Chequing' : /master/i.test(type) ? 'RBC Mastercard' : /visa/i.test(type) ? 'RBC Visa' : /saving/i.test(type) ? 'RBC Savings' : 'RBC ' + type;
        return { d: mdy(r[idx('transaction date')]), a, s: (r[idx('description 1')] + ' ' + (r[idx('description 2')] || '')).trim(), v: Math.round(parseFloat(r[idx('cad$')]) * 100) / 100 };
      });
    }
    if (idx('debit') >= 0 && idx('credit') >= 0 && idx('description') >= 0 && idx('transaction date') >= 0) {
      // Capital One download
      return rows.slice(1).map((r) => {
        const debit = parseFloat(r[idx('debit')] || ''), credit = parseFloat(r[idx('credit')] || '');
        const v = !isNaN(debit) && debit ? -debit : (isNaN(credit) ? 0 : credit);
        return { d: r[idx('transaction date')].trim().slice(0, 10), a: 'Capital One Mastercard', s: r[idx('description')].trim(), v: Math.round(v * 100) / 100 };
      }).filter((t) => t.v !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.d));
    }
    return null;
  }

  async function importFiles(files) {
    const box = $('#import-result');
    box.hidden = false;
    box.replaceChildren(el('h3', { text: 'Results' }));
    // Count what we already have, so the same file twice adds nothing
    const have = {};
    state.tx.forEach((t) => { const k = txKey(t); have[k] = (have[k] || 0) + 1; });
    let addedTotal = 0, homeless = 0;
    const newOnes = [];
    for (const f of files) {
      let txs = null;
      try { txs = toTransactions(parseCsv(await f.text())); } catch (e) { txs = null; }
      if (!txs) { box.append(el('p', { class: 'bad', text: `${f.name}: I don't recognise this layout. It works with RBC and Capital One CSV downloads.` })); continue; }
      const seen = {}; let added = 0;
      for (const t of txs) {
        const k = txKey(t);
        seen[k] = (seen[k] || 0) + 1;
        if (seen[k] <= (have[k] || 0)) continue;
        const nt = { id: state.nextId++, ...t, env: null };
        nt.env = sortTx(nt);
        if (nt.env === HOME) homeless++;
        state.tx.push(nt);
        added++;
      }
      Object.entries(seen).forEach(([k, n]) => { have[k] = Math.max(have[k] || 0, n); });
      addedTotal += added;
      box.append(el('p', { text: `${f.name}: ${added} new, ${txs.length - added} already here.` }));
      if (added) newOnes.push(...state.tx.slice(-added));
    }
    showPossibleDoubles(box, newOnes);
    if (homeless) {
      const go = el('button', { type: 'button', class: 'btn primary', text: `Sort ${homeless} that need a home` });
      go.addEventListener('click', () => { $('#tx-filter').value = 'home'; showTab('transactions'); });
      box.append(go);
    } else if (addedTotal) box.append(el('p', { class: 'good', text: 'Everything new was sorted into an envelope.' }));
    const ms = months();
    state.month = ms[ms.length - 1];
    checkAlerts();
    save(); render();
    wallpaperChanged();
  }
  const drop = $('#drop');
  $('#file-input').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); importFiles([...e.dataTransfer.files]); });

  // ---------- backup ----------
  $('#backup-save').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `money-envelopes-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    $('#backup-msg').textContent = 'Backup saved to your Downloads folder. Keep a copy somewhere safe, like your computer.';
  });
  $('#backup-load').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.tx) || !Array.isArray(data.plan)) throw new Error('not a backup');
      state = data;
      state.learned = state.learned || {};
      const taught = learnFromSorted();
      save(); render();
      $('#backup-msg').textContent = `Restored ${data.tx.length} transactions from ${f.name}.` + (taught ? ` Learned where ${taught} stores go, so new statements sort themselves.` : '');
    } catch (err) {
      $('#backup-msg').textContent = `${f.name} isn't a Money Envelopes backup file.`;
    }
  });


  // The public phone copy has no built-in store rules, so it learns them from transactions
  // already sorted in a backup: each store goes to the envelope it was used for most.
  function learnFromSorted() {
    const votes = {};
    for (const t of state.tx) {
      if (!t.env) continue;
      const k = merchantKey(t.s), v = votes[k] = votes[k] || {};
      v[t.env] = (v[t.env] || 0) + 1;
    }
    let n = 0;
    for (const [k, v] of Object.entries(votes)) {
      if (state.learned[k] !== undefined) continue;
      const best = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0];
      state.learned[k] = best; n++;
    }
    return n;
  }

  // ---------- adding by hand: payees, payors and new envelopes ----------
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const payees = () => (state.payees = state.payees || []);
  const accounts = () => [...new Set(['Cash', ...state.tx.map((t) => t.a)])];
  function payeeFor(text) {
    const up = String(text).toUpperCase();
    return payees().find((p) => p.name.toUpperCase() === up.trim())
      || payees().find((p) => p.match && up.includes(p.match.toUpperCase()));
  }
  function addEnvelope(name, group, plan) {
    name = name.trim();
    if (!name || name === INCOME || name === IGNORE) return null;
    if (!lines().includes(name)) state.plan.push({ line: name, group, plan: Number(plan || 0), note: '', alert: defaultAlert(group) });
    return name;
  }

  // A pop-up card that slides up from the bottom of the screen
  function sheet(title, build) {
    const overlay = el('div', { class: 'sheet-overlay' });
    const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-label': title });
    const close = el('button', { type: 'button', class: 'boom-close', 'aria-label': 'Close', text: '✕' });
    const done = () => { overlay.remove(); };
    close.addEventListener('click', done);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(); });
    panel.append(el('div', { class: 'boom-head' }, el('h2', { text: title }), close));
    build(panel, done);
    overlay.append(panel);
    document.body.append(overlay);
    const first = panel.querySelector('input, select');
    if (first) setTimeout(() => first.focus(), 50);
  }
  const field = (label, input) => el('label', { class: 'field' }, label, input);
  // Envelope picker with "+ New envelope..." at the bottom, which opens two small boxes to name it
  function envPicker(current, allowIncome) {
    const wrap = el('div', { class: 'env-picker' });
    const sel = envOptions(current);
    if (!allowIncome) [...sel.options].forEach((o) => { if (o.value === INCOME) o.remove(); });
    sel.append(new Option('+ New envelope...', '__new'));
    const name = el('input', { type: 'text', placeholder: 'New envelope name, e.g. Music supplies', 'aria-label': 'New envelope name' });
    const group = el('select', { 'aria-label': 'New envelope type' });
    ['Needs', 'Wants', 'Bills', 'Debt', 'Saving', 'Your call'].forEach((g) => group.append(new Option(g, g)));
    const extra = el('div', { class: 'env-new', hidden: '' }, name, group);
    sel.addEventListener('change', () => { extra.hidden = sel.value !== '__new'; if (!extra.hidden) name.focus(); });
    wrap.append(sel, extra);
    wrap.value = () => (sel.value === '__new' ? addEnvelope(name.value, group.value, 0) : sel.value);
    wrap.set = (v) => { sel.value = v; extra.hidden = true; };
    return wrap;
  }

  function addTransactionSheet() {
    sheet('Add a transaction', (panel, done) => {
      let dir = 'out';
      const outBtn = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', text: 'Money out' });
      const inBtn = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', text: 'Money in' });
      const who = el('input', { type: 'text', list: 'payee-names', autocomplete: 'off', placeholder: 'e.g. Metcap' });
      const names = el('datalist', { id: 'payee-names' });
      const amount = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', placeholder: '0.00' });
      const date = el('input', { type: 'date' }); date.value = today();
      const acct = el('select', {}); accounts().forEach((a) => acct.append(new Option(a, a)));
      const env = envPicker(HOME, true);
      const remember = el('input', { type: 'checkbox' }); remember.checked = true;
      const whoLabel = el('span', { text: 'Paid to (payee)' });
      const msg = el('p', { class: 'small bad' });
      const fillNames = () => names.replaceChildren(...payees().filter((p) => p.kind === dir).map((p) => new Option(p.name)));
      const setDir = (d) => {
        dir = d; outBtn.setAttribute('aria-pressed', String(d === 'out')); inBtn.setAttribute('aria-pressed', String(d === 'in'));
        whoLabel.textContent = d === 'out' ? 'Paid to (payee)' : 'Paid by (payor)';
        if (d === 'in') env.set(INCOME); else if (env.value() === INCOME) env.set(HOME);
        fillNames();
      };
      // Pick a saved name and its usual envelope fills itself in
      who.addEventListener('change', () => { const p = payeeFor(who.value); if (p && p.env) env.set(p.env); });
      outBtn.addEventListener('click', () => setDir('out'));
      inBtn.addEventListener('click', () => setDir('in'));
      const save1 = el('button', { type: 'button', class: 'btn primary', text: 'Save' });
      save1.addEventListener('click', () => {
        const name = who.value.trim(), v = Math.round(Number(amount.value) * 100) / 100;
        if (!name) { msg.textContent = 'Who was it? Type a name.'; return; }
        if (!(v > 0)) { msg.textContent = 'Type an amount above zero.'; return; }
        const e = env.value();
        if (e === null) { msg.textContent = 'Give the new envelope a name.'; return; }
        state.tx.push({ id: state.nextId++, d: date.value || today(), a: acct.value, s: name, v: dir === 'out' ? -v : v, env: e || HOME, manual: true, byHand: true });
        if (remember.checked && !payees().some((p) => p.name.toUpperCase() === name.toUpperCase())) payees().push({ name, kind: dir, env: e || '', match: '' });
        state.month = (date.value || today()).slice(0, 7);
        checkAlerts(); save(); render(); done();
      });
      fillNames();
      panel.append(
        el('div', { class: 'btn-row' }, outBtn, inBtn), names,
        el('label', { class: 'field' }, whoLabel, who),
        el('div', { class: 'two' }, field('Amount $', amount), field('Date', date)),
        field('Account', acct), field('Envelope', env),
        el('label', { class: 'check' }, remember, ' Remember this name for next time'),
        msg, save1);
    });
  }
  $('#fab').addEventListener('click', addTransactionSheet);

  $('#new-env-btn').addEventListener('click', () => sheet('New envelope', (panel, done) => {
    const name = el('input', { type: 'text', placeholder: 'e.g. Music supplies' });
    const group = el('select', {}); ['Needs', 'Wants', 'Bills', 'Debt', 'Saving', 'Your call'].forEach((g) => group.append(new Option(g, g)));
    const plan = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '1', placeholder: '0' });
    const msg = el('p', { class: 'small bad' });
    const go = el('button', { type: 'button', class: 'btn primary', text: 'Add envelope' });
    go.addEventListener('click', () => {
      if (lines().includes(name.value.trim())) { msg.textContent = 'You already have an envelope with that name.'; return; }
      if (!addEnvelope(name.value, group.value, plan.value)) { msg.textContent = 'Give it a name.'; return; }
      save(); render(); done();
    });
    panel.append(field('Name', name), field('Type', group), field('Plan per month $', plan),
      el('p', { class: 'muted small', text: 'You can change the amount any time on the Budget tab.' }), msg, go);
  }));

  // Settings: the list of payees and payors
  let payeeEnv = null;
  function renderPayees() {
    if (!payeeEnv) { payeeEnv = envPicker(HOME, true); $('#payee-env-slot').replaceChildren(payeeEnv); }
    const list = $('#payee-list');
    if (!payees().length) { list.replaceChildren(el('p', { class: 'muted small', text: 'None yet. Add one below, or tick "Remember this name" when you add a transaction.' })); return; }
    list.replaceChildren(...payees().slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
      const pick = envOptions(p.env || HOME);
      pick.addEventListener('change', () => { p.env = pick.value; save(); });
      const match = el('input', { type: 'text', placeholder: 'Shows on statement as', 'aria-label': `Statement name for ${p.name}` });
      match.value = p.match || '';
      match.addEventListener('change', () => { p.match = match.value.trim(); save(); });
      const del = el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${p.name}`, text: '✕' });
      del.addEventListener('click', () => { if (window.confirm(`Remove ${p.name} from the list? Transactions stay where they are.`)) { state.payees = payees().filter((o) => o !== p); save(); renderPayees(); } });
      return el('div', { class: 'payee' },
        el('div', { class: 'payee-top' }, el('b', { text: p.name }), el('span', { class: 'muted small', text: p.kind === 'in' ? 'pays me' : 'I pay' }), del),
        pick, match);
    }));
  }
  $('#payee-kind').addEventListener('change', (e) => payeeEnv && payeeEnv.set(e.target.value === 'in' ? INCOME : HOME));
  $('#payee-add').addEventListener('click', () => {
    const name = $('#payee-name').value.trim();
    if (!name || payees().some((p) => p.name.toUpperCase() === name.toUpperCase())) return;
    const e = payeeEnv.value();
    if (e === null) return;
    payees().push({ name, kind: $('#payee-kind').value, env: e || '', match: $('#payee-match').value.trim() });
    $('#payee-name').value = ''; $('#payee-match').value = ''; payeeEnv = null;
    save(); renderPayees();
  });

  // After a statement comes in, point out bank lines that look like ones typed by hand
  function showPossibleDoubles(box, fresh) {
    const days = (a, b) => Math.abs(new Date(a) - new Date(b)) / 864e5;
    const pairs = [];
    const used = new Set();
    for (const b of fresh) {
      const h = state.tx.find((t) => t.byHand && !t.checked && !used.has(t) && Math.abs(t.v - b.v) < 0.005 && days(t.d, b.d) <= 7);
      if (h) { used.add(h); pairs.push([h, b]); }
    }
    if (!pairs.length) return;
    box.append(el('h3', { text: 'Possible doubles' }),
      el('p', { class: 'muted small', text: 'These bank lines match ones you added by hand. If they are the same thing, remove the hand one so it isn\'t counted twice.' }));
    pairs.forEach(([h, b]) => {
      const rm = el('button', { type: 'button', class: 'btn', text: 'Same thing: remove mine' });
      const keep = el('button', { type: 'button', class: 'btn', text: 'Different: keep both' });
      const row = el('div', { class: 'card' }, el('p', { text: `You added: ${h.s} ${money2(h.v)} on ${h.d}` }), el('p', { class: 'muted', text: `Bank says: ${b.s} ${money2(b.v)} on ${b.d}` }), el('div', { class: 'btn-row' }, rm, keep));
      rm.addEventListener('click', () => {
        // Trust the envelope you picked by hand, and remember it for this store
        if (h.env && h.env !== HOME) { b.env = h.env; b.manual = true; state.learned[merchantKey(b.s)] = h.env; }
        state.tx = state.tx.filter((t) => t !== h); save(); render(); row.replaceChildren(el('p', { class: 'good', text: 'Removed. Counted once now.' }));
      });
      keep.addEventListener('click', () => { h.checked = true; save(); row.replaceChildren(el('p', { class: 'good', text: 'Kept both.' })); });
      box.append(row);
    });
  }

  // ---------- alerts ----------
  // Level 1 = passed the envelope's alert %, level 2 = went over. Each level pops up once per envelope per month.
  function levelsFor(month) {
    const spent = spentBy(month), out = {};
    state.plan.forEach((p) => {
      const plan = Number(p.plan || 0), s = Math.max(0, spent[p.line] || 0);
      const fill = plan > 0 ? s / plan : (s > 0 ? 10 : 0);
      const level = p.group === 'Saving' ? 0 : fill > 1.0001 ? 2 : fill >= (p.alert ?? 80) / 100 - 0.0001 && (p.alert ?? 80) < 100 ? 1 : 0;
      out[p.line] = { fill, s, plan, level };
    });
    return out;
  }
  // Bills and debt payments are meant to be paid in full, so they only warn when they go over.
  function defaultAlert(group) { return /Bills|Debt|Saving/.test(group) ? 100 : 80; }
  function markAllAlerted() {
    months().forEach((m) => {
      const lv = levelsFor(m);
      state.alerted[m] = Object.fromEntries(Object.entries(lv).map(([k, v]) => [k, v.level]));
    });
  }
  function notify(title, body) {
    try {
      if (!('Notification' in window)) return;
      // Android only shows pop-ups that come through the app's service worker
      const go = () => (navigator.serviceWorker && navigator.serviceWorker.controller
        ? navigator.serviceWorker.ready.then((r) => r.showNotification(title, { body, icon: 'icons/icon192.png', badge: 'icons/icon192.png' }))
        : new Notification(title, { body, icon: 'icons/icon192.png' }));
      if (Notification.permission === 'granted') go();
      else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => { if (p === 'granted') go(); });
    } catch (e) { /* pop-ups not available */ }
  }
  function checkAlerts() {
    state.alerted = state.alerted || {};
    const fresh = [];
    months().forEach((m) => {
      const lv = levelsFor(m), seen = state.alerted[m] = state.alerted[m] || {};
      Object.entries(lv).forEach(([line, v]) => {
        if (v.level > (seen[line] || 0)) {
          fresh.push({ m, line, ...v });
          seen[line] = v.level;
        }
      });
    });
    fresh.forEach((a) => {
      if (a.level === 2) notify(`${a.line} is over`, `${money(a.s)} of ${money(a.plan)} in ${monthName(a.m)}. Over by ${money(a.s - a.plan)}.`);
      else notify(`${a.line} is ${Math.round(a.fill * 100)}% full`, `${money(a.plan - a.s)} left for ${monthName(a.m)}.`);
    });
    const banner = $('#alert-banner');
    if (fresh.length) {
      banner.hidden = false;
      banner.textContent = 'New alerts: ' + fresh.map((a) => `${a.line} ${a.level === 2 ? 'went over' : 'is ' + Math.round(a.fill * 100) + '% full'}`).join(' · ');
    }
  }



  // ---------- exploding envelope ----------
  // Clicking an envelope bursts it open into the list of transactions inside it for that month.
  function explode(line, fromSvg) {
    const p = state.plan.find((x) => x.line === line);
    const rows = state.tx.filter((t) => t.d.startsWith(state.month) && t.env === line).sort((a, b) => a.d.localeCompare(b.d) || a.id - b.id);
    const total = rows.reduce((a, t) => a - t.v, 0);
    const r = fromSvg.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

    const overlay = el('div', { class: 'boom-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${line} transactions` });
    // Paper scraps flying out from the envelope
    const burst = el('div', { class: 'boom-burst' });
    burst.style.left = cx + 'px'; burst.style.top = cy + 'px';
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3, dist = 120 + Math.random() * 160;
      const s = el('span', { class: 'scrap' });
      s.style.setProperty('--dx', Math.cos(a) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(a) * dist + 'px');
      s.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      s.style.background = i % 3 ? 'var(--paper)' : (state.byFill ? 'var(--gold)' : PALETTE[state.color]);
      burst.append(s);
    }
    const ghost = fromSvg.cloneNode(true);
    ghost.classList.add('boom-ghost');
    ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px'; ghost.style.width = r.width + 'px';

    const panel = el('div', { class: 'boom-panel' });
    panel.style.setProperty('--ox', (cx - window.innerWidth / 2) + 'px');
    panel.style.setProperty('--oy', (cy - window.innerHeight / 2) + 'px');
    const close = el('button', { type: 'button', class: 'boom-close', 'aria-label': 'Close', text: '✕' });
    const plan = Number(p ? p.plan : 0);
    panel.append(
      el('div', { class: 'boom-head' },
        el('div', {}, el('h2', { text: line }), el('p', { class: 'muted', text: `${monthName(state.month)} · ${rows.length} transaction${rows.length === 1 ? '' : 's'} · ${money2(total)} of ${money(plan)}` })),
        close));
    if (!rows.length) panel.append(el('p', { class: 'muted boom-empty', text: 'Nothing in this envelope yet this month.' }));
    else {
      const list = el('div', { class: 'boom-list' });
      rows.forEach((t, i) => {
        const sel = envOptions(t.env);
        sel.addEventListener('change', () => {
          t.env = sel.value; t.manual = true; state.learned[merchantKey(t.s)] = sel.value;
          save(); render(); wallpaperChanged();
          item.classList.add('moved');
        });
        const item = el('div', { class: 'boom-item' },
          el('span', { class: 'boom-date', text: new Date(t.d + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) }),
          el('span', { class: 'boom-desc', text: t.s }),
          el('span', { class: 'boom-acct muted', text: t.a }),
          el('span', { class: 'boom-amt ' + (t.v > 0 ? 'good' : ''), text: money2(-t.v) }),
          sel);
        item.style.animationDelay = (380 + i * 35) + 'ms';
        list.append(item);
      });
      panel.append(list);
      panel.append(el('p', { class: 'muted small', text: 'Something in the wrong envelope? Pick a different one and it moves. Future ones from that store will follow.' }));
    }
    overlay.append(burst, ghost, panel);
    document.body.append(overlay);
    const done = () => { overlay.classList.add('closing'); setTimeout(() => overlay.remove(), 220); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') done(); };
    close.addEventListener('click', done);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(); });
    document.addEventListener('keydown', onKey);
    setTimeout(() => close.focus(), 400);
  }

  // ---------- desktop wallpaper (desktop app only) ----------
  async function saveNow() {
    clearTimeout(saveTimer);
    try { if (hasChrome) await chrome.storage.local.set({ [KEY]: state }); else localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  async function updateWallpaper() {
    if (!window.desktop) return;
    const msg = $('#wp-msg');
    msg.className = 'small muted'; msg.textContent = 'Painting your wallpaper...';
    await saveNow();
    const r = await window.desktop.setWallpaper({ hideAmounts: !!state.wpHide });
    if (r && r.ok) { state.wpOn = true; save(); msg.className = 'small good'; msg.textContent = `Wallpaper updated ${new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}.`; }
    else { msg.className = 'small bad'; msg.textContent = (r && r.message) || 'Something went wrong setting the wallpaper.'; }
  }
  let wpTimer;
  function wallpaperChanged() {
    if (!window.desktop || !state.wpAuto || !state.wpOn) return;
    clearTimeout(wpTimer);
    wpTimer = setTimeout(updateWallpaper, 1500);
  }
  if (window.desktop) {
    $('#wallpaper-card').hidden = false;
    $('#wp-set').addEventListener('click', updateWallpaper);
    $('#wp-restore').addEventListener('click', async () => {
      const r = await window.desktop.restoreWallpaper();
      state.wpOn = false; save();
      $('#wp-msg').className = 'small ' + (r && r.ok ? 'good' : 'bad');
      $('#wp-msg').textContent = r && r.ok ? 'Your old wallpaper is back.' : (r && r.message) || 'Could not put the old wallpaper back.';
    });
    $('#wp-auto').addEventListener('change', (e) => { state.wpAuto = e.target.checked; save(); });
    $('#wp-hide').addEventListener('change', (e) => { state.wpHide = e.target.checked; save(); if (state.wpOn) updateWallpaper(); });
  }

  // ---------- go ----------
  function render() {
    if (state.tab === 'envelopes') renderEnvelopes();
    if (state.tab === 'budget') renderBudget();
    if (state.tab === 'trends') renderTrends();
    if (state.tab === 'settings') { renderSettings(); renderPayees(); }
    if (state.tab === 'transactions') { if (!state.month) state.month = months().slice(-1)[0]; renderTx(); }
  }
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state.tab === 'trends') renderTrends(); }, 150); });

  (async () => {
    state = await load();
    if (!state) { fromSeed(); save(); }
    state.learned = state.learned || {};
    if (state.wpAuto === undefined) state.wpAuto = true;
    if (!state.alerted) { state.alerted = {}; markAllAlerted(); }
    state.plan.forEach((p) => { if (p.alert == null) p.alert = defaultAlert(p.group); });
    showTab(state.tab || 'envelopes');
    // Ask Android to keep this app's data even when the phone runs low on space
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* not available */ }
  })();

  // ---------- works offline ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
