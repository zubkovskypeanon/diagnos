// ---------- Состояние ----------
const state = {
  nosologyId: null,
  data: null,
  pageIndex: -1, // -1 = экран выбора нозологии
  answers: {},
  icdPageOpen: false // отдельный экран выбора кода МКБ, поверх текущей pageIndex-страницы
};

const root = document.getElementById('app');

// ---------- Загрузка данных ----------
async function loadIndex() {
  const res = await fetch('js/data/index.json');
  return res.json();
}

async function loadNosology(file) {
  const res = await fetch('js/data/' + file);
  return res.json();
}

// ---------- Таблица риска (Приложение 6, КР "Артериальная гипертензия у взрослых" 2024) ----------
// Возвращает { value } для однозначной ячейки, { candidates: [...] } для вилки,
// или null, если подсказку по имеющимся данным построить нельзя.
function suggestRisk(stage, degree) {
  if (stage === 'III') return { value: 4 };
  if (stage === 'II') {
    if (degree === 1) return { value: 3 };
    if (degree === 2) return { value: 3 };
    if (degree === 3) return { candidates: [3, 4] };
    return null; // статус "на терапии" без явной степени — таблица не применима напрямую
  }
  // Стадия I: ячейка зависит от количества ФР, которые отмечаются позже (на странице находок).
  // На этом этапе мастера данных ещё нет — подсказку не строим, показываем только таблицу.
  return null;
}

// ---------- Условная видимость страниц (skipIf) и подавление текста (suppressDiagnosisIf) ----------
// Общий механизм: условие всегда ссылается на УЖЕ отвеченную страницу ({page, in}),
// поэтому не требует знания о порядке страниц конкретной нозологии.
function conditionMet(cond) {
  if (!cond) return false;
  return cond.in.includes(state.answers[cond.page]);
}

function isPageSkipped(page) {
  return !!(page.skipIf && conditionMet(page.skipIf));
}

function nextVisibleIndex(fromIndex) {
  let idx = fromIndex + 1;
  while (idx < state.data.pages.length && isPageSkipped(state.data.pages[idx])) idx++;
  return idx;
}

function prevVisibleIndex(fromIndex) {
  let idx = fromIndex - 1;
  while (idx >= 0 && isPageSkipped(state.data.pages[idx])) idx--;
  return idx;
}

function isEffectivelyLastPage(index) {
  for (let i = index + 1; i < state.data.pages.length; i++) {
    if (!isPageSkipped(state.data.pages[i])) return false;
  }
  return true;
}

// ---------- Рендер: список нозологий ----------
function renderNosologyList(list) {
  root.innerHTML = '';
  const header = el('div', 'header');
  header.innerHTML = '<p class="eyebrow">Формулировка диагноза</p><h1>Выбери нозологию</h1>';
  root.appendChild(header);

  const listEl = el('div', 'stack');
  list.forEach(item => {
    const card = el('div', 'card option' + (item.ready ? '' : ' disabled'));
    card.innerHTML = `<span class="option-label">${item.name}</span>` +
      (item.ready ? '<i class="ti ti-chevron-right"></i>' : '<span class="badge">скоро</span>');
    if (item.ready) {
      card.onclick = () => openNosology(item);
    }
    listEl.appendChild(card);
  });
  root.appendChild(listEl);
}

async function openNosology(item) {
  state.data = await loadNosology(item.file);
  state.nosologyId = item.id;
  state.pageIndex = 0;
  state.answers = {};
  state.icdPageOpen = false;
  renderPage();
}

// ---------- Рендер: страница мастера ----------
function renderPage() {
  if (state.icdPageOpen) { renderIcdPage(); return; }
  const page = state.data.pages[state.pageIndex];
  root.innerHTML = '';

  root.appendChild(renderBreadcrumbs());

  const header = el('div', 'header');
  header.innerHTML = `<p class="eyebrow">${state.data.name}</p><h1>${page.title}</h1>`;
  root.appendChild(header);

  if (page.type === 'single') {
    root.appendChild(renderSingle(page));
  } else if (page.type === 'single_grouped') {
    root.appendChild(renderSingleGrouped(page));
  } else if (page.type === 'multi') {
    root.appendChild(renderMulti(page));
  }

  // Результат показываем на последней СТРАНИЦЕ С УЧЁТОМ skipIf, а не по типу страницы —
  // у ХСН последняя видимая страница (ФК) типа 'single', а не 'multi', как было у ГБ.
  if (isEffectivelyLastPage(state.pageIndex)) {
    root.appendChild(renderResultBlock());
  }

  root.appendChild(renderNav(page));
}

function renderBreadcrumbs() {
  const wrap = el('div', 'breadcrumbs');
  state.data.pages.forEach(page => {
    if (isPageSkipped(page)) return;
    let label = null;
    if (page.type === 'single') {
      const val = state.answers[page.id];
      const opt = page.options.find(o => o.id === val);
      if (opt) label = opt.label;
    } else if (page.type === 'single_grouped') {
      if (state.answers.degreeStatus) label = state.answers.degreeStatus.label;
    }
    if (label) {
      const chip = el('span', 'chip');
      chip.textContent = label;
      wrap.appendChild(chip);
    }
  });
  return wrap;
}

function renderSingle(page) {
  const wrap = el('div', 'stack');

  if (page.note) {
    const staticNote = el('div', 'note');
    staticNote.innerHTML = `<i class="ti ti-info-circle"></i><span>${page.note}</span>`;
    wrap.appendChild(staticNote);
  }

  const isRiskPage = page.id === 'risk';
  let suggestion = null;
  if (isRiskPage) {
    const degree = state.answers.degreeStatus && state.answers.degreeStatus.degree;
    const contextKey = state.answers.stage + '|' + degree;
    suggestion = suggestRisk(state.answers.stage, degree);
    // Пересчитываем подсказку заново при каждой смене стадии/степени (например, если врач
    // вернулся назад и поменял ответ) — иначе устаревшее значение риска молча остаётся выбранным.
    if (state.answers._riskContextKey !== contextKey) {
      state.answers._riskContextKey = contextKey;
      state.answers.risk = (suggestion && suggestion.value) ? suggestion.value : undefined;
    }
  }

  if (isRiskPage && suggestion) {
    const note = el('div', 'note');
    if (suggestion.value) {
      note.innerHTML = `<i class="ti ti-info-circle"></i><span>Для выбранной стадии и степени таблица даёт однозначный риск. Вариант предзаполнен, можно изменить вручную.</span>`;
    } else if (suggestion.candidates) {
      note.innerHTML = `<i class="ti ti-info-circle"></i><span>Таблица даёт вилку: риск ${suggestion.candidates.join(' или ')}. Выбери подходящий вариант вручную.</span>`;
    }
    wrap.appendChild(note);
  } else if (isRiskPage && state.answers.stage === 'I') {
    const note = el('div', 'note');
    note.innerHTML = `<i class="ti ti-info-circle"></i><span>Для стадии I риск зависит от числа факторов риска — они отмечаются на следующей странице. Выбери риск по таблице ниже вручную.</span>`;
    wrap.appendChild(note);
  } else if (isRiskPage) {
    const note = el('div', 'note');
    note.innerHTML = `<i class="ti ti-info-circle"></i><span>Готовой подсказки для этой комбинации нет — ориентируйся на таблицу ниже и выбери риск вручную.</span>`;
    wrap.appendChild(note);
  }

  // Калькулятор СКФ по CKD-EPI 2009 (Приложение Г, п.7 КР "Хроническая болезнь почек"
  // 2024) — легаси-механизм по образцу SCORE2 у ГБ (жёстко привязан к page.id, не
  // завязан на generic-схему). Формула дана в КР только для пациентов европеоидной
  // расы — коэффициента для других рас КР не приводит, поэтому калькулятор о расе не
  // спрашивает и не применяет его. Только считает и подсказывает стадию — вариант
  // ниже выбирает врач сам.
  if (page.id === 'gfr_stage') {
    wrap.appendChild(renderCkdEpiCalc());
  }

  page.options.forEach(opt => {
    const id = opt.id;
    const selected = state.answers[page.id === 'risk' ? 'risk' : page.id] === id;
    const card = el('div', 'card option' + (selected ? ' selected' : ''));
    card.appendChild(renderRadioRow(opt.label, opt.sub, opt.hint, selected));

    if (opt.criteria) {
      card.appendChild(renderExpandable(opt, page.id));
    }

    if (selected && opt.freetextField) {
      card.appendChild(renderOptionFreetext(opt, page.id));
    }

    card.onclick = (e) => {
      if (e.target.closest('.expand-toggle') || e.target.closest('.opt-freetext')) return;
      state.answers[page.id === 'risk' ? 'risk' : page.id] = id;
      renderPage();
    };
    wrap.appendChild(card);
  });

  // Свободное текстовое поле уровня страницы (напр. точное значение размера язвы) —
  // не привязано к конкретной опции, значение подставляется в diagnosisText выбранной опции
  // через плейсхолдер {key}. Генерик: любая single-страница любой нозологии может это объявить.
  // Если задан ff.unit — значение при сборке оборачивается в "(число unit)" автоматически,
  // врач вводит только число.
  if (page.freetextField) {
    const ff = page.freetextField;
    const stateKey = page.id + '__' + ff.key;
    const row = el('div', 'inline-fields');
    const input = document.createElement('input');
    input.type = ff.type || 'text';
    if (input.type === 'number') input.step = ff.step || '0.1';
    input.placeholder = ff.placeholder || '';
    input.value = state.answers[stateKey] || '';
    input.oninput = () => { state.answers[stateKey] = input.value; };
    commitOnEnter(input);
    row.appendChild(input);
    if (ff.unit) {
      const unitLabel = el('span', null);
      unitLabel.textContent = ff.unit;
      unitLabel.style.alignSelf = 'center';
      unitLabel.style.fontSize = '13px';
      unitLabel.style.color = 'var(--text-secondary)';
      row.appendChild(unitLabel);
    }
    wrap.appendChild(row);
  }

  if (page.references) {
    page.references.forEach(ref => wrap.appendChild(renderPageReference(page.id, ref)));
  }

  if (page.id === 'risk') {
    wrap.appendChild(renderRiskTableToggle());
    wrap.appendChild(renderRiskFactorsListToggle());
    wrap.appendChild(renderScore2Block());
    wrap.appendChild(renderModifyingFactorsListToggle());
  }

  return wrap;
}

// ---------- Generic справочные блоки (page.references) ----------
// В отличие от 4 блоков ГБ выше (жёстко зашиты под page.id === 'risk' — легаси,
// не трогаем), этот механизм полностью декларативный: любая страница любой
// нозологии может объявить в JSON произвольные сворачиваемые подсказки —
// таблицу (ref.table), сгруппированные списки (ref.groups) или плоский список
// (ref.criteria) — без единой правки app.js.
function renderPageReference(pageId, ref) {
  const wrap = el('div', 'expand');
  const key = 'page-ref-' + pageId + '-' + ref.label + '-open';
  const isOpen = !!state[key];
  const btn = el('button', 'expand-toggle');
  btn.textContent = (isOpen ? 'Скрыть ' : 'Показать ') + lowerFirst(ref.label);
  btn.onclick = () => { state[key] = !isOpen; renderPage(); };
  wrap.appendChild(btn);
  if (!isOpen) return wrap;

  if (ref.table) {
    const table = document.createElement('table');
    table.className = 'risk-table';
    let html = '<tr>' + ref.table.headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
    ref.table.rows.forEach(row => {
      html += '<tr>' + row.map(c => `<td>${c}</td>`).join('') + '</tr>';
    });
    table.innerHTML = html;
    wrap.appendChild(table);
  }

  if (ref.note) {
    const note = el('div', 'note');
    note.innerHTML = `<i class="ti ti-info-circle"></i><span>${ref.note}</span>`;
    wrap.appendChild(note);
  }

  if (ref.groups) {
    ref.groups.forEach(group => {
      const label = el('p', 'group-label');
      label.textContent = group.heading;
      wrap.appendChild(label);
      const list = document.createElement('ul');
      group.items.forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
      });
      wrap.appendChild(list);
    });
  }

  if (ref.criteria) {
    const list = document.createElement('ul');
    ref.criteria.forEach(text => {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    wrap.appendChild(list);
  }

  return wrap;
}

function renderSingleGrouped(page) {
  const wrap = el('div', 'stack');
  page.groups.forEach(group => {
    const label = el('p', 'group-label');
    label.textContent = group.label;
    wrap.appendChild(label);
    group.options.forEach(opt => {
      const selected = state.answers.degreeStatus && state.answers.degreeStatus.id === opt.id;
      const card = el('div', 'card option' + (selected ? ' selected' : ''));
      card.appendChild(renderRadioRow(opt.label, null, opt.hint, selected));
      card.onclick = () => {
        state.answers.degreeStatus = opt;
        renderPage();
      };
      wrap.appendChild(card);
    });
  });
  return wrap;
}

function renderMulti(page) {
  if (!state.answers.findings) state.answers.findings = {};
  const wrap = el('div', 'stack');

  if (page.note) {
    const staticNote = el('div', 'note');
    staticNote.innerHTML = `<i class="ti ti-info-circle"></i><span>${page.note}</span>`;
    wrap.appendChild(staticNote);
  }

  page.items.forEach(item => {
    const answer = state.answers.findings[item.id] || { checked: false };
    const card = el('div', 'card');
    const label = el('label', 'check-row');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = answer.checked;
    box.onchange = () => {
      answer.checked = box.checked;
      state.answers.findings[item.id] = answer;
      renderPage();
    };
    const span = el('span', null);
    span.textContent = item.label;
    label.appendChild(box);
    label.appendChild(span);
    card.appendChild(label);

    // Раскрываемая подсказка-критерии под пунктом чекбокс-списка (напр. классификация
    // Форрест под "Кровотечение") — тот же механизм, что и opt.criteria в single,
    // показывается независимо от того, отмечен чекбокс или нет.
    if (item.criteria) {
      card.appendChild(renderExpandable(item, page.id));
    }

    if (answer.checked && item.kind === 'degree') {
      const sel = document.createElement('select');
      item.options.forEach(d => {
        const o = document.createElement('option');
        o.value = d; o.textContent = d + ' степени';
        if ((answer.degree || item.default) === d) o.selected = true;
        sel.appendChild(o);
      });
      if (!answer.degree) answer.degree = item.default;
      sel.onchange = () => { answer.degree = sel.value; state.answers.findings[item.id] = answer; renderPage(); };
      card.appendChild(sel);
    }

    if (answer.checked && item.kind === 'compound') {
      const row = el('div', 'inline-fields');
      item.fields.forEach(fld => {
        // fld.type === 'freetext' — текстовое поле вместо select, для случаев, когда
        // КР не даёт формального перечня значений (напр. локализация стеноза у ЯБ).
        if (fld.type === 'freetext') {
          const input = document.createElement('input');
          input.type = 'text';
          input.placeholder = fld.placeholder || '';
          input.value = answer[fld.key] || '';
          input.oninput = () => { answer[fld.key] = input.value; state.answers.findings[item.id] = answer; };
          commitOnEnter(input);
          row.appendChild(input);
          return;
        }
        const sel = document.createElement('select');
        fld.options.forEach(v => {
          const o = document.createElement('option'); o.value = v; o.textContent = v;
          if ((answer[fld.key] || fld.default) === v) o.selected = true;
          sel.appendChild(o);
        });
        if (!answer[fld.key]) answer[fld.key] = fld.default;
        sel.onchange = () => { answer[fld.key] = sel.value; state.answers.findings[item.id] = answer; renderPage(); };
        row.appendChild(sel);
      });
      card.appendChild(row);
    }

    if (answer.checked && item.kind === 'freetext') {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = item.placeholder || '';
      input.value = answer.value || '';
      input.oninput = () => { answer.value = input.value; state.answers.findings[item.id] = answer; };
      commitOnEnter(input);
      card.appendChild(input);
    }

    // "scorecalc" — чекбокс раскрывает калькулятор шкалы (сумма баллов по отмеченным
    // факторам/выбранным градациям). Пока не отмечен — калькулятор не рендерится и его
    // результат не участвует в сборке диагноза (см. renderFindingTemplate). Добавлено
    // для ФП (CHA2DS2-VASc, HAS-BLED) — генерик, не завязан на конкретную нозологию,
    // подходит для любой будущей шкалы с суммируемыми баллами.
    if (answer.checked && item.kind === 'scorecalc') {
      card.appendChild(renderScoreCalc(item, answer, page.id));
    }

    wrap.appendChild(card);
  });
  return wrap;
}

function renderRadioRow(label, sub, hint, selected) {
  const row = el('div', 'radio-row');
  const dot = el('div', 'radio-dot' + (selected ? ' selected' : ''));
  if (selected) dot.innerHTML = '<div class="radio-dot-inner"></div>';
  const text = el('div', 'radio-text');
  text.innerHTML = `<p class="option-title">${label}${sub ? ' <span class="muted">— ' + sub + '</span>' : ''}</p>` +
    (hint ? `<p class="option-hint">${hint}</p>` : '');
  row.appendChild(dot);
  row.appendChild(text);
  return row;
}

// Свободное поле, привязанное к КОНКРЕТНОЙ опции single-страницы (в отличие от
// page.freetextField, который относится ко всей странице целиком) — показывается,
// только когда эта опция выбрана. Синяя подсказка сверху (opt.freetextField.note) +
// поле + обычная (серая) подсказка снизу (opt.freetextField.hint). Пример — "Множественные"
// язвы у ЯБ: конструктор считает локализацию/размер только для одной язвы (см. соседние
// страницы), остальные врач вписывает вручную сюда.
function renderOptionFreetext(opt, pageId) {
  const wrap = el('div', 'opt-freetext');
  wrap.style.marginTop = '10px';
  const ff = opt.freetextField;
  const stateKey = pageId + '-' + opt.id + '__' + ff.key;

  if (ff.note) {
    const note = el('div', 'note');
    note.innerHTML = `<i class="ti ti-info-circle"></i><span>${ff.note}</span>`;
    wrap.appendChild(note);
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = ff.placeholder || '';
  input.value = state.answers[stateKey] || '';
  input.style.width = '100%';
  input.oninput = () => { state.answers[stateKey] = input.value; };
  commitOnEnter(input);
  wrap.appendChild(input);

  if (ff.hint) {
    const hint = el('p', 'option-hint');
    hint.style.marginTop = '6px';
    hint.textContent = ff.hint;
    wrap.appendChild(hint);
  }

  return wrap;
}

function renderExpandable(opt, pageId) {
  const wrap = el('div', 'expand');
  const key = pageId + '-' + opt.id + '-open';
  const isOpen = !!state[key];
  const btn = el('button', 'expand-toggle');
  btn.textContent = (isOpen ? 'Скрыть ' : 'Показать ') + lowerFirst(opt.criteriaLabel);
  btn.onclick = (e) => {
    e.stopPropagation();
    state[key] = !isOpen;
    renderPage();
  };
  wrap.appendChild(btn);
  if (isOpen) {
    const list = document.createElement('ul');
    opt.criteria.forEach(c => {
      const li = document.createElement('li');
      li.textContent = c;
      list.appendChild(li);
    });
    wrap.appendChild(list);
  }
  return wrap;
}

// ---------- Калькулятор суммируемых шкал (generic: kind: "scorecalc" в multi-странице) ----------
// Чекбокс пункта раскрывает набор факторов (item.factors): простые чекбоксы с
// фиксированными баллами (points) либо взаимоисключающий select (type: "select",
// options: [{value, label, points}]) — например возрастная градация в CHA2DS2-VASc.
// Сумма баллов пересчитывается на каждый ре-рендер из отмеченных/выбранных факторов
// и хранится в answer.score — renderFindingTemplate() подставляет её в item.template
// через {score}/{scoreWord}. Пока чекбокс пункта не отмечен, калькулятор не рендерится
// и answer.score не существует — в сборку диагноза попадает только то, что отмечено
// (тот же принцип, что у остальных kind в multi). Добавлено для ФП (CHA2DS2-VASc,
// HAS-BLED, Прил. Г1 КР), но не завязано на конкретную нозологию.
function renderScoreCalc(item, answer, pageId) {
  const wrap = el('div', 'scorecalc');
  wrap.style.marginTop = '8px';
  if (!answer.factors) answer.factors = {};

  item.factors.forEach(f => {
    if (f.type === 'select') {
      if (!answer.factors[f.key]) answer.factors[f.key] = f.default;
      const row = document.createElement('div');
      row.style.marginTop = '6px';
      const lbl = document.createElement('label');
      lbl.textContent = f.label;
      lbl.style.display = 'block';
      lbl.style.fontSize = '12.5px';
      lbl.style.color = 'var(--text-secondary)';
      const sel = document.createElement('select');
      f.options.forEach(o => {
        const optEl = document.createElement('option');
        optEl.value = o.value;
        optEl.textContent = `${o.label} (+${o.points})`;
        if (answer.factors[f.key] === o.value) optEl.selected = true;
        sel.appendChild(optEl);
      });
      sel.onchange = () => { answer.factors[f.key] = sel.value; renderPage(); };
      row.appendChild(lbl);
      row.appendChild(sel);
      wrap.appendChild(row);
    } else {
      const row = el('label', 'check-row');
      row.style.marginTop = '6px';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!answer.factors[f.key];
      box.onchange = () => { answer.factors[f.key] = box.checked; renderPage(); };
      const span = el('span', null);
      span.textContent = `${f.label} (+${f.points})`;
      row.appendChild(box);
      row.appendChild(span);
      wrap.appendChild(row);
    }
  });

  const score = computeScoreCalc(item, answer.factors);
  answer.score = score;

  const resultNote = el('div', 'note');
  resultNote.style.marginTop = '8px';
  const scoreWord = pluralRu(score, item.scoreWordForms || ['балл', 'балла', 'баллов']);
  resultNote.innerHTML = `<i class="ti ti-report-analytics"></i><span><b>${item.label}: ${score} ${scoreWord}</b></span>`;
  wrap.appendChild(resultNote);

  return wrap;
}

function computeScoreCalc(item, factors) {
  let sum = 0;
  item.factors.forEach(f => {
    if (f.type === 'select') {
      const val = factors[f.key] || f.default;
      const opt = f.options.find(o => o.value === val);
      sum += opt ? opt.points : 0;
    } else if (factors[f.key]) {
      sum += f.points;
    }
  });
  return sum;
}

function renderRiskTableToggle() {
  const wrap = el('div', 'expand');
  const isOpen = !!state['risk-table-open'];
  const btn = el('button', 'expand-toggle');
  btn.textContent = (isOpen ? 'Скрыть таблицу риска' : 'Показать таблицу риска');
  btn.onclick = () => { state['risk-table-open'] = !isOpen; renderPage(); };
  wrap.appendChild(btn);
  if (isOpen) {
    const table = document.createElement('table');
    table.className = 'risk-table';
    table.innerHTML = `
      <tr><th>Стадия</th><th>Высокое норм.</th><th>Степень 1</th><th>Степень 2</th><th>Степень 3</th></tr>
      <tr><td>I, нет ФР</td><td>Низкий (1)</td><td>Низкий (1)</td><td>Умеренный (2)</td><td>Высокий (3)</td></tr>
      <tr><td>I, 1-2 ФР</td><td>Низкий (1)</td><td>Умеренный (2)</td><td>Умеренный/высокий</td><td>Высокий (3)</td></tr>
      <tr><td>I, ≥3 ФР</td><td>Низкий/умеренный</td><td>Умеренный/высокий</td><td>Высокий (3)</td><td>Высокий (3)</td></tr>
      <tr><td>II</td><td>Умеренный/высокий</td><td>Высокий (3)</td><td>Высокий (3)</td><td>Высокий/оч.высокий</td></tr>
      <tr><td>III</td><td>Оч.высокий (4)</td><td>Оч.высокий (4)</td><td>Оч.высокий (4)</td><td>Оч.высокий (4)</td></tr>
    `;
    wrap.appendChild(table);
  }
  return wrap;
}

// ---------- Список факторов СС риска (раздел 1.5, стр. 19-20 КР) ----------
// Именно этот список считается для определения числа ФР (0 / 1-2 / ≥3) в Табл. П15
// на странице стадии I. Порядок и формулировки — как в разделе 1.5, а не как в Табл. П16
// (там те же пункты сгруппированы иначе).
const RISK_FACTORS_LIST = [
  'Пол (мужчины > женщин)',
  'Возраст ≥55 лет у мужчин, ≥65 лет у женщин',
  'Курение (в настоящем или прошлом; отказ менее года назад — тоже считать)',
  'Дислипидемия: ОХС >4,9 ммоль/л и/или ХС ЛНП >3,0 ммоль/л и/или ХС ЛВП <1,0 ммоль/л (муж.) / <1,2 ммоль/л (жен.) и/или триглицериды >1,7 ммоль/л',
  'Мочевая кислота ≥360 мкмоль/л',
  'Нарушение гликемии натощак: глюкоза плазмы натощак 5,6–6,9 ммоль/л',
  'Нарушение толерантности к глюкозе',
  'Избыточная масса тела (ИМТ 25–29,9 кг/м²) или ожирение (ИМТ ≥30 кг/м²)',
  'Абдоминальное ожирение (окружность талии >94 см у мужчин, >80 см у женщин)',
  'Семейный анамнез ранних ССЗ (<55 лет у мужчин, <65 лет у женщин)',
  'Развитие АГ в молодом возрасте у родителей или в семье',
  'Ранняя менопауза',
  'Малоподвижный образ жизни',
  'Психологические и социально-экономические факторы',
  'ЧСС в покое >80 уд/мин'
];

function renderRiskFactorsListToggle() {
  const wrap = el('div', 'expand');
  const isOpen = !!state['risk-factors-open'];
  const btn = el('button', 'expand-toggle');
  btn.textContent = isOpen ? 'Скрыть список факторов риска' : 'Показать список факторов риска';
  btn.onclick = () => { state['risk-factors-open'] = !isOpen; renderPage(); };
  wrap.appendChild(btn);
  if (!isOpen) return wrap;

  const list = document.createElement('ul');
  RISK_FACTORS_LIST.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  wrap.appendChild(list);

  return wrap;
}

// ---------- Калькулятор SCORE2 / SCORE2-OP (Приложение Г1-Г2, КР АГ 2024) ----------
// Самодостаточный блок: собственное состояние в state.score2, НЕ пишет в state.answers
// и не участвует в assembleDiagnosis(). Регион риска зашит как "очень высокий" (РФ,
// см. Приложение А3 стр.211 и официальный список регионов ESC). Формула и коэффициенты
// сверены с открытой реализацией SCORE2/SCORE2-OP (R-пакет RiskScorescvd на CRAN,
// со ссылкой на "SCORE2 Updated Supplementary Material page 9"); диабет в формуле
// зафиксирован как 0, потому что при СД калькулятор вообще не запускается (см. гейтинг).
function renderScore2Block() {
  const wrap = el('div', 'expand');
  const isOpen = !!state['score2-open'];
  const btn = el('button', 'expand-toggle');
  btn.textContent = isOpen ? 'Скрыть калькулятор SCORE2/SCORE2-OP' : 'Показать калькулятор SCORE2/SCORE2-OP';
  btn.onclick = () => { state['score2-open'] = !isOpen; renderPage(); };
  wrap.appendChild(btn);
  if (!isOpen) return wrap;

  if (!state.score2) {
    state.score2 = {
      age: '', sex: 'male', smoking: false,
      sbp: '', tc: '', hdl: '',
      excl: { ascvd: false, dm: false, ckd: false, fh: false, severeRF: false },
      result: null
    };
  }
  const s2 = state.score2;

  const note = el('div', 'note');
  note.innerHTML = '<i class="ti ti-info-circle"></i><span>Отдельный инструмент общей оценки ССР (раздел 2.4, Приложение Г1-Г2 КР) — ' +
    'результат НЕ подставляется в «Риск N» формулировки ГБ (та строится по Табл. П15 на предыдущем шаге). ' +
    'Регион риска зафиксирован как «очень высокий» (РФ). По данным валидации на выборке ESSE-RF, ' +
    'стандартная калибровка для этого региона завышает риск у мужчин — трактуйте цифру с поправкой на это, ' +
    'а не как точный процент.</span>';
  wrap.appendChild(note);

  const exclLabel = el('p', 'group-label');
  exclLabel.textContent = 'Сначала исключить критерии, при которых категория уже определена клинически (Табл. П13/А3, шаг 1)';
  wrap.appendChild(exclLabel);

  const exclItems = [
    ['ascvd', 'Документированное атеросклеротическое ССЗ (ОКС, стенокардия, ЧКВ/КШ, инсульт/ТИА, ЗПА, бляшка ≥50%)'],
    ['dm', 'Сахарный диабет 1 или 2 типа'],
    ['ckd', 'ХБП с рСКФ <60 мл/мин/1,73м² (стадия ≥3)'],
    ['fh', 'Семейная гиперхолестеринемия'],
    ['severeRF', 'Резко повышен один фактор: АД ≥180/110 и/или ОХС >8 и/или ХС ЛНП >4,9 ммоль/л']
  ];
  exclItems.forEach(([key, label]) => {
    const row = el('label', 'check-row');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = s2.excl[key];
    box.onchange = () => { s2.excl[key] = box.checked; renderPage(); };
    const span = el('span', null);
    span.textContent = label;
    row.appendChild(box);
    row.appendChild(span);
    wrap.appendChild(row);
  });

  const anyExcl = Object.keys(s2.excl).some(k => s2.excl[k]);
  if (anyExcl) {
    const resultNote = el('div', 'note');
    resultNote.innerHTML = '<i class="ti ti-alert-triangle"></i><span>Категория уже определена клинически — ' +
      'высокий/очень высокий риск. SCORE2/SCORE2-OP не считается (Табл. П13/А3, шаг 1: правило остановки).</span>';
    wrap.appendChild(resultNote);
    return wrap;
  }

  function numberField(labelText, key, placeholder) {
    const row = document.createElement('div');
    row.style.marginTop = '8px';
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    lbl.style.display = 'block';
    lbl.style.fontSize = '12.5px';
    lbl.style.color = 'var(--text-secondary)';
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.1';
    input.placeholder = placeholder || '';
    input.value = s2[key];
    input.style.width = '100%';
    input.style.marginTop = '4px';
    input.oninput = () => { s2[key] = input.value; };
    row.appendChild(lbl);
    row.appendChild(input);
    return row;
  }

  const fieldsWrap = document.createElement('div');
  fieldsWrap.appendChild(numberField('Возраст, лет', 'age', 'напр. 55'));

  const sexRow = el('div', 'inline-fields');
  [['male', 'Мужской'], ['female', 'Женский']].forEach(([v, text]) => {
    const label = el('label', 'check-row');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'score2-sex';
    radio.checked = s2.sex === v;
    radio.onchange = () => { s2.sex = v; renderPage(); };
    const span = el('span', null);
    span.textContent = text;
    label.appendChild(radio);
    label.appendChild(span);
    sexRow.appendChild(label);
  });
  fieldsWrap.appendChild(sexRow);

  const smokeRow = el('label', 'check-row');
  smokeRow.style.marginTop = '8px';
  const smokeBox = document.createElement('input');
  smokeBox.type = 'checkbox';
  smokeBox.checked = s2.smoking;
  smokeBox.onchange = () => { s2.smoking = smokeBox.checked; renderPage(); };
  const smokeSpan = el('span', null);
  smokeSpan.textContent = 'Курение (сейчас или отказ <1 года назад)';
  smokeRow.appendChild(smokeBox);
  smokeRow.appendChild(smokeSpan);
  fieldsWrap.appendChild(smokeRow);

  fieldsWrap.appendChild(numberField('САД, мм рт. ст.', 'sbp', 'напр. 150'));
  fieldsWrap.appendChild(numberField('Общий холестерин, ммоль/л', 'tc', 'напр. 5.5'));
  fieldsWrap.appendChild(numberField('ХС ЛВП, ммоль/л', 'hdl', 'напр. 1.2'));
  wrap.appendChild(fieldsWrap);

  const calcBtn = el('button', 'primary-btn');
  calcBtn.style.marginTop = '10px';
  calcBtn.textContent = 'Рассчитать';
  calcBtn.onclick = () => {
    const age = parseFloat(s2.age);
    const sbp = parseFloat(s2.sbp);
    const tc = parseFloat(s2.tc);
    const hdl = parseFloat(s2.hdl);
    if (!age || !sbp || !tc || !hdl) {
      s2.result = { error: 'Заполните все поля (возраст, САД, ОХС, ХС ЛВП).' };
    } else if (age < 40) {
      s2.result = { error: 'КР не определяет числовой порог SCORE2 для возраста младше 40 лет.' };
    } else {
      s2.result = computeScore2({ age, sex: s2.sex, smoking: s2.smoking, sbp, tc, hdl });
    }
    renderPage();
  };
  wrap.appendChild(calcBtn);

  if (s2.result) {
    const resBox = el('div', 'note');
    if (s2.result.error) {
      resBox.innerHTML = `<i class="ti ti-alert-triangle"></i><span>${s2.result.error}</span>`;
    } else {
      const cautionMale = s2.result.sex === 'male'
        ? ' У мужчин стандартная калибровка для региона «очень высокий» по данным ESSE-RF завышает риск — интерпретируйте с осторожностью.'
        : '';
      resBox.innerHTML = `<i class="ti ti-report-analytics"></i><span><b>${s2.result.model}: ${s2.result.value}%</b> — ` +
        `категория «${s2.result.category}» (регион «очень высокий», РФ).${cautionMale}</span>`;
    }
    wrap.appendChild(resBox);
  }

  return wrap;
}

// Чистая функция расчёта SCORE2 (40-69 лет) / SCORE2-OP (>=70 лет), регион "Very high".
// Коэффициенты и scale1/scale2 — по SCORE2/SCORE2-OP Working Group, ESC 2021.
function computeScore2({ age, sex, smoking, sbp, tc, hdl }) {
  const smoker = smoking ? 1 : 0;
  const diabetes = 0; // гейтинг выше исключает СД до вызова этой функции
  let scale1, scale2, model, riskFraction;

  if (age < 70) {
    model = 'SCORE2';
    if (sex === 'male') { scale1 = 0.5836; scale2 = 0.8294; } else { scale1 = 0.9412; scale2 = 0.8329; }
    let xx;
    if (sex === 'male') {
      xx = 0.3742 * (age - 60) / 5 + 0.6012 * smoker + 0.2777 * (sbp - 120) / 20 + 0.6457 * diabetes +
        0.1458 * (tc - 6) + (-0.2698) * (hdl - 1.3) / 0.5 +
        (-0.0755) * (age - 60) / 5 * smoker + (-0.0255) * (age - 60) / 5 * (sbp - 120) / 20 +
        (-0.0281) * (age - 60) / 5 * (tc - 6) + 0.0426 * (age - 60) / 5 * (hdl - 1.3) / 0.5 +
        (-0.0983) * (age - 60) / 5 * diabetes;
      const base = 1 - Math.pow(0.9605, Math.exp(xx));
      riskFraction = 1 - Math.exp(-Math.exp(scale1 + scale2 * Math.log(-Math.log(1 - base))));
    } else {
      xx = 0.4648 * (age - 60) / 5 + 0.7744 * smoker + 0.3131 * (sbp - 120) / 20 + 0.8096 * diabetes +
        0.1002 * (tc - 6) + (-0.2606) * (hdl - 1.3) / 0.5 +
        (-0.1088) * (age - 60) / 5 * smoker + (-0.0277) * (age - 60) / 5 * (sbp - 120) / 20 +
        (-0.0226) * (age - 60) / 5 * (tc - 6) + 0.0613 * (age - 60) / 5 * (hdl - 1.3) / 0.5 +
        (-0.1272) * (age - 60) / 5 * diabetes;
      const base = 1 - Math.pow(0.9776, Math.exp(xx));
      riskFraction = 1 - Math.exp(-Math.exp(scale1 + scale2 * Math.log(-Math.log(1 - base))));
    }
  } else {
    model = 'SCORE2-OP';
    if (sex === 'male') { scale1 = 0.05; scale2 = 0.7; } else { scale1 = 0.38; scale2 = 0.69; }
    let xx;
    if (sex === 'male') {
      xx = 0.0634 * (age - 73) + 0.4245 * diabetes + 0.3524 * smoker + 0.0094 * (sbp - 150) +
        0.0850 * (tc - 6) + (-0.3564) * (hdl - 1.4) +
        (-0.0174) * (age - 73) * diabetes + (-0.0247) * (age - 73) * smoker +
        (-0.0005) * (age - 73) * (sbp - 150) + 0.0073 * (age - 73) * (tc - 6) + 0.0091 * (age - 73) * (hdl - 1.4);
      const base = 1 - Math.pow(0.7576, Math.exp(xx - 0.0929));
      riskFraction = 1 - Math.exp(-Math.exp(scale1 + scale2 * Math.log(-Math.log(1 - base))));
    } else {
      xx = 0.0789 * (age - 73) + 0.6010 * diabetes + 0.4921 * smoker + 0.0102 * (sbp - 150) +
        0.0605 * (tc - 6) + (-0.3040) * (hdl - 1.4) +
        (-0.0107) * (age - 73) * diabetes + (-0.0255) * (age - 73) * smoker +
        (-0.0004) * (age - 73) * (sbp - 150) + (-0.0009) * (age - 73) * (tc - 6) + 0.0154 * (age - 73) * (hdl - 1.4);
      const base = 1 - Math.pow(0.8082, Math.exp(xx - 0.229));
      riskFraction = 1 - Math.exp(-Math.exp(scale1 + scale2 * Math.log(-Math.log(1 - base))));
    }
  }

  const value = Math.round(riskFraction * 1000) / 10; // проценты, 1 знак после запятой
  const category = categorizeScore2(value, age);
  return { model, value, category, sex };
}

// Категории по Приложение Г2/А3: пороги 4-уровневые (низкий/умеренный/высокий/оч.высокий),
// это ОТЛИЧАЕТСЯ от официального 3-уровневого вывода ESC/HeartScore (низкий-умеренный
// объединены) — расхождение с heartscore.escardio.org при сверке ожидаемо, не баг.
function categorizeScore2(value, age) {
  const modThreshold = age < 50 ? 2.5 : (age < 70 ? 5 : 7.5);
  const highThreshold = age < 50 ? 7.5 : (age < 70 ? 10 : 15);
  if (value < 1) return 'низкий';
  if (value < modThreshold) return 'умеренный';
  if (value < highThreshold) return 'высокий';
  return 'очень высокий';
}

// ---------- Калькулятор СКФ по CKD-EPI 2009 (Приложение Г, п.7 КР "ХБП" 2024) ----------
// Самодостаточный блок: собственное состояние в state.ckdEpi, НЕ пишет в state.answers
// и не участвует в assembleDiagnosis() — только считает и подсказывает стадию, выбор
// варианта в списке ниже остаётся за врачом (тот же принцип, что у SCORE2-блока выше).
// Формула — четыре ветки по полу и порогу креатинина, как дано в самой КР (Приложение Г,
// п.7): только для пациентов европеоидной расы, коэффициента для других рас КР не
// приводит — калькулятор о расе не спрашивает и не применяет его.
function renderCkdEpiCalc() {
  if (!state.ckdEpi) {
    state.ckdEpi = { sex: 'female', age: '', creatinine: '', result: null };
  }
  const c = state.ckdEpi;
  const wrap = el('div', 'expand');
  const isOpen = !!state['ckd-epi-open'];
  const btn = el('button', 'expand-toggle');
  btn.textContent = isOpen ? 'Скрыть калькулятор СКФ (CKD-EPI)' : 'Показать калькулятор СКФ (CKD-EPI)';
  btn.onclick = () => { state['ckd-epi-open'] = !isOpen; renderPage(); };
  wrap.appendChild(btn);
  if (!isOpen) return wrap;

  const note = el('div', 'note');
  note.innerHTML = '<i class="ti ti-info-circle"></i><span>Формула CKD-EPI 2009 по креатинину крови (Приложение Г, п.7 КР) — в самой КР дана ' +
    'только для пациентов европеоидной расы, коэффициента для других рас КР не приводит. Калькулятор только считает — вариант ' +
    'стадии ниже выбирает врач.</span>';
  wrap.appendChild(note);

  const sexRow = el('div', 'inline-fields');
  [['female', 'Женский'], ['male', 'Мужской']].forEach(([v, text]) => {
    const label = el('label', 'check-row');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'ckd-epi-sex';
    radio.checked = c.sex === v;
    radio.onchange = () => { c.sex = v; renderPage(); };
    const span = el('span', null);
    span.textContent = text;
    label.appendChild(radio);
    label.appendChild(span);
    sexRow.appendChild(label);
  });
  wrap.appendChild(sexRow);

  function numberField(labelText, key, placeholder) {
    const row = document.createElement('div');
    row.style.marginTop = '8px';
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    lbl.style.display = 'block';
    lbl.style.fontSize = '12.5px';
    lbl.style.color = 'var(--text-secondary)';
    const input = document.createElement('input');
    input.type = 'number';
    input.placeholder = placeholder || '';
    input.value = c[key];
    input.style.width = '100%';
    input.style.marginTop = '4px';
    input.oninput = () => { c[key] = input.value; };
    row.appendChild(lbl);
    row.appendChild(input);
    return row;
  }

  wrap.appendChild(numberField('Возраст, лет', 'age', 'напр. 60'));
  wrap.appendChild(numberField('Креатинин крови, мкмоль/л', 'creatinine', 'напр. 90'));

  const calcBtn = el('button', 'primary-btn');
  calcBtn.style.marginTop = '10px';
  calcBtn.textContent = 'Рассчитать';
  calcBtn.onclick = () => {
    const age = parseFloat(c.age);
    const cr = parseFloat(c.creatinine);
    if (!age || !cr) {
      c.result = { error: 'Заполните возраст и креатинин.' };
    } else {
      const gfr = computeCkdEpiGfr(c.sex, age, cr);
      c.result = { gfr, stage: gfrToStageLabel(gfr) };
    }
    renderPage();
  };
  wrap.appendChild(calcBtn);

  if (c.result) {
    const resBox = el('div', 'note');
    if (c.result.error) {
      resBox.innerHTML = `<i class="ti ti-alert-triangle"></i><span>${c.result.error}</span>`;
    } else {
      resBox.innerHTML = `<i class="ti ti-report-analytics"></i><span><b>рСКФ ≈ ${c.result.gfr.toFixed(1)} мл/мин/1,73 м²</b> → ${c.result.stage}</span>`;
    }
    wrap.appendChild(resBox);
  }

  return wrap;
}

// Чистая функция расчёта (Приложение Г, п.7 КР): 4 ветки по полу и порогу креатинина.
function computeCkdEpiGfr(sex, age, creatinineUmol) {
  const ratio = creatinineUmol / 88.4;
  if (sex === 'female') {
    const exp = creatinineUmol <= 62 ? -0.328 : -1.210;
    return 144 * Math.pow(0.993, age) * Math.pow(ratio / 0.7, exp);
  }
  const exp = creatinineUmol <= 80 ? -0.412 : -1.210;
  return 141 * Math.pow(0.993, age) * Math.pow(ratio / 0.9, exp);
}

function gfrToStageLabel(gfr) {
  if (gfr > 90) return 'С1';
  if (gfr >= 60) return 'С2';
  if (gfr >= 45) return 'С3а';
  if (gfr >= 30) return 'С3б';
  if (gfr >= 15) return 'С4';
  return 'С5';
}

// ---------- Модифицирующие факторы (Табл. П14/А3, стр. 185) ----------
// Используются для разрешения "вилок" в таблице риска (ячейки без единственного
// значения) и особенно значимы у пациентов категории умеренного риска (раздел 2.4 КР).
// Возрастной порог семейного анамнеза здесь (<60 лет у женщин) ОТЛИЧАЕТСЯ от порога
// в списке факторов риска выше (<65 лет у женщин, Табл. П16/раздел 1.5) — это
// расхождение внутри самой КР, не опечатка при переносе.
const MODIFYING_FACTORS_LIST = [
  'Социальная депривация',
  'Ожирение (по ИМТ) и центральное ожирение (по окружности талии)',
  'Отсутствие физической активности',
  'Психологический стресс',
  'Семейный анамнез раннего развития ССЗ (<55 лет у мужчин, <60 лет у женщин)',
  'Аутоиммунные и другие воспалительные заболевания',
  'Большие психические расстройства',
  'Лечение инфекций при наличии ВИЧ',
  'Фибрилляция предсердий',
  'Гипертрофия левого желудочка',
  'ХБП',
  'Синдром обструктивного апноэ сна'
];

function renderModifyingFactorsListToggle() {
  const wrap = el('div', 'expand');
  const isOpen = !!state['modifying-factors-open'];
  const btn = el('button', 'expand-toggle');
  btn.textContent = isOpen ? 'Скрыть модифицирующие факторы' : 'Показать модифицирующие факторы';
  btn.onclick = () => { state['modifying-factors-open'] = !isOpen; renderPage(); };
  wrap.appendChild(btn);
  if (!isOpen) return wrap;

  const note = el('div', 'note');
  note.innerHTML = '<i class="ti ti-info-circle"></i><span>Применяются, когда таблица риска даёт вилку ' +
    '(«умеренный/высокий» и т.п.): наличие модифицирующих факторов — довод в пользу более высокого ' +
    'значения из вилки, особенно в категории умеренного риска.</span>';
  wrap.appendChild(note);

  const list = document.createElement('ul');
  MODIFYING_FACTORS_LIST.forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  wrap.appendChild(list);

  return wrap;
}

// ---------- Сборка итоговой строки (универсальная, не знает про конкретную нозологию) ----------
// Диспетчер стиля: по умолчанию (assemblyStyle не задан) — старый стиль "предложение на
// страницу через точку", сверенный дословно с примерами КР ГБ/ХСН, НЕ трогаем. Новый стиль
// "flowing" — одно предложение через запятые (нужен ЯБ, т.к. официальных примеров формулировки
// в этом КР нет вообще, и стиль ориентируется на реальную практику записи, а не на КР).
function assembleDiagnosis() {
  let result = state.data.assemblyStyle === 'flowing' ? assembleDiagnosisFlowing() : assembleDiagnosisSentence();
  if (state.answers.icdCode) {
    result = (result ? result + ' ' : '') + '(Код по МКБ-10: ' + state.answers.icdCode + ')';
  }
  return result;
}

// Текст single-страницы с учётом опционального page.freetextField (напр. точный размер
// в см, введённый врачом отдельным полем и подставляемый в diagnosisText через {key}).
// Общая для обоих стилей сборки — не дублируем логику подстановки.
function buildSingleFragmentText(page, opt) {
  if (!opt || !opt.diagnosisText) return '';
  let text = opt.diagnosisText;
  if (page.freetextField) {
    const ff = page.freetextField;
    const raw = state.answers[page.id + '__' + ff.key] || '';
    const formatted = raw ? '(' + raw + (ff.unit ? ' ' + ff.unit : '') + ')' : '';
    text = text.replace('{' + ff.key + '}', formatted);
  }
  if (opt.freetextField) {
    const ff = opt.freetextField;
    const raw = state.answers[page.id + '-' + opt.id + '__' + ff.key] || '';
    if (raw) text += (ff.prefix || '') + raw;
  }
  return text.trim();
}

function assembleDiagnosisSentence() {
  const a = state.answers;
  const parts = [];

  state.data.pages.forEach(page => {
    if (page.suppressDiagnosisIf && conditionMet(page.suppressDiagnosisIf)) return;
    if (isPageSkipped(page)) return; // ФИКС: страница, скрытая через skipIf, не должна протаскивать протухший ответ, оставшийся в state.answers с прошлой ветки
    if (page.type === 'single') {
      const val = a[page.id === 'risk' ? 'risk' : page.id];
      const opt = page.options.find(o => o.id === val);
      const text = buildSingleFragmentText(page, opt);
      if (text) parts.push(text);
    } else if (page.type === 'single_grouped') {
      if (a.degreeStatus && a.degreeStatus.diagnosisText) parts.push(a.degreeStatus.diagnosisText);
    } else if (page.type === 'multi') {
      const findingsText = [];
      page.items.forEach(item => {
        const f = a.findings && a.findings[item.id];
        if (!f || !f.checked) return;
        findingsText.push(renderFindingTemplate(item, f));
      });
      if (findingsText.length) parts.push(findingsText.join('. ') + '.');
    }
  });

  return parts.join(' ');
}

// "Flowing"-стиль: одно предложение, фрагменты соединяются через page.joiner (по умолчанию
// ", "), первый непустой фрагмент — без джойнера (он же начинает предложение с заглавной,
// т.к. это headline-страница). Регистр остальных фрагментов НЕ трогаем программно — каждый
// diagnosisText пишется в JSON сразу с нужной буквой (это надёжнее авто-lowerCase, который
// ломает аббревиатуры вроде "НПВП" при попадании в начало фрагмента).
function assembleDiagnosisFlowing() {
  const a = state.answers;
  const fragments = []; // { text, joiner }

  // page.assembleIndex (необязательный, генерик) — порядок сборки фрагментов независим
  // от порядка страниц мастера (по умолчанию совпадает с ним, если поле нигде не задано,
  // т.к. сортировка по исходному индексу — это исходный порядок). Добавлено для ХБП:
  // страница "ЗПТ" должна идти ПОСЛЕДНЕЙ в навигации (в подавляющем большинстве случаев
  // не заполняется вовсе — незачем заставлять врача каждый раз через неё щёлкать), но
  // её фрагмент в итоговой строке — сразу после стадии, до альбуминурии, как в
  // официальном примере КР ("ХБП С5Д (гемодиализ...)").
  const orderedPages = state.data.pages
    .map((page, idx) => ({ page, idx }))
    .sort((x, y) => (x.page.assembleIndex ?? x.idx) - (y.page.assembleIndex ?? y.idx))
    .map(x => x.page);

  orderedPages.forEach(page => {
    if (page.suppressDiagnosisIf && conditionMet(page.suppressDiagnosisIf)) return;
    if (isPageSkipped(page)) return; // ФИКС: страница, скрытая через skipIf, не должна протаскивать протухший ответ, оставшийся в state.answers с прошлой ветки
    const joiner = page.joiner !== undefined ? page.joiner : ', ';
    if (page.type === 'single') {
      const val = a[page.id];
      const opt = page.options.find(o => o.id === val);
      const text = buildSingleFragmentText(page, opt);
      if (text) fragments.push({ text, joiner });
    } else if (page.type === 'single_grouped') {
      if (a.degreeStatus && a.degreeStatus.diagnosisText) fragments.push({ text: a.degreeStatus.diagnosisText, joiner });
    } else if (page.type === 'multi') {
      page.items.forEach(item => {
        const f = a.findings && a.findings[item.id];
        if (!f || !f.checked) return;
        fragments.push({ text: renderFindingTemplate(item, f), joiner });
      });
    }
  });

  let result = '';
  fragments.forEach((frag, i) => {
    result += (i === 0 ? frag.text : frag.joiner + frag.text);
  });
  return result ? result.trim() + '.' : '';
}

function renderFindingTemplate(item, f) {
  if (item.kind === 'compound') {
    let t = item.template;
    item.fields.forEach(fld => { t = t.replace('{' + fld.key + '}', f[fld.key] || fld.default || ''); });
    return t;
  }
  if (item.kind === 'degree') {
    return item.template.replace('{degree}', f.degree || item.default);
  }
  if (item.kind === 'freetext') {
    return item.template + (f.value ? item.freetextPrefix + f.value : '');
  }
  if (item.kind === 'scorecalc') {
    // f.score посчитан и сохранён в renderScoreCalc() на момент, пока чекбокс был отмечен
    // и калькулятор рендерился — сюда попадает, только если f.checked (см. вызывающий код).
    const scoreWord = pluralRu(f.score, item.scoreWordForms || ['балл', 'балла', 'баллов']);
    return item.template.replace('{score}', f.score).replace('{scoreWord}', scoreWord);
  }
  return item.template;
}

function renderResultBlock() {
  const wrap = el('div', 'result-block');
  const label = el('p', 'group-label');
  label.textContent = 'Итоговая строка диагноза';
  const box = el('div', 'result-box');
  box.textContent = assembleDiagnosis();
  const btn = el('button', 'primary-btn');
  btn.innerHTML = '<i class="ti ti-copy"></i>Скопировать';
  btn.onclick = () => {
    const text = assembleDiagnosis();
    navigator.clipboard.writeText(text).then(() => {
      btn.innerHTML = '<i class="ti ti-check"></i>Скопировано';
      setTimeout(() => { btn.innerHTML = '<i class="ti ti-copy"></i>Скопировать'; }, 1500);
    });
  };
  wrap.appendChild(label);
  wrap.appendChild(box);
  wrap.appendChild(btn);

  // Кнопка кода МКБ — генерик, показывается для любой нозологии, у которой в JSON
  // задан icd10 (непустой массив). Формат элементов icd10 гибкий: либо просто строка-код
  // (легаси, как у ГБ/ХСН — код без расшифровки), либо {code, label} с описанием (ЯБ).
  if (state.data.icd10 && state.data.icd10.length) {
    const icdBtn = el('button', 'secondary-btn');
    icdBtn.style.marginTop = '10px';
    icdBtn.style.width = '100%';
    icdBtn.innerHTML = state.answers.icdCode
      ? `<i class="ti ti-pencil"></i>Код МКБ-10: ${state.answers.icdCode}`
      : '<i class="ti ti-plus"></i>Добавить код МКБ';
    icdBtn.onclick = () => { state.icdPageOpen = true; renderPage(); };
    wrap.appendChild(icdBtn);
  }

  return wrap;
}

// ---------- Экран выбора кода МКБ ----------
// Отдельный "экран" поверх текущей wizard-страницы (не часть pages[]), потому что код
// МКБ — не диагностический параметр самой нозологии, а техническая пометка для карты,
// применимая к любой уже собранной строке. Наверху — собранный диагноз (без кода, чтобы
// врач сверялся с клинической картиной), ниже — список кодов, клик по коду выбирает его
// (повторный клик по уже выбранному — снимает выбор, т.к. код может не понадобиться).
function renderIcdPage() {
  root.innerHTML = '';

  const header = el('div', 'header');
  header.innerHTML = `<p class="eyebrow">${state.data.name}</p><h1>Код МКБ-10</h1>`;
  root.appendChild(header);

  const diagBox = el('div', 'result-box');
  diagBox.textContent = assembleDiagnosis();
  root.appendChild(diagBox);

  const listLabel = el('p', 'group-label');
  listLabel.textContent = 'Выбери код';
  root.appendChild(listLabel);

  const wrap = el('div', 'stack');
  state.data.icd10.forEach(entry => {
    const code = typeof entry === 'string' ? entry : entry.code;
    const desc = typeof entry === 'string' ? null : entry.label;
    const selected = state.answers.icdCode === code;
    const card = el('div', 'card option' + (selected ? ' selected' : ''));
    card.appendChild(renderRadioRow(code, null, desc, selected));
    card.onclick = () => {
      state.answers.icdCode = selected ? undefined : code;
      renderPage();
    };
    wrap.appendChild(card);
  });
  root.appendChild(wrap);

  const nav = el('div', 'nav-row');
  const done = el('button', 'primary-btn');
  done.textContent = 'Готово';
  done.onclick = () => { state.icdPageOpen = false; renderPage(); };
  nav.appendChild(done);
  root.appendChild(nav);
}

// ---------- Навигация ----------
function renderNav(page) {
  const wrap = el('div', 'nav-row');
  if (state.pageIndex > 0) {
    const back = el('button', 'secondary-btn');
    back.textContent = 'Назад';
    back.onclick = () => { state.pageIndex = prevVisibleIndex(state.pageIndex); renderPage(); };
    wrap.appendChild(back);
  } else {
    const back = el('button', 'secondary-btn');
    back.textContent = 'К списку нозологий';
    back.onclick = () => { state.pageIndex = -1; init(); };
    wrap.appendChild(back);
  }

  if (isEffectivelyLastPage(state.pageIndex)) {
    const toList = el('button', 'primary-btn');
    toList.textContent = 'К списку нозологий';
    toList.onclick = () => { state.pageIndex = -1; init(); };
    wrap.appendChild(toList);
  } else {
    const next = el('button', 'primary-btn');
    next.textContent = 'Далее';
    next.onclick = () => {
      if (!canProceed(page)) return;
      state.pageIndex = nextVisibleIndex(state.pageIndex);
      renderPage();
    };
    wrap.appendChild(next);
  }
  return wrap;
}

function canProceed(page) {
  if (page.type === 'single') return state.answers[page.id === 'risk' ? 'risk' : page.id] !== undefined;
  if (page.type === 'single_grouped') return !!state.answers.degreeStatus;
  return true;
}

// ---------- Утилита ----------
// Приводим к нижнему регистру только первую букву подписи для кнопок
// "Показать .../Скрыть ..." — full toLowerCase() ломает аббревиатуры и римские
// цифры внутри подписи (напр. "Римские критерии IV" -> "римские критерии iv").
function lowerFirst(str) {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

// Согласование числительного с существительным для русских баллов/подобных слов
// (1 балл, 2-4 балла, 5-20 баллов, 21 балл, 22 балла...). Генерик-хелпер, не завязан
// на конкретную шкалу — используется в scorecalc (CHA2DS2-VASc, HAS-BLED), но подходит
// для любой будущей шкалы с суммой баллов. forms = [один, два-четыре, пять+].
function pluralRu(n, forms) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

// Значения текстовых полей сохраняются в state на каждый oninput, но страница НЕ
// перерисовывается на каждое нажатие (иначе поле теряет фокус посреди набора текста) —
// из-за этого итоговая строка визуально не обновляется, пока не произойдёт какой-то
// другой клик. По Enter — коммитим явно: перерисовываем, врач видит результат сразу.
function commitOnEnter(input) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      renderPage();
    }
  });
}

// ---------- Инициализация ----------
async function init() {
  const list = await loadIndex();
  renderNosologyList(list);
}

init();

// ---------- Service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js');
  });
}
