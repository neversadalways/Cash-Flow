/* global Calc, Store */
(function () {
  'use strict';

  let state = Store.load();
  const view = document.getElementById('view');
  const sheet = document.getElementById('sheet');
  const sheetBody = document.getElementById('sheet-body');
  const importInput = document.getElementById('import-file');
  let openMonthKey = null;

  // ---------- עיצוב מספרים ותאריכים ----------
  const nfMoney = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0, minimumFractionDigits: 0 });
  const nfPlain = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
  const fmtMonthLong = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
  const fmtMonthShort = new Intl.DateTimeFormat('he-IL', { month: 'short', year: '2-digit' });
  const fmtMonthOnly = new Intl.DateTimeFormat('he-IL', { month: 'short' });
  const fmtDayLong = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

  const clean = n => { const r = Math.round(n); return r === 0 ? 0 : r; };
  // מסירים תווי כיווניות נסתרים שהפורמט העברי מוסיף; הכיוון נקבע ב-CSS של .num
  const fmtMoney = n => nfMoney.format(clean(n)).replace(/[‎‏]/g, '');
  const money = n => `<span class="num">${fmtMoney(n)}</span>`;
  const plain = n => `<span class="num">${nfPlain.format(clean(n))}</span>`;
  const signedMoney = n => `<span class="num">${clean(n) > 0 ? '+' : ''}${fmtMoney(n)}</span>`;
  const signedPlain = n => `<span class="num">${clean(n) > 0 ? '+' : ''}${nfPlain.format(clean(n))}</span>`;
  const tone = n => (clean(n) < 0 ? 'neg' : 'pos');
  const toneT = n => (n < state.minThreshold ? 'neg' : 'pos');

  const keyToDate = (key, day) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, day || 1); };
  const monthLong = key => fmtMonthLong.format(keyToDate(key));
  const monthShort = key => fmtMonthShort.format(keyToDate(key));
  const fmtMonthName = new Intl.DateTimeFormat('he-IL', { month: 'long' });
  const monthNameOnly = key => fmtMonthName.format(keyToDate(key));
  const dayLong = (key, day) => fmtDayLong.format(keyToDate(key, day));
  const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `<span class="num">${Number(d)}/${Number(m)}/${y}</span>`; };
  const thisMonth = () => Calc.monthKey(new Date());

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function parseAmount(v) {
    if (v == null) return null;
    const s = String(v).replace(/[,\s₪]/g, '').replace(/[−–]/g, '-');
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const inputVal = n => (n == null ? '' : String(n));

  // ---------- שמירה והודעות ----------
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function commit(msg) {
    if (!Store.save(state)) toast('השמירה נכשלה. ייתכן שהאחסון במכשיר מלא.');
    else if (msg) toast(msg);
    render();
    if (sheet.open && openMonthKey) renderMonthSheet(openMonthKey);
  }

  // ---------- רכיבים משותפים ----------
  function amountField(name, label, value, opts = {}) {
    const signBtn = opts.signed
      ? `<button type="button" class="sign-btn" data-action="toggle-sign" aria-label="החלפת סימן פלוס/מינוס">±</button>`
      : '';
    return `<label class="field"><span>${label}</span>
      <div class="input-wrap">${signBtn}<input name="${name}" type="text" inputmode="decimal" autocomplete="off"
        value="${esc(inputVal(value))}" placeholder="${esc(opts.placeholder || '0')}" ${opts.required ? 'required' : ''}><span class="unit">₪</span></div></label>`;
  }
  function dayField(name, label, value) {
    return `<label class="field"><span>${label}</span>
      <input name="${name}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${esc(inputVal(value))}" required></label>`;
  }
  function monthField(name, label, value, required) {
    return `<label class="field"><span>${label}</span>
      <input name="${name}" type="month" value="${esc(value || '')}" ${required ? 'required' : ''}></label>`;
  }
  function balanceForm() {
    return `<form data-form="balance" class="stack">
      <div class="grid2">
        ${amountField('amount', 'יתרה', state.balance.amount, { signed: true, required: true })}
        <label class="field"><span>נכון לתאריך</span><input name="date" type="date" value="${esc(state.balance.date)}" required></label>
      </div>
      <button class="btn primary">שמירת יתרה</button>
    </form>`;
  }

  // ---------- גרף ----------
  function niceStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }
  function chartSvg(months, threshold) {
    if (!months.length) return '';
    const W = 360, H = 220, L = 54, R = 12, T = 14, B = 36;
    const vals = months.map(m => m.end);
    let min = Math.min(...vals, threshold);
    let max = Math.max(...vals, threshold);
    if (max - min < 1) { min -= 1000; max += 1000; }
    const step = niceStep((max - min) / 4);
    min = Math.floor(min / step) * step;
    max = Math.ceil(max / step) * step;
    const n = months.length;
    const x = i => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
    const y = v => T + ((max - v) / (max - min)) * (H - T - B);

    let grid = '';
    for (let v = min; v <= max + step / 2; v += step) {
      grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
      grid += `<text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${nfPlain.format(v)}</text>`;
    }
    const ty = y(threshold);
    const off = Math.min(1, Math.max(0, (ty - T) / (H - T - B)));
    const pts = months.map((m, i) => `${x(i).toFixed(1)},${y(m.end).toFixed(1)}`).join(' ');
    const every = n > 12 ? 2 : 1;
    const labels = months.map((m, i) => {
      if (i % every) return '';
      const d = keyToDate(m.key);
      const year = i === 0 || d.getMonth() === 0 ? `<tspan x="${x(i)}" dy="13">${String(d.getFullYear()).slice(2)}</tspan>` : '';
      return `<text class="ax" x="${x(i)}" y="${H - B + 16}" text-anchor="middle">${fmtMonthOnly.format(d)}${year}</text>`;
    }).join('');
    const dots = months.map((m, i) => `
      <circle class="dot ${m.end < threshold ? 'neg' : 'pos'}" cx="${x(i)}" cy="${y(m.end)}" r="4"/>
      <circle class="hit" cx="${x(i)}" cy="${y(m.end)}" r="15" data-action="open-month" data-key="${m.key}"><title>${monthLong(m.key)}: ${nfMoney.format(clean(m.end))}</title></circle>`).join('');

    return `<svg class="chart" viewBox="0 0 ${W} ${H}" dir="ltr" role="img" aria-label="גרף יתרה בסוף כל חודש">
      <defs><linearGradient id="lg" gradientUnits="userSpaceOnUse" x1="0" y1="${T}" x2="0" y2="${H - B}">
        <stop offset="${off}" class="stop-pos"/><stop offset="${off}" class="stop-neg"/></linearGradient></defs>
      ${grid}
      <line class="thr" x1="${L}" x2="${W - R}" y1="${ty}" y2="${ty}"/>
      <polyline class="line" points="${pts}" stroke="url(#lg)"/>
      ${dots}${labels}
    </svg>`;
  }

  // ---------- מסך סיכום ----------
  function hasData() {
    return state.salary.changes.length || state.fixed.length || state.variable.default || state.oneTime.length || state.balance.amount;
  }

  function renderSummary() {
    if (!hasData()) {
      return `<section class="card empty">
        <h2>ברוכים הבאים</h2>
        <p>כדי לראות תחזית, הזינו יתרה נוכחית, משכורת והוצאות.</p>
        <a class="btn primary" href="#data">להזנת נתונים</a>
      </section>`;
    }
    const s = Calc.summarize(state, new Date());
    const lp = s.lowestPoint;
    const lm = s.lowestMonth;
    const cur = s.current;
    let html = '';

    if (s.alert) {
      const below0 = lp.amount < 0;
      html += `<section class="alert" role="alert">
        <strong>${below0 ? 'היתרה צפויה לרדת למינוס' : 'היתרה צפויה לרדת מתחת לסף המינימום'}</strong>
        <p>${money(lp.amount)} ב-${dayLong(lp.key, lp.day)}${!below0 || s.threshold ? ` · סף: ${money(s.threshold)}` : ''}</p>
        <button class="btn danger-outline" data-action="open-month" data-key="${lp.key}">לפירוט החודש</button>
      </section>`;
    }

    html += `<section class="card hero">
      <div class="label">יתרה נוכחית</div>
      <div class="big ${tone(state.balance.amount)}">${money(state.balance.amount)}</div>
      <div class="sub">עודכנה בתאריך ${fmtDate(state.balance.date)}</div>
      <button class="btn" data-action="edit-balance">עדכון יתרה</button>
    </section>`;

    if (cur) {
      html += `<section class="card tap" data-action="open-month" data-key="${cur.key}">
        <div class="label">צפי לסוף ${monthLong(cur.key)}</div>
        <div class="mid ${toneT(cur.end)}">${money(cur.end)}</div>
        <div class="sub">נטו החודש: <span class="${tone(cur.net)}">${signedMoney(cur.net)}</span></div>
      </section>`;
    }

    if (lm) {
      html += `<section class="card tap" data-action="open-month" data-key="${lm.key}">
        <div class="label">החודש הנמוך בשנה הקרובה</div>
        <div class="mid ${toneT(lm.end)}">${money(lm.end)}</div>
        <div class="sub">${monthLong(lm.key)} (יתרה בסוף החודש)</div>
        <div class="sub">הנקודה הנמוכה ביותר: <span class="${toneT(lp.amount)}">${money(lp.amount)}</span> ב-${dayLong(lp.key, lp.day)}</div>
      </section>`;
    }
    return html;
  }

  // ---------- מסך תחזית ----------
  function renderForecast() {
    const s = Calc.summarize(state, new Date());
    const rows = s.months.map(m => `
      <tr data-action="open-month" data-key="${m.key}" class="${m.past ? 'past' : ''}">
        <th scope="row">${monthShort(m.key)}${m.partial ? '<sup>*</sup>' : ''}</th>
        <td>${plain(m.income)}${m.oneTimeIncome ? '<sup>•</sup>' : ''}${m.salaryOverridden ? '<sup>✎</sup>' : ''}</td>
        <td>${plain(m.fixed)}</td>
        <td>${plain(m.variable + m.oneTimeExpense)}${m.oneTimeExpense ? '<sup>•</sup>' : ''}${m.variableSource === 'actual' ? '<sup>✓</sup>' : ''}</td>
        <td class="${tone(m.net)}">${signedPlain(m.net)}</td>
        <td class="b ${toneT(m.end)}">${plain(m.end)}</td>
        <td class="${toneT(m.low)}">${plain(m.low)}</td>
      </tr>`).join('');
    return `
      <section class="card chart-card">
        <h2>יתרה בסוף כל חודש</h2>
        ${chartSvg(s.months, s.threshold)}
        <p class="hint">הקו המקווקו: ${s.threshold ? 'סף המינימום' : 'אפס'}. לחיצה על נקודה או על שורה פותחת את פירוט החודש, ושם אפשר לשנות את המשכורת וההוצאות המשתנות של אותו חודש.</p>
      </section>
      <section class="card flush">
        <div class="table-wrap">
          <table class="fc">
            <thead><tr><th>חודש</th><th>הכנסות</th><th>קבועות</th><th>משתנות</th><th>נטו</th><th>יתרה</th><th>נמוכה</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="legend">כל הסכומים בש"ח. "יתרה": בסוף החודש. "נמוכה": הנקודה הנמוכה במהלך החודש.<br>
          * מתאריך עדכון היתרה · • כולל חד-פעמיות · ✓ הוזן סכום בפועל · ✎ משכורת שונתה לחודש</p>
      </section>`;
  }

  // ---------- פירוט חודש ----------
  const sourceLabel = { actual: 'בפועל', override: 'הערכה לחודש זה', default: 'הערכה' };

  function renderMonthSheet(key) {
    const s = Calc.summarize(state, new Date());
    const m = s.months.find(x => x.key === key);
    if (!m) { closeSheet(); return; }
    openMonthKey = key;
    const actual = state.variable.actuals[key];
    const override = state.variable.overrides[key];
    const workKey = m.salaryMonth;
    const salaryOverride = state.salary.overrides[workKey];
    const baseSalary = Calc.salaryFor({ salary: { changes: state.salary.changes } }, workKey);
    const nextMonth = state.salary.paidNextMonth;
    // בחודש של עדכון היתרה, אם יום המשכורת כבר עבר, היא כבר כלולה ביתרה ואין מה לשנות
    const salaryPassed = m.partial && Math.min(state.salary.day, Calc.daysInMonth(key)) <= Number(state.balance.date.slice(8, 10));
    const evRows = m.events.map(ev => `
      <tr><td>${ev.type === 'oneTime' ? '—' : ev.day}</td>
        <td>${esc(ev.name)}${ev.type === 'salary' && nextMonth ? ` ${monthNameOnly(ev.workMonth)}` : ''}${ev.overridden ? ' <small>(שונתה לחודש זה)</small>' : ''}${ev.type === 'variable' ? ` <small>(${sourceLabel[ev.source]})</small>` : ''}${ev.type === 'oneTime' ? ' <small>(חד-פעמי)</small>' : ''}</td>
        <td class="${tone(ev.amount)}">${signedPlain(ev.amount)}</td>
        <td class="${toneT(ev.balance)}">${plain(ev.balance)}</td></tr>`).join('');

    sheetBody.innerHTML = `
      <h2>${monthLong(key)}</h2>
      ${m.partial ? `<p class="hint">החודש מחושב מתאריך עדכון היתרה (${fmtDate(state.balance.date)}). משכורת וקבועות עד התאריך הזה כבר כלולות ביתרה.</p>` : ''}
      <section class="sheet-box">
        <h3>${nextMonth ? `משכורת ${monthLong(workKey)} (נכנסת החודש)` : 'משכורת בחודש זה'}</h3>
        ${salaryPassed
          ? `<p class="hint">המשכורת שנכנסת החודש${nextMonth ? ` (של ${monthLong(workKey)})` : ''} כבר נכנסה לפני תאריך עדכון היתרה, ולכן היא כלולה ביתרה. אפשר לערוך משכורת בחודשים הבאים.</p>`
          : `<form data-form="month-salary" data-key="${workKey}" class="stack">
          ${amountField('amount', nextMonth ? `סכום נטו למשכורת ${monthNameOnly(workKey)} בלבד` : 'סכום נטו לחודש זה בלבד', salaryOverride, { placeholder: `רגילה: ${nfPlain.format(clean(baseSalary))}` })}
          <div class="btn-row"><button class="btn primary">שמירת משכורת</button>
            ${salaryOverride != null ? `<button type="button" class="btn" data-action="clear-salary-override" data-key="${workKey}">חזרה לרגילה</button>` : ''}</div>
          <p class="hint">לשינוי קבוע (למשל העלאה) מחודש מסוים והלאה: מסך נתונים, משכורת.</p>
        </form>`}
      </section>

      <dl class="kv">
        <dt>יתרת פתיחה</dt><dd>${money(m.start)}</dd>
        <dt>משכורת${nextMonth ? ` ${monthNameOnly(workKey)}` : ''}${m.salaryOverridden ? ' <small>(שונתה)</small>' : ''}</dt><dd class="pos">${signedMoney(m.salary)}</dd>
        <dt>הוצאות קבועות</dt><dd class="neg">${signedMoney(-m.fixed)}</dd>
        <dt>הוצאות משתנות <small>(${sourceLabel[m.variableSource]})</small></dt><dd class="neg">${signedMoney(-m.variable)}</dd>
        ${m.oneTimeIncome ? `<dt>הכנסות חד-פעמיות</dt><dd class="pos">${signedMoney(m.oneTimeIncome)}</dd>` : ''}
        ${m.oneTimeExpense ? `<dt>הוצאות חד-פעמיות</dt><dd class="neg">${signedMoney(-m.oneTimeExpense)}</dd>` : ''}
        <dt>נטו</dt><dd class="${tone(m.net)}">${signedMoney(m.net)}</dd>
        <dt class="b">יתרת סגירה</dt><dd class="b ${toneT(m.end)}">${money(m.end)}</dd>
        <dt>נקודה נמוכה</dt><dd class="${toneT(m.low)}">${money(m.low)} <small>(${m.lowDay} בחודש)</small></dd>
      </dl>

      <h3>תנועות לפי סדר</h3>
      ${m.events.length ? `<div class="table-wrap"><table class="events">
        <thead><tr><th>יום</th><th>תיאור</th><th>סכום</th><th>יתרה</th></tr></thead>
        <tbody>${evRows}</tbody></table></div>` : '<p class="hint">אין תנועות בחודש זה.</p>'}

      <h3>הוצאות משתנות בחודש זה</h3>
      <form data-form="month-actual" data-key="${key}" class="stack">
        ${amountField('amount', 'סכום בפועל (מחליף את ההערכה)', actual, { placeholder: `הערכה: ${nfPlain.format(clean(override != null ? override : state.variable.default))}` })}
        <div class="btn-row"><button class="btn primary">שמירה</button>
          ${actual != null ? `<button type="button" class="btn" data-action="clear-actual" data-key="${key}">ניקוי</button>` : ''}</div>
      </form>
      <form data-form="month-override" data-key="${key}" class="stack">
        ${amountField('amount', 'הערכה מיוחדת לחודש זה', override, { placeholder: `ברירת מחדל: ${nfPlain.format(clean(state.variable.default))}` })}
        <div class="btn-row"><button class="btn">שמירת הערכה</button>
          ${override != null ? `<button type="button" class="btn" data-action="clear-override" data-key="${key}">ניקוי</button>` : ''}</div>
      </form>`;
    if (!sheet.open) sheet.showModal();
  }

  // ---------- מסך נתונים ----------
  function rangeText(f) {
    const parts = [];
    if (f.start) parts.push(`מ-${monthShort(f.start)}`);
    parts.push(f.end ? `עד ${monthShort(f.end)}` : 'ללא סיום');
    return parts.join(' ');
  }

  function renderData() {
    const cur = thisMonth();
    const changes = state.salary.changes.slice().sort((a, b) => (a.from < b.from ? -1 : 1));
    const salaryKeys = Object.keys(state.salary.overrides).sort();
    const fixed = state.fixed.slice().sort((a, b) => a.day - b.day);
    const fixedTotal = state.fixed.filter(f => Calc.isFixedActive(f, cur)).reduce((t, f) => t + f.amount, 0);
    const v = state.variable;
    const varKeys = Array.from(new Set([...Object.keys(v.overrides), ...Object.keys(v.actuals)])).sort();
    const oneTime = state.oneTime.slice().sort((a, b) => (a.month < b.month ? -1 : 1));

    return `
      <section class="card">
        <h2>יתרה נוכחית בעו"ש</h2>
        ${balanceForm()}
      </section>

      <section class="card">
        <h2>משכורת חודשית</h2>
        <form data-form="salary-day" class="inline-form">
          ${dayField('day', 'יום כניסה בחודש', state.salary.day)}
          <button class="btn">שמירה</button>
        </form>
        <button type="button" class="switch" role="switch" aria-checked="${state.salary.paidNextMonth}" data-action="toggle-salary-next">
          <span class="switch-text"><strong>נכנסת בחודש שאחרי</strong>
            <small>משכורת ${monthNameOnly(cur)} נכנסת ב-${state.salary.day} ב${monthNameOnly(state.salary.paidNextMonth ? Calc.addMonths(cur, 1) : cur)}</small></span>
          <span class="switch-track"><span class="switch-thumb"></span></span>
        </button>
        ${changes.length ? `<ul class="list">${changes.map(c => `
          <li><div class="li-main"><div class="li-title">${money(c.amount)}</div><small>החל ${state.salary.paidNextMonth ? 'ממשכורת ' : 'מ'}${monthLong(c.from)}</small></div>
            <div class="li-actions"><button class="btn sm danger" data-action="del-salary" data-from="${c.from}">מחיקה</button></div></li>`).join('')}</ul>`
          : '<p class="hint">עדיין לא הוזנה משכורת.</p>'}
        ${salaryKeys.length ? `<h3>שינויים לחודש בודד</h3><ul class="list">${salaryKeys.map(k => `
          <li><div class="li-main"><div class="li-title">${state.salary.paidNextMonth ? 'משכורת ' : ''}${monthLong(k)}</div><small>${money(state.salary.overrides[k])} במקום הרגילה</small></div>
            <div class="li-actions"><button class="btn sm danger" data-action="clear-salary-override" data-key="${k}">מחיקה</button></div></li>`).join('')}</ul>` : ''}
        <form data-form="salary-change" class="stack">
          <div class="grid2">
            ${amountField('amount', 'סכום נטו', '', { required: true })}
            ${monthField('from', state.salary.paidNextMonth ? 'החל ממשכורת חודש' : 'החל מחודש', cur, true)}
          </div>
          <button class="btn primary">${changes.length ? 'הוספת שינוי סכום' : 'שמירת משכורת'}</button>
          ${changes.length ? '<p class="hint">להעלאה בשכר: הזינו את הסכום החדש ואת החודש שממנו הוא חל. אותו חודש מחליף את הקיים.</p>' : ''}
        </form>
      </section>

      <section class="card">
        <div class="card-head"><h2>הוצאות קבועות</h2><button class="btn sm primary" data-action="add-fixed">+ הוספה</button></div>
        ${fixed.length ? `<p class="hint">פעילות החודש: ${money(fixedTotal)}</p><ul class="list">${fixed.map(f => {
          const ended = f.end && f.end < cur;
          return `<li class="${f.paused || ended ? 'muted' : ''}">
            <div class="li-main">
              <div class="li-title">${esc(f.name)}${f.category ? ` <span class="chip">${esc(f.category)}</span>` : ''}${f.paused ? ' <span class="chip warn">מושהה</span>' : ''}${ended ? ' <span class="chip">הסתיים</span>' : ''}</div>
              <small>${f.day} בחודש · ${rangeText(f)}</small>
            </div>
            <div class="li-amount neg">${money(f.amount)}</div>
            <div class="li-actions">
              <button class="btn sm" data-action="edit-fixed" data-id="${esc(f.id)}">עריכה</button>
              <button class="btn sm" data-action="toggle-fixed" data-id="${esc(f.id)}">${f.paused ? 'חידוש' : 'השהיה'}</button>
              <button class="btn sm danger" data-action="del-fixed" data-id="${esc(f.id)}">מחיקה</button>
            </div></li>`;
        }).join('')}</ul>` : '<p class="hint">אין הוצאות קבועות. לדוגמה: שכר דירה, הלוואה, ביטוחים, מנויים.</p>'}
      </section>

      <section class="card">
        <h2>הוצאות משתנות (סוף חודש)</h2>
        <form data-form="variable-default" class="inline-form">
          ${amountField('amount', 'הערכה חודשית (ברירת מחדל)', v.default)}
          <button class="btn">שמירה</button>
        </form>
        <h3>חודשים מיוחדים וסכומים בפועל</h3>
        ${varKeys.length ? `<ul class="list">${varKeys.map(k => `
          <li><div class="li-main"><div class="li-title">${monthLong(k)}</div>
            ${v.actuals[k] != null ? `<small>בפועל: ${money(v.actuals[k])}</small>` : ''}
            ${v.overrides[k] != null ? `<small class="${v.actuals[k] != null ? 'strike' : ''}">הערכה: ${money(v.overrides[k])}</small>` : ''}</div>
            <div class="li-actions">
              ${v.actuals[k] != null ? `<button class="btn sm danger" data-action="clear-actual" data-key="${k}">מחיקת בפועל</button>` : ''}
              ${v.overrides[k] != null ? `<button class="btn sm danger" data-action="clear-override" data-key="${k}">מחיקת הערכה</button>` : ''}
            </div></li>`).join('')}</ul>` : ''}
        <form data-form="variable-month" class="stack">
          <div class="grid2">
            ${monthField('month', 'חודש', cur, true)}
            ${amountField('amount', 'סכום', '', { required: true })}
          </div>
          <div class="segmented" role="radiogroup">
            <label><input type="radio" name="kind" value="override" checked><span>הערכה לחודש</span></label>
            <label><input type="radio" name="kind" value="actual"><span>סכום בפועל</span></label>
          </div>
          <button class="btn primary">שמירה לחודש</button>
        </form>
      </section>

      <section class="card">
        <div class="card-head"><h2>פריטים חד-פעמיים</h2><button class="btn sm primary" data-action="add-onetime">+ הוספה</button></div>
        ${oneTime.length ? `<ul class="list">${oneTime.map(o => `
          <li><div class="li-main"><div class="li-title">${esc(o.name)}</div><small>${monthLong(o.month)} · ${o.kind === 'income' ? 'הכנסה' : 'הוצאה'}</small></div>
            <div class="li-amount ${o.kind === 'income' ? 'pos' : 'neg'}">${signedMoney(o.kind === 'income' ? o.amount : -o.amount)}</div>
            <div class="li-actions">
              <button class="btn sm" data-action="edit-onetime" data-id="${esc(o.id)}">עריכה</button>
              <button class="btn sm danger" data-action="del-onetime" data-id="${esc(o.id)}">מחיקה</button>
            </div></li>`).join('')}</ul>` : '<p class="hint">לדוגמה: חופשה, החזר מס, בונוס.</p>'}
      </section>`;
  }

  function fixedSheet(id) {
    const f = id ? state.fixed.find(x => x.id === id) : null;
    const cats = Array.from(new Set(state.fixed.map(x => x.category).filter(Boolean))).sort();
    sheetBody.innerHTML = `
      <h2>${f ? 'עריכת הוצאה קבועה' : 'הוצאה קבועה חדשה'}</h2>
      <form data-form="fixed" data-id="${f ? esc(f.id) : ''}" class="stack">
        <label class="field"><span>שם</span><input name="name" type="text" value="${f ? esc(f.name) : ''}" required autocomplete="off"></label>
        <div class="grid2">
          ${amountField('amount', 'סכום חודשי', f ? f.amount : '', { required: true })}
          ${dayField('day', 'יום בחודש', f ? f.day : 1)}
        </div>
        <div class="grid2">
          ${monthField('start', 'חודש התחלה', f ? f.start : thisMonth(), true)}
          ${monthField('end', 'חודש סיום (אופציונלי)', f ? f.end : '', false)}
        </div>
        <label class="field"><span>קטגוריה (אופציונלי)</span>
          <input name="category" type="text" list="cat-list" value="${f ? esc(f.category) : ''}" autocomplete="off">
          <datalist id="cat-list">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <p class="hint">חודש הסיום כלול בחישוב. השאירו ריק אם אין סיום.</p>
        <div class="btn-row"><button class="btn primary">שמירה</button><button type="button" class="btn" data-action="close-sheet">ביטול</button></div>
      </form>`;
    openMonthKey = null;
    sheet.showModal();
  }

  function oneTimeSheet(id) {
    const o = id ? state.oneTime.find(x => x.id === id) : null;
    const kind = o ? o.kind : 'expense';
    sheetBody.innerHTML = `
      <h2>${o ? 'עריכת פריט חד-פעמי' : 'פריט חד-פעמי חדש'}</h2>
      <form data-form="onetime" data-id="${o ? esc(o.id) : ''}" class="stack">
        <div class="segmented" role="radiogroup">
          <label><input type="radio" name="kind" value="expense" ${kind === 'expense' ? 'checked' : ''}><span>הוצאה</span></label>
          <label><input type="radio" name="kind" value="income" ${kind === 'income' ? 'checked' : ''}><span>הכנסה</span></label>
        </div>
        <label class="field"><span>שם</span><input name="name" type="text" value="${o ? esc(o.name) : ''}" required autocomplete="off"></label>
        <div class="grid2">
          ${amountField('amount', 'סכום', o ? o.amount : '', { required: true })}
          ${monthField('month', 'חודש', o ? o.month : thisMonth(), true)}
        </div>
        <p class="hint">לצורך ההתראה, הוצאה חד-פעמית נחשבת בתחילת החודש והכנסה בסופו.</p>
        <div class="btn-row"><button class="btn primary">שמירה</button><button type="button" class="btn" data-action="close-sheet">ביטול</button></div>
      </form>`;
    openMonthKey = null;
    sheet.showModal();
  }

  function balanceSheet() {
    sheetBody.innerHTML = `<h2>עדכון יתרה</h2>${balanceForm()}`;
    openMonthKey = null;
    sheet.showModal();
    // ברירת מחדל נוחה: עדכון להיום
    sheetBody.querySelector('input[name=date]').value = Store.todayIso();
  }

  function closeSheet() {
    openMonthKey = null;
    if (sheet.open) sheet.close();
  }

  // ---------- מסך גיבוי ----------
  function renderBackup() {
    return `
      <section class="card">
        <h2>ייצוא גיבוי</h2>
        <p>שמירת כל הנתונים לקובץ JSON. מומלץ לשמור את הקובץ בענן או לשלוח אותו לעצמכם, כי הנתונים נשמרים רק במכשיר הזה.</p>
        <button class="btn primary" data-action="export">ייצוא לקובץ</button>
      </section>
      <section class="card">
        <h2>ייבוא מקובץ</h2>
        <p>טעינת קובץ גיבוי. <strong>כל הנתונים הנוכחיים במכשיר יוחלפו</strong> בנתונים מהקובץ.</p>
        <button class="btn" data-action="import">בחירת קובץ…</button>
      </section>
      <p class="hint center">הנתונים נשמרים רק במכשיר הזה ולא נשלחים לשום מקום.</p>`;
  }

  // ---------- ניווט ----------
  const views = { summary: renderSummary, forecast: renderForecast, data: renderData, backup: renderBackup };
  const titles = { summary: 'סיכום', forecast: 'תחזית 12 חודשים', data: 'נתונים', backup: 'גיבוי' };
  const currentTab = () => { const h = location.hash.slice(1); return views[h] ? h : 'summary'; };

  function render() {
    const tab = currentTab();
    document.getElementById('title').textContent = titles[tab];
    document.title = `תזרים · ${titles[tab]}`;
    view.innerHTML = views[tab]();
    document.querySelectorAll('.tabbar a').forEach(a => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  // ---------- פעולות ----------
  const findFixed = id => state.fixed.find(f => f.id === id);
  const actions = {
    'open-month': el => renderMonthSheet(el.dataset.key),
    'close-sheet': () => closeSheet(),
    'edit-balance': () => balanceSheet(),
    'add-fixed': () => fixedSheet(null),
    'edit-fixed': el => fixedSheet(el.dataset.id),
    'toggle-fixed': el => { const f = findFixed(el.dataset.id); if (f) { f.paused = !f.paused; commit(f.paused ? 'ההוצאה הושהתה' : 'ההוצאה חודשה'); } },
    'del-fixed': el => {
      const f = findFixed(el.dataset.id);
      if (f && confirm(`למחוק את "${f.name}"?`)) { state.fixed = state.fixed.filter(x => x !== f); commit('נמחק'); }
    },
    'del-salary': el => {
      if (confirm(`למחוק את המשכורת החל מ${monthLong(el.dataset.from)}?`)) {
        state.salary.changes = state.salary.changes.filter(c => c.from !== el.dataset.from);
        commit('נמחק');
      }
    },
    'toggle-salary-next': () => { state.salary.paidNextMonth = !state.salary.paidNextMonth; commit('נשמר'); },
    'clear-salary-override': el => { delete state.salary.overrides[el.dataset.key]; commit('המשכורת חזרה לסכום הרגיל'); },
    'clear-actual': el => { delete state.variable.actuals[el.dataset.key]; commit('הסכום בפועל נמחק'); },
    'clear-override': el => { delete state.variable.overrides[el.dataset.key]; commit('ההערכה נמחקה'); },
    'add-onetime': () => oneTimeSheet(null),
    'edit-onetime': el => oneTimeSheet(el.dataset.id),
    'del-onetime': el => {
      const o = state.oneTime.find(x => x.id === el.dataset.id);
      if (o && confirm(`למחוק את "${o.name}"?`)) { state.oneTime = state.oneTime.filter(x => x !== o); commit('נמחק'); }
    },
    'toggle-sign': el => {
      const input = el.parentElement.querySelector('input');
      const v = input.value.trim();
      input.value = v.startsWith('-') ? v.slice(1) : '-' + v;
      input.focus();
    },
    'export': () => {
      const blob = new Blob([Store.toBackup(state)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `tazrim-backup-${Store.todayIso()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },
    'import': () => { importInput.value = ''; importInput.click(); }
  };

  const fail = msg => { toast(msg); return false; };
  const validDay = d => Number.isInteger(d) && d >= 1 && d <= 31;

  const forms = {
    balance: (fd) => {
      const amount = parseAmount(fd.get('amount'));
      const date = fd.get('date');
      if (amount === null) return fail('נא להזין סכום תקין');
      if (!date) return fail('נא לבחור תאריך');
      state.balance = { amount, date };
      return 'היתרה עודכנה';
    },
    'salary-day': (fd) => {
      const day = Number(fd.get('day'));
      if (!validDay(day)) return fail('יום בחודש: מספר בין 1 ל-31');
      state.salary.day = day;
      return 'נשמר';
    },
    'salary-change': (fd) => {
      const amount = parseAmount(fd.get('amount'));
      const from = fd.get('from');
      if (amount === null || amount < 0) return fail('נא להזין סכום תקין');
      if (!from) return fail('נא לבחור חודש');
      state.salary.changes = state.salary.changes.filter(c => c.from !== from).concat({ from, amount });
      return 'המשכורת נשמרה';
    },
    fixed: (fd, form) => {
      const name = String(fd.get('name') || '').trim();
      const amount = parseAmount(fd.get('amount'));
      const day = Number(fd.get('day'));
      const start = fd.get('start') || null;
      const end = fd.get('end') || null;
      if (!name) return fail('נא להזין שם');
      if (amount === null || amount <= 0) return fail('נא להזין סכום חיובי');
      if (!validDay(day)) return fail('יום בחודש: מספר בין 1 ל-31');
      if (!start) return fail('נא לבחור חודש התחלה');
      if (end && end < start) return fail('חודש הסיום לפני חודש ההתחלה');
      const data = { name, amount, day, start, end, category: String(fd.get('category') || '').trim() };
      const existing = form.dataset.id && findFixed(form.dataset.id);
      if (existing) Object.assign(existing, data);
      else state.fixed.push(Object.assign({ id: Store.uid(), paused: false }, data));
      closeSheet();
      return 'נשמר';
    },
    'variable-default': (fd) => {
      const amount = parseAmount(fd.get('amount'));
      if (amount !== null && amount < 0) return fail('נא להזין סכום חיובי');
      state.variable.default = amount || 0;
      return 'נשמר';
    },
    'variable-month': (fd) => {
      const month = fd.get('month');
      const amount = parseAmount(fd.get('amount'));
      if (!month) return fail('נא לבחור חודש');
      if (amount === null || amount < 0) return fail('נא להזין סכום תקין');
      state.variable[fd.get('kind') === 'actual' ? 'actuals' : 'overrides'][month] = amount;
      return 'נשמר';
    },
    'month-salary': (fd, form) => {
      const amount = parseAmount(fd.get('amount'));
      if (amount === null) { delete state.salary.overrides[form.dataset.key]; return 'המשכורת חזרה לסכום הרגיל'; }
      if (amount < 0) return fail('נא להזין סכום חיובי');
      state.salary.overrides[form.dataset.key] = amount;
      return 'המשכורת לחודש נשמרה';
    },
    'month-actual': (fd, form) => {
      const amount = parseAmount(fd.get('amount'));
      if (amount === null) { delete state.variable.actuals[form.dataset.key]; return 'הסכום בפועל נמחק'; }
      if (amount < 0) return fail('נא להזין סכום חיובי');
      state.variable.actuals[form.dataset.key] = amount;
      return 'הסכום בפועל נשמר';
    },
    'month-override': (fd, form) => {
      const amount = parseAmount(fd.get('amount'));
      if (amount === null) { delete state.variable.overrides[form.dataset.key]; return 'ההערכה נמחקה'; }
      if (amount < 0) return fail('נא להזין סכום חיובי');
      state.variable.overrides[form.dataset.key] = amount;
      return 'ההערכה נשמרה';
    },
    onetime: (fd, form) => {
      const name = String(fd.get('name') || '').trim();
      const amount = parseAmount(fd.get('amount'));
      const month = fd.get('month');
      if (!name) return fail('נא להזין שם');
      if (amount === null || amount <= 0) return fail('נא להזין סכום חיובי');
      if (!month) return fail('נא לבחור חודש');
      const data = { name, amount, month, kind: fd.get('kind') === 'income' ? 'income' : 'expense' };
      const existing = form.dataset.id && state.oneTime.find(x => x.id === form.dataset.id);
      if (existing) Object.assign(existing, data);
      else state.oneTime.push(Object.assign({ id: Store.uid() }, data));
      closeSheet();
      return 'נשמר';
    }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    e.preventDefault();
    actions[el.dataset.action](el);
  });

  document.addEventListener('submit', e => {
    const form = e.target;
    const handler = forms[form.dataset.form];
    if (!handler) return;
    e.preventDefault();
    const fromSheet = sheet.contains(form);
    const msg = handler(new FormData(form), form);
    if (msg === false) return;
    if (fromSheet && form.dataset.form === 'balance') closeSheet();
    if (document.activeElement) document.activeElement.blur();
    commit(msg);
  });

  // לחיצה על הרקע מחוץ לגיליון סוגרת אותו
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  sheet.addEventListener('close', () => { openMonthKey = null; });

  importInput.addEventListener('change', () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const next = Store.fromBackup(String(reader.result));
        if (!confirm('הייבוא יחליף את כל הנתונים הנוכחיים במכשיר. להמשיך?')) return;
        state = next;
        commit('הנתונים יובאו בהצלחה');
      } catch (err) {
        toast(err.message);
      }
    };
    reader.onerror = () => toast('לא ניתן לקרוא את הקובץ');
    reader.readAsText(file);
  });

  window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); });

  // עדכון כשחוזרים לאפליקציה (למשל ביום אחר או אחרי עריכה בלשונית אחרת)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { state = Store.load(); render(); }
  });

  render();
  Store.requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // כשגרסה חדשה מותקנת, טוענים מחדש מיד במקום לחכות לפתיחה הבאה
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      // אפליקציה מותקנת נשארת לפעמים פתוחה ברקע, אז בודקים עדכון בכל חזרה אליה
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  }
})();
