// drafts.js — keep what someone typed (or the page they were on) when they move to another tab or
// page and come back. Stored in sessionStorage: only this browser tab, gone when it closes, and
// cleared on sign-out (clearDrafts). Never use it for passwords.
import { useCallback, useState } from 'react';

const PREFIX = 'srs:draft:';

// JSON that also keeps Sets (e.g. ticked modules).
const encode = (v) => JSON.stringify(v, (_, x) => (x instanceof Set ? { $set: [...x] } : x));
const decode = (s) => JSON.parse(s, (_, x) => (x && typeof x === 'object' && Array.isArray(x.$set) ? new Set(x.$set) : x));

function read(key) {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    return raw === null ? { found: false } : { found: true, value: decode(raw) };
  } catch { return { found: false }; }
}
function write(key, value) {
  try { window.sessionStorage.setItem(PREFIX + key, encode(value)); } catch { /* storage full or blocked: the draft just is not kept */ }
}
function remove(key) {
  try { window.sessionStorage.removeItem(PREFIX + key); } catch { /* nothing to remove */ }
}

const init = (initial) => (typeof initial === 'function' ? initial() : initial);

// Like useState, but what the USER changes is kept for this browser tab:
//   const [name, setName, { reset, restored }] = useDraft('student:12:name', '');
//   setName(v)    user input  -> remembered
//   reset(v)      data from the server, or after saving -> shown, and the remembered draft is dropped
//   restored      true when this value came back from an earlier visit (unsaved changes)
// When `key` changes (another record), the state switches to that key's draft or `initial`.
// `omit` lists object fields that are never stored (e.g. ['password']); they come back from `initial`.
export function useDraft(key, initial, { omit = [] } = {}) {
  const load = (k) => {
    const r = read(k);
    return { key: k, value: r.found ? (omit.length ? { ...init(initial), ...r.value } : r.value) : init(initial), restored: r.found };
  };
  const [state, setState] = useState(() => load(key));
  if (state.key !== key) setState(load(key));
  const omitted = omit.join(',');
  const set = useCallback((update) => setState((s) => {
    const value = typeof update === 'function' ? update(s.value) : update;
    if (omitted && value && typeof value === 'object') {
      const kept = { ...value };
      for (const f of omitted.split(',')) delete kept[f];
      write(s.key, kept);
    } else write(s.key, value);
    return { ...s, value };
  }), [omitted]);
  const [first] = useState(() => init(initial)); // what reset() with no value goes back to
  const reset = useCallback((value) => setState((s) => {
    remove(s.key);
    return { ...s, value: value === undefined ? first : value, restored: false };
  }), [first]);
  return [state.value, set, { reset, restored: state.restored }];
}

// True when any of `keys` has an unsaved draft (e.g. to load a record from the server only when untouched).
export const hasDraft = (...keys) => keys.some((k) => read(k).found);

// Drop drafts: all of them (sign-out), or those whose key starts with `prefix` (after saving a record).
export function clearDrafts(prefix = '') {
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(PREFIX + prefix)) window.sessionStorage.removeItem(k);
    }
  } catch { /* storage blocked */ }
}

// The last page visited in each section/tab, so going back to a tab returns to where you were.
const LAST = 'srs:last:';
export const rememberPage = (base, path) => { try { window.sessionStorage.setItem(LAST + base, path); } catch { /* ignore */ } };
export const lastPage = (base) => { try { return window.sessionStorage.getItem(LAST + base); } catch { return null; } };
export function forgetPages() {
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(LAST)) window.sessionStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}
