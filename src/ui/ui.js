/* global roost */
const $ = (s) => document.querySelector(s);
const lists = { mail: $('#list-mail'), chat: $('#list-chat'), top: $('#list-top') };
const dlg = $('#dlg');
const sdlg = $('#settings');
let state = { services: [], activeId: null };
let presets = [];
let mode = 'add'; // or 'edit'
let editingId = null;
let selectedType = 'gmail';
let dragId = null;

if (roost.platform !== 'darwin') document.body.classList.add('not-mac');

function initials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

// A steady color per name, so letter tiles look different from each other.
const LETTER_COLORS = ['#e8505b', '#f08a24', '#e0b11b', '#3fb26b', '#17a2a6', '#3a86ff', '#7c6cff', '#c05bd6', '#e05f9b', '#8d6e63'];
function letterColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return LETTER_COLORS[h % LETTER_COLORS.length];
}

function iconEl(svc, size) {
  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.style.background = svc.color || '#6B7280';
  if (svc.iconMode === 'letter') {
    icon.classList.add('letter');
    icon.style.background = letterColor(svc.name);
    icon.textContent = (Array.from(String(svc.name || '').trim())[0] || '?').toUpperCase();
  } else if (svc.iconMode === 'custom' && svc.icon) {
    icon.classList.add('custom');
    const img = document.createElement('img');
    img.src = svc.icon;
    img.alt = '';
    icon.appendChild(img);
  } else if (svc.icon && /^https:|^data:/.test(svc.icon)) {
    const img = document.createElement('img');
    img.src = svc.icon;
    img.alt = '';
    img.onerror = () => { img.remove(); icon.textContent = initials(svc.name); };
    icon.appendChild(img);
  } else {
    icon.textContent = size === 'small' ? initials(svc.name).slice(0, 1) : initials(svc.name);
  }
  return icon;
}

const presetIcon = (type) => (presets.find((p) => p.type === type) || {}).icon || null;
const shortName = (svc) => String(svc.name).replace(/^Google\s+/i, '');

// Red = needs a person. Gray number = unread, but calm (e.g. Promotions). Gray dot = something new, no count.
function badgeEl(svc) {
  const k = roostUi.badgeFor(svc);
  if (!k) return null;
  const b = document.createElement('span');
  b.className = 'badge' + (k.kind === 'red' ? '' : k.kind === 'calm' ? ' calm' : ' dot');
  b.textContent = k.text;
  return b;
}

function tileEl(svc) {
  const li = document.createElement('li');
  li.className = 'tile';
  li.classList.toggle('active', svc.id === state.activeId);
  li.classList.toggle('muted', svc.muted);
  li.classList.toggle('loading', svc.loading && !svc.icon);
  li.dataset.id = svc.id;
  li.dataset.group = svc.group;
  li.title = svc.name + (svc.muted ? ' (notifications off)' : '');
  li.draggable = true;
  const icon = iconEl({ ...svc, icon: svc.icon || presetIcon(svc.type) });
  const b = badgeEl(svc);
  if (b) icon.appendChild(b);
  if (svc.muted) {
    const m = document.createElement('span');
    m.className = 'muted-mark';
    m.textContent = '🔕';
    icon.appendChild(m);
  }
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = svc.group === 'top' ? shortName(svc) : svc.name;
  li.append(icon, label);
  return li;
}

function render() {
  for (const ul of Object.values(lists)) ul.textContent = '';
  for (const svc of state.services) (lists[svc.group] || lists.chat).appendChild(tileEl(svc));
  const has = (g) => state.services.some((s) => s.group === g);
  $('#divider').hidden = !(has('mail') && has('chat'));
  $('#welcome').hidden = state.services.length > 0;
  if (!$('#welcome').hidden) renderWelcome();
  document.body.classList.toggle('has-app', state.services.length > 0 && !!state.activeId);
  document.body.classList.toggle('top-empty', !has('top'));
  const dnd = $('#dnd');
  const quiet = state.quiet;
  dnd.classList.toggle('on', !!quiet);
  dnd.classList.toggle('auto', !!quiet && quiet !== 'dnd');
  dnd.setAttribute('aria-pressed', String(!!state.dnd));
  const qt = roostUi.quietText(state.dnd ? 'dnd' : quiet, state.settings && state.settings.quietHours);
  dnd.title = qt.title;
  document.body.classList.toggle('dnd-on', !!quiet);
  const topAcc = $('#top-account');
  topAcc.hidden = !state.topEmail;
  topAcc.textContent = state.topEmail || '';
  topAcc.title = state.topEmail ? `The top bar apps open as ${state.topEmail} (the Gmail tab you used last)` : '';
  const pill = $('#quiet-pill');
  pill.hidden = !quiet;
  pill.textContent = quiet ? roostUi.quietText(quiet, state.settings && state.settings.quietHours).pill : '';
  pill.title = 'Notification settings';
  renderKeybar();
  if (sdlg.open) renderSettings();
}

// ----- tile events (sidebar and top bar) -----
for (const ul of Object.values(lists)) {
  ul.addEventListener('click', (e) => {
    const li = e.target.closest('.tile');
    if (li) roost.select(li.dataset.id);
  });
  ul.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('.tile');
    if (!li) return;
    e.preventDefault();
    roost.context(li.dataset.id);
  });
}

// ----- drag to reorder (also between Email, Messages and the top bar) -----
const clearDrop = () => document.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-into'));
document.addEventListener('dragstart', (e) => {
  const li = e.target.closest && e.target.closest('.tile');
  if (!li) return;
  dragId = li.dataset.id;
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
});
document.addEventListener('dragend', () => {
  dragId = null;
  clearDrop();
  document.querySelectorAll('.dragging').forEach((n) => n.classList.remove('dragging'));
});
function dropTarget(e) {
  const li = e.target.closest && e.target.closest('.tile');
  if (li) return { li, group: li.dataset.group };
  const ul = e.target.closest && (e.target.closest('[data-group]') || (e.target.closest('#topbar') && lists.top));
  return ul ? { ul, group: ul.dataset.group } : null;
}
document.addEventListener('dragover', (e) => {
  if (!dragId) return;
  const t = dropTarget(e);
  if (!t) return;
  e.preventDefault();
  clearDrop();
  if (t.li) {
    const r = t.li.getBoundingClientRect();
    const horizontal = t.group === 'top';
    const before = horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
    t.li.classList.add(before ? 'drop-before' : 'drop-after');
  } else {
    t.ul.classList.add('drop-into');
  }
});
document.addEventListener('drop', (e) => {
  if (!dragId) return;
  const t = dropTarget(e);
  if (!t) return;
  e.preventDefault();
  const before = t.li && t.li.classList.contains('drop-before');
  clearDrop();
  const ids = state.services.map((s) => s.id).filter((id) => id !== dragId);
  let idx;
  if (t.li) {
    idx = ids.indexOf(t.li.dataset.id);
    if (idx === -1) return;
    if (!before) idx += 1;
  } else {
    // dropped on an empty part of a group: put it after that group's last app
    const inGroup = state.services.filter((s) => s.group === t.group && s.id !== dragId);
    idx = inGroup.length ? ids.indexOf(inGroup[inGroup.length - 1].id) + 1 : ids.length;
  }
  ids.splice(idx, 0, dragId);
  roost.reorder(ids, { id: dragId, group: t.group });
});

// ----- add / edit dialog -----
function renderPresets() {
  const box = $('#presets');
  box.textContent = '';
  for (const p of presets) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset' + (p.type === selectedType ? ' selected' : '');
    b.dataset.type = p.type;
    b.append(iconEl({ name: p.type === 'custom' ? '+' : p.name, color: p.color, icon: p.icon || null }, 'small'));
    const t = document.createElement('span');
    t.textContent = shortName(p);
    b.appendChild(t);
    box.appendChild(b);
  }
}

function pickPreset(type, { focus = true } = {}) {
  const prev = presets.find((p) => p.type === selectedType);
  const next = presets.find((p) => p.type === type);
  if (!next) return;
  selectedType = next.type;
  const nameEl = $('#f-name');
  if (!nameEl.value || nameEl.value === prev?.name) nameEl.value = next.type === 'custom' ? '' : next.name;
  $('#f-url').value = next.url;
  $('#f-group').value = next.group || 'chat';
  renderPresets();
  if (focus) (next.type === 'custom' ? $('#f-url') : nameEl).focus();
}

$('#presets').addEventListener('click', (e) => {
  const b = e.target.closest('.preset');
  if (b) pickPreset(b.dataset.type);
});

function openModal(d) {
  roost.overlay(true);
  document.body.classList.add('modal-open');
  if (!d.open) d.showModal();
}
const searchDlg = $('#search-dlg');
const keysDlg = $('#keys-dlg');
for (const d of [dlg, sdlg, searchDlg, keysDlg]) {
  d.addEventListener('close', () => {
    if (dlg.open || sdlg.open || searchDlg.open || keysDlg.open) return;
    document.body.classList.remove('modal-open');
    roost.overlay(false);
  });
}

function openAdd(type) {
  mode = 'add';
  editingId = null;
  selectedType = type || 'gmail';
  $('#dlg-title').textContent = 'Add an app';
  $('#f-ok').textContent = 'Add';
  $('#presets').hidden = false;
  const p = presets.find((x) => x.type === selectedType) || presets[0];
  $('#f-name').value = p.name;
  $('#f-url').value = p.url;
  $('#f-group').value = p.group || 'chat';
  $('#f-error').hidden = true;
  renderPresets();
  openModal(dlg);
  $('#f-name').select();
}

function openEdit(id) {
  const svc = state.services.find((s) => s.id === id);
  if (!svc) return;
  mode = 'edit';
  editingId = id;
  $('#dlg-title').textContent = `Edit ${svc.name}`;
  $('#f-ok').textContent = 'Save';
  $('#presets').hidden = true;
  $('#f-name').value = svc.name;
  $('#f-url').value = svc.url;
  $('#f-group').value = svc.group;
  $('#f-error').hidden = true;
  openModal(dlg);
  $('#f-name').select();
}

$('#f-cancel').addEventListener('click', () => dlg.close());

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#f-name').value;
  const url = $('#f-url').value;
  const group = $('#f-group').value;
  const res = mode === 'add'
    ? await roost.add({ type: selectedType, name, url, group })
    : await roost.update({ id: editingId, name, url, group });
  if (res && res.ok) {
    dlg.close();
  } else {
    $('#f-error').textContent = (res && res.error) || 'Something went wrong.';
    $('#f-error').hidden = false;
  }
});

// ----- welcome screen: pick apps with one click -----
const welcomePicked = new Set();
let welcomeBusy = false;

function renderWelcome() {
  const box = $('#welcome-tiles');
  const list = roostUi.welcomePresets(presets);
  for (const t of [...welcomePicked]) if (!list.some((p) => p.type === t)) welcomePicked.delete(t);
  const shown = [...box.querySelectorAll('.wtile')].map((b) => b.dataset.type).join(',');
  if (shown !== list.map((p) => p.type).join(',')) {
    box.textContent = '';
    for (const p of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wtile';
      b.dataset.type = p.type;
      const icon = iconEl({ name: p.name, color: p.color, icon: p.icon || null });
      const check = document.createElement('span');
      check.className = 'wcheck';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      const text = document.createElement('span');
      text.className = 'wtext';
      const name = document.createElement('b');
      name.textContent = p.name;
      const hint = document.createElement('small');
      hint.textContent = roostUi.welcomeHint(p);
      text.append(name, hint);
      b.append(icon, text, check);
      box.appendChild(b);
    }
  }
  for (const b of box.querySelectorAll('.wtile')) {
    const on = welcomePicked.has(b.dataset.type);
    b.classList.toggle('picked', on);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = welcomeBusy;
  }
  const go = $('#welcome-go');
  go.textContent = welcomeBusy ? 'Adding…' : roostUi.welcomeButtonLabel(welcomePicked.size);
  go.disabled = welcomeBusy || welcomePicked.size === 0;
}

$('#welcome-tiles').addEventListener('click', (e) => {
  const b = e.target.closest('.wtile');
  if (!b || welcomeBusy) return;
  const t = b.dataset.type;
  if (welcomePicked.has(t)) welcomePicked.delete(t); else welcomePicked.add(t);
  renderWelcome();
});

$('#welcome-go').addEventListener('click', async () => {
  if (welcomeBusy || !welcomePicked.size) return;
  const picked = roostUi.welcomePresets(presets).filter((p) => welcomePicked.has(p.type));
  const err = $('#welcome-error');
  err.hidden = true;
  welcomeBusy = true;
  renderWelcome();
  const failed = [];
  for (const p of picked) {
    let res;
    try { res = await roost.add({ type: p.type, name: p.name, url: p.url, group: p.group || 'chat' }); } catch (e) { res = { ok: false, error: String(e && e.message || e) }; }
    if (res && res.ok) welcomePicked.delete(p.type);
    else failed.push({ p, error: (res && res.error) || 'Something went wrong.' });
  }
  welcomeBusy = false;
  if (failed.length) {
    const msg = `Could not add ${failed.map((f) => `${f.p.name} (${f.error})`).join(', ')}.`;
    err.textContent = msg;
    err.hidden = false;
    // Some apps were added, so the welcome screen is gone: show the problem in the Add dialog instead.
    if (state.services.length > 0) {
      openAdd(failed[0].p.type);
      $('#f-error').textContent = msg;
      $('#f-error').hidden = false;
    }
  }
  renderWelcome();
});

// ----- settings -----
const GROUP_NAMES = { mail: 'Email', chat: 'Messages', top: 'Top bar' };

function switchEl(checked, label, onChange) {
  const i = document.createElement('input');
  i.type = 'checkbox';
  i.className = 'switch';
  i.checked = checked;
  i.setAttribute('aria-label', label);
  i.addEventListener('change', () => onChange(i.checked));
  return i;
}

function renderSettings() {
  const s = state.settings || {};
  $('#s-dnd').checked = !!state.dnd;
  $('#s-call').checked = !!s.callQuiet;
  $('#s-hours').checked = !!s.quietHours?.on;
  if (document.activeElement !== $('#s-from')) $('#s-from').value = s.quietHours?.from || '22:00';
  if (document.activeElement !== $('#s-to')) $('#s-to').value = s.quietHours?.to || '07:00';
  $('#s-sounds').checked = s.sounds !== false;
  $('#s-keybar').checked = s.keyBar !== false;
  const mv = s.mailView || {};
  $('#s-mv-pane').value = mv.pane || 'right';
  $('#s-mv-width').value = mv.listWidth || 'normal';
  $('#s-mv-density').value = mv.density || 'comfortable';
  $('#s-mv-preview').checked = mv.preview !== false;
  $('#s-mv-labels').checked = mv.labels !== false;
  $('#s-status').textContent = roostUi.quietText(state.quiet, s.quietHours).status;

  const box = $('#s-apps');
  box.textContent = '';
  const head = document.createElement('div');
  head.className = 'app-row app-head';
  head.innerHTML = '<span></span><span>Notifications</span><span>Sounds</span><span>Badge</span>';
  box.appendChild(head);
  let anyWindow = false;
  // Only apps that differ from the default (notifications, sounds and badge on), unless "Show all apps" is on.
  // An app stays in the list while Settings is open, so it does not jump away when you switch it back.
  const isDefault = (svc) => !svc.muted && svc.sounds !== false && svc.badge !== false;
  for (const svc of state.services) if (!isDefault(svc)) appsShown.add(svc.id);
  const showAll = $('#s-apps-all').checked;
  const visible = state.services.filter((svc) => showAll || appsShown.has(svc.id));
  head.hidden = !visible.length;
  $('#s-apps-default').hidden = showAll || visible.length > 0;
  for (const g of ['mail', 'chat', 'top']) {
    for (const svc of visible.filter((x) => x.group === g)) {
      const row = document.createElement('div');
      row.className = 'app-row';
      const name = document.createElement('span');
      name.className = 'app-name';
      name.append(iconEl({ ...svc, icon: svc.icon || presetIcon(svc.type) }, 'small'));
      const t = document.createElement('span');
      t.innerHTML = '';
      t.textContent = svc.name;
      const sub = document.createElement('small');
      sub.textContent = GROUP_NAMES[svc.group] + (svc.mode === 'window' ? ` · ${state.chrome || 'Chrome'} window` : '');
      t.appendChild(sub);
      name.appendChild(t);
      const inWindow = svc.mode === 'window';
      anyWindow = anyWindow || inWindow;
      const n = switchEl(!svc.muted, `Notifications for ${svc.name}`, (v) => roost.setApp({ id: svc.id, muted: !v }));
      const so = switchEl(svc.sounds, `Sounds for ${svc.name}`, (v) => roost.setApp({ id: svc.id, sounds: v }));
      const b = switchEl(svc.badge, `Badge for ${svc.name}`, (v) => roost.setApp({ id: svc.id, badge: v }));
      if (inWindow) { n.disabled = true; so.disabled = true; }
      row.append(name, n, so, b);
      box.appendChild(row);
    }
  }
  const note = $('#s-chrome-note');
  note.hidden = !anyWindow;
  note.textContent = anyWindow ? `Apps in a ${state.chrome || 'Chrome'} window send their notifications through ${state.chrome || 'Chrome'}. Set those in macOS System Settings → Notifications → ${state.chrome || 'Google Chrome'}.` : '';

  $('#s-ai-state').textContent = state.aiConfigured ? '✓ AI writing is on.' : 'AI writing is off: no key yet.';
  $('#s-ai-remove').hidden = !state.aiConfigured;
}

// One section at a time; the menu on the left (on top when the window is narrow) switches it.
const navBtns = () => [...document.querySelectorAll('#s-nav .s-nav-btn')];
let settingsSection = 'quiet';
function showSection(name, { focusMenu = false } = {}) {
  const btns = navBtns();
  const btn = btns.find((b) => b.dataset.sec === name) || btns[0];
  settingsSection = btn.dataset.sec;
  for (const b of btns) {
    const on = b === btn;
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    const sec = document.getElementById(b.getAttribute('aria-controls'));
    if (sec) sec.hidden = !on;
  }
  $('.s-body').scrollTop = 0;
  if (focusMenu) btn.focus();
}
$('#s-nav').addEventListener('click', (e) => {
  const b = e.target.closest('.s-nav-btn');
  if (b) showSection(b.dataset.sec);
});
$('#s-nav').addEventListener('keydown', (e) => {
  const btns = navBtns();
  const i = btns.indexOf(document.activeElement);
  if (i < 0) return;
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  let next = null;
  if (step) next = btns[(i + step + btns.length) % btns.length];
  else if (e.key === 'Home') next = btns[0];
  else if (e.key === 'End') next = btns[btns.length - 1];
  if (!next) return;
  e.preventDefault();
  showSection(next.dataset.sec, { focusMenu: true });
});
const appsShown = new Set(); // apps listed in Settings › Apps while it is open
$('#s-apps-all').addEventListener('change', () => renderSettings());

function openSettings(section) {
  if (dlg.open) dlg.close();
  if (!sdlg.open) { appsShown.clear(); $('#s-apps-all').checked = false; }
  renderSettings();
  openModal(sdlg);
  showSection(section || (sdlg.dataset.opened ? settingsSection : 'quiet'));
  sdlg.dataset.opened = '1';
  const target = section && document.getElementById(`sec-${section}`);
  if (target) { target.classList.add('flash'); setTimeout(() => target.classList.remove('flash'), 1200); }
  if (section === 'ai') $('#s-ai-key').focus();
  else if (!section) (navBtns().find((b) => b.dataset.sec === settingsSection) || navBtns()[0]).focus();
}

$('#s-close').addEventListener('click', () => sdlg.close());
$('#s-dnd').addEventListener('change', (e) => roost.setSettings({ dnd: e.target.checked }));
$('#s-call').addEventListener('change', (e) => roost.setSettings({ callQuiet: e.target.checked }));
$('#s-sounds').addEventListener('change', (e) => roost.setSettings({ sounds: e.target.checked }));
$('#s-keybar').addEventListener('change', (e) => roost.setSettings({ keyBar: e.target.checked }));
$('#s-mv-pane').addEventListener('change', (e) => roost.setSettings({ mailView: { pane: e.target.value } }));
$('#s-mv-width').addEventListener('change', (e) => roost.setSettings({ mailView: { listWidth: e.target.value } }));
$('#s-mv-density').addEventListener('change', (e) => roost.setSettings({ mailView: { density: e.target.value } }));
$('#s-mv-preview').addEventListener('change', (e) => roost.setSettings({ mailView: { preview: e.target.checked } }));
$('#s-mv-labels').addEventListener('change', (e) => roost.setSettings({ mailView: { labels: e.target.checked } }));
const saveHours = () => roost.setSettings({ quietHours: { on: $('#s-hours').checked, from: $('#s-from').value, to: $('#s-to').value } });
for (const id of ['#s-hours', '#s-from', '#s-to']) $(id).addEventListener('change', saveHours);
$('#s-ai-save').addEventListener('click', async () => {
  const res = await roost.setAiKey($('#s-ai-key').value);
  $('#s-ai-key').value = '';
  if (!res || !res.ok) $('#s-ai-state').textContent = (res && res.error) || 'Could not save the key.';
});
$('#s-ai-remove').addEventListener('click', () => roost.setAiKey(''));
$('#s-ai-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#s-ai-save').click(); } });
$('#s-ai-get').addEventListener('click', () => roost.openUrl('https://platform.claude.com/settings/keys'));

// ----- buttons -----
$('#add').addEventListener('click', () => openAdd());
$('#add-top').addEventListener('click', () => openAdd('drive'));
$('#dnd').addEventListener('click', () => roost.toggleDnd());
$('#settings-btn').addEventListener('click', () => openSettings());
$('#quiet-pill').addEventListener('click', () => openSettings('quiet'));
$('#welcome-more').addEventListener('click', () => openAdd('custom'));
roost.onAdd(() => openAdd());
roost.onEdit(openEdit);
roost.onSettings(openSettings);
roost.onState((s) => { state = s; render(); });

roost.getState().then((res) => {
  if (!res) return;
  presets = res.presets;
  state = res.state;
  render();
});


// ----- search all inboxes (⌘⇧F) -----

const sd = { seq: 0, timer: null, rows: [], on: -1 };
const isMacUi = roost.platform === 'darwin';
const MOD = isMacUi ? '⌘' : 'Ctrl+';

function sdDate(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

function sdFrom(v) { return String(v || '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || '(unknown sender)'; }

function sdMove(i) {
  if (!sd.rows.length) return;
  sd.on = (i + sd.rows.length) % sd.rows.length;
  sd.rows.forEach((r, k) => { r.classList.toggle('on', k === sd.on); r.setAttribute('aria-selected', String(k === sd.on)); });
  sd.rows[sd.on].scrollIntoView({ block: 'nearest' });
}

function sdMessage(text) {
  const box = $('#sd-results');
  box.textContent = '';
  const p = document.createElement('div');
  p.className = 'sd-empty';
  p.textContent = text;
  box.appendChild(p);
  sd.rows = [];
  sd.on = -1;
}

async function runSearch() {
  clearTimeout(sd.timer);
  const q = $('#sd-input').value.trim();
  const seq = ++sd.seq;
  if (!q) { sdMessage('Type to search every inbox.'); return; }
  sdMessage('Searching…');
  const r = await roost.searchAll(q);
  if (seq !== sd.seq || !searchDlg.open) return;
  const groups = (r && r.groups) || [];
  if (!groups.length) { sdMessage('Add a Gmail inbox first.'); return; }
  const box = $('#sd-results');
  box.textContent = '';
  sd.rows = [];
  let total = 0;
  for (const g of groups) {
    if (!g.threads.length && !g.error) continue;
    const head = document.createElement('div');
    head.className = 'sd-group';
    const svc = state.services.find((s) => s.id === g.id) || { name: g.name, color: '#888' };
    head.appendChild(iconEl(svc, 'small'));
    const name = document.createElement('b');
    name.textContent = g.name;
    head.appendChild(name);
    const info = document.createElement('span');
    if (g.error) { info.className = 'sd-err'; info.textContent = g.error; } else info.textContent = `${g.email} · ${g.threads.length}${g.more ? '+' : ''}`;
    head.appendChild(info);
    box.appendChild(head);
    for (const t of g.threads) {
      total++;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'sd-row' + (t.unread ? ' unread' : '');
      row.setAttribute('role', 'option');
      const line = document.createElement('span');
      line.className = 'sd-line';
      const from = document.createElement('span'); from.className = 'sd-from'; from.textContent = sdFrom(t.from);
      const date = document.createElement('span'); date.className = 'sd-date'; date.textContent = sdDate(t.date);
      line.append(from, date);
      const subj = document.createElement('span'); subj.className = 'sd-subj'; subj.textContent = t.subject || '(no subject)';
      const snip = document.createElement('span'); snip.className = 'sd-snip'; snip.textContent = t.snippet || '';
      row.append(line, subj, snip);
      row.addEventListener('click', () => { searchDlg.close(); roost.openMail(g.id, t.id); });
      row.addEventListener('mousemove', () => { const k = sd.rows.indexOf(row); if (k !== sd.on) sdMove(k); });
      box.appendChild(row);
      sd.rows.push(row);
    }
  }
  if (!total) {
    const errs = groups.filter((g) => g.error).length;
    if (!errs) sdMessage(`No emails match “${q}” in any inbox.`);
    else { const p = document.createElement('div'); p.className = 'sd-empty'; p.textContent = `No emails match “${q}”.`; box.appendChild(p); }
    return;
  }
  sdMove(0);
}

function openSearch() {
  if (dlg.open) dlg.close();
  if (sdlg.open) sdlg.close();
  if (keysDlg.open) keysDlg.close();
  openModal(searchDlg);
  const input = $('#sd-input');
  input.focus();
  input.select();
  if (!input.value.trim()) sdMessage('Type to search every inbox.');
}

$('#sd-input').addEventListener('input', () => { clearTimeout(sd.timer); sd.timer = setTimeout(runSearch, 400); });
$('#sd-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); sdMove(sd.on + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sdMove(sd.on - 1); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (sd.timer || !sd.rows.length) { clearTimeout(sd.timer); sd.timer = null; runSearch(); }
    else if (sd.rows[sd.on]) sd.rows[sd.on].click();
  }
});
searchDlg.addEventListener('click', (e) => { if (e.target === searchDlg) searchDlg.close(); });
roost.onSearch(openSearch);

// ----- keyboard shortcut list (⌘/) -----

const SHORTCUTS = [
  ['Anywhere in Roost', [
    [`${MOD}⇧F`, 'Search all inboxes'],
    [`${MOD}N`, 'New email (in this inbox)'],
    [`${MOD}1 … ${MOD}9`, 'Go to app 1 to 9'],
    [`${MOD}⇧]  /  ${MOD}⇧[`, 'Next / previous app'],
    ['Ctrl+Tab', 'Next app'],
    [`${MOD}T`, 'Add an app'],
    [`${MOD}⇧D`, 'Do Not Disturb on / off'],
    [`${MOD},`, 'Settings'],
    [`${MOD}R`, 'Reload this app'],
    [`${MOD}=  /  ${MOD}-`, 'Zoom in / out'],
    [`${MOD}/`, 'This list'],
    ['View › Shortcut Bar', 'Show / hide the bottom bar'],
  ]],
  ['In an inbox', [
    ['c', 'Write a new email'],
    ['/', 'Search this inbox'],
    ['[  /  ]', 'Previous / next inbox tab (Primary, Promotions …)'],
    ['\\', 'Hide / show the list (full view of the email)'],
    ['⇧F', 'Search all inboxes'],
    ['j  /  k', 'Next / previous email'],
    ['Enter  or  o', 'Open email'],
    ['u', 'Back to the list'],
    ['x', 'Tick email (to act on many)'],
    ['e', 'Archive (ticked or this email)'],
    ['#', 'Delete (ticked or this email)'],
    ['s', 'Star / unstar'],
    ['⇧U', 'Mark as unread'],
    ['r  /  a  /  f', 'Reply / reply all / forward'],
    ['Esc', 'Close'],
    ['?', 'This list'],
  ]],
];

function openShortcuts() {
  if (searchDlg.open) searchDlg.close();
  const list = $('#keys-list');
  list.textContent = '';
  for (const [title, rows] of SHORTCUTS) {
    const h = document.createElement('h3');
    h.textContent = title;
    list.appendChild(h);
    for (const [keys, what] of rows) {
      const r = document.createElement('div');
      r.className = 'keys-row';
      const a = document.createElement('span'); a.textContent = what;
      const b = document.createElement('span');
      const k = document.createElement('kbd'); k.textContent = keys;
      b.appendChild(k);
      r.append(a, b);
      list.appendChild(r);
    }
  }
  openModal(keysDlg);
  $('#keys-close').focus();
}
$('#keys-close').addEventListener('click', () => keysDlg.close());
roost.onShortcuts(openShortcuts);


// ----- slim shortcut bar at the bottom: the main keys for what you look at -----

const KEYBAR_INBOX = [['c', 'New email'], ['/', 'Search'], ['⇧F', 'All inboxes'], ['j k', 'Move'], ['x', 'Tick'], ['e', 'Archive'], ['#', 'Delete'], ['r', 'Reply'], ['s', 'Star'], ['[ ]', 'Tabs'], ['u', 'Back']];
const KEYBAR_APP = [[`${MOD}⇧F`, 'Search all inboxes'], [`${MOD}N`, 'New email'], [`${MOD}1–9`, 'Go to app'], [`${MOD}⇧] [`, 'Next / previous app'], [`${MOD}⇧D`, 'Do Not Disturb'], [`${MOD}T`, 'Add app']];
let keybarShown = ''; // what the bar shows now, so it only redraws on a change
let keybarDoneLine = false; // the "You know the shortcuts" line showed in this session

// In an inbox the bar steps back: a shortcut used 5 times leaves the bar. When every inbox shortcut is
// learned, one short line shows instead. After you leave that inbox, the bar stays away in inboxes
// (settings.keyBarDoneSeen; main.js then gives the inbox the full height). The bar in other apps stays.
function renderKeybar() {
  const s = state.settings || {};
  const active = state.services.find((x) => x.id === state.activeId);
  const kind = active && active.type === 'gmail' && active.mode === 'api' ? 'inbox' : 'app';
  if (kind !== 'inbox' && keybarDoneLine && !s.keyBarDoneSeen) {
    keybarDoneLine = false;
    roost.setSettings({ keyBarDoneSeen: true });
  }
  const steppedBack = kind === 'inbox' && !!s.keyBarDoneSeen;
  const on = s.keyBar !== false && !steppedBack;
  const bar = $('#keybar');
  bar.hidden = !on;
  bar.dataset.kind = kind;
  document.body.classList.toggle('keybar-on', on);
  if (!on) { keybarShown = ''; return; }
  const items = kind === 'inbox' ? roostUi.keysToShow(KEYBAR_INBOX, state.keysLearned) : KEYBAR_APP;
  const done = kind === 'inbox' && !items.length;
  if (done) keybarDoneLine = true;
  const sig = `${kind}|${done}|${items.map((i) => i[0]).join(' ')}`;
  if (sig === keybarShown) return;
  keybarShown = sig;
  const box = $('#keybar-keys');
  box.textContent = '';
  bar.classList.toggle('done', done);
  if (done) {
    const line = document.createElement('span');
    line.className = 'keybar-done';
    line.textContent = `You know the shortcuts. ${MOD}/ shows them all.`;
    box.appendChild(line);
    return;
  }
  for (const [keys, what] of items) {
    const item = document.createElement('span');
    item.className = 'keybar-item';
    const k = document.createElement('kbd');
    k.textContent = keys;
    item.append(k, document.createTextNode(what));
    box.appendChild(item);
  }
}
$('#keybar-all').querySelector('kbd').textContent = `${MOD}/`;
$('#keybar-all').addEventListener('click', openShortcuts);
$('#keybar-hide').addEventListener('click', () => roost.setSettings({ keyBar: false }));
