// ---------- Состояние ----------
const state = {
  nosologyId: null,
  data: null,
  pageIndex: -1, // -1 = экран выбора нозологии
  answers: {},
  icdPageOpen: false, // отдельный экран выбора кода МКБ, поверх текущей pageIndex-страницы
  // Экран передачи опросника пациенту (generic, добавлено для ХОБЛ, см. renderPatientHandoffPage) —
  // тот же паттерн отдельного экрана поверх pageIndex, что и icdPageOpen. null, когда закрыт;
  // {pageId, scaleType} — какую шкалу на какой странице сейчас проходит пациент.
  patientHandoffOpen: null
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
  state.patientHandoffOpen = null;
  renderPage();
}

// ---------- Рендер: страница мастера ----------
function renderPage() {
  if (state.icdPageOpen) { renderIcdPage(); return; }
  if (state.patientHandoffOpen) { renderPatientHandoffPage(); return; }
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
  } else if (page.type === 'compound') {
    root.appendChild(renderCompoundPage(page));
  } else if (page.type === 'scoredAssessment') {
    root.appendChild(renderScoredAssessment(page));
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
    } else if (page.type === 'scoredAssessment') {
      const group = deriveScoredAssessmentGroup(page);
      if (group) label = 'Группа ' + group.letter;
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

  // page.scorecalc (генерик, добавлено для пневмонии) — калькулятор суммируемой шкалы
  // на single-странице, независимый от того, какая опция выбрана (напр. SMART-COP/
  // SMRT-CO на странице "Тяжесть" — не альтернатива нетяжелой/тяжелой, а опциональное
  // дополнение к любой из них). По чекбоксу разворачивается тот же UI, что и у kind:
  // "scorecalc" в multi (переиспользуем renderScoreCalc() без дублирования логики).
  // Результат подставляется в diagnosisText выбранной опции через токен {key} —
  // см. buildSingleFragmentText().
  if (page.scorecalc) {
    const scKey = page.id + '__' + (page.scorecalc.key || 'scorecalc');
    if (!state.answers[scKey]) state.answers[scKey] = { checked: false, factors: {} };
    const scAnswer = state.answers[scKey];
    const scCard = el('div', 'card');
    const scLabelRow = el('label', 'check-row');
    const scBox = document.createElement('input');
    scBox.type = 'checkbox';
    scBox.checked = scAnswer.checked;
    scBox.onchange = () => { scAnswer.checked = scBox.checked; renderPage(); };
    const scSpan = el('span', null);
    scSpan.textContent = page.scorecalc.label;
    scLabelRow.appendChild(scBox);
    scLabelRow.appendChild(scSpan);
    scCard.appendChild(scLabelRow);
    if (page.scorecalc.criteria) {
      scCard.appendChild(renderExpandable(page.scorecalc, page.id));
    }
    if (scAnswer.checked) {
      scCard.appendChild(renderScoreCalc(page.scorecalc, scAnswer, page.id));
    }
    wrap.appendChild(scCard);
  }

  // page.indexCalcs (генерик, добавлено для Болезни Бехтерева) — массив независимых
  // клинических индексов на этой странице (BASDAI, ASDAS), каждый со своей карточкой:
  // числовое поле для готового значения + опционально кнопка передачи пациенту + для
  // индексов с лабораторным компонентом (ASDAS) — отдельное поле лабораторного значения.
  // В отличие от page.scorecalc (один калькулятор, сумма баллов по факторам) их может быть
  // несколько сразу на одной странице — по решению врача.
  if (page.indexCalcs) {
    page.indexCalcs.forEach(calc => wrap.appendChild(renderIndexCalc(page, calc)));
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
  // ref.highlight (опционально, generic) — визуально акцентирует именно эту кнопку
  // (напр. вопросы ВВЭ у постгеморрагической анемии), не трогая остальные expand-toggle.
  const btn = el('button', 'expand-toggle' + (ref.highlight ? ' expand-toggle-warning' : ''));
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
      setListItemText(li, text);
      list.appendChild(li);
    });
    wrap.appendChild(list);
  }

  // ref.image (опционально, generic, добавлено при работе над Хроническим панкреатитом) —
  // растровая схема/алгоритм из текста самой КР (напр. Приложение Б), для случаев, когда
  // ход рассуждения официально дан только как рисунок, а не как таблица/текст, и пересказ
  // текстом рискует исказить ветвление. ref.image.src — data URI (страница КР растеризована
  // и встроена как base64, без похода во внешнюю сеть); ref.image.alt — обязателен по
  // доступности; ref.image.caption — опциональная подпись под картинкой (напр. номер
  // алгоритма и страница КР). Ничего не меняет в существующих ref без image — поле нигде
  // больше не задано.
  if (ref.image) {
    const img = document.createElement('img');
    img.src = ref.image.src;
    img.alt = ref.image.alt || ref.label;
    img.style.maxWidth = '100%';
    img.style.display = 'block';
    img.style.margin = '8px 0';
    img.style.borderRadius = '8px';
    img.style.border = '1px solid var(--border, #e2e8f0)';
    wrap.appendChild(img);
    if (ref.image.caption) {
      const cap = el('p', 'option-hint');
      cap.style.marginTop = '4px';
      cap.textContent = ref.image.caption;
      wrap.appendChild(cap);
    }
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
    // по умолчанию показывается независимо от того, отмечен чекбокс или нет.
    //
    // item.criteriaOnlyIfChecked (генерик, добавлено для СД2 — страница «Осложнения» на
    // одной странице объединяет ~14 пунктов, подсказки всех сразу были бы избыточны) —
    // необязательный флаг, если true, criteria рендерится только при answer.checked.
    // Не задан ни у одного пункта уже выпущенных нозологий (Форрест у ЯБ, Фредриксен у ГБ
    // и т.п.) — их поведение не меняется.
    if (item.criteria && (!item.criteriaOnlyIfChecked || answer.checked)) {
      card.appendChild(renderExpandable(item, page.id));
    }

    // item.references (генерик, добавлено для СД2 — нефропатия) — то же самое, что
    // page.references (таблица/note/groups/image, см. renderPageReference), но привязано
    // к ОТДЕЛЬНОМУ пункту чекбокс-списка, а не ко всей странице, и рендерится только когда
    // пункт отмечен (в отличие от page.references, который виден всегда). Нужно, когда
    // подсказка — не список критериев (item.criteria поддерживает только плоский список), а
    // полноценная референсная таблица (напр. стадии ХБП по СКФ + классификация по
    // альбуминурии, Алгоритмы РАЭ по СД, стр. 63) — переиспользует renderPageReference()
    // без дублирования кода, ключ открытия/закрытия — составной (page.id + item.id), чтобы
    // не конфликтовать с page.references той же страницы или другими пунктами.
    if (answer.checked && item.references) {
      item.references.forEach(ref => card.appendChild(renderPageReference(page.id + '__' + item.id, ref)));
    }

    if (answer.checked && item.kind === 'degree') {
      const sel = document.createElement('select');
      item.options.forEach(d => {
        const o = document.createElement('option');
        // item.optionSuffix (опционально, generic) — суффикс, добавляемый к каждому варианту
        // в выпадающем списке. По умолчанию " степени" (прежнее поведение, не ломаем уже
        // выпущенные нозологии — Forrest у ЯБ, Фредриксен у ГБ и т.п., где суффикс не задан).
        // Пусто ("") или другое слово — когда "степени" грамматически не подходит (напр.
        // "обострение"/"ремиссия" у стадии хронического холецистита ЖКБ).
        const optionSuffix = item.optionSuffix !== undefined ? item.optionSuffix : ' степени';
        o.value = d; o.textContent = d + optionSuffix;
        if ((answer.degree || item.default) === d) o.selected = true;
        sel.appendChild(o);
      });
      if (!answer.degree) answer.degree = item.default;
      sel.onchange = () => { answer.degree = sel.value; state.answers.findings[item.id] = answer; renderPage(); };
      card.appendChild(sel);
    }

    // item.patientScale (generic, добавлено для ХОБЛ — ВАШ Борга на пункте "С обострением")
    // — та же механика, что catScale/mmrcScale на scoredAssessment-странице (см. выше), но
    // висит на ОТДЕЛЬНОМ ПУНКТЕ multi-страницы, а не на самой странице: рендерится внутри
    // карточки пункта, только пока он отмечен, независимо от item.kind — практически
    // используется рядом с kind:"degree", но по смыслу не альтернатива ему, а отдельный,
    // необязательный источник данных (врач сам решает степень тяжести обострения по всем 5
    // критериям Рис.2 КР, ВАШ Борга — только один из них, сюда автоматически не пишется).
    // По решению врача для ВАШ Борга (в отличие от CAT/mMRC на "Группе") нет собственного
    // тап-выбора врачом вообще — только подпись серым (psScale.label) + кнопка передачи
    // пациенту; после ответа значение просто дописывается отдельной строкой под кнопкой.
    if (answer.checked && item.patientScale) {
      const psScale = item.patientScale;
      const psWrap = document.createElement('div');
      psWrap.style.marginTop = '10px';
      const psCaption = el('p', 'group-label');
      psCaption.style.margin = '0 0 4px';
      psCaption.textContent = psScale.label;
      psWrap.appendChild(psCaption);
      if (psScale.patientHandoff) {
        psWrap.appendChild(renderPatientHandoffButton({ pageId: page.id, itemId: item.id, scaleField: 'patientScale' }, psScale.label));
      }
      if (answer[psScale.key] !== undefined) {
        const psResult = el('p', 'option-hint');
        psResult.style.marginTop = '6px';
        psResult.textContent = 'Ответ пациента: ' + answer[psScale.key] + ' баллов';
        psWrap.appendChild(psResult);
      }
      card.appendChild(psWrap);
    }

    if (answer.checked && item.kind === 'compound') {
      // item.stackFields (генерик, добавлено для СД2 — СДС: конечность с подписью сверху,
      // форма отдельной строкой ниже, а не бок о бок как OD/OS у ретинопатии) — опциональный
      // флаг уровня пункта: контейнер полей — вертикальная колонка (.stack) вместо горизонтального
      // ряда (.inline-fields). Не задан ни у одного уже выпущенного compound-пункта (ХБП/стеноз
      // у ГБ/ЯБ, ретинопатия/нефропатия у СД2) — их раскладка не меняется.
      const row = el('div', item.stackFields ? 'stack' : 'inline-fields');
      item.fields.forEach(fld => {
        // fld.label (генерик, добавлено для СД2 — ретинопатия OD/OS) — необязательная
        // подпись над конкретным полем (напр. "Правый глаз" / "Левый глаз"), когда одного
        // fld.prefix (виден только в собранной строке диагноза, не в самой форме) мало,
        // чтобы понять на экране, какое поле за что отвечает. Не задано ни у одного fld
        // ни одной уже выпущенной нозологии (ХБП у ГБ, стеноз у ЯБ) — их вёрстка не
        // меняется: без label поле рендерится в общий row, как и раньше.
        let target = row;
        if (fld.label) {
          target = el('div', null);
          target.style.display = 'flex';
          target.style.flexDirection = 'column';
          target.style.gap = '4px';
          const lbl = el('span', 'group-label');
          lbl.textContent = fld.label;
          target.appendChild(lbl);
          row.appendChild(target);
        }
        // fld.type === 'freetext' — текстовое поле вместо select, для случаев, когда
        // КР не даёт формального перечня значений (напр. локализация стеноза у ЯБ).
        if (fld.type === 'freetext') {
          const input = document.createElement('input');
          input.type = 'text';
          input.placeholder = fld.placeholder || '';
          input.value = answer[fld.key] || '';
          input.oninput = () => { answer[fld.key] = input.value; state.answers.findings[item.id] = answer; };
          commitOnEnter(input);
          target.appendChild(input);
          return;
        }
        const sel = document.createElement('select');
        fld.options.forEach(v => {
          const o = document.createElement('option'); o.value = v; o.textContent = v || '(не указан)';
          if ((answer[fld.key] || fld.default) === v) o.selected = true;
          sel.appendChild(o);
        });
        if (!answer[fld.key]) answer[fld.key] = fld.default;
        sel.onchange = () => { answer[fld.key] = sel.value; state.answers.findings[item.id] = answer; renderPage(); };
        target.appendChild(sel);
      });
      card.appendChild(row);
    }

    // item.ckdEpiCalc / item.wifiCalc (генерик, добавлено для СД2 — нефропатия/СДС) —
    // те же калькуляторы, что уже есть в приложении (renderCkdEpiCalc — легаси-механизм,
    // жёстко привязанный к page.id === 'gfr_stage' у отдельной нозологии ХБП, см. renderSingle;
    // renderWifiCalc — новый, см. ниже), теперь доступны и с чекбокс-пункта multi-страницы
    // любой нозологии через простой булев флаг. Оба калькулятора самодостаточны (state.ckdEpi /
    // state.wifi — глобальные, не завязаны на page.id/item.id) и ничего не пишут в ответ
    // пункта — врач переносит результат в select вручную, как и раньше.
    if (answer.checked && item.ckdEpiCalc) {
      card.appendChild(renderCkdEpiCalc());
    }
    if (answer.checked && item.wifiCalc) {
      card.appendChild(renderWifiCalc());
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

    // "lobe" (добавлено для пневмонии — выбор долей/сегментов лёгкого) — чекбоксы
    // сегментов рендерятся ВСЕГДА, а не только при отмеченной "вся доля" (answer.checked):
    // врач должен иметь возможность выбрать конкретные сегменты напрямую, без
    // обязательной предварительной отметки доли целиком. Приоритет между "вся доля" и
    // сегментами разрешается в renderFindingTemplate() при сборке текста.
    if (item.kind === 'lobe') {
      if (!answer.segments) answer.segments = {};
      const segWrap = el('div', 'inline-fields');
      segWrap.style.flexWrap = 'wrap';
      (item.segments || []).forEach(seg => {
        const segLabel = el('label', 'check-row');
        const segBox = document.createElement('input');
        segBox.type = 'checkbox';
        segBox.checked = !!answer.segments[seg.id];
        segBox.onchange = () => {
          answer.segments[seg.id] = segBox.checked;
          state.answers.findings[item.id] = answer;
          renderPage();
        };
        const segSpan = el('span', null);
        segSpan.textContent = seg.label;
        segLabel.appendChild(segBox);
        segLabel.appendChild(segSpan);
        segWrap.appendChild(segLabel);
      });
      card.appendChild(segWrap);
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

  // page.references на multi-странице (генерик, добавлено для ХОБЛ — подсказка по ВАШ Борга
  // на странице «Обострение») — тот же механизм и та же функция renderPageReference(), что
  // уже используется на single/compound/scoredAssessment страницах (см. соответствующие
  // разделы), сюда до сих пор не была подключена просто потому, что ни одной multi-странице
  // это не требовалось. Рендерится один раз после всех пунктов, а не внутри item.criteria —
  // это отдельный блок практической информации, не критерии конкретного пункта чекбокс-списка.
  if (page.references) {
    page.references.forEach(ref => wrap.appendChild(renderPageReference(page.id, ref)));
  }

  return wrap;
}

// page.type === 'compound' (добавлено для ИБС — изолированный постинфарктный кардиосклероз)
// — страница чистого ввода полей (freetext/select), БЕЗ радио-выбора и БЕЗ чекбокса-гейта
// поверх, в отличие от kind: "compound" внутри multi (там поля появляются только после
// отметки чекбокса пункта). Нужна, когда странице нечего "выбирать" — только заполнить
// атрибуты уже выбранной на предыдущей странице формы (дата/локализация/тип ИМ). Значения
// живут в state.answers[page.id] (объект по ключам полей), а не в state.answers.findings —
// это не multi-пункт. Поля начинают собираться в строку, только когда заполнено хотя бы
// одно (см. buildCompoundPageText) — пустая страница не оставляет в диагнозе пустых скобок.
function renderCompoundPage(page) {
  const wrap = el('div', 'stack');

  if (page.note) {
    const staticNote = el('div', 'note');
    staticNote.innerHTML = `<i class="ti ti-info-circle"></i><span>${page.note}</span>`;
    wrap.appendChild(staticNote);
  }

  if (!state.answers[page.id]) state.answers[page.id] = {};
  const values = state.answers[page.id];
  const card = el('div', 'card');
  card.style.cursor = 'default';
  const row = el('div', 'inline-fields');
  page.fields.forEach(fld => {
    if (fld.type === 'freetext') {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = fld.placeholder || '';
      input.value = values[fld.key] || '';
      input.oninput = () => { values[fld.key] = input.value; };
      commitOnEnter(input);
      row.appendChild(input);
      return;
    }
    const sel = document.createElement('select');
    fld.options.forEach(v => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v || '(не указан)';
      if ((values[fld.key] || fld.default) === v) o.selected = true;
      sel.appendChild(o);
    });
    if (values[fld.key] === undefined) values[fld.key] = fld.default;
    sel.onchange = () => { values[fld.key] = sel.value; renderPage(); };
    row.appendChild(sel);
  });
  card.appendChild(row);
  wrap.appendChild(card);

  if (page.references) {
    page.references.forEach(ref => wrap.appendChild(renderPageReference(page.id, ref)));
  }

  return wrap;
}

// page.type === 'scoredAssessment' (добавлено для ХОБЛ — группа A/B/E по CAT+mMRC+частоте
// обострений, Рис. 1 КР "ХОБЛ" 2024, GOLD 2023). Комбинирует на одной странице суммируемую
// 8-доменную шкалу (page.catScale, 0-40 баллов), одиночный select (page.mmrcScale, 0-4) и
// раздельный ввод частоты/госпитализации обострений (page.frequency) — и сам вычисляет
// производную 3-категорийную группу. В отличие от page.scorecalc (необязательная надстройка
// НАД уже сделанным выбором) здесь сама группа — это и есть результат страницы, поэтому
// вычисляется без ручного переопределения (по прямому решению врача: правило по Рис.1
// безвилочное). Правило вывода (см. deriveScoredAssessmentGroup) — фиксированный алгоритм
// именно этого типа страницы, не универсальный конструктор правил: для не-ABE-образной
// шкалы в будущем эту функцию придётся расширять, а не только JSON.
// Карточки одиночного выбора для шкалы вида {value, hint?} — общий рендер для mMRC и любой
// будущей/добавленной шкалы такого же вида (напр. ВАШ Борга у ХОБЛ). Число — всегда жирным
// заголовком (а не описание) — важно для шкал, где не у каждого уровня своя формулировка.
//
// Группировка (добавлено для ВАШ Борга, generic) — источник может давать ОДНУ подпись сразу
// на НЕСКОЛЬКО соседних чисел (напр. у Борга по oxy2.ru: 4-5 — «одышка выражена сильно, но
// терпеть можно», 6-7-8 — «одышка выражена сильно»), а не по подписи на каждое число отдельно
// — по решению врача. Определяется по данным, а не отдельным флагом в JSON: подряд идущие
// пункты с ОДИНАКОВЫМ непустым hint схлопываются в один блок с ОДНОЙ подписью и рядом мелких
// кликабельных чисел внутри (переиспользует стиль `.num-scale-item`, но с шириной по
// содержимому — не растягивается на всю строку, как у 6-элементного ряда CAT). Пациент
// внутри группы всё равно выбирает конкретное число сам — группировка только про подпись,
// не про сокращение число вариантов. Пункты с уникальным или отсутствующим hint — как раньше,
// отдельная карточка на каждый (у mMRC подписи всегда уникальны, так что для неё это ничего
// не меняет визуально).
function renderScaleOptionCards(options, currentValue, onSelect) {
  const stack = el('div', 'stack');
  let i = 0;
  while (i < options.length) {
    const hint = options[i].hint;
    let j = i + 1;
    if (hint) {
      while (j < options.length && options[j].hint === hint) j++;
    }
    const group = options.slice(i, j);
    if (group.length > 1) {
      const card = el('div', 'card');
      card.style.cursor = 'default';
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';
      group.forEach(opt => {
        const selected = currentValue === opt.value;
        const item = el('div', 'num-scale-item' + (selected ? ' selected' : ''));
        item.style.flex = 'none';
        item.style.width = '44px';
        item.textContent = opt.value;
        item.onclick = () => onSelect(opt.value);
        row.appendChild(item);
      });
      card.appendChild(row);
      const hintP = el('p', 'option-hint');
      hintP.style.marginTop = '8px';
      hintP.textContent = hint;
      card.appendChild(hintP);
      stack.appendChild(card);
    } else {
      const opt = options[i];
      const selected = currentValue === opt.value;
      const card = el('div', 'card option' + (selected ? ' selected' : ''));
      card.appendChild(renderRadioRow(String(opt.value), null, opt.hint, selected));
      card.onclick = () => onSelect(opt.value);
      stack.appendChild(card);
    }
    i = j;
  }
  return stack;
}

function renderScoredAssessment(page) {
  const wrap = el('div', 'stack');
  if (!state.answers[page.id]) {
    state.answers[page.id] = { cat: {}, catScore: undefined, mmrc: undefined, freqCount: undefined, hospitalization: false };
  }
  const a = state.answers[page.id];

  if (page.note) {
    const staticNote = el('div', 'note');
    staticNote.innerHTML = `<i class="ti ti-info-circle"></i><span>${page.note}</span>`;
    wrap.appendChild(staticNote);
  }

  // --- CAT --- (по решению врача: либо врач сам вводит готовую сумму баллов, либо отдаёт
  // тест пациенту — 8 отдельных доменов на странице врача не показываются вовсе, чтобы не
  // перегружать страницу; домены остаются только на экране пациента, см.
  // renderPatientHandoffPage(). Сумма живёт в a.catScore (простое число) независимо от
  // того, как получена — вручную или из ответов пациента.
  const cat = page.catScale;
  const catCard = el('div', 'card');
  catCard.style.cursor = 'default';
  const catHeader = el('p', 'group-label');
  catHeader.style.margin = '0 0 4px';
  catHeader.textContent = cat.label;
  catCard.appendChild(catHeader);
  if (cat.patientHandoff) {
    catCard.appendChild(renderPatientHandoffButton({ pageId: page.id, scaleField: 'catScale' }, cat.label));
  }
  const catInputRow = document.createElement('div');
  catInputRow.style.marginTop = '8px';
  const catInputLbl = document.createElement('label');
  catInputLbl.textContent = 'Сумма баллов CAT (0–40)';
  catInputLbl.style.display = 'block';
  catInputLbl.style.fontSize = '12.5px';
  catInputLbl.style.color = 'var(--text-secondary)';
  const catInput = document.createElement('input');
  catInput.type = 'number';
  catInput.min = '0';
  catInput.max = '40';
  catInput.step = '1';
  catInput.style.width = '100%';
  catInput.placeholder = 'напр. 14';
  catInput.value = a.catScore !== undefined ? a.catScore : '';
  catInput.oninput = () => {
    a.catScore = catInput.value === '' ? undefined : parseInt(catInput.value, 10);
  };
  commitOnEnter(catInput);
  catInputRow.appendChild(catInputLbl);
  catInputRow.appendChild(catInput);
  catCard.appendChild(catInputRow);
  if (cat.criteria) {
    catCard.appendChild(renderExpandable(cat, page.id));
  }
  wrap.appendChild(catCard);

  // --- mMRC ---
  const mmrc = page.mmrcScale;
  const mmrcCard = el('div', 'card');
  mmrcCard.style.cursor = 'default';
  const mmrcHeader = el('p', 'group-label');
  mmrcHeader.style.margin = '0 0 4px';
  mmrcHeader.textContent = mmrc.label;
  mmrcCard.appendChild(mmrcHeader);
  if (mmrc.patientHandoff) {
    mmrcCard.appendChild(renderPatientHandoffButton({ pageId: page.id, scaleField: 'mmrcScale' }, mmrc.label));
  }
  const mmrcStack = renderScaleOptionCards(mmrc.options, a.mmrc, (v) => { a.mmrc = v; renderPage(); });
  mmrcStack.style.marginTop = '8px';
  mmrcCard.appendChild(mmrcStack);
  wrap.appendChild(mmrcCard);

  // --- Частота обострений ---
  const freq = page.frequency;
  const freqCard = el('div', 'card');
  freqCard.style.cursor = 'default';
  const freqHeader = el('p', 'group-label');
  freqHeader.style.margin = '0 0 4px';
  freqHeader.textContent = 'Обострения за последний год';
  freqCard.appendChild(freqHeader);
  const freqStack = el('div', 'stack');
  freqStack.style.marginTop = '8px';
  freq.countOptions.forEach(opt => {
    const selected = a.freqCount === opt.value;
    const optCard = el('div', 'card option' + (selected ? ' selected' : ''));
    optCard.appendChild(renderRadioRow(opt.label, null, null, selected));
    optCard.onclick = () => { a.freqCount = opt.value; renderPage(); };
    freqStack.appendChild(optCard);
  });
  freqCard.appendChild(freqStack);
  const hospRow = el('label', 'check-row');
  hospRow.style.marginTop = '10px';
  const hospBox = document.createElement('input');
  hospBox.type = 'checkbox';
  hospBox.checked = a.hospitalization;
  hospBox.onchange = () => { a.hospitalization = hospBox.checked; renderPage(); };
  const hospSpan = el('span', null);
  hospSpan.textContent = freq.hospitalizationLabel;
  hospRow.appendChild(hospBox);
  hospRow.appendChild(hospSpan);
  freqCard.appendChild(hospRow);
  wrap.appendChild(freqCard);

  // --- Результат: вычисленная группа (не переопределяется вручную) ---
  const group = deriveScoredAssessmentGroup(page);
  const groupNote = el('div', 'note');
  groupNote.style.marginTop = '4px';
  groupNote.innerHTML = group
    ? `<i class="ti ti-report-analytics"></i><span><b>${group.text}</b></span>`
    : `<i class="ti ti-info-circle"></i><span>Заполните CAT, mMRC и частоту обострений — группа вычисляется автоматически по Рис. 1 КР и не редактируется вручную.</span>`;
  wrap.appendChild(groupNote);

  if (page.references) {
    page.references.forEach(ref => wrap.appendChild(renderPageReference(page.id, ref)));
  }

  return wrap;
}

// Одна строка CAT (общая для врачебного вида и экрана пациента, см. renderPatientHandoffPage) —
// градуированный числовой ряд 0-5 (по решению врача — пациенту так визуально проще, чем
// выпадающий список), без предзаполненного значения по умолчанию: пока домен не отвечен
// явно, сумма (computeCatScore) не считается вовсе, а не молча считается нулём.
// maxValue (генерик, добавлено для Болезни Бехтерева — BASDAI/ASDAS используют ЧРШ 0-10,
// не 0-5 как CAT) — необязательный параметр, по умолчанию 5 (прежнее поведение, CAT у ХОБЛ
// его не передаёт — ничего не меняется).
function renderCatDomainField(dom, currentValue, onChange, maxValue) {
  const max = maxValue !== undefined ? maxValue : 5;
  const row = document.createElement('div');
  row.style.marginTop = '10px';
  const lbl = document.createElement('p');
  lbl.className = 'option-title';
  lbl.style.margin = '0';
  lbl.textContent = dom.question;
  const hint = el('p', 'option-hint');
  hint.textContent = `${dom.low} (0) — ${dom.high} (${max})`;
  const scale = el('div', 'num-scale');
  for (let v = 0; v <= max; v++) {
    const item = el('div', 'num-scale-item' + (currentValue === v ? ' selected' : ''));
    item.textContent = v;
    item.onclick = () => onChange(v);
    scale.appendChild(item);
  }
  row.appendChild(lbl);
  row.appendChild(hint);
  row.appendChild(scale);
  return row;
}

// Сумма CAT — null, если хоть один из 8 доменов не отвечен (не считаем частичную сумму,
// т.к. незаполненный пункт молча трактовался бы как 0 — заведомо неверно).
function computeCatScore(catScale, catAnswers) {
  let sum = 0;
  for (const dom of catScale.domains) {
    const v = catAnswers ? catAnswers[dom.key] : undefined;
    if (v === undefined || v === null) return null;
    sum += v;
  }
  return sum;
}

// ---------- Калькуляторы клинических индексов на пациентских ЧРШ-доменах + опц. лабораторное
// значение (generic: page.indexCalcs, добавлено для Болезни Бехтерева — BASDAI/ASDAS,
// Прил. Г1/Г3 КР) ----------
// В отличие от computeCatScore (плоская сумма доменов, используется CAT/группой ABE у ХОБЛ),
// здесь формула — взвешенная (BASDAI: среднее с половинным весом последних двух пунктов;
// ASDAS: линейная комбинация с ln/√ лабораторного маркера). scale.formulaType выбирает
// формулу; answer.domains — пациентская часть (все домены обязательны, гарантируется
// гейтингом "Готово" на экране пациента, см. renderPatientHandoffPage), answer.labValue/
// answer.lab — лабораторный ввод врача (не часть опроса пациента, см. renderIndexCalc).
// Возвращает null, если посчитать нельзя (для ASDAS — лабораторное значение ещё не введено) —
// вызывающий код в этом случае НЕ затирает то, что было в answer.score раньше.
function computeIndexCalcScore(scale, answer) {
  const d = answer.domains || {};
  if (scale.formulaType === 'basdai') {
    // Индекс BASDAI (Прил. Г1 КР): (п.1+п.2+п.3+п.4+(п.5+п.6)/2) / 5
    if ([d.q1, d.q2, d.q3, d.q4, d.q5, d.q6].some(v => v === undefined || v === null)) return null;
    const raw = (d.q1 + d.q2 + d.q3 + d.q4 + (d.q5 + d.q6) / 2) / 5;
    return roundTo(raw, 1);
  }
  if (scale.formulaType === 'asdas') {
    const lab = answer.labValue;
    if (lab === undefined || lab === null || isNaN(lab)) return null;
    if ([d.back, d.global, d.joints, d.stiffness].some(v => v === undefined || v === null)) return null;
    let raw;
    if (answer.lab === 'esr') {
      // ASDAS(СОЭ), Прил. Г3 КР
      raw = 0.113 * d.global + 0.293 * Math.sqrt(Math.max(lab, 0)) + 0.086 * d.joints + 0.069 * d.stiffness + 0.079 * d.back;
    } else {
      // ASDAS(С-РБ), Прил. Г3 КР — предпочтительный вариант индекса по КР
      raw = 0.121 * d.back + 0.110 * d.global + 0.073 * d.joints + 0.058 * d.stiffness + 0.579 * Math.log(lab + 1);
    }
    return roundTo(raw, 1);
  }
  return null;
}

function roundTo(n, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

// Русское форматирование десятичной дроби (запятая, не точка) — так во всех официальных
// примерах КР ("BASDAI 7,8"). Генерик-хелпер, не завязан на конкретный индекс.
function formatRuDecimal(n, decimals) {
  return n.toFixed(decimals).replace('.', ',');
}

// Правило вывода группы (Рис. 1 КР "ХОБЛ" 2024, GOLD 2023) — безвилочное:
// госпитализация ИЛИ ≥2 обострений средней тяжести за год -> E (независимо от симптомов);
// иначе при CAT≥10 или mMRC≥2 -> B; иначе -> A. Возвращает null, пока не заполнены все три
// входа (CAT, mMRC, частота) — до этого группа не показывается и не пишется в диагноз.
// CAT — простое число a.catScore (страница врача больше не считает сумму по доменам сама:
// либо врач вводит готовую сумму текстовым полем, либо она приходит с экрана пациента —
// computeCatScore() используется только ТАМ, для гейтинга "Готово" по 8 доменам).
function deriveScoredAssessmentGroup(page) {
  const a = state.answers[page.id];
  if (!a) return null;
  const catScore = a.catScore;
  if (catScore === undefined || catScore === null || isNaN(catScore) || a.mmrc === undefined || !a.freqCount) return null;

  const letter = (a.hospitalization || a.freqCount === '2plus')
    ? 'E'
    : (catScore >= 10 || a.mmrc >= 2 ? 'B' : 'A');

  const freq = page.frequency;
  const countOpt = freq.countOptions.find(o => o.value === a.freqCount);
  let frequencyLabel = countOpt ? countOpt.shortLabel : '';
  if (a.hospitalization) frequencyLabel += (freq.hospitalizationSuffix || ', в т.ч. с госпитализацией');

  const text = page.template
    .replace('{group}', letter)
    .replace('{catScore}', catScore)
    .replace('{mmrcValue}', a.mmrc)
    .replace('{frequencyLabel}', frequencyLabel);

  return { letter, text };
}

// ---------- Экран передачи опросника пациенту (generic, добавлено для ХОБЛ) ----------
// Тот же паттерн, что renderIcdPage(): отдельный "экран" поверх текущей wizard-страницы, не
// часть pages[]. Пациент видит ТОЛЬКО вопросы, без интерпретации и без суммы баллов (по
// решению врача) — открытие экрана сразу обнуляет прежние ответы по этой шкале, в т.ч.
// черновые ответы врача, без предупреждения (тоже по решению врача). "Готово" неактивна,
// пока не отвечены ВСЕ пункты шкалы. Ответы пишутся в те же ключи state.answers, что и
// обычный врачебный ввод — при возврате остальной движок не отличает, кто именно заполнял.
//
// Локатор шкалы — {pageId, itemId?, scaleField} (generic, обобщено при добавлении ВАШ Борга
// у ХОБЛ — изначально шкала могла жить только на самой scoredAssessment-странице [catScale/
// mmrcScale], теперь может висеть и на ПУНКТЕ multi-страницы через item.patientScale, напр.
// «С обострением» → ВАШ Борга). itemId не задан → шкала на уровне страницы (page[scaleField]),
// ответ хранится в state.answers[pageId]; itemId задан → шкала на уровне пункта чекбокс-списка
// (item[scaleField]), ответ — в state.answers.findings[itemId]. resolveScaleContext()
// возвращает единую форму для обоих случаев, дальше движок работает с ней одинаково.
// locator.indexCalcKey (генерик, добавлено для Болезни Бехтерева — BASDAI/ASDAS на странице
// "Активность") — третья форма локатора, наряду с item-уровнем (itemId) и page-уровнем
// (scaleField). Шкала живёт не в page[scaleField]/item[scaleField], а в массиве
// page.indexCalcs (несколько независимых калькуляторов на одной странице — см.
// renderIndexCalc). Ответ хранится в state.answers[pageId + '__' + indexCalcKey] — том же
// объекте, что и ручной ввод итогового числа (answer.score) и, для ASDAS, лабораторного
// значения (answer.labValue/answer.lab) — единый источник истины независимо от способа
// заполнения. valueKey зафиксирован как 'domains' (вложенный объект под ответы пациента),
// а не scale.key — здесь scale.key используется для другого (id калькулятора в JSON), чтобы
// не путать с полем-контейнером опроса. isSum всегда true: у BASDAI/ASDAS пациентская часть
// — это всегда набор ЧРШ-вопросов, а не одиночный выбор (в отличие от mMRC/Борга).
function resolveScaleContext(locator) {
  const { pageId, itemId, scaleField, indexCalcKey } = locator;
  const page = state.data.pages.find(p => p.id === pageId);
  let scale, answer, valueKey, isSum;
  if (indexCalcKey) {
    scale = page.indexCalcs.find(c => c.key === indexCalcKey);
    const icKey = pageId + '__' + indexCalcKey;
    if (!state.answers[icKey]) state.answers[icKey] = {};
    answer = state.answers[icKey];
    valueKey = 'domains';
    isSum = true;
  } else if (itemId) {
    const item = page.items.find(i => i.id === itemId);
    scale = item[scaleField];
    if (!state.answers.findings) state.answers.findings = {};
    if (!state.answers.findings[itemId]) state.answers.findings[itemId] = { checked: true };
    answer = state.answers.findings[itemId];
    valueKey = scale.key;
    isSum = !!scale.domains;
  } else {
    scale = page[scaleField];
    if (!state.answers[pageId]) state.answers[pageId] = {};
    answer = state.answers[pageId];
    valueKey = scale.key;
    isSum = !!scale.domains;
  }
  return { scale, answer, valueKey, isSum };
}

function openPatientHandoff(locator) {
  const { scale, answer, valueKey, isSum } = resolveScaleContext(locator);
  answer[valueKey] = isSum ? {} : undefined;
  state.patientHandoffOpen = locator;
  renderPage();
}

function renderPatientHandoffButton(locator, scaleLabel) {
  const btn = el('button', 'secondary-btn');
  btn.style.marginTop = '8px';
  btn.style.width = '100%';
  btn.innerHTML = '<i class="ti ti-device-mobile"></i>Дать пациенту пройти тест';
  btn.onclick = (e) => {
    e.stopPropagation();
    openPatientHandoff(locator);
  };
  return btn;
}

function renderPatientHandoffPage() {
  root.innerHTML = '';
  const locator = state.patientHandoffOpen;
  const { scale, answer, valueKey, isSum } = resolveScaleContext(locator);

  // Минимальная шапка (по решению врача) — только название шкалы и одна строка инструкции,
  // без бренда мастера/нозологии над ней.
  const header = el('div', 'header');
  header.innerHTML = `<h1>${scale.label}</h1><p class="option-hint">Отметьте, что ближе всего к вашему состоянию сейчас.</p>`;
  root.appendChild(header);

  const wrap = el('div', 'stack');

  if (isSum) {
    scale.domains.forEach(dom => {
      const card = el('div', 'card');
      card.style.cursor = 'default';
      card.appendChild(renderCatDomainField(dom, answer[valueKey][dom.key], (v) => { answer[valueKey][dom.key] = v; renderPage(); }, scale.domainMax));
      wrap.appendChild(card);
    });
  } else {
    wrap.appendChild(renderScaleOptionCards(scale.options, answer[valueKey], (v) => { answer[valueKey] = v; renderPage(); }));
  }
  root.appendChild(wrap);

  const complete = isSum
    ? scale.domains.every(dom => answer[valueKey][dom.key] !== undefined)
    : answer[valueKey] !== undefined;

  const nav = el('div', 'nav-row');

  // "Назад" — выйти можно и не ответив на всё (по решению врача); в этом случае результат
  // сбрасывается: незавершённый ответ пациента не должен молча остаться в состоянии как
  // будто это законченные данные. Тот же сброс, что и при открытии экрана (openPatientHandoff),
  // просто без повторного захода на экран.
  const back = el('button', 'secondary-btn');
  back.textContent = 'Назад';
  back.onclick = () => {
    answer[valueKey] = isSum ? {} : undefined;
    state.patientHandoffOpen = null;
    renderPage();
  };
  nav.appendChild(back);

  const done = el('button', 'primary-btn');
  done.textContent = 'Готово';
  if (!complete) done.style.opacity = '0.5';
  done.onclick = () => {
    if (!complete) return;
    // indexCalcKey (BASDAI/ASDAS, Болезнь Бехтерева) — считаем по формуле именно этого
    // индекса (не плоская сумма, см. computeIndexCalcScore) и пишем результат прямо в
    // answer.score — то же поле, которое врач мог бы заполнить вручную числом на своей
        // странице (см. renderIndexCalc). Если формула не может посчитаться (для ASDAS — ещё
    // не введено лабораторное значение), answer.score НЕ трогаем: то, что было введено
    // вручную раньше, не затирается пустым результатом.
    if (locator.indexCalcKey) {
      const computed = computeIndexCalcScore(scale, answer);
      if (computed !== null) answer.score = computed;
    } else if (isSum) {
      // Для суммируемой шкалы (CAT) сумма по доменам пишется в отдельное поле <ключ>Score
      // (напр. a.catScore) — то же поле, которое врач мог бы заполнить вручную текстовым полем
      // на своей странице (см. renderScoredAssessment). Один источник истины для отображения
      // независимо от способа получения числа. Для одиночного выбора (mMRC/Борг) значение и так
      // уже лежит прямо в answer[valueKey] — отдельного поля с суммой не нужно.
      answer[valueKey + 'Score'] = computeCatScore(scale, answer[valueKey]);
    }
    state.patientHandoffOpen = null;
    renderPage();
  };
  nav.appendChild(done);
  root.appendChild(nav);
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
      setListItemText(li, c);
      list.appendChild(li);
    });
    wrap.appendChild(list);
  }
  return wrap;
}

// Формат элемента opt.criteria/ref.criteria — гибкий (добавлено при работе над Бронхиальной
// астмой): обычная строка -> li.textContent (прежнее поведение, без изменений для всех уже
// выпущенных нозологий — ни одна не использует объектный формат); объект {html: "..."} ->
// li.innerHTML, точечный опт-ин для форматирования (напр. <b>жирный</b>) внутри конкретной
// строки подсказки. Не переключаем весь список на innerHTML огулом: часть существующих
// критериев (напр. пороговые значения "ПСВ <33%", "PaO2 <60") содержат "<"/">" как обычные
// символы сравнения — при innerHTML браузер принял бы их за начало тега и обрезал текст.
// Такие строки остаются обычными строками и продолжают идти через textContent.
function setListItemText(li, entry) {
  if (entry && typeof entry === 'object' && entry.html !== undefined) li.innerHTML = entry.html;
  else li.textContent = entry;
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

// ---------- Калькулятор риска потери конечности WIfI (СДС) ----------
// Источник: «Алгоритмы специализированной медицинской помощи больным сахарным диабетом»
// (РАЭ, 12-й вып., 2026), разд. 14, стр. 101-103 — не действующая КР, формулировка не
// сверена по тексту профильной КР. Классификация W (Wound, глубина поражения тканей
// стопы), I (Ischemia, по ЛПИ/систолическому давлению в артерии голени/транскутанному
// напряжению кислорода), fI (foot Infection, тяжесть инфекции стопы), каждая 0-3. Итоговый
// риск потери конечности в течение 1 года и показания к реваскуляризации — из готовых
// таблиц (не вычисляются по формуле, это справочные матрицы 4×4×4, перенесённые как есть).
// Самодостаточен по образцу renderCkdEpiCalc — state.wifi глобальный, не завязан на
// page.id/item.id, калькулятор только считает, вариант формы/конечности на самой странице
// врач по-прежнему выбирает сам.
const WIFI_RISK_LABELS = { 'ОН': 'Очень низкий', 'Н': 'Низкий', 'У': 'Умеренный', 'В': 'Высокий' };
// [I][W] -> [fI0, fI1, fI2, fI3]
const WIFI_LIMB_LOSS_MATRIX = [
  [['ОН','ОН','Н','У'], ['ОН','ОН','Н','У'], ['Н','Н','У','В'], ['У','У','В','В']], // I-0
  [['ОН','Н','У','В'], ['ОН','Н','У','В'], ['У','У','В','В'], ['В','В','В','В']],   // I-1
  [['Н','Н','У','В'], ['Н','У','В','В'], ['У','В','В','В'], ['В','В','В','В']],     // I-2
  [['Н','У','У','В'], ['У','У','В','В'], ['В','В','В','В'], ['В','В','В','В']]      // I-3
];
const WIFI_REVASC_MATRIX = [
  [['ОН','ОН','ОН','ОН'], ['ОН','ОН','ОН','ОН'], ['ОН','ОН','ОН','ОН'], ['ОН','ОН','ОН','ОН']], // I-0
  [['ОН','Н','Н','У'], ['Н','У','У','У'], ['У','У','В','В'], ['У','У','У','В']],                 // I-1
  [['Н','Н','У','У'], ['У','В','В','В'], ['В','В','В','В'], ['В','В','В','В']],                  // I-2
  [['У','В','В','В'], ['В','В','В','В'], ['В','В','В','В'], ['В','В','В','В']]                   // I-3
];

function renderWifiCalc() {
  if (!state.wifi) state.wifi = { w: '0', i: '0', fi: '0', result: null };
  const c = state.wifi;
  const wrap = el('div', 'expand');
  const isOpen = !!state['wifi-open'];
  const btn = el('button', 'expand-toggle');
  btn.textContent = isOpen ? 'Скрыть калькулятор WIfI (риск потери конечности)' : 'Показать калькулятор WIfI (риск потери конечности)';
  btn.onclick = () => { state['wifi-open'] = !isOpen; renderPage(); };
  wrap.appendChild(btn);
  if (!isOpen) return wrap;

  const note = el('div', 'note');
  note.innerHTML = '<i class="ti ti-info-circle"></i><span>Классификация WIfI (Wound/Ischemia/foot Infection) — источник: «Алгоритмы» РАЭ, разд. 14, стр. 101-103, ' +
    'не действующая КР. Калькулятор только считает риск по готовой матрице — вариант формы СДС на странице выбирает врач сам.</span>';
  wrap.appendChild(note);

  function gradeTable(title, headers, rows) {
    const label = el('p', 'group-label');
    label.style.marginTop = '10px';
    label.textContent = title;
    wrap.appendChild(label);
    const table = document.createElement('table');
    table.className = 'risk-table';
    let html = '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
    rows.forEach(row => { html += '<tr>' + row.map(cell => `<td>${cell}</td>`).join('') + '</tr>'; });
    table.innerHTML = html;
    wrap.appendChild(table);
  }

  gradeTable('W — глубина поражения тканей стопы', ['Степень', 'Язва', 'Гангрена'], [
    ['0', 'нет', 'нет'],
    ['1', 'малая поверхностная язва дистального отдела, без вовлечения костных структур (кроме дистальных фаланг)', 'нет'],
    ['2', 'глубокая язва с вовлечением костей/суставов/сухожилий', 'ограничивается фалангами пальцев'],
    ['3', 'обширная глубокая язва, в т.ч. пяточной области с вовлечением пяточной кости', 'распространяется на передний/средний отдел стопы ± пяточная кость']
  ]);
  gradeTable('I — ишемия', ['Степень', 'ЛПИ', 'Сист. АД в артерии голени, мм рт.ст.', 'Транскутанное напряжение O₂ / пальцевое давление, мм рт.ст.'], [
    ['0', '≥0,8', '>100', '≥60'],
    ['1', '0,6–0,79', '70–100', '40–59'],
    ['2', '0,4–0,59', '50–70', '30–39'],
    ['3', '≤0,39', '<50', '<30']
  ]);
  gradeTable('fI — инфекция стопы', ['Степень', 'Критерии'], [
    ['0', 'нет симптомов и признаков инфекции'],
    ['1 (лёгкая)', '2 из: локальный отёк/инфильтрация, эритема 0,5-2 см, местное напряжение/болезненность, локальная гипертермия, гнойное отделяемое'],
    ['2 (средняя)', 'гиперемия >2 см или вовлечение структур глубже кожи/подкожной клетчатки (абсцесс, остеомиелит, септический артрит, фасциит), без системных признаков'],
    ['3 (тяжёлая)', 'местная инфекция + 2 из: t° >38° или <36°, ЧСС >90, ЧД >20 или PaCO2 <32, лейкоциты >12000/<4000 или >10% юных форм']
  ]);

  function gradeSelect(labelText, key) {
    const row = document.createElement('div');
    row.style.marginTop = '8px';
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    lbl.style.display = 'block';
    lbl.style.fontSize = '12.5px';
    lbl.style.color = 'var(--text-secondary)';
    const sel = document.createElement('select');
    sel.style.width = '100%';
    sel.style.marginTop = '4px';
    ['0', '1', '2', '3'].forEach(v => {
      const o = document.createElement('option'); o.value = v; o.textContent = v;
      if (c[key] === v) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => { c[key] = sel.value; renderPage(); };
    row.appendChild(lbl);
    row.appendChild(sel);
    return row;
  }

  wrap.appendChild(gradeSelect('W (0-3)', 'w'));
  wrap.appendChild(gradeSelect('I (0-3)', 'i'));
  wrap.appendChild(gradeSelect('fI (0-3)', 'fi'));

  const calcBtn = el('button', 'primary-btn');
  calcBtn.style.marginTop = '10px';
  calcBtn.textContent = 'Рассчитать';
  calcBtn.onclick = () => {
    const i = parseInt(c.i, 10), w = parseInt(c.w, 10), fi = parseInt(c.fi, 10);
    const limbLoss = WIFI_LIMB_LOSS_MATRIX[i][w][fi];
    const revasc = WIFI_REVASC_MATRIX[i][w][fi];
    c.result = { limbLoss, revasc };
    renderPage();
  };
  wrap.appendChild(calcBtn);

  if (c.result) {
    const resBox = el('div', 'note');
    resBox.innerHTML = `<i class="ti ti-report-analytics"></i><span>` +
      `<b>Риск потери конечности в течение 1 года: ${WIFI_RISK_LABELS[c.result.limbLoss]} (${c.result.limbLoss})</b><br>` +
      `Показания к реваскуляризации (при контроле инфекции): ${WIFI_RISK_LABELS[c.result.revasc]} (${c.result.revasc})` +
      `</span>`;
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
  if (page.scorecalc) {
    // Результат page-level scorecalc (напр. "(SMRT-CO - 4)") подставляется через токен
    // {key} только если чекбокс отмечен и счёт посчитан — иначе токен заменяется на
    // пустую строку (шкала опциональна, как и у kind: "scorecalc" в multi).
    const scKey = page.id + '__' + (page.scorecalc.key || 'scorecalc');
    const scAnswer = state.answers[scKey];
    let scText = '';
    if (scAnswer && scAnswer.checked && scAnswer.score !== undefined) {
      const scoreWord = pluralRu(scAnswer.score, page.scorecalc.scoreWordForms || ['балл', 'балла', 'баллов']);
      scText = page.scorecalc.resultTemplate
        .replace('{score}', scAnswer.score)
        .replace('{scoreWord}', scoreWord);
    }
    text = text.replace('{' + (page.scorecalc.key || 'scorecalc') + '}', scText);
  }
  if (page.indexCalcs) {
    // {indices} (генерик, добавлено для Болезни Бехтерева) — все заполненные индексы этой
    // страницы (BASDAI, ASDAS) одним кластером в круглых скобках через "; ", по образцу
    // официального примера КР: "очень высокая активность (BASDAI 7,8; ASDAS С-РБ – 3,7)".
    // Пустая строка, если ни один индекс не заполнен — токен просто исчезает без пустых скобок.
    const parts = [];
    page.indexCalcs.forEach(calc => {
      const icAnswer = state.answers[page.id + '__' + calc.key];
      const score = icAnswer && icAnswer.score;
      if (score === undefined || score === null || isNaN(score)) return;
      let labLabel = '';
      if (calc.labField) {
        const lab = icAnswer.lab || calc.labField.default;
        const labOpt = calc.labField.options.find(o => o.value === lab);
        labLabel = labOpt ? labOpt.shortLabel : '';
      }
      parts.push(calc.resultTemplate.replace('{score}', formatRuDecimal(score, 1)).replace('{labLabel}', labLabel));
    });
    text = text.replace('{indices}', parts.length ? ' (' + parts.join('; ') + ')' : '');
  }
  if (opt.freetextField) {
    const ff = opt.freetextField;
    const raw = state.answers[page.id + '-' + opt.id + '__' + ff.key] || '';
    if (raw) text += (ff.prefix || '') + raw;
  }
  return text.trim();
}

// Текст page.type === 'compound' страницы (добавлено для ИБС) — та же подстановка
// {key} + fld.prefix, что и в renderFindingTemplate() для kind: "compound" внутри multi,
// но здесь источник значений — state.answers[page.id], а не answer конкретного пункта.
// Возвращает '', если НИ ОДНО поле не заполнено — иначе в строку попали бы пустые скобки
// на странице, которую врач осознанно пропустил не заполняя (все поля необязательны).
function buildCompoundPageText(page) {
  const values = state.answers[page.id] || {};
  const hasAny = page.fields.some(fld => values[fld.key]);
  if (!hasAny) return '';
  let t = page.template;
  page.fields.forEach(fld => {
    const raw = values[fld.key] || fld.default || '';
    t = t.replace('{' + fld.key + '}', raw ? (fld.prefix || '') + raw : '');
  });
  return t;
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
      // item.noPrefixDegrees (генерик, добавлено для ХОБЛ) — см. подробный комментарий в
      // "flowing"-варианте ниже. Здесь (легаси-стиль) все находки страницы — один склеенный
      // блок, поэтому проще: префикс приписывается один раз перед ВСЕМ блоком, только если
      // среди отмеченных пунктов есть хотя бы один НЕ в подавляющем значении.
      let anyNonSuppressed = false;
      page.items.forEach(item => {
        const f = a.findings && a.findings[item.id];
        if (!findingHasContent(item, f)) return;
        findingsText.push(renderFindingTemplate(item, f));
        const suppressed = item.noPrefixDegrees && f && item.noPrefixDegrees.includes(f.degree);
        if (!suppressed) anyNonSuppressed = true;
      });
      // page.diagnosisPrefix (генерик) — префикс, добавляемый один раз перед всей
      // склеенной группой находок этой страницы (напр. "Осложнения: "), а не перед
      // каждым отдельным пунктом. Используется у ГЭРБ.
      if (findingsText.length) {
        const prefix = (page.diagnosisPrefix && anyNonSuppressed) ? page.diagnosisPrefix : '';
        parts.push(prefix + findingsText.join('. ') + '.');
      }
    } else if (page.type === 'compound') {
      const text = buildCompoundPageText(page);
      if (text) parts.push(text);
    } else if (page.type === 'scoredAssessment') {
      const group = deriveScoredAssessmentGroup(page);
      if (group) parts.push(group.text);
    }
  });

  return parts.join(' ');
}

// Определяет, вносит ли конкретный отмеченный/заполненный пункт multi-страницы вклад
// в итоговую строку. Для всех обычных kind это просто f.checked (как было раньше).
// Для kind: "lobe" (добавлено для пневмонии — выбор долей/сегментов лёгкого) пункт
// может быть "включён" двумя независимыми путями: чекбоксом "вся доля" (f.checked)
// ИЛИ отметкой хотя бы одного сегмента внутри неё (f.segments), даже если сам чекбокс
// доли не отмечен — врач должен иметь возможность выбрать сегменты напрямую, без
// обязательной отметки "вся доля" сначала.
function findingHasContent(item, f) {
  if (!f) return false;
  if (item && item.kind === 'lobe') {
    return !!f.checked || !!(f.segments && Object.keys(f.segments).some(k => f.segments[k]));
  }
  return !!f.checked;
}

// ---------- Склейка нескольких multi-страниц через "и" (generic: page.groupWith,
// добавлено для Болезни Бехтерева — "с внеаксиальными (X) и внескелетными (Y) проявлениями") ----------
// Простой список отмеченных находок страницы, без diagnosisPrefix/noPrefixDegrees —
// упрощённый путь специально для groupWith (см. ограничение в buildGroupedMultiText ниже).
function buildMultiFindingsList(page) {
  const a = state.answers;
  const list = [];
  page.items.forEach(item => {
    const f = a.findings && a.findings[item.id];
    if (!findingHasContent(item, f)) return;
    list.push(renderFindingTemplate(item, f));
  });
  return list;
}

// anchorPage объявляет groupWith (id страниц-партнёров) + groupPrefix/groupConnector/
// groupSuffix; КАЖДАЯ страница группы (включая anchor) несёт свой groupLabel. Пустая
// страница выпадает из фразы целиком; если пусты все — вся фраза пропадает. Пример:
// anchor.groupPrefix="с ", extraaxial.groupLabel="внеаксиальными",
// extraskeletal.groupLabel="внескелетными", anchor.groupConnector=" и ",
// anchor.groupSuffix=" проявлениями" ->
// "с внеаксиальными (X, Y) и внескелетными (Z) проявлениями".
// Ограничение (сознательное, под текущую задачу): diagnosisPrefix/noPrefixDegrees/
// item.assembleIndex/item.joiner внутри сгруппированных страниц не поддержаны — если
// понадобятся, buildGroupedMultiText придётся расширить, а не просто прописать в JSON.
function buildGroupedMultiText(anchorPage, partnerPages) {
  const segments = [];
  [anchorPage, ...partnerPages].forEach(p => {
    const items = buildMultiFindingsList(p);
    if (items.length) segments.push({ label: p.groupLabel, text: items.join(', ') });
  });
  if (!segments.length) return '';
  const connector = anchorPage.groupConnector !== undefined ? anchorPage.groupConnector : ' и ';
  const prefix = anchorPage.groupPrefix !== undefined ? anchorPage.groupPrefix : '';
  const suffix = anchorPage.groupSuffix !== undefined ? anchorPage.groupSuffix : '';
  return prefix + segments.map(s => `${s.label} (${s.text})`).join(connector) + suffix;
}

// "Flowing"-стиль: одно предложение, фрагменты соединяются через page.joiner (по умолчанию
// ", "), первый непустой фрагмент — без джойнера (он же начинает предложение с заглавной,
// т.к. это headline-страница). Регистр остальных фрагментов НЕ трогаем программно — каждый
// diagnosisText пишется в JSON сразу с нужной буквой (это надёжнее авто-lowerCase, который
// ломает аббревиатуры вроде "НПВП" при попадании в начало фрагмента).
function assembleDiagnosisFlowing() {
  const a = state.answers;

  // Плоский список "юнитов сборки" — по одному на single/single_grouped страницу и по
  // одному на КАЖДЫЙ отмеченный пункт multi-страницы (а не один на всю страницу целиком).
  // Каждый юнит по умолчанию наследует позицию (key) и joiner своей страницы — это
  // в точности прежнее поведение (page.assembleIndex, добавлено для ХБП: страница "ЗПТ"
  // идёт последней в навигации, но в строке — сразу после стадии).
  //
  // Расширено для пневмонии: у отдельного пункта multi-страницы может быть СВОЯ позиция
  // (item.assembleIndex) и/или свой joiner (item.joiner), независимо от остальных пунктов
  // той же страницы. Нужно, когда пункты одного блока "Осложнения" физически расходятся
  // по разным местам итоговой строки — например, возбудитель должен идти сразу после
  // локализации (до тяжести) и отделяться запятой, тогда как обычные осложнения после
  // тяжести отделяются точкой (см. примеры Указаний по ВПТ). Ни assembleIndex, ни joiner
  // не заданы ни у одного пункта уже выпущенных нозологий — их поведение не меняется.
  const units = [];
  // page.groupWith (см. buildGroupedMultiText выше) — страницы-партнёры обрабатываются
  // вместе с якорем и должны быть пропущены, когда цикл дойдёт до них по своему порядку.
  const handledByGroup = new Set();
  state.data.pages.forEach((page, pageIdx) => {
    if (handledByGroup.has(page.id)) return;
    if (page.suppressDiagnosisIf && conditionMet(page.suppressDiagnosisIf)) return;
    if (isPageSkipped(page)) return; // ФИКС: страница, скрытая через skipIf, не должна протаскивать протухший ответ, оставшийся в state.answers с прошлой ветки
    const pageKey = page.assembleIndex ?? pageIdx;
    const pageJoiner = page.joiner !== undefined ? page.joiner : ', ';

    if (page.type === 'multi' && page.groupWith) {
      const partnerPages = page.groupWith.map(id => state.data.pages.find(p => p.id === id)).filter(Boolean);
      partnerPages.forEach(p => handledByGroup.add(p.id));
      const text = buildGroupedMultiText(page, partnerPages);
      if (text) units.push({ key: pageKey, seq: units.length, text, joiner: pageJoiner });
      return;
    }

    if (page.type === 'single') {
      const val = a[page.id];
      const opt = page.options.find(o => o.id === val);
      const text = buildSingleFragmentText(page, opt);
      if (text) units.push({ key: pageKey, seq: units.length, text, joiner: pageJoiner });
    } else if (page.type === 'single_grouped') {
      if (a.degreeStatus && a.degreeStatus.diagnosisText) {
        units.push({ key: pageKey, seq: units.length, text: a.degreeStatus.diagnosisText, joiner: pageJoiner });
      }
    } else if (page.type === 'multi') {
      // page.diagnosisPrefix — добавляется один раз, к первому отмеченному пункту ЭТОЙ
      // страницы в исходном порядке items (независимо от того, куда потом встанет его
      // юнит после сортировки по key), как и раньше.
      //
      // page.firstItemJoiner (опционально, генерик, добавлено для пневмонии) — джойнер,
      // которым ПЕРВЫЙ отмеченный пункт этой страницы присоединяется к предыдущему
      // фрагменту, если отличается от джойнера МЕЖДУ несколькими пунктами этой же
      // страницы (page.joiner). Пример — «Локализация»: «...пневмония с локализацией
      // в нижней доле...» (без запятой перед группой), но «...нижней доле, верхней
      // доле...» (с запятой между несколькими выбранными долями). Если не задан —
      // прежнее поведение (везде один и тот же page.joiner), ничего не меняется у уже
      // выпущенных нозологий.
      let firstOnThisPage = true;
      // item.noPrefixDegrees (генерик, добавлено для ХОБЛ — "ДН 0 ст." не должно читаться
      // как осложнение) — необязательный список значений item.kind:"degree", при которых
      // ЭТОТ конкретный пункт не забирает page.diagnosisPrefix на себя, даже если оказался
      // первым отмеченным пунктом страницы; префикс просто ждёт следующего отмеченного
      // пункта, который не подавлен (prefixPending остаётся true). Если ВСЕ отмеченные
      // пункты страницы подавлены — префикс не появляется вовсе, как и должно быть у "ДН 0
      // ст." в одиночку. Не задано ни у одного item ни одной уже выпущенной нозологии —
      // поведение не меняется.
      let prefixPending = !!page.diagnosisPrefix;
      page.items.forEach(item => {
        const f = a.findings && a.findings[item.id];
        if (!findingHasContent(item, f)) return;
        let text = renderFindingTemplate(item, f);
        const suppressPrefixHere = prefixPending && item.noPrefixDegrees && f && item.noPrefixDegrees.includes(f.degree);
        if (prefixPending && !suppressPrefixHere) {
          text = page.diagnosisPrefix + text;
          prefixPending = false;
        }
        const defaultJoiner = (firstOnThisPage && page.firstItemJoiner !== undefined) ? page.firstItemJoiner : pageJoiner;
        firstOnThisPage = false;
        const itemKey = item.assembleIndex !== undefined ? item.assembleIndex : pageKey;
        const itemJoiner = item.joiner !== undefined ? item.joiner : defaultJoiner;
        units.push({ key: itemKey, seq: units.length, text, joiner: itemJoiner });
      });
    } else if (page.type === 'compound') {
      const text = buildCompoundPageText(page);
      if (text) units.push({ key: pageKey, seq: units.length, text, joiner: pageJoiner });
    } else if (page.type === 'scoredAssessment') {
      const group = deriveScoredAssessmentGroup(page);
      if (group) units.push({ key: pageKey, seq: units.length, text: group.text, joiner: pageJoiner });
    }
  });

  // Сортировка по key; при равенстве — стабильно по исходному порядку (seq), чтобы
  // юниты без явного assembleIndex/item.assembleIndex шли ровно как раньше.
  units.sort((x, y) => (x.key - y.key) || (x.seq - y.seq));

  let result = '';
  units.forEach((u, i) => {
    result += (i === 0 ? u.text : u.joiner + u.text);
  });
  return result ? result.trim() + '.' : '';
}

function renderFindingTemplate(item, f) {
  if (item.kind === 'compound') {
    let t = item.template;
    // fld.prefix (опционально, добавлено для ИБС) — подставляется перед значением поля,
    // только если оно непустое; отсутствует у поля -> прежнее поведение (пустая строка),
    // ничего не меняется у уже выпущенных compound-пунктов (ХБП у ГБ, стеноз у ЯБ), т.к.
    // там fld.prefix нигде не задан. Нужно, когда часть полей необязательна (дата/локализация/
    // тип ИМ у постинфарктного кардиосклероза) и без условного разделителя пустое поле
    // склеивало бы соседние значения без пробела/запятой.
    item.fields.forEach(fld => {
      const raw = f[fld.key] || fld.default || '';
      const val = raw ? (fld.prefix || '') + raw : '';
      t = t.replace('{' + fld.key + '}', val);
    });
    return t;
  }
  if (item.kind === 'degree') {
    // item.degreeAppend (генерик, добавлено для СД2 — ожирение: список/дропдаун показывает
    // "III степени" как обычно, а в собранный текст диагноза для этого конкретного значения
    // дополнительно подставляется суффикс — напр. "(морбидное)" для III степени, по прямому
    // решению врача (ИМТ≥40 = морбидное ожирение вне зависимости от осложнений). Карта
    // {значение: суффикс}, необязательная; не задана ни у одного другого degree-пункта —
    // их сборка не меняется.
    const val = f.degree || item.default;
    const extra = (item.degreeAppend && item.degreeAppend[val]) || '';
    return item.template.replace('{degree}', val + extra);
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
  if (item.kind === 'lobe') {
    // "Вся доля" (f.checked) имеет приоритет над отдельными отмеченными сегментами —
    // если оба почему-то отмечены одновременно, в строку идёт только целая доля,
    // без противоречивого дублирования "...доле... сегментах...".
    if (f.checked) return item.wholeTemplate;
    const checkedSegs = (item.segments || []).filter(seg => f.segments && f.segments[seg.id]);
    if (checkedSegs.length) {
      const segList = checkedSegs.map(seg => seg.id.toUpperCase()).join(', ');
      return item.segmentsTemplate.replace('{segments}', segList);
    }
    return '';
  }
  return item.template;
}

// Карточка одного индекса из page.indexCalcs (генерик, добавлено для Болезни Бехтерева —
// BASDAI/ASDAS на странице "Активность"). Ответ живёт в state.answers[pageId + '__' + calc.key]:
// answer.score — итоговое число (единственное, что участвует в сборке диагноза, см.
// buildSingleFragmentText), можно ввести напрямую ИЛИ получить через передачу пациенту
// (renderPatientHandoffButton -> computeIndexCalcScore, см. renderPatientHandoffPage);
// answer.lab/answer.labValue — лабораторный компонент (только если calc.labField задан,
// напр. С-РБ/СОЭ у ASDAS) — вводит врач сам, это не часть опроса пациента.
function renderIndexCalc(page, calc) {
  const icKey = page.id + '__' + calc.key;
  if (!state.answers[icKey]) state.answers[icKey] = {};
  const a = state.answers[icKey];
  const card = el('div', 'card');
  card.style.cursor = 'default';
  card.style.marginTop = '8px';

  const header = el('p', 'group-label');
  header.textContent = calc.label;
  card.appendChild(header);

  // Лабораторное значение (ASDAS) — вводится ДО передачи теста пациенту, если возможно:
  // при "Готово" на экране пациента индекс считается сразу (см. renderPatientHandoffPage);
  // если лабораторное значение появится позже, автоматического пересчёта нет — придётся
  // либо переоткрыть экран пациента, либо ввести итоговое число вручную ниже.
  if (calc.labField) {
    const lf = calc.labField;
    if (!a.lab) a.lab = lf.default;
    const labRow = el('div', 'inline-fields');
    labRow.style.marginTop = '8px';
    const sel = document.createElement('select');
    lf.options.forEach(o => {
      const oe = document.createElement('option');
      oe.value = o.value;
      oe.textContent = o.label;
      if (a.lab === o.value) oe.selected = true;
      sel.appendChild(oe);
    });
    sel.onchange = () => {
      // Переключение лабораторного маркера сбрасывает введённое значение — число для
      // С-РБ и СОЭ не взаимозаменяемо, оставлять его молча было бы неверно.
      if (a.lab !== sel.value) a.labValue = undefined;
      a.lab = sel.value;
      renderPage();
    };
    const labInput = document.createElement('input');
    labInput.type = 'number';
    labInput.step = '0.1';
    labInput.placeholder = 'значение';
    labInput.value = a.labValue !== undefined ? a.labValue : '';
    labInput.oninput = () => { a.labValue = labInput.value === '' ? undefined : parseFloat(labInput.value); };
    commitOnEnter(labInput);
    labRow.appendChild(sel);
    labRow.appendChild(labInput);
    card.appendChild(labRow);
    if (lf.note) {
      const note = el('div', 'note');
      note.style.marginTop = '6px';
      note.innerHTML = `<i class="ti ti-info-circle"></i><span>${lf.note}</span>`;
      card.appendChild(note);
    }
  }

  if (calc.patientHandoff) {
    const btn = renderPatientHandoffButton({ pageId: page.id, indexCalcKey: calc.key }, calc.label);
    btn.style.marginTop = '8px';
    card.appendChild(btn);
  }

  const scoreRow = document.createElement('div');
  scoreRow.style.marginTop = '8px';
  const scoreLbl = document.createElement('label');
  scoreLbl.textContent = 'Итоговое значение ' + calc.label + ' (можно ввести напрямую)';
  scoreLbl.style.display = 'block';
  scoreLbl.style.fontSize = '12.5px';
  scoreLbl.style.color = 'var(--text-secondary)';
  const scoreInput = document.createElement('input');
  scoreInput.type = 'number';
  scoreInput.step = '0.1';
  scoreInput.style.width = '100%';
  scoreInput.value = a.score !== undefined ? a.score : '';
  scoreInput.oninput = () => { a.score = scoreInput.value === '' ? undefined : parseFloat(scoreInput.value); };
  commitOnEnter(scoreInput);
  scoreRow.appendChild(scoreLbl);
  scoreRow.appendChild(scoreInput);
  card.appendChild(scoreRow);

  if (calc.criteria) card.appendChild(renderExpandable(calc, page.id));

  return card;
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
  if (page.type === 'scoredAssessment') return !!deriveScoredAssessmentGroup(page);
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
