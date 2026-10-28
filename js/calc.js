/*
 * לוגיקת חישוב התזרים.
 * פונקציות טהורות בלבד (בלי DOM ובלי אחסון), כדי שאפשר יהיה לבדוק אותן בנפרד.
 * חודשים מיוצגים כמחרוזת "YYYY-MM", תאריכים כ-"YYYY-MM-DD".
 */
(function (root) {
  'use strict';

  function pad(n) { return String(n).padStart(2, '0'); }
  function monthKey(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1); }
  function isoDate(date) { return monthKey(date) + '-' + pad(date.getDate()); }
  function addMonths(key, n) {
    const [y, m] = key.split('-').map(Number);
    const total = y * 12 + (m - 1) + n;
    return Math.floor(total / 12) + '-' + pad((total % 12) + 1);
  }
  function daysInMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }
  function round2(x) { return Math.round(x * 100) / 100; }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

  // המשכורת בתוקף בחודש: השינוי האחרון שתחילתו לא אחרי החודש.
  function salaryFor(state, key) {
    const changes = ((state.salary && state.salary.changes) || [])
      .filter(c => c.from <= key)
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    return changes.length ? num(changes[changes.length - 1].amount) : 0;
  }

  function isFixedActive(item, key) {
    return !item.paused && (!item.start || item.start <= key) && (!item.end || key <= item.end);
  }

  // סדר עדיפות: סכום בפועל, אחר כך הערכה מיוחדת לחודש, אחר כך ברירת המחדל.
  function variableFor(state, key) {
    const v = state.variable || {};
    if (v.actuals && v.actuals[key] != null) return { amount: num(v.actuals[key]), source: 'actual' };
    if (v.overrides && v.overrides[key] != null) return { amount: num(v.overrides[key]), source: 'override' };
    return { amount: num(v.default), source: 'default' };
  }

  /*
   * התנועות של חודש אחד, ממוינות לפי סדר התרחשות.
   * afterDay: בחודש של עדכון היתרה נספרות רק משכורת וקבועות שהיום שלהן אחרי יום העדכון
   * (מה שקרה עד אז כבר כלול ביתרה). משתנות וחד-פעמיות נספרות תמיד.
   * כדי שההתראה תהיה זהירה: חד-פעמית של הוצאה נחשבת בתחילת החודש,
   * חד-פעמית של הכנסה בסוף החודש, והמשתנות ביום האחרון של החודש.
   */
  function monthEvents(state, key, afterDay) {
    const dim = daysInMonth(key);
    const clampDay = d => Math.min(Math.max(1, Math.round(num(d)) || 1), dim);
    const events = [];

    const salary = salaryFor(state, key);
    if (salary) {
      const day = clampDay(state.salary.day);
      if (day > afterDay) events.push({ type: 'salary', name: 'משכורת', day, order: day, amount: Math.abs(salary) });
    }

    (state.fixed || []).forEach(f => {
      if (!isFixedActive(f, key)) return;
      const day = clampDay(f.day);
      if (day > afterDay) {
        events.push({ type: 'fixed', id: f.id, name: f.name, category: f.category || '', day, order: day, amount: -Math.abs(num(f.amount)) });
      }
    });

    (state.oneTime || []).forEach(o => {
      if (o.month !== key) return;
      const income = o.kind === 'income';
      events.push({
        type: 'oneTime', id: o.id, name: o.name, kind: income ? 'income' : 'expense',
        day: income ? dim : Math.min(afterDay + 1, dim),
        order: income ? dim + 1 : 0,
        amount: income ? Math.abs(num(o.amount)) : -Math.abs(num(o.amount))
      });
    });

    const variable = variableFor(state, key);
    if (variable.amount) {
      events.push({ type: 'variable', name: 'הוצאות משתנות', source: variable.source, day: dim, order: dim + 0.5, amount: -Math.abs(variable.amount) });
    }

    // באותו יום: הוצאות לפני הכנסות (הערכה זהירה של הנקודה הנמוכה).
    events.sort((a, b) => a.order - b.order || a.amount - b.amount);
    return { events, variable };
  }

  /*
   * תחזית מחודש עדכון היתרה ועד 11 חודשים אחרי החודש הנוכחי.
   * אם היתרה עודכנה לפני כמה חודשים, החודשים שעברו מחושבים גם הם
   * (ושם סכום בפועל של משתנות מחליף את ההערכה).
   */
  function forecast(state, today) {
    today = today || new Date();
    const todayKey = monthKey(today);
    const bDate = (state.balance && state.balance.date) || isoDate(today);
    const startKey = bDate.slice(0, 7);
    const afterDay = Number(bDate.slice(8, 10)) || 0;
    let endKey = addMonths(todayKey, 11);
    if (addMonths(startKey, 11) > endKey) endKey = addMonths(startKey, 11);

    let balance = round2(num(state.balance && state.balance.amount));
    const months = [];
    for (let key = startKey; key <= endKey; key = addMonths(key, 1)) {
      const first = key === startKey;
      const { events, variable } = monthEvents(state, key, first ? afterDay : 0);
      const m = {
        key, start: balance, salary: 0, fixed: 0, variable: 0, variableSource: variable.source,
        oneTimeIncome: 0, oneTimeExpense: 0, partial: first && afterDay > 0, past: key < todayKey,
        events, low: null, lowDay: null
      };
      events.forEach(ev => {
        balance = round2(balance + ev.amount);
        ev.balance = balance;
        if (ev.type === 'salary') m.salary += ev.amount;
        else if (ev.type === 'fixed') m.fixed -= ev.amount;
        else if (ev.type === 'variable') m.variable -= ev.amount;
        else if (ev.amount > 0) m.oneTimeIncome += ev.amount;
        else m.oneTimeExpense -= ev.amount;
        if (m.low === null || balance < m.low) { m.low = balance; m.lowDay = ev.day; }
      });
      if (m.low === null) { m.low = balance; m.lowDay = daysInMonth(key); }
      ['salary', 'fixed', 'variable', 'oneTimeIncome', 'oneTimeExpense'].forEach(k => { m[k] = round2(m[k]); });
      m.income = round2(m.salary + m.oneTimeIncome);
      m.end = balance;
      m.net = round2(balance - m.start);
      months.push(m);
    }
    return months;
  }

  function summarize(state, today) {
    today = today || new Date();
    const todayKey = monthKey(today);
    const months = forecast(state, today);
    const threshold = num(state.minThreshold);
    const ahead = months.filter(m => m.key >= todayKey).slice(0, 12);
    const current = months.find(m => m.key === todayKey) || ahead[0] || null;
    let lowestMonth = null;
    let lowestPoint = null;
    ahead.forEach(m => {
      if (!lowestMonth || m.end < lowestMonth.end) lowestMonth = m;
      if (!lowestPoint || m.low < lowestPoint.amount) lowestPoint = { amount: m.low, key: m.key, day: m.lowDay };
    });
    return {
      months, todayKey, threshold, current, lowestMonth, lowestPoint,
      alert: !!lowestPoint && lowestPoint.amount < threshold
    };
  }

  const api = { monthKey, isoDate, addMonths, daysInMonth, salaryFor, isFixedActive, variableFor, monthEvents, forecast, summarize };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this);
