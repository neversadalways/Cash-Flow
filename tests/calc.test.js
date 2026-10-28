/*
 * בדיקות ללוגיקת החישוב. רצות בדפדפן (tests/index.html) או ב-Node: node tests/calc.test.js
 */
(function (root) {
  'use strict';
  const Calc = root.Calc || require('../js/calc.js');
  const results = [];
  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e.message }); }
  }
  function eq(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${msg || ''} expected ${b}, got ${a}`);
  }

  // נתוני דוגמה: היום 28/10/2026
  const today = new Date(2026, 9, 28);
  function sample() {
    return {
      minThreshold: 0,
      balance: { amount: 10000, date: '2026-10-28' },
      salary: { day: 10, changes: [{ from: '2026-01', amount: 12000 }, { from: '2027-03', amount: 13000 }] },
      fixed: [
        { id: 'rent', name: 'שכר דירה', amount: 4500, day: 1, start: '2026-01', end: null },
        { id: 'loan', name: 'הלוואה', amount: 1000, day: 15, start: '2026-01', end: '2027-03' }, // מסתיימת באמצע השנה
        { id: 'gym', name: 'חדר כושר', amount: 200, day: 5, start: '2026-01', end: null, paused: true },
        { id: 'phone', name: 'סלולר', amount: 100, day: 31, start: '2026-01', end: null }, // יום 31 בחודש קצר
        { id: 'ins', name: 'ביטוח', amount: 300, day: 20, start: '2027-01', end: null } // מתחילה בעתיד
      ],
      variable: { default: 4000, overrides: { '2026-12': 6000 }, actuals: { '2026-10': 3500 } },
      oneTime: [
        { id: 'tax', name: 'החזר מס', amount: 2500, kind: 'income', month: '2027-04' },
        { id: 'trip', name: 'חופשה', amount: 8000, kind: 'expense', month: '2027-07' }
      ]
    };
  }

  test('addMonths חוצה שנים', () => {
    eq(Calc.addMonths('2026-12', 1), '2027-01');
    eq(Calc.addMonths('2027-01', -1), '2026-12');
    eq(Calc.addMonths('2026-10', 11), '2027-09');
  });

  test('12 חודשים מאוקטובר 2026 עד ספטמבר 2027', () => {
    const m = Calc.forecast(sample(), today);
    eq(m.length, 12);
    eq(m[0].key, '2026-10');
    eq(m[11].key, '2027-09');
  });

  test('יתרות סוף חודש לפי חישוב ידני', () => {
    const ends = Calc.forecast(sample(), today).map(m => m.end);
    eq(ends, [6400, 8800, 9200, 11300, 13400, 16500, 23100, 27200, 31300, 27400, 31500, 35600]);
  });

  test('חודש נוכחי חלקי: רק תנועות אחרי 28/10, ומשתנות בפועל (3,500) במקום הערכה', () => {
    const oct = Calc.forecast(sample(), today)[0];
    eq(oct.partial, true);
    eq(oct.salary, 0, 'משכורת של ה-10 כבר ביתרה');
    eq(oct.fixed, 100, 'רק הסלולר ב-31');
    eq(oct.variable, 3500);
    eq(oct.variableSource, 'actual');
  });

  test('דריסת משתנות בדצמבר (6,000 במקום 4,000)', () => {
    const dec = Calc.forecast(sample(), today).find(m => m.key === '2026-12');
    eq(dec.variable, 6000);
    eq(dec.variableSource, 'override');
    eq(dec.net, 12000 - 4500 - 1000 - 100 - 6000);
  });

  test('הלוואה שמסתיימת במרץ 2027: נספרת במרץ, לא באפריל', () => {
    const m = Calc.forecast(sample(), today);
    const mar = m.find(x => x.key === '2027-03');
    const apr = m.find(x => x.key === '2027-04');
    eq(mar.events.some(e => e.id === 'loan'), true);
    eq(apr.events.some(e => e.id === 'loan'), false);
    eq(mar.fixed, 4500 + 1000 + 300 + 100);
    eq(apr.fixed, 4500 + 300 + 100);
  });

  test('העלאה במשכורת ממרץ 2027', () => {
    const m = Calc.forecast(sample(), today);
    eq(m.find(x => x.key === '2027-02').salary, 12000);
    eq(m.find(x => x.key === '2027-03').salary, 13000);
  });

  test('שינוי משכורת לחודש בודד (ינואר 2027) לא משפיע על החודשים שאחריו', () => {
    const st = sample();
    st.salary.overrides = { '2027-01': 9000, '2027-03': 0 };
    const m = Calc.forecast(st, today);
    const jan = m.find(x => x.key === '2027-01');
    eq([jan.salary, jan.salaryOverridden, jan.end], [9000, true, 11300 - 3000]);
    eq(m.find(x => x.key === '2027-02').salary, 12000);
    eq(m.find(x => x.key === '2027-03').salary, 0, 'חודש בלי משכורת');
    eq(m.find(x => x.key === '2027-04').salary, 13000, 'ההעלאה ממרץ ממשיכה באפריל');
  });

  test('הוצאה מושהית לא נספרת, הוצאה עתידית מתחילה בינואר', () => {
    const m = Calc.forecast(sample(), today);
    eq(m.some(x => x.events.some(e => e.id === 'gym')), false);
    eq(m.find(x => x.key === '2026-12').events.some(e => e.id === 'ins'), false);
    eq(m.find(x => x.key === '2027-01').events.some(e => e.id === 'ins'), true);
  });

  test('יום 31 עובר ליום האחרון בחודש קצר', () => {
    const feb = Calc.forecast(sample(), today).find(m => m.key === '2027-02');
    eq(feb.events.find(e => e.id === 'phone').day, 28);
  });

  test('חד-פעמיות: הכנסה באפריל, הוצאה ביולי', () => {
    const m = Calc.forecast(sample(), today);
    const apr = m.find(x => x.key === '2027-04');
    const jul = m.find(x => x.key === '2027-07');
    eq([apr.oneTimeIncome, apr.income], [2500, 15500]);
    eq([jul.oneTimeExpense, jul.net], [8000, -3900]);
  });

  test('נקודה נמוכה בתוך החודש: 1/11 אחרי שכר דירה ולפני משכורת', () => {
    const s = Calc.summarize(sample(), today);
    eq(s.lowestPoint, { amount: 1900, key: '2026-11', day: 1 });
    eq(s.lowestMonth.key, '2026-10');
    eq(s.current.end, 6400);
    eq(s.alert, false);
  });

  test('התראה כשהנקודה הנמוכה מתחת לסף', () => {
    const st = sample();
    st.minThreshold = 2000;
    eq(Calc.summarize(st, today).alert, true);
  });

  test('יתרה ישנה (15/9): ספטמבר מחושב עם סכום בפועל, ומינוס ב-1/10 מעורר התראה', () => {
    const st = sample();
    st.balance = { amount: 5000, date: '2026-09-15' };
    st.variable.actuals['2026-09'] = 3000;
    const s = Calc.summarize(st, today);
    eq(s.months.length, 13);
    eq(s.months[0].key, '2026-09');
    eq(s.months[0].past, true);
    eq(s.months[0].end, 1900);
    eq(s.months[1].low, -2600);
    eq(s.months[1].end, 4800);
    eq(s.lowestPoint, { amount: -2600, key: '2026-10', day: 1 });
    eq(s.alert, true);
  });

  test('נתונים ריקים לא קורסים', () => {
    const s = Calc.summarize({ balance: { amount: 0, date: '2026-10-28' } }, today);
    eq(s.months.length, 12);
    eq(s.months.every(m => m.end === 0), true);
  });

  const failed = results.filter(r => !r.ok);
  if (typeof document !== 'undefined') {
    document.getElementById('out').innerHTML =
      `<p id="summary">${results.length - failed.length}/${results.length} passed</p><ul>` +
      results.map(r => `<li class="${r.ok ? 'ok' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ' — ' + r.error}</li>`).join('') + '</ul>';
  } else {
    results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ' — ' + r.error}`));
    console.log(`${results.length - failed.length}/${results.length} passed`);
    if (failed.length) process.exitCode = 1;
  }
})(typeof self !== 'undefined' ? self : this);
