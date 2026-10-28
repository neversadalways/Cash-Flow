/*
 * שמירת הנתונים במכשיר (localStorage), ייצוא וייבוא JSON.
 * שום דבר לא נשלח החוצה.
 */
(function (root) {
  'use strict';

  const KEY = 'tazrim.v1';

  function pad(n) { return String(n).padStart(2, '0'); }
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function defaultState() {
    return {
      version: 1,
      minThreshold: 0,
      balance: { amount: 0, date: todayIso() },
      salary: { day: 10, paidNextMonth: true, changes: [], overrides: {} },
      fixed: [],
      variable: { default: 0, overrides: {}, actuals: {} },
      oneTime: []
    };
  }

  const isMonth = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const arr = a => (Array.isArray(a) ? a : []);
  const num = (v, def) => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? n : def; };
  const day = (v, def) => { const n = Math.round(num(v, def)); return n >= 1 && n <= 31 ? n : def; };
  const monthMap = o => {
    const out = {};
    if (o && typeof o === 'object') {
      Object.keys(o).forEach(k => { const n = num(o[k], null); if (isMonth(k) && n !== null) out[k] = n; });
    }
    return out;
  };

  // מנרמל כל קלט (מהאחסון או מקובץ גיבוי) למבנה תקין.
  function normalize(raw) {
    const d = defaultState();
    if (!raw || typeof raw !== 'object') return d;
    const b = raw.balance || {};
    const s = raw.salary || {};
    const v = raw.variable || {};
    return {
      version: 1,
      minThreshold: num(raw.minThreshold, 0),
      balance: { amount: num(b.amount, 0), date: isDate(b.date) ? b.date : d.balance.date },
      salary: {
        day: day(s.day, 10),
        // ברירת מחדל: משכורת החודש נכנסת בחודש שאחרי (הנפוץ בישראל)
        paidNextMonth: s.paidNextMonth === undefined ? true : !!s.paidNextMonth,
        changes: arr(s.changes).filter(c => c && isMonth(c.from)).map(c => ({ from: c.from, amount: Math.abs(num(c.amount, 0)) })),
        overrides: monthMap(s.overrides)
      },
      fixed: arr(raw.fixed).filter(f => f && typeof f.name === 'string').map(f => ({
        id: f.id ? String(f.id) : uid(),
        name: f.name,
        amount: Math.abs(num(f.amount, 0)),
        day: day(f.day, 1),
        start: isMonth(f.start) ? f.start : null,
        end: isMonth(f.end) ? f.end : null,
        category: typeof f.category === 'string' ? f.category : '',
        paused: !!f.paused
      })),
      variable: { default: Math.abs(num(v.default, 0)), overrides: monthMap(v.overrides), actuals: monthMap(v.actuals) },
      oneTime: arr(raw.oneTime).filter(o => o && isMonth(o.month)).map(o => ({
        id: o.id ? String(o.id) : uid(),
        name: String(o.name || ''),
        amount: Math.abs(num(o.amount, 0)),
        kind: o.kind === 'income' ? 'income' : 'expense',
        month: o.month
      }))
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : defaultState();
    } catch (e) {
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  function toBackup(state) {
    return JSON.stringify(Object.assign({ app: 'tazrim', exportedAt: new Date().toISOString() }, state), null, 2);
  }

  // זורק שגיאה עם הודעה בעברית אם הקובץ לא נראה כמו גיבוי של האפליקציה.
  function fromBackup(text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('הקובץ אינו קובץ JSON תקין.'); }
    if (!raw || typeof raw !== 'object' || (raw.app !== 'tazrim' && !(raw.balance && raw.salary))) {
      throw new Error('הקובץ אינו גיבוי של אפליקציית התזרים.');
    }
    return normalize(raw);
  }

  // מבקש מהדפדפן לא למחוק את האחסון של האתר כשהמקום במכשיר מתמלא.
  function requestPersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) { /* לא נתמך */ }
  }

  const api = { KEY, defaultState, normalize, load, save, toBackup, fromBackup, requestPersistence, uid, todayIso };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof self !== 'undefined' ? self : this);
