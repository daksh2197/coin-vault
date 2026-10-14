/**
 * The wiring. It reads the database, hands holdings and prices to the core, and paints the result.
 * It does no money maths and builds no Holding by hand: core/summarize does the first, core/form the second.
 *
 *   database --readAll()--> state --summarize()--> render() --> screen
 *   form --buildHolding()--> database --reload--> state ...
 */

import './styles/fonts.css';
import './styles/brand.css';
import './styles/app.css';

import { openVault, type Vault, VaultError } from './core/db';
import { todayLocal } from './core/dates';
import { buildHolding, buildSpot, holdingToInput, type HoldingField, type HoldingInput } from './core/form';
import { LockError, MESSAGES, checkNewPassphrase, lockText, unlockText } from './core/lock';
import { allocation, summarize } from './core/melt';
import { formatBasisPoints, formatCents } from './core/money';
import { newId } from './core/schema';
import { sampleHoldings, sampleSpots } from './core/sample';
import { type Holding, METAL_LABEL, METALS, type Metal, type Spot } from './core/types';
import { formatFineness, formatGrams, formatOzt, formatWeight, parseFineness, parseWeight } from './core/units';
import { buildExport, mergeVaults, parseVaultText, serializeExport, validateExport, type VaultExport } from './core/vaultfile';
import { el, h, input, setText } from './ui/dom';
import { asOf, asOfTotals, backupStatus, excludedText, missingSpotText } from './ui/words';

interface State {
  holdings: Holding[];
  spots: Spot[];
  lastBackup: string | null;
  unreadable: number;
}

let vault: Vault;
let state: State = { holdings: [], spots: [], lastBackup: null, unreadable: 0 };
let editingId: string | null = null;
let pendingDelete: string | null = null;
let pendingImport: VaultExport | null = null;
let pendingEncrypted: unknown = null;

const today = (): string => todayLocal();
const DASH = '—';

// ---------- messages ----------

function showBanner(message: string): void {
  const banner = el('banner');
  setText(banner, message);
  banner.hidden = message === '';
}

function errorText(error: unknown): string {
  if (error instanceof VaultError) return error.message;
  return 'Something went wrong saving to this device.';
}

async function reload(): Promise<void> {
  state = await vault.readAll();
  showBanner(
    state.unreadable > 0
      ? `${state.unreadable} saved ${state.unreadable === 1 ? 'row' : 'rows'} could not be read and ${state.unreadable === 1 ? 'is' : 'are'} not shown.`
      : '',
  );
  render();
}

/** Run a database change, then redraw. A failure becomes a banner, never a silent loss. */
async function change(work: () => Promise<void>): Promise<boolean> {
  try {
    await work();
    await reload();
    return true;
  } catch (error) {
    showBanner(errorText(error));
    return false;
  }
}

// ---------- drawing ----------

function render(): void {
  const { lines, totals } = summarize(state.holdings, state.spots);
  const t = today();
  const hasHoldings = state.holdings.length > 0;
  const missing = METALS.filter((m) => state.holdings.some((x) => x.metal === m) && !state.spots.some((s) => s.metal === m));

  el('sample-note').hidden = !(state.holdings.some((x) => x.sample) || state.spots.some((s) => s.sample));

  // The bold element: the gap between what was paid and what the metal is worth.
  const hero = el('hero');
  const label = el('hero-label');
  const gap = el('hero-gap');
  const sub = el('hero-sub');
  const asOfLine = asOfTotals(lines, t);
  if (!hasHoldings) {
    setText(label, 'Premium over melt');
    setText(gap, DASH);
    setText(sub, 'Add a coin or bar to begin.');
    hero.dataset.tone = 'idle';
  } else if (totals.included === 0) {
    setText(label, 'Premium over melt');
    setText(gap, DASH);
    setText(sub, missingSpotText(missing));
    hero.dataset.tone = 'idle';
  } else {
    const under = totals.gap < 0n;
    setText(label, under ? 'Paid under melt' : 'Premium over melt');
    setText(gap, formatCents(under ? -totals.gap : totals.gap));
    setText(sub, `${totals.premiumBp === null ? 'n/a' : formatBasisPoints(totals.premiumBp, { sign: true })} against melt. ${asOfLine}`);
    hero.dataset.tone = under ? 'under' : totals.gap === 0n ? 'idle' : 'over';
  }

  setText(el('stat-paid'), totals.included > 0 ? formatCents(totals.paid) : hasHoldings ? formatCents(totals.paidAll) : DASH);
  setText(el('asof-paid'), totals.included > 0 && totals.excluded > 0 ? 'holdings with a spot price' : hasHoldings && totals.included === 0 ? 'everything you entered' : '');
  setText(el('stat-melt'), totals.included > 0 ? formatCents(totals.melt) : DASH);
  setText(el('asof-melt'), asOfLine);
  setText(el('stat-gain'), totals.included > 0 ? formatCents(totals.gain) : DASH);
  setText(el('asof-gain'), asOfLine);

  const excluded = el('hero-excluded');
  setText(excluded, excludedText(totals.excluded, missing));
  excluded.hidden = totals.excluded === 0;

  setText(
    el('hero-live'),
    totals.included === 0
      ? hasHoldings
        ? missingSpotText(missing)
        : 'No holdings yet.'
      : `Paid ${formatCents(totals.paid)}, melt value ${formatCents(totals.melt)}, ${gapWords(totals.gap)} ${formatCents(totals.gap < 0n ? -totals.gap : totals.gap)}. ${asOfLine}`,
  );

  renderSpots();
  renderHoldings(lines);
  renderAllocation(totals.meltByMetal);
  setText(el('backup-status'), backupStatus(state.lastBackup, t, hasHoldings));
  renderSheet(lines, totals);
}

const gapWords = (gap: bigint): string => (gap < 0n ? 'paid under melt by' : 'premium over melt');

function renderSpots(): void {
  const rows = el('spot-rows');
  // Keep what the user is typing: rebuild only when the saved prices changed.
  const key = JSON.stringify(state.spots);
  if (rows.dataset.key === key) return;
  rows.dataset.key = key;
  rows.replaceChildren(
    ...METALS.map((metal) => {
      const spot = state.spots.find((s) => s.metal === metal);
      const price = h('input', {
        id: `spot-${metal}`,
        type: 'text',
        inputmode: 'decimal',
        autocomplete: 'off',
        placeholder: 'Enter a spot price',
        value: spot ? (spot.centsPerOzt / 100).toFixed(2) : undefined,
      });
      const date = h('input', { id: `spot-date-${metal}`, type: 'date', max: today(), value: spot?.enteredOn ?? today() });
      return h(
        'div',
        { class: 'spot-row' },
        h('div', { class: 'field' }, h('label', { for: `spot-${metal}` }, `${METAL_LABEL[metal]}, CAD per troy ounce`), price),
        h('div', { class: 'field' }, h('label', { for: `spot-date-${metal}` }, `${METAL_LABEL[metal]}, price typed on`), date),
        h('p', { class: 'err', id: `err-spot-${metal}` }),
        spot ? h('p', { class: 'row-note' }, spot.sample ? 'SAMPLE price, invented.' : `Saved ${asOf(spot, today())}.`) : null,
      );
    }),
  );
}

function renderHoldings(lines: ReturnType<typeof summarize>['lines']): void {
  el('holdings-empty').hidden = state.holdings.length > 0;
  el('holding-list').replaceChildren(
    ...lines.map((line) => {
      const hd = line.holding;
      const meta = [
        METAL_LABEL[hd.metal],
        formatFineness(hd.finenessPpm),
        `${formatWeight(BigInt(hd.weightNg), hd.enteredUnit)} each`,
        `× ${hd.quantity}`,
        hd.mint,
        hd.year === undefined ? undefined : String(hd.year),
      ].filter((x): x is string => Boolean(x));
      const spotNote = line.spot ? asOf(line.spot, today()) : '';
      const fig = (name: string, value: string, note = ''): HTMLElement =>
        h('div', { class: 'fig' }, h('dt', {}, name), h('dd', {}, value), note ? h('dd', { class: 'asof' }, note) : null);
      const confirming = pendingDelete === hd.id;
      return h(
        'li',
        { class: 'holding', 'data-id': hd.id },
        h('h3', {}, hd.name),
        h('p', { class: 'meta' }, meta.join(' · ')),
        h(
          'dl',
          { class: 'figs' },
          fig('Paid', formatCents(line.paid), hd.paidOn ? `on ${hd.paidOn}` : ''),
          fig('Melt value', line.melt === null ? DASH : formatCents(line.melt), line.melt === null ? `Enter a ${METAL_LABEL[hd.metal].toLowerCase()} spot price` : spotNote),
          fig('Premium', line.melt === null ? DASH : line.premiumBp === null ? 'n/a' : formatBasisPoints(line.premiumBp, { sign: true }), spotNote),
          fig('Gain or loss', line.gain === null ? DASH : formatCents(line.gain), spotNote),
        ),
        hd.location ? h('p', { class: 'kept' }, `Kept: ${hd.location}`) : null,
        hd.note ? h('p', { class: 'story' }, hd.note) : null,
        h(
          'div',
          { class: 'actions' },
          h('button', { type: 'button', class: 'btn btn-ghost', 'data-edit': hd.id, 'aria-label': `Edit ${hd.name}` }, 'Edit'),
          confirming
            ? [
                h('button', { type: 'button', class: 'btn btn-danger', 'data-delete-yes': hd.id, 'aria-label': `Yes, delete ${hd.name}` }, 'Yes, delete'),
                h('button', { type: 'button', class: 'btn btn-ghost', 'data-delete-no': hd.id }, 'Keep'),
              ]
            : h('button', { type: 'button', class: 'btn btn-ghost', 'data-delete': hd.id, 'aria-label': `Delete ${hd.name}` }, 'Delete'),
        ),
      );
    }),
  );
}

function renderAllocation(meltByMetal: Record<Metal, bigint>): void {
  const parts = allocation(meltByMetal);
  const section = el('allocation');
  section.hidden = parts === null;
  if (!parts) return;
  const pct = (bp: bigint): string => formatBasisPoints(bp);
  setText(el('alloc-help'), 'By melt value at the spot prices you typed. Metals without a price are not counted.');
  el('alloc-bar').replaceChildren(
    ...parts.map((p) => h('span', { class: `seg-bar m-${p.metal}`, style: `width:${Number(p.bp) / 100}%` })),
  );
  el('alloc-body').replaceChildren(
    ...parts.map((p) =>
      h(
        'tr',
        {},
        h('th', { scope: 'row' }, h('span', { class: `swatch m-${p.metal}`, 'aria-hidden': 'true' }), METAL_LABEL[p.metal]),
        h('td', { class: 'num' }, formatCents(p.melt)),
        h('td', { class: 'num' }, pct(p.bp)),
      ),
    ),
  );
}

function renderSheet(lines: ReturnType<typeof summarize>['lines'], totals: ReturnType<typeof summarize>['totals']): void {
  const showLocation = input('sheet-location').checked;
  const showNotes = input('sheet-notes').checked;
  const t = today();
  const sheet = el('sheet');
  const cell = (label: string, value: string, cls = ''): HTMLElement => h('td', { 'data-label': label, class: cls }, value);
  const usedSpots = METALS.flatMap((m) => {
    const s = state.spots.find((x) => x.metal === m && state.holdings.some((hd) => hd.metal === m));
    return s ? [s] : [];
  });
  sheet.replaceChildren(
    h('h2', { id: 'sheet-title' }, 'Coin Vault inventory'),
    h('p', { class: 'sheet-meta' }, `Printed ${t}. ${state.holdings.length} ${state.holdings.length === 1 ? 'holding' : 'holdings'}. Amounts in Canadian dollars.`),
    state.holdings.length === 0
      ? h('p', {}, 'No holdings to list.')
      : h(
          'table',
          { class: 'sheet-table' },
          h(
            'thead',
            {},
            h('tr', {}, ...['Item', 'Fineness', 'Weight each', 'Qty', 'Paid', 'Melt value', 'Premium'].map((c, i) => h('th', { scope: 'col', class: i >= 3 ? 'num' : '' }, c))),
          ),
          h(
            'tbody',
            {},
            ...lines.flatMap((line) => {
              const hd = line.holding;
              const detail = [METAL_LABEL[hd.metal], hd.mint, hd.year === undefined ? undefined : String(hd.year), hd.paidOn ? `bought ${hd.paidOn}` : undefined, hd.sample ? 'SAMPLE' : undefined]
                .filter((x): x is string => Boolean(x))
                .join(', ');
              const extra = [showLocation && hd.location ? `Kept: ${hd.location}` : '', showNotes && hd.note ? hd.note : ''].filter(Boolean);
              return [
                h(
                  'tr',
                  { class: 'sheet-row' },
                  h('td', { 'data-label': 'Item', class: 'item' }, h('strong', {}, hd.name), h('span', { class: 'detail' }, detail), ...extra.map((x) => h('span', { class: 'detail extra' }, x))),
                  cell('Fineness', formatFineness(hd.finenessPpm)),
                  cell('Weight each', formatWeight(BigInt(hd.weightNg), hd.enteredUnit)),
                  cell('Qty', String(hd.quantity), 'num'),
                  cell('Paid', formatCents(line.paid), 'num'),
                  cell('Melt value', line.melt === null ? 'no spot price' : formatCents(line.melt), 'num'),
                  cell('Premium', line.melt === null ? DASH : line.premiumBp === null ? 'n/a' : formatBasisPoints(line.premiumBp, { sign: true }), 'num'),
                ),
              ];
            }),
          ),
          h(
            'tfoot',
            {},
            h(
              'tr',
              { class: 'sheet-total' },
              h('th', { scope: 'row', colspan: '4' }, totals.excluded > 0 ? `Total (${totals.included} of ${state.holdings.length} holdings have a spot price)` : 'Total'),
              h('td', { class: 'num', 'data-label': 'Paid' }, formatCents(totals.included > 0 ? totals.paid : totals.paidAll)),
              h('td', { class: 'num', 'data-label': 'Melt value' }, totals.included > 0 ? formatCents(totals.melt) : DASH),
              h('td', { class: 'num', 'data-label': 'Premium' }, totals.premiumBp === null ? DASH : formatBasisPoints(totals.premiumBp, { sign: true })),
            ),
          ),
        ),
    h(
      'div',
      { class: 'sheet-foot' },
      h('p', {}, usedSpots.length === 0 ? 'No spot prices entered.' : `Spot prices used, CAD per troy ounce, as typed by the owner of this sheet: ${usedSpots.map((s) => `${METAL_LABEL[s.metal]} ${formatCents(BigInt(s.centsPerOzt))} on ${s.enteredOn}${s.sample ? ' (SAMPLE)' : ''}`).join('; ')}.`),
      h('p', {}, 'Melt value is the metal content at those prices. It is not a valuation or an appraisal. Not financial advice. Not affiliated with the Royal Canadian Mint or any dealer.'),
    ),
  );
}

// ---------- the add / edit form ----------

const FIELDS: { field: HoldingField; id: string }[] = [
  { field: 'name', id: 'f-name' },
  { field: 'metal', id: 'f-metal' },
  { field: 'fineness', id: 'f-fineness' },
  { field: 'weight', id: 'f-weight' },
  { field: 'unit', id: 'f-unit' },
  { field: 'quantity', id: 'f-quantity' },
  { field: 'paid', id: 'f-paid' },
  { field: 'paidOn', id: 'f-paidOn' },
  { field: 'mint', id: 'f-mint' },
  { field: 'year', id: 'f-year' },
  { field: 'location', id: 'f-location' },
  { field: 'note', id: 'f-note' },
];

const field = (id: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
  el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);

function readForm(): HoldingInput {
  const out = {} as Record<HoldingField, string>;
  for (const f of FIELDS) out[f.field] = field(f.id).value;
  return out;
}

function fillForm(values: HoldingInput): void {
  for (const f of FIELDS) field(f.id).value = values[f.field];
  updateReadouts();
}

const BLANK: HoldingInput = {
  name: '',
  metal: 'gold',
  fineness: '',
  weight: '',
  unit: 'ozt',
  quantity: '1',
  paid: '',
  paidOn: '',
  mint: '',
  year: '',
  location: '',
  note: '',
};

function clearErrors(): void {
  for (const f of FIELDS) {
    setText(el(`err-${f.field}`), '');
    field(f.id).removeAttribute('aria-invalid');
    field(f.id).removeAttribute('aria-describedby');
  }
  const summary = el('form-error');
  setText(summary, '');
  summary.hidden = true;
}

function openForm(holding: Holding | null): void {
  editingId = holding ? holding.id : null;
  clearErrors();
  fillForm(holding ? holdingToInput(holding) : { ...BLANK, paidOn: '' });
  setText(el('form-title'), holding ? 'Edit this coin or bar' : 'Add a coin or bar');
  el('holding-form').hidden = false;
  el('add-holding').setAttribute('aria-expanded', 'true');
  el('holding-form').scrollIntoView({ block: 'nearest' });
  field('f-name').focus();
}

function closeForm(): void {
  editingId = null;
  el('holding-form').hidden = true;
  el('add-holding').setAttribute('aria-expanded', 'false');
}

/** Live readouts so a wrong reading is visible before it is saved. */
function updateReadouts(): void {
  const fine = parseFineness(field('f-fineness').value);
  setText(
    el('fineness-read'),
    field('f-fineness').value.trim() === ''
      ? 'Type 0.9999, 99.99 or 999.9.'
      : fine.ok
        ? `Read as ${formatFineness(fine.value.ppm)}, typed as a ${fine.value.reading}.`
        : fine.error,
  );
  const unit = field('f-unit').value === 'g' ? 'g' : 'ozt';
  const weight = parseWeight(field('f-weight').value, unit);
  setText(
    el('weight-read'),
    field('f-weight').value.trim() === ''
      ? 'One troy ounce is exactly 31.1034768 g.'
      : weight.ok
        ? `${formatGrams(weight.value)} g, or ${formatOzt(weight.value)} troy ounces.`
        : weight.error,
  );
}

async function submitHolding(event: Event): Promise<void> {
  event.preventDefault();
  clearErrors();
  const result = buildHolding(readForm(), editingId ?? newId(), today());
  if (!result.ok) {
    let firstId = '';
    for (const f of FIELDS) {
      const message = result.errors[f.field];
      if (!message) continue;
      setText(el(`err-${f.field}`), message);
      field(f.id).setAttribute('aria-invalid', 'true');
      field(f.id).setAttribute('aria-describedby', `err-${f.field}`);
      if (!firstId) firstId = f.id;
    }
    const summary = el('form-error');
    const n = Object.keys(result.errors).length;
    setText(summary, `${n} ${n === 1 ? 'thing needs' : 'things need'} fixing before this can be saved.`);
    summary.hidden = false;
    if (firstId) field(firstId).focus();
    return;
  }
  const saved = result.value;
  const existing = state.holdings.find((x) => x.id === saved.id);
  if (existing?.sample) saved.sample = true;
  const ok = await change(() => vault.putHolding(saved));
  if (ok) {
    closeForm();
    setText(el('holdings-status'), `${saved.name} saved.`);
  }
}

// ---------- spot prices ----------

async function submitSpots(event: Event): Promise<void> {
  event.preventDefault();
  const status = el('spot-status');
  setText(status, '');
  const toSave: Spot[] = [];
  const toDelete: Metal[] = [];
  let bad = 0;
  for (const metal of METALS) {
    setText(el(`err-spot-${metal}`), '');
    input(`spot-${metal}`).removeAttribute('aria-invalid');
    const price = input(`spot-${metal}`).value;
    if (price.trim() === '') {
      if (state.spots.some((s) => s.metal === metal)) toDelete.push(metal);
      continue;
    }
    const spot = buildSpot(metal, price, input(`spot-date-${metal}`).value, today());
    if (!spot.ok) {
      bad += 1;
      setText(el(`err-spot-${metal}`), spot.error);
      input(`spot-${metal}`).setAttribute('aria-invalid', 'true');
      continue;
    }
    const prev = state.spots.find((s) => s.metal === metal);
    // An untouched sample price stays marked as a sample.
    if (prev?.sample && prev.centsPerOzt === spot.value.centsPerOzt && prev.enteredOn === spot.value.enteredOn) spot.value.sample = true;
    toSave.push(spot.value);
  }
  if (bad > 0) {
    setText(status, `${bad} ${bad === 1 ? 'price needs' : 'prices need'} fixing. Nothing was saved.`);
    return;
  }
  const ok = await change(async () => {
    for (const s of toSave) await vault.putSpot(s);
    for (const m of toDelete) await vault.deleteSpot(m);
  });
  if (ok) setText(el('spot-status'), toSave.length + toDelete.length === 0 ? 'No changes.' : `Saved. ${toSave.length} kept, ${toDelete.length} cleared.`);
}

// ---------- backup ----------

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function exportBackup(): Promise<void> {
  const err = el('err-export');
  setText(err, '');
  setText(el('export-status'), '');
  const locked = input('lock-on').checked;
  const now = new Date();
  let text = serializeExport(buildExport(state.holdings, state.spots, now));
  let name = `coin-vault-${todayLocal(now)}.json`;
  if (locked) {
    const pass = input('lock-pass').value;
    const short = checkNewPassphrase(pass);
    if (short) return void setText(err, short);
    if (pass !== input('lock-pass2').value) return void setText(err, 'The two passphrases do not match.');
    el<HTMLButtonElement>('export-btn').disabled = true;
    setText(el('export-status'), 'Locking the file. This takes a moment.');
    try {
      text = JSON.stringify(await lockText(text, pass), null, 2);
      name = `coin-vault-${todayLocal(now)}-locked.json`;
    } catch {
      setText(err, 'Could not lock the file in this browser.');
      setText(el('export-status'), '');
      el<HTMLButtonElement>('export-btn').disabled = false;
      return;
    }
    el<HTMLButtonElement>('export-btn').disabled = false;
  }
  download(name, text);
  await change(() => vault.setLastBackup(now.toISOString()));
  setText(el('export-status'), `Saved ${name}. ${state.holdings.length} ${state.holdings.length === 1 ? 'holding' : 'holdings'}.`);
}

function resetImport(): void {
  pendingImport = null;
  pendingEncrypted = null;
  el('import-unlock').hidden = true;
  el('import-choose').hidden = true;
  input('import-pass').value = '';
  input('import-file').value = '';
}

function offerImport(vaultFile: VaultExport): void {
  pendingImport = vaultFile;
  const n = vaultFile.holdings.length;
  const s = vaultFile.spots.length;
  setText(
    el('import-summary'),
    `This file has ${n} ${n === 1 ? 'holding' : 'holdings'} and ${s} spot ${s === 1 ? 'price' : 'prices'}${vaultFile.exportedAt ? `, saved ${vaultFile.exportedAt.slice(0, 10)}` : ''}. ` +
      `You have ${state.holdings.length} here now. "Replace" deletes those first.`,
  );
  el('import-unlock').hidden = true;
  el('import-choose').hidden = false;
}

async function pickFile(): Promise<void> {
  const file = input('import-file').files?.[0];
  const err = el('err-import');
  setText(err, '');
  setText(el('import-status'), '');
  el('import-unlock').hidden = true;
  el('import-choose').hidden = true;
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) return void setText(err, 'That file is too large to be a Coin Vault backup.');
  const parsed = parseVaultText(await file.text());
  if (!parsed.ok) return void setText(err, parsed.error);
  if (parsed.value.kind === 'plain') return offerImport(parsed.value.vault);
  pendingEncrypted = parsed.value.file;
  el('import-unlock').hidden = false;
  input('import-pass').focus();
}

async function unlockImport(): Promise<void> {
  const err = el('err-import');
  setText(err, '');
  const button = el<HTMLButtonElement>('import-unlock-btn');
  button.disabled = true;
  setText(el('import-status'), 'Unlocking. This takes a moment.');
  try {
    const text = await unlockText(pendingEncrypted, input('import-pass').value);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LockError('bad-file', MESSAGES.badFile);
    }
    const checked = validateExport(json);
    if (!checked.ok) setText(err, checked.error);
    else if (checked.value.kind === 'plain') offerImport(checked.value.vault);
  } catch (error) {
    setText(err, error instanceof LockError ? error.message : MESSAGES.badFile);
  }
  setText(el('import-status'), '');
  button.disabled = false;
}

async function applyImport(mode: 'merge' | 'replace'): Promise<void> {
  const incoming = pendingImport;
  if (!incoming) return;
  const result = mode === 'replace' ? { holdings: incoming.holdings, spots: incoming.spots } : mergeVaults(state, incoming);
  const ok = await change(() => vault.replaceAll(result.holdings, result.spots));
  if (ok) {
    resetImport();
    setText(el('import-status'), `${mode === 'replace' ? 'Replaced' : 'Added'}. You now have ${result.holdings.length} ${result.holdings.length === 1 ? 'holding' : 'holdings'}.`);
  }
}

// ---------- start ----------

function wire(): void {
  el('add-holding').addEventListener('click', () => (el('holding-form').hidden ? openForm(null) : closeForm()));
  el('cancel-holding').addEventListener('click', closeForm);
  el('holding-form').addEventListener('submit', (e) => void submitHolding(e));
  el('holding-form').addEventListener('input', updateReadouts);
  el('spot-form').addEventListener('submit', (e) => void submitSpots(e));

  for (const chip of document.querySelectorAll<HTMLButtonElement>('[data-fineness]')) {
    chip.addEventListener('click', () => {
      field('f-fineness').value = chip.dataset.fineness ?? '';
      updateReadouts();
    });
  }
  for (const chip of document.querySelectorAll<HTMLButtonElement>('[data-size]')) {
    chip.addEventListener('click', () => {
      field('f-weight').value = chip.dataset.size ?? '';
      field('f-unit').value = 'ozt';
      updateReadouts();
    });
  }

  el('holding-list').addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;
    const d = button.dataset;
    if (d.edit) {
      const target = state.holdings.find((x) => x.id === d.edit);
      if (target) openForm(target);
    } else if (d.delete) {
      pendingDelete = d.delete;
      render();
      el('holding-list').querySelector<HTMLElement>(`[data-delete-yes="${CSS.escape(d.delete)}"]`)?.focus();
    } else if (d.deleteNo) {
      const id = d.deleteNo;
      pendingDelete = null;
      render();
      el('holding-list').querySelector<HTMLElement>(`[data-delete="${CSS.escape(id)}"]`)?.focus();
    } else if (d.deleteYes) {
      const id = d.deleteYes;
      pendingDelete = null;
      void change(() => vault.deleteHolding(id)).then(() => setText(el('holdings-status'), 'Deleted.'));
    }
  });

  el('load-sample').addEventListener('click', () => {
    const t = today();
    void change(async () => {
      for (const s of sampleSpots(t)) if (!state.spots.some((x) => x.metal === s.metal)) await vault.putSpot(s);
      for (const x of sampleHoldings(t)) await vault.putHolding(x);
    });
  });
  el('remove-sample').addEventListener('click', () => {
    void change(async () => {
      for (const x of state.holdings) if (x.sample) await vault.deleteHolding(x.id);
      for (const s of state.spots) if (s.sample) await vault.deleteSpot(s.metal);
    });
  });

  input('lock-on').addEventListener('change', () => {
    el('lock-fields').hidden = !input('lock-on').checked;
  });
  el('export-btn').addEventListener('click', () => void exportBackup());
  input('import-file').addEventListener('change', () => void pickFile());
  el('import-unlock-btn').addEventListener('click', () => void unlockImport());
  el('import-merge').addEventListener('click', () => void applyImport('merge'));
  el('import-replace').addEventListener('click', () => void applyImport('replace'));
  el('import-cancel').addEventListener('click', resetImport);

  const erase = (asking: boolean): void => {
    el('erase-btn').hidden = asking;
    el('erase-confirm').hidden = !asking;
    el('erase-cancel').hidden = !asking;
  };
  el('erase-btn').addEventListener('click', () => {
    erase(true);
    el('erase-cancel').focus();
  });
  el('erase-cancel').addEventListener('click', () => {
    erase(false);
    el('erase-btn').focus();
  });
  el('erase-confirm').addEventListener('click', () => {
    erase(false);
    void change(() => vault.replaceAll([], [])).then(() => setText(el('import-status'), 'Everything was erased from this browser.'));
  });

  const showSheet = (on: boolean): void => {
    el('sheet-view').hidden = !on;
    el('vault-view').hidden = on;
    if (on) el('sheet-view').scrollIntoView({ block: 'start' });
  };
  el('open-sheet').addEventListener('click', () => showSheet(true));
  el('close-sheet').addEventListener('click', () => showSheet(false));
  el('print-sheet').addEventListener('click', () => window.print());
  for (const id of ['sheet-location', 'sheet-notes']) input(id).addEventListener('change', render);
}

async function start(): Promise<void> {
  if (new URLSearchParams(location.search).has('embed')) document.documentElement.dataset.embed = '';
  wire();
  try {
    vault = await openVault();
  } catch (error) {
    showBanner(errorText(error));
    for (const id of ['vault-view', 'sheet-view']) el(id).hidden = true;
    return;
  }
  await reload();

  // The service worker is what makes the vault open with no signal. Only in the real build.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support is a bonus, not a requirement */
    });
  }
}

void start();
