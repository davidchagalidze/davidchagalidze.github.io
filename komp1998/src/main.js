// Контроллер «Компьютерщика'98» v3: состояние + отрисовка + обработка кликов.
// Каркас: слот дня и слот вечера, доска заказов, пакетный режим «провести неделю».

import {
  PARTS, SLOTS, OSES, SOFTWARE, JOBS, COURSES, REST_OPTIONS, EVENING_RESTS, BALANCE,
  TOTAL_DAYS, MONTHS_NOM_RU, ANTIVIRUSES, partById, osById, softwareById, jobById,
  courseById, restById, antivirusById, cpuNameForTier, osNamesFor,
  SKILLS, SKILL_BRANCHES, SERVERS, LUXURY, GEN_RELEASE, MAX_GEN, genName, partsOfGen, genSetPrice,
} from './game/data.js';
import {
  SAVE_KEY, createInitialState, deserialize, serialize, dateOf, formatDateRu,
  fmtMoney, fmtNum, machineSpecs, machineSummary, totalPower, powerAtSpec, powerOfSlot,
  wasteReport, diskFree, hasWorkingPC, jobBlockers, jobStatus, scoreOf, pluralRu,
  rentFor, salaryFor, onProbation, probationDaysLeft, partPrice, gearPrice, partAvailable,
  currentGen, pcGen, pcAge, agingNote, agingMult,
  skillLevel, skillCost, canLearn, serverOwned, serverTier, serverGross, serverUpkeep,
  serverOverdue, serverMaintDueIn, hasLuxury, luxuryPoints, luxuryUpkeep,
  bbsCatalog, downloadFromBbs, buyAntivirus, updateAntivirus, runAntivirus,
  catchRateFor, antivirusStale, virusStatus,
  hackStatus, buyProxy, courseAttempt, courseBlockers, forgetAmount,
  openContracts, acceptContract, canTakeContract, contractRisk,
} from './game/logic.js';
import * as game from './game/logic.js';

const $ = (id) => document.getElementById(id);

const escapeHtml = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

function loadState() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? deserialize(raw) : null;
  } catch {
    return null;
  }
}

let state = loadState() || createInitialState();

const ui = {
  dialog: null,
  alert: null,
  weekPlan: { day: 'work', evening: 'study' },
  hint: 'Добро пожаловать в 1998 год. День — работа, вечер — учёба. Устройтесь и купите компьютер.',
};

function save() {
  try {
    window.localStorage.setItem(SAVE_KEY, serialize(state));
  } catch {
    /* приватный режим — играем без сохранения */
  }
}

// ---------------------------------------------------------------------------
// Форматирование
// ---------------------------------------------------------------------------

function elligible(part) {
  const os = osById(state.os);
  if (!os) return { effective: 0, capped: false };
  const cap = os.caps[part.slot] || 0;
  const effective = powerAtSpec(part.slot, Math.min(part.spec, cap));
  return { effective, capped: part.spec > cap };
}

function bar(label, value, max, cls, note = '') {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const low = cls === 'mood' && value <= 25;
  return `
    <div class="bar-block">
      <div class="bar-head"><span>${escapeHtml(label)}${note ? ` <span class="muted small">${escapeHtml(note)}</span>` : ''}</span><span class="num">${fmtNum(value)} / ${max}</span></div>
      <div class="bar" role="progressbar" aria-label="${escapeHtml(label)}" aria-valuenow="${Math.round(value)}" aria-valuemin="0" aria-valuemax="${max}">
        <div class="bar-fill ${cls}${low ? ' low' : ''}" style="width:${pct.toFixed(1)}%"></div>
        <div class="bar-ticks"></div>
      </div>
    </div>`;
}

function currentDate() {
  return dateOf(Math.min(state.day, TOTAL_DAYS));
}

// ---------------------------------------------------------------------------
// Панели
// ---------------------------------------------------------------------------

function renderDiary() {
  const d = currentDate();
  const dayLabel = Math.min(state.day, TOTAL_DAYS);
  const job = jobById(state.jobId);
  $('panel-diary').innerHTML = `
    <div class="group">
      <div class="group-title">Календарь</div>
      <div class="row"><span class="label">Дата</span><span class="value">${formatDateRu(dayLabel)}</span></div>
      <div class="row"><span class="label">День года</span><span class="value">${dayLabel} / ${TOTAL_DAYS}</span></div>
      <div class="row"><span class="label">День недели</span><span class="value">${d.weekday}</span></div>
      <div class="hr"></div>
      <div class="row"><span class="label">Доход за месяц</span><span class="value">${fmtMoney(state.monthIncome)}</span></div>
      ${state.racket && state.racket.started ? `<div class="row"><span class="label">Рэкет</span><span class="value">${fmtNum(state.racket.appetite)}% · следующий счёт ~${fmtMoney(Math.round((state.racket.incomeMonth * state.racket.appetite) / 100))}</span></div>` : ''}
      ${state.racket && state.racket.krysha.active ? `<div class="row"><span class="label">Крыша</span><span class="value">${state.racket.krysha.points} × $${BALANCE.racket.kryshaPointIncome}/мес</span></div>` : ''}
      <div class="row"><span class="label">Аренда</span><span class="value">${fmtMoney(rentFor(state))}/мес</span></div>
      <div class="bar-block"><button class="wide" data-act="new-game">Новая игра</button></div>
    </div>`;
}

function renderHero() {
  const job = jobById(state.jobId);
  const debt = state.debtWarned
    ? `<div class="row"><span class="label">Долг</span><span class="value value-bad">${fmtMoney(state.cash)} до ${formatDateRu(state.debtDeadline || state.day)}</span></div>`
    : '';
  const virus = state.infected
    ? `<div class="row"><span class="label">Вирус</span><span class="value value-bad">${escapeHtml((state.virus && state.virus.name) || 'неизвестный')}</span></div>`
    : '';
  const heat = `<div class="row"><span class="label">След</span><span class="value ${state.heat >= BALANCE.heatLimit ? 'value-bad' : ''}">${state.heat} / ${BALANCE.heatLimit}${state.proxies ? ` · прокси ${state.proxies}` : ''}</span></div>`;
  const police = state.racket && state.racket.police > 0
    ? `<div class="row"><span class="label">Милиция</span><span class="value ${state.racket.police >= 80 ? 'value-bad' : ''}">${state.racket.police} / ${BALANCE.racket.policeMax}${state.racket.krysha.active ? ' · не остывает' : ''}</span></div>`
    : '';
  const forget = state.knowledge > 0
    ? `−${fmtNum(forgetAmount(state))}/день`
    : '';
  const jobWarn = job && job.req.knowledge && state.knowledge < job.req.knowledge
    ? `<div class="warn-box">Знания просели ниже требования работы «${escapeHtml(job.name)}»: ${Math.floor(state.knowledge)} из ${job.req.knowledge}. Забывание идёт каждый день — учитесь вечерами.</div>`
    : '';
  $('panel-hero').innerHTML = `
    <div class="group">
      <div class="group-title">Вы</div>
      <div class="row"><span class="label">Деньги</span><span class="value ${state.cash < 0 ? 'value-bad' : ''}">${fmtMoney(state.cash)}</span></div>
      <div class="row"><span class="label">Зарплата</span><span class="value">${job ? `${fmtMoney(salaryFor(state))}/день` : '—'}</span></div>
      <div class="row"><span class="label">Репутация</span><span class="value">${Math.round(state.rep)} / 100</span></div>
      ${heat}
      ${police}
      ${debt}
      ${virus}
      ${bar('Знания', state.knowledge, BALANCE.maxKnowledge, 'knowledge', forget)}
      ${bar('Настроение', state.mood, BALANCE.maxMood, 'mood')}
      ${bar('Энергия', state.energy, BALANCE.maxEnergy, 'energy')}
      ${jobWarn}
    </div>`;
}

function renderJob() {
  const job = jobById(state.jobId);
  const probation = onProbation(state);
  $('panel-job').innerHTML = `
    <div class="group">
      <div class="group-title">Работа</div>
      <div class="row"><span class="label">Сейчас</span><span class="value">${job ? escapeHtml(job.name) : 'без работы'}</span></div>
      ${job ? `<div class="row"><span class="label">Оклад</span><span class="value">${fmtMoney(salaryFor(state))}/день</span></div>` : ''}
      ${job && probation ? `<div class="row"><span class="label">Испытательный</span><span class="value value-bad">платят ${fmtMoney(salaryFor(state))}, ещё ${probationDaysLeft(state)} дн.</span></div>` : ''}
      ${job ? `<div class="row"><span class="label">Энергия / настроение</span><span class="value">−${job.energy} / −${job.mood}</span></div>` : ''}
      <div class="hr"></div>
      <button class="wide" data-act="dialog" data-dialog="jobs">Вакансии (${JOBS.length})</button>
      <button class="wide" data-act="dialog" data-dialog="contracts">Доска заказов</button>
      ${job ? '<button class="wide" data-act="quit">Уволиться <small>день потерян, пятно в трудовой</small></button>' : ''}
    </div>`;
}

function renderPc() {
  const summary = machineSummary(state);
  const specs = machineSpecs(state);
  const os = osById(state.os);
  const rows = SLOTS.map((slot) => {
    const part = partById(state.hardware[slot.id]);
    if (!part) {
      return `<tr><td class="spec-label">${slot.label}</td><td class="spec-value"><span class="missing">не установлено</span></td></tr>`;
    }
    const { effective, capped } = elligible(part);
    const meta = capped
      ? `мощность ${effective} · <span class="tag warn">ОС урежет</span>`
      : `мощность ${effective}`;
    return `<tr>
      <td class="spec-label">${slot.label}</td>
      <td class="spec-value">${escapeHtml(part.name)} <span class="muted small">· ${meta}</span></td>
    </tr>`;
  }).join('');

  const waste = wasteReport(state);
  const wasteHtml = waste.length
    ? `<div class="warn-box"><b>ОС не использует всё железо:</b><ul>${waste.map((w) => `<li>${escapeHtml(w.text)}</li>`).join('')}</ul></div>`
    : '';

  const osRow = os
    ? `${escapeHtml(os.name)} <span class="muted small">· свободно ${fmtNum(diskFree(state))} МБ из ${fmtNum(specs.hdd || 0)}</span>`
    : '<span class="missing">не установлена — компьютер не работает</span>';

  const av = state.antivirus ? antivirusById(state.antivirus.id) : null;
  const avRow = av
    ? `${escapeHtml(av.name)} <span class="muted small">· ловит ${Math.round(catchRateFor(state) * 100)}%${antivirusStale(state) ? ' · базы устарели' : ''}</span>`
    : '<span class="missing">не установлен</span>';

  const vs = virusStatus(state);
  const virusHtml = vs.infected
    ? `<div class="warn-box"><b>${escapeHtml(vs.text)}</b>
        <ul>
          <li>Мощность урезана на ${BALANCE.virusPowerPenalty}.</li>
          <li>Каждую ночь вирус тянет деньги со счёта.</li>
          ${state.systemDown ? '<li>Система не грузится — на работу не выйти.</li>' : ''}
        </ul>
        ${state.antivirus
          ? '<button data-act="scan">Прогнать антивирус</button>'
          : '<button data-act="dialog" data-dialog="software">Купить антивирус</button>'}
      </div>`
    : '';

  $('panel-pc').innerHTML = `
    <div class="group">
      <div class="group-title">Компьютер · мощность ${summary.power}</div>
      <table class="spec-table">
        ${rows}
        <tr><td class="spec-label">ОС</td><td class="spec-value">${osRow}</td></tr>
        <tr><td class="spec-label">Антивирус</td><td class="spec-value">${avRow}</td></tr>
      </table>
      ${os ? '' : '<div class="warn-box">Без операционной системы компьютер — просто ящик с железом. Купите ОС в разделе «Софт».</div>'}
      ${virusHtml}
      ${wasteHtml}
    </div>`;
}

function eveningReady() {
  return ['work', 'contract', 'course'].includes(state.daySlotKind) && !state.eveningUsed && !state.result;
}

function renderActions() {
  const job = jobById(state.jobId);
  const canWork = Boolean(job) && !state.daySlotUsed && !state.sickToday && !state.result && !state.systemDown
    && state.energy >= job.energy;
  const workSub = !job
    ? 'нужна работа'
    : state.sickToday
      ? 'простуда — сегодня только постель'
      : state.systemDown
        ? 'система не грузится — нужен антивирус'
        : state.daySlotUsed
          ? 'день уже занят'
          : state.energy < job.energy
            ? `нужно энергии ${job.energy}, осталось ${Math.floor(state.energy)}`
            : `+${fmtMoney(salaryFor(state))} за день${onProbation(state) ? ' (испытательный)' : ''}`;

  const contract = state.contract;
  const course = state.courseProgress ? courseById(state.courseProgress.id) : null;
  const canTake = !state.daySlotUsed && !state.contract && !state.courseProgress && !state.sickToday && !state.result;

  const eveningNote = state.eveningUsed
    ? 'вечер уже занят'
    : eveningReady() ? `энергии останется ${Math.floor(state.energy)}` : 'вечер бывает после работы, заказа или курса';

  const hackInfo = hackStatus(state);

  $('panel-actions').innerHTML = `
    <div class="group">
      <div class="group-title">День${state.daySlotKind ? ` · ${state.daySlotKind}` : ''}</div>
      <div class="actions">
        <button class="action-btn primary span-2" data-act="work" ${canWork ? '' : 'disabled'}>
          Отработать день
          <small>${workSub}</small>
        </button>
        <button class="action-btn span-2" data-act="dialog" data-dialog="contracts" ${canTake ? '' : 'disabled'}>
          Доска заказов
          <small>${contract ? `в работе «${escapeHtml(contract.name)}», осталось ${contract.leftDays} дн.` : (state.courseProgress ? 'сначала доучитесь' : 'взять заказ на несколько дней')}</small>
        </button>
        <button class="action-btn" data-act="dialog" data-dialog="study" ${state.courseProgress || state.daySlotUsed ? 'disabled' : ''}>
          Курсы
          <small>${course ? `идёт «${escapeHtml(course.name)}»` : 'знания за деньги и дни'}</small>
        </button>
        <button class="action-btn" data-act="dialog" data-dialog="rest" ${canTake ? '' : 'disabled'}>
          Отдых днём
          <small>${state.daySlotUsed ? 'день уже занят' : 'стоит целого дня'}</small>
        </button>
        ${contract ? `<button class="action-btn span-2" data-act="contract-work" ${state.daySlotUsed || state.energy < BALANCE.contractEnergy ? 'disabled' : ''}>
          Работать на заказе
          <small>осталось ${contract.leftDays} дн. · −${BALANCE.contractEnergy} энергии / −${BALANCE.contractMood} настроения</small>
        </button>` : ''}
      </div>
    </div>

    <div class="group">
      <div class="group-title">Дела · v3.5 <span class="muted small">· поколение ${currentGen(state)}${pcGen(state) ? `, возраст ${pcAge(state)}` : ''}</span></div>
      <div class="actions">
        <button class="action-btn" data-act="dialog" data-dialog="machine">
          Машина
          <small>${pcGen(state) ? `ПК ${genName(pcGen(state))}, поколение в магазине ${currentGen(state)}` : 'техно-гонка: поколение раз в 60 дней'}</small>
        </button>
        <button class="action-btn" data-act="dialog" data-dialog="server">
          Сервер
          <small>${serverOwned(state, 's1') ? `${serverTier(state)}/4 · ${fmtMoney(serverGross(state))}/мес${serverOverdue(state) ? ' · обслуживание просрочено' : ''}` : 'пассивный доход раз в месяц'}</small>
        </button>
        <button class="action-btn" data-act="dialog" data-dialog="skills">
          Навыки
          <small>${SKILL_BRANCHES.reduce((n, b) => n + skillLevel(state, b), 0)}/16 уровней · знания + деньги + дни</small>
        </button>
        <button class="action-btn" data-act="dialog" data-dialog="home">
          Дом
          <small>${luxuryPoints(state)} очков · содержание ${fmtMoney(luxuryUpkeep(state))}/мес</small>
        </button>
        ${state.skillProgress ? `<button class="action-btn span-2" data-act="skill-next" ${state.daySlotUsed ? 'disabled' : ''}>
          Продолжить обучение: ${escapeHtml(SKILLS[state.skillProgress.branch].name)}
          <small>осталось ${state.skillProgress.remaining} дн. · −${BALANCE.skillEnergy} энергии</small>
        </button>` : ''}
      </div>
    </div>

    <div class="group">
      <div class="group-title">Вечер <span class="muted small">· ${escapeHtml(eveningNote)}</span></div>
      <div class="actions">
        <button class="action-btn" data-act="evening-study" ${eveningReady() ? '' : 'disabled'}>
          Учёба
          <small>+${BALANCE.studyKnowledge} знание · −${BALANCE.studyEnergy} энергии · −${BALANCE.studyMood} настроения</small>
        </button>
        <button class="action-btn" data-act="evening-library" ${eveningReady() ? '' : 'disabled'}>
          Библиотека
          <small>+${BALANCE.libraryK} знания раз в ${BALANCE.libraryCooldown} дней · −${BALANCE.libraryEnergy} энергии</small>
        </button>
        <button class="action-btn" data-act="dialog" data-dialog="evening-rest" ${eveningReady() ? '' : 'disabled'}>
          Развлечение
          <small>+${Math.max(...EVENING_RESTS.map((r) => r.mood))} настроения, но не выше ${BALANCE.eveningMoodCap}</small>
        </button>
        <button class="action-btn" data-act="evening-hack" ${hackInfo.available ? '' : 'disabled'}>
          Взлом
          <small>${hackInfo.available ? `$${BALANCE.hackMinIncome}–${BALANCE.hackMaxIncome} · +1 след · −${BALANCE.hackEnergy} энергии` : escapeHtml(hackInfo.reasons[0] || '')}</small>
        </button>
      </div>
    </div>

    <div class="group">
      <div class="group-title">Пакетный режим</div>
      <div class="row week-plan"><span class="label">День</span><span class="value">
        <select id="week-day">
          <option value="work" ${ui.weekPlan.day === 'work' ? 'selected' : ''}>работа</option>
          <option value="contract" ${ui.weekPlan.day === 'contract' ? 'selected' : ''}>заказы</option>
          <option value="rest:walk" ${ui.weekPlan.day === 'rest:walk' ? 'selected' : ''}>отдых</option>
          ${COURSES.map((c) => `<option value="course:${c.id}" ${ui.weekPlan.day === `course:${c.id}` ? 'selected' : ''}>курс: ${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </span></div>
      <div class="row week-plan"><span class="label">Вечер</span><span class="value">
        <select id="week-evening">
          <option value="study" ${ui.weekPlan.evening === 'study' ? 'selected' : ''}>учёба</option>
          <option value="library" ${ui.weekPlan.evening === 'library' ? 'selected' : ''}>библиотека</option>
          <option value="rest:e-club" ${ui.weekPlan.evening === 'rest:e-club' ? 'selected' : ''}>развлечение</option>
          <option value="none" ${ui.weekPlan.evening === 'none' ? 'selected' : ''}>ничего</option>
        </select>
      </span></div>
      <div class="actions">
        <button class="action-btn span-2" data-act="week">
          Провести неделю по плану
          <small>останавливается на болезни, обмороке, сдаче/провале заказа и долге</small>
        </button>
        <button class="action-btn span-2" data-act="sleep">
          Спать → следующий день
          <small>энергия утром ${Math.round(game.energyOnWake(state))} (по настроению ${Math.round(state.mood)}) · наступит ${formatDateRu(Math.min(state.day + 1, TOTAL_DAYS))}</small>
        </button>
      </div>
    </div>`;
}

function renderLog() {
  const items = state.log.slice().reverse();
  const pending = state.racket && state.racket.pending ? state.racket.pending : null;
  const card = pending ? `
        <li class="racket-card">
          <span class="log-day">д${state.day}</span>
          <div class="racket-body">
            <div class="racket-title">Рэкет · осталось ${Math.max(0, pending.dueDay - state.day)} ${pluralRu(Math.max(0, pending.dueDay - state.day), 'день', 'дня', 'дней')}</div>
            <div class="racket-text">${escapeHtml(game.racketCardTextOf(state))}</div>
            <div class="racket-actions">
              ${game.racketChoices(state).map((c) => `
                <button data-act="racket" data-choice="${escapeHtml(c.choice)}" ${c.enabled ? '' : 'disabled'}>
                  ${escapeHtml(c.label)}${c.reason ? `<small>${escapeHtml(c.reason)}</small>` : ''}
                </button>`).join('')}
            </div>
          </div>
        </li>` : '';
  $('panel-log').innerHTML = `
    <div class="group">
      <div class="group-title">Журнал</div>
      <ul class="log">
        ${card}
        ${items.map((entry) => `<li class="${escapeHtml(entry.kind)}"><span class="log-day">д${entry.day}</span><span>${escapeHtml(entry.text)}</span></li>`).join('')}
      </ul>
    </div>`;
}

function renderStatus() {
  $('status-hint').textContent = ui.hint || '';
  $('status-power').textContent = `мощность: ${totalPower(state)}`;
  $('status-cash').textContent = fmtMoney(state.cash);
  $('title-date').textContent = formatDateRu(Math.min(state.day, TOTAL_DAYS));
}

// ---------------------------------------------------------------------------
// Диалоги
// ---------------------------------------------------------------------------

function dialogShell({ title, body, actions = '', narrow = false }) {
  return `
    <div class="titlebar">
      <span class="titlebar-text" id="dialog-title">${escapeHtml(title)}</span>
      <span class="titlebar-spacer"></span>
      <button class="dialog-close" data-act="close-dialog" aria-label="Закрыть">×</button>
    </div>
    <div class="dialog-body">${body}</div>
    <div class="dialog-actions">
      <span class="spacer"></span>
      ${actions}
      <button data-act="close-dialog">Закрыть</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// v3.5: четыре панели — машина, сервер, навыки, дом
// ---------------------------------------------------------------------------

function renderMachine() {
  const gen = currentGen(state);
  const pcg = pcGen(state);
  const age = pcAge(state);
  const note = agingNote(state);
  const rows = SLOTS.map((slot) => {
    const part = partById(state.hardware[slot.id]);
    const want = partsOfGen(gen).find((p) => p.slot === slot.id);
    const canBuy = want && (!part || part.gen < gen) && partAvailable(state, want);
    return `<tr>
      <td>${slot.label}<div class="small muted">${part ? escapeHtml(part.name) : '—'}</div></td>
      <td class="num">${part ? genName(part.gen) : '—'}</td>
      <td class="num">${canBuy ? `<button data-act="buy" data-id="${want.id}">${escapeHtml(want.name)} · ${fmtMoney(gearPrice(state, want))}</button>` : '—'}</td>
    </tr>`;
  }).join('');
  return dialogShell({
    title: 'Машина · техно-гонка',
    body: `
      <p class="hint-inline">Поколение в магазине: <b>${gen}</b>. Ваш ПК — ${pcg ? genName(pcg) : 'не собран'}, `
      + `возраст <b>${age}</b> ${pluralRu(age, 'поколение', 'поколения', 'поколений')}.</p>
      ${note ? `<p class="alert-text">${escapeHtml(note)}. Без апгрейда работу не отбирают — платят меньше.</p>` : ''}
      <p class="hint-inline">Новое поколение выходит раз в ${BALANCE.genStep} дней: `
      + `${GEN_RELEASE(gen)}-й день — ${genName(gen)}, следующий — ${gen < MAX_GEN ? `${GEN_RELEASE(gen + 1)}-й` : 'в этом году не будет'}. `
      + `Полный комплект ${genName(gen)} стоит ${fmtMoney(genSetPrice(gen))}.</p>
      <table class="grid">
        <thead><tr><th>Деталь</th><th>Поколение</th><th>Обновить</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
  });
}

function renderServer() {
  const owned = serverOwned(state, 's1');
  const rows = SERVERS.map((s) => {
    const have = serverOwned(state, s.id);
    const locked = s.needs && !serverOwned(state, s.needs);
    return `<tr class="${have ? 'installed' : ''}">
      <td>${escapeHtml(s.name)}${have ? ' <span class="tag">куплен</span>' : ''}
        <div class="small muted">доход $${s.income}/мес · содержание $${s.upkeep}/мес${s.needs ? ` · нужен «${escapeHtml((SERVERS.find((x) => x.id === s.needs) || {}).name || '')}»` : ''}</div></td>
      <td class="num">${fmtMoney(s.price)}</td>
      <td class="num">${have ? '—' : `<button data-act="srv-buy" data-id="${s.id}" ${locked ? 'disabled' : ''}>Купить</button>`}</td>
    </tr>`;
  }).join('');
  const overdue = serverOverdue(state);
  const due = serverMaintDueIn(state);
  return dialogShell({
    title: 'Свой сервер · пассивный доход',
    body: `
      <p class="hint-inline">Уровень: <b>${serverTier(state)}/4</b>. Доход: <b>${fmtMoney(serverGross(state))}</b>/мес, `
      + `содержание: ${fmtMoney(serverUpkeep(state))}/мес. Доход приходит 1-го числа.</p>
      ${owned ? `<p class="${overdue ? 'alert-text' : 'hint-inline'}">
        ${overdue ? 'Обслуживание просрочено: доход вдвое ниже.' : `До обслуживания: ${due} ${pluralRu(due, 'день', 'дня', 'дней')}.`}
        <button data-act="srv-maint" ${state.daySlotUsed ? 'disabled' : ''}>Обслужить (−${BALANCE.serverMaintEnergy} энергии, день)</button>
        <button data-act="srv-pirate">${state.server.pirate ? 'Убрать пиратку' : 'Пиратский контент +35%'}</button>
      </p>` : ''}
      <table class="grid">
        <thead><tr><th>Улучшение</th><th>Цена</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
  });
}

function renderSkills() {
  const branches = SKILL_BRANCHES.map((b) => {
    const branch = SKILLS[b];
    const lvl = skillLevel(state, b);
    const cost = skillCost(state, b);
    const blockers = canLearn(state, b);
    const levels = branch.levels.map((l, i) => {
      const done = i < lvl;
      const next = i === lvl;
      return `<div class="small ${done ? '' : 'muted'}">${done ? '✓' : (next ? '→' : '·')} `
        + `${escapeHtml(l.name)} — ${escapeHtml(l.desc)}</div>`;
    }).join('');
    return `<tr>
      <td><b>${escapeHtml(branch.name)}</b> · уровень ${lvl}/4<div>${levels}</div></td>
      <td class="num">${cost ? `${cost.knowledge} зн.<br>$${cost.money}<br>${cost.days} дн.` : 'макс.'}</td>
      <td class="num">${cost
        ? `<button data-act="skill-learn" data-id="${b}" ${blockers.length ? 'disabled' : ''}>Учить</button>
           ${blockers.length ? `<div class="small muted">${escapeHtml(blockers[0])}</div>` : ''}`
        : '—'}</td>
    </tr>`;
  }).join('');
  return dialogShell({
    title: 'Дерево навыков · модификаторы, не гейты',
    body: `
      <p class="hint-inline">Уровень стоит знания + деньги + дни. Ни одна работа и ни один заказ `
      + `не требуют уровня навыка.</p>
      <table class="grid">
        <thead><tr><th>Ветка</th><th>Цена</th><th></th></tr></thead>
        <tbody>${branches}</tbody>
      </table>`,
  });
}

function renderHome() {
  const rows = LUXURY.map((l) => {
    const have = hasLuxury(state, l.id);
    const locked = l.needs && !hasLuxury(state, l.needs);
    return `<tr class="${have ? 'installed' : ''}">
      <td>${escapeHtml(l.name)}${have ? ' <span class="tag">есть</span>' : ''}
        <div class="small muted">${escapeHtml(l.desc)} · содержание $${l.upkeep}/мес · ${l.points} очков</div></td>
      <td class="num">${fmtMoney(l.price)}</td>
      <td class="num">${have ? '—' : `<button data-act="lux-buy" data-id="${l.id}" ${locked ? 'disabled' : ''}>Купить</button>`}</td>
    </tr>`;
  }).join('');
  const rent = rentFor(state);
  return dialogShell({
    title: 'Дом · роскошь с содержанием',
    body: `
      <p class="hint-inline">Очки за роскошь: <b>${luxuryPoints(state)}</b>. Содержание: `
      + `${fmtMoney(luxuryUpkeep(state))}/мес. Жильё: ${hasLuxury(state, 'flat') ? `налог ${fmtMoney(rent)}/мес вместо аренды` : `аренда ${fmtMoney(rent)}/мес`}.</p>
      <table class="grid">
        <thead><tr><th>Покупка</th><th>Цена</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
  });
}

function renderShop() {
  const os = osById(state.os);
  const groups = SLOTS.map((slot) => {
    const rows = PARTS.filter((p) => p.slot === slot.id && p.gen <= currentGen(state)).map((part) => {
      const installed = state.hardware[slot.id] === part.id;
      const capped = Boolean(os) && part.spec > (os.caps[slot.id] || 0);
      const effectiveUnderOs = os ? powerAtSpec(slot.id, Math.min(part.spec, os.caps[slot.id] || 0)) : part.power;
      const price = partPrice(part, state.day);
      const sellPrice = Math.round(price * BALANCE.sellRatio);
      const powerCell = capped
        ? `${part.power} <span class="tag warn" title="${escapeHtml(os.name)} не использует эту деталь полностью">ОС: ${effectiveUnderOs}</span>`
        : `${part.power}`;
      return `
        <tr class="${installed ? 'installed' : ''}">
          <td>${escapeHtml(part.name)}${installed ? ' <span class="tag">стоит</span>' : ''}
            <div class="small muted">${escapeHtml(part.note || '')}</div></td>
          <td class="num">${powerCell}</td>
          <td class="num">${fmtMoney(price)}</td>
          <td class="num">
            ${installed
              ? `<button data-act="sell" data-slot="${slot.id}">Продать ${fmtMoney(sellPrice)}</button>`
              : `<button data-act="buy" data-id="${part.id}">Купить</button>`}
          </td>
        </tr>`;
    }).join('');
    return `<tr class="slot-head"><td colspan="4">${slot.label}</td></tr>${rows}`;
  }).join('');

  return dialogShell({
    title: 'Магазин железа — «Радиотовары»',
    body: `
      <p class="hint-inline">Деньги: <b>${fmtMoney(state.cash)}</b>. Железо дешевеет на 4,5% в месяц — ждать выгодно.
      При замене детали старую принимают в комиссионку за полцены.</p>
      <table class="grid">
        <thead><tr><th>Деталь</th><th>Мощность</th><th>Цена</th><th></th></tr></thead>
        <tbody>${groups}</tbody>
      </table>`,
  });
}

function renderSoftware() {
  const rows = OSES.map((os) => {
    const installed = state.os === os.id;
    const blockers = [];
    const specs = machineSpecs(state);
    if (!state.hardware.cpu) blockers.push('нет процессора');
    if (!state.hardware.ram) blockers.push('нет ОЗУ');
    if (!state.hardware.hdd) blockers.push('нет винчестера');
    if (specs.cpu && specs.cpu < os.req.cpu) blockers.push(`нужен ${cpuNameForTier(os.req.cpu)}`);
    if (specs.ram && specs.ram < os.req.ram) blockers.push(`нужно ${os.req.ram} МБ ОЗУ (у вас ${specs.ram})`);
    if (specs.hdd && specs.hdd < os.req.hdd) blockers.push(`нужно ${os.req.hdd} МБ диска (у вас ${specs.hdd})`);
    if (state.cash < os.price) blockers.push('не хватает денег');
    return `
      <tr class="${installed ? 'installed' : ''}">
        <td><b>${escapeHtml(os.name)}</b> <span class="small muted">· ОС</span>
          <div class="small muted">${escapeHtml(os.note)}</div>
          <div class="small">Требует: ${os.req.ram} МБ ОЗУ, ${os.req.hdd} МБ диска, ${cpuNameForTier(os.req.cpu)}</div>
          ${blockers.length ? `<div class="small" style="color:#800000">${escapeHtml(blockers.join('; '))}</div>` : ''}
        </td>
        <td class="num hide-sm">+${os.knowledge} зн.</td>
        <td class="num">${fmtMoney(os.price)}</td>
        <td class="num">${installed
          ? '<span class="tag">установлена</span>'
          : `<button data-act="install-os" data-id="${os.id}">Установить</button>`}</td>
      </tr>`;
  }).join('');

  const swRows = SOFTWARE.map((item) => {
    const installed = Boolean(state.software[item.id]);
    const blockers = [];
    const specs = machineSpecs(state);
    if (!state.os) blockers.push('нужна ОС');
    else if (!item.req.os.includes(state.os)) blockers.push(`нужна ${osNamesFor(item.req.os)}`);
    if (item.req.ram && specs.ram < item.req.ram) blockers.push(`нужно ${item.req.ram} МБ ОЗУ`);
    if (item.req.cpu && specs.cpu < item.req.cpu) blockers.push(`нужен ${cpuNameForTier(item.req.cpu)}`);
    if (item.req.modem && specs.modem < item.req.modem) blockers.push(`нужен модем ${item.req.modem} бод`);
    if (state.os && diskFree(state) < item.sizeMb) blockers.push(`мало места (нужно ${item.sizeMb} МБ)`);
    if (state.cash < item.price) blockers.push('не хватает денег');
    return `
      <tr class="${installed ? 'installed' : ''}">
        <td>${escapeHtml(item.name)}
          <div class="small muted">${escapeHtml(item.note)}</div>
          ${blockers.length ? `<div class="small" style="color:#800000">${escapeHtml(blockers.join('; '))}</div>` : ''}
        </td>
        <td class="num hide-sm">+${item.knowledge} зн.</td>
        <td class="num">${fmtMoney(item.price)}</td>
        <td class="num">${installed
          ? '<span class="tag">установлен</span>'
          : `<button data-act="install-sw" data-id="${item.id}">Установить</button>`}</td>
      </tr>`;
  }).join('');

  const avRows = ANTIVIRUSES.map((av) => {
    const installed = state.antivirus && state.antivirus.id === av.id;
    const stale = installed && antivirusStale(state);
    const blockers = [];
    if (!state.os) blockers.push('нужна ОС');
    if (state.cash < av.price) blockers.push('не хватает денег');
    return `
      <tr class="${installed ? 'installed' : ''}">
        <td><b>${escapeHtml(av.name)}</b>
          <div class="small muted">${escapeHtml(av.note)}</div>
          <div class="small">Ловит ${Math.round(av.catchRate * 100)}% заразы, обновление баз ${fmtMoney(av.updatePrice)}</div>
          ${blockers.length && !installed ? `<div class="small" style="color:#800000">${escapeHtml(blockers.join('; '))}</div>` : ''}
        </td>
        <td class="num hide-sm">${Math.round(av.catchRate * 100)}%</td>
        <td class="num">${fmtMoney(av.price)}</td>
        <td class="num">${installed
          ? (stale ? `<button data-act="update-av">Обновить ${fmtMoney(av.updatePrice)}</button>` : '<span class="tag">стоит</span>')
          : `<button data-act="buy-av" data-id="${av.id}">Купить</button>`}</td>
      </tr>`;
  }).join('');

  const modem = machineSpecs(state).modem;
  const bbsRows = bbsCatalog(state).map((offer) => {
    const installedSw = offer.kind === 'software' && Boolean(state.software[offer.id]);
    const installedAv = offer.kind === 'antivirus' && state.antivirus
      && state.antivirus.id === (offer.itemId || offer.id);
    const disabled = !modem || installedSw || installedAv;
    return `
      <tr class="${installedSw || installedAv ? 'installed' : ''}">
        <td>${escapeHtml(offer.name)}
          <div class="small muted">${escapeHtml(offer.note || '')}</div>
          <div class="small">Риск вируса: ${Math.round(offer.risk * 100)}% · ${offer.minutes} мин. линии</div>
        </td>
        <td class="num hide-sm">${fmtMoney(offer.lineCost)}</td>
        <td class="num">${offer.price ? fmtMoney(offer.price) : 'бесплатно'}</td>
        <td class="num">${installedSw || installedAv
          ? '<span class="tag">есть</span>'
          : `<button data-act="bbs" data-id="${offer.id}" ${disabled ? 'disabled' : ''}>${fmtMoney(offer.total)} · Скачать</button>`}</td>
      </tr>`;
  }).join('');

  return dialogShell({
    title: 'Софт — «Диски и дискеты»',
    body: `
      <p class="hint-inline">Деньги: <b>${fmtMoney(state.cash)}</b>. ОС и программы требуют железа и места на диске.</p>
      <table class="grid">
        <thead><tr><th>Операционная система</th><th class="hide-sm">Знания</th><th>Цена</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <table class="grid">
        <thead><tr><th>Программа</th><th class="hide-sm">Знания</th><th>Цена</th><th></th></tr></thead>
        <tbody>${swRows}</tbody>
      </table>
      <table class="grid">
        <thead><tr><th>Антивирус</th><th class="hide-sm">Ловит</th><th>Цена</th><th></th></tr></thead>
        <tbody>${avRows}</tbody>
      </table>
      <table class="grid">
        <thead><tr><th>BBS — доска объявлений${modem ? '' : ' (нужен модем)'}</th><th class="hide-sm">Связь</th><th>Файл</th><th></th></tr></thead>
        <tbody>${bbsRows}</tbody>
      </table>
      <p class="hint-inline">На BBS файлы дешевле магазина, но за скачивание платишь за минуты линии
      и рискуешь поймать вирус.</p>`,
  });
}

function jobRequirementsText(job) {
  const parts = [];
  if (job.req.knowledge) parts.push(`знания ${job.req.knowledge}`);
  if (job.req.power) parts.push(`мощность ПК ${job.req.power}`);
  if (job.req.os) parts.push('своя ОС');
  if (job.req.rep) parts.push(`репутация ${job.req.rep}`);
  if (job.req.modem) parts.push(`модем ${job.req.modem} бод`);
  if (job.req.hacks) parts.push('успешный взлом');
  return parts.length ? parts.join(', ') : 'без требований';
}

function renderJobs() {
  const specs = machineSpecs(state);
  const rows = JOBS.map((job) => {
    const status = jobStatus(state, job.id);
    return `
      <tr class="${status.current ? 'installed' : ''}">
        <td><b>${escapeHtml(job.name)}</b>
          <div class="small muted">${escapeHtml(job.note)}</div>
          <div class="small">Требуется: ${jobRequirementsText(job)}</div>
          ${status.reasons.length ? `<ul class="reason-list">${status.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
        </td>
        <td class="num">${fmtMoney(job.salary)}</td>
        <td class="num hide-sm">−${job.energy} / −${job.mood}</td>
        <td class="num hide-sm">${job.gain ? `+${job.gain}` : '—'}</td>
        <td class="num">${status.current
          ? '<span class="tag">вы здесь</span>'
          : `<button data-act="take-job" data-id="${job.id}">Устроиться</button>`}</td>
      </tr>`;
  }).join('');

  return dialogShell({
    title: 'Вакансии — «Биржа труда»',
    body: `
      <p class="hint-inline">Сейчас: знания ${Math.floor(state.knowledge)}, мощность ${totalPower(state)},
        репутация ${Math.round(state.rep)}, модем ${specs.modem ? `${specs.modem} бод` : 'нет'}.
        Звание считается по занимаемой должности.</p>
      <table class="grid">
        <thead><tr><th>Вакансия</th><th>Зарплата</th><th class="hide-sm">Энергия / настроение</th><th class="hide-sm">Опыт</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
  });
}

function renderContracts() {
  const list = openContracts(state);
  const rows = list.map((c) => {
    const risk = contractRisk(state, c);
    const advance = Math.round(c.pay * BALANCE.contractAdvance);
    const reqText = jobRequirementsText({ req: c.req || {} });
    return `
      <tr class="${c.available ? '' : 'installed'}">
        <td><b>${escapeHtml(c.name)}</b> <span class="small muted">· тир ${c.t}${c.kind === 'generated' ? ' · с доски' : ''}</span>
          <div class="small muted">${escapeHtml(c.note || '')}</div>
          <div class="small">Требуется: ${escapeHtml(reqText)}</div>
          ${c.reasons && c.reasons.length ? `<ul class="reason-list">${c.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
        </td>
        <td class="num">${c.days} дн.</td>
        <td class="num hide-sm">+${c.knowledge} зн. / реп. ${c.rep >= 0 ? '+' : ''}${c.rep}</td>
        <td class="num hide-sm">риск ${Math.round(risk * 100)}%</td>
        <td class="num">${fmtMoney(c.pay)}<div class="small muted">аванс ${fmtMoney(advance)}</div></td>
        <td class="num">${c.available
          ? `<button data-act="take-contract" data-id="${c.id}">Взять</button>`
          : '<span class="tag">закрыт</span>'}</td>
      </tr>`;
  }).join('');

  return dialogShell({
    title: `Доска заказов — ${list.length} предложений`,
    body: `
      <p class="hint-inline">Заказ занимает слот дня на N дней, срок — N + ${BALANCE.contractSlack} дней.
      При подписании платят аванс ${Math.round(BALANCE.contractAdvance * 100)}%. Провал возвращает аванс и бьёт по репутации.
      Запас знаний сверх требования режет риск.</p>
      ${state.contract ? `<div class="warn-box">В работе «${escapeHtml(state.contract.name)}»: осталось ${state.contract.leftDays} дн., срок ${formatDateRu(state.contract.deadline)}.</div>` : ''}
      <table class="grid">
        <thead><tr><th>Заказ</th><th>Дней</th><th class="hide-sm">Польза</th><th class="hide-sm">Риск</th><th>Оплата</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
  });
}

function renderStudy() {
  const rows = COURSES.map((course) => {
    const attempt = courseAttempt(state, course.id);
    const blockers = courseBlockers(state, course.id);
    const perUnit = attempt.perKnowledge === 0
      ? '<span class="tag">бесплатно</span>'
      : `$${fmtNum(attempt.perKnowledge)}/ед.`;
    const repeatNote = attempt.first
      ? ''
      : `<span class="small muted"> · повтор №${attempt.repeats}</span>`;
    return `
      <tr class="${attempt.first ? '' : 'installed'}">
        <td>${escapeHtml(course.name)}${repeatNote}
          <div class="small muted">${escapeHtml(course.note)}</div>
          <div class="small"><b>+${attempt.knowledge} знаний за ${course.days} ${pluralRu(course.days, 'день', 'дня', 'дней')}, ${perUnit}</b></div>
          ${blockers.length ? `<div class="small" style="color:#800000">${escapeHtml(blockers.join('; '))}</div>` : ''}
        </td>
        <td class="num hide-sm">−${course.energy} энергии</td>
        <td class="num">+${attempt.knowledge} зн.</td>
        <td class="num hide-sm">${course.days} дн.</td>
        <td class="num">${fmtMoney(attempt.price)}</td>
        <td class="num"><button data-act="study" data-id="${course.id}">${state.courseProgress && state.courseProgress.id === course.id ? 'Продолжить' : 'Начать'}</button></td>
      </tr>`;
  }).join('');

  return dialogShell({
    title: 'Курсы — знания за деньги и дни',
    body: `
      <p class="hint-inline">Деньги: <b>${fmtMoney(state.cash)}</b>. Энергия: <b>${Math.floor(state.energy)}</b>.
      Курс занимает слот дня на несколько дней; знания начисляются в конце. Повтор дороже ×${BALANCE.courseRepeatCostGrowth} и даёт ×${BALANCE.courseRepeatKnowFalloff} знаний.
      Бесплатный источник знаний — вечерняя учёба и библиотека.</p>
      <table class="grid">
        <thead><tr><th>Курс</th><th class="hide-sm">Энергия</th><th>Знания</th><th class="hide-sm">Дней</th><th>Цена</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
  });
}

function renderRest() {
  const daySpent = state.daySlotUsed;
  const cards = REST_OPTIONS.map((option) => `
      <tr>
        <td>${escapeHtml(option.name)}<div class="small muted">${escapeHtml(option.note)}</div></td>
        <td class="num">+${option.mood} настр.</td>
        <td class="num hide-sm">−${option.energy} энергии</td>
        <td class="num">${option.price ? fmtMoney(option.price) : 'бесплатно'}</td>
        <td class="num"><button data-act="rest" data-id="${option.id}" ${daySpent ? 'disabled' : ''}>Отдохнуть</button></td>
      </tr>`).join('');

  return dialogShell({
    title: 'Отдых — вернуть настроение, но потерять день',
    body: `
      <p class="hint-inline">Деньги: <b>${fmtMoney(state.cash)}</b>. Настроение: <b>${Math.floor(state.mood)}</b>.
      Отдых занимает <b>весь день</b>, как работа. Вечером после отдыха уже ничего не будет.
      Настроение задаёт энергию на утро: ${BALANCE.energyFloor} + ${BALANCE.energySpan} × настроение/100.</p>
      <table class="grid">
        <thead><tr><th>Куда пойти</th><th>Настроение</th><th class="hide-sm">Энергия</th><th>Цена</th><th></th></tr></thead>
        <tbody>${cards}</tbody>
      </table>
      ${daySpent ? '<div class="warn-box">Сегодня день уже занят — отдых только завтра.</div>' : ''}`,
  });
}

function renderEveningRest() {
  const rows = EVENING_RESTS.map((option) => {
    const gain = Math.max(0, Math.min(option.mood, BALANCE.eveningMoodCap - state.mood));
    return `
      <tr>
        <td>${escapeHtml(option.name)}<div class="small muted">${escapeHtml(option.note)}</div></td>
        <td class="num">+${gain} настр.</td>
        <td class="num hide-sm">−${option.energy} энергии</td>
        <td class="num">${option.price ? fmtMoney(option.price) : 'бесплатно'}</td>
        <td class="num"><button data-act="evening-rest" data-id="${option.id}" ${eveningReady() && gain > 0 ? '' : 'disabled'}>Пойти</button></td>
      </tr>`;
  }).join('');

  return dialogShell({
    title: 'Вечернее развлечение — не заменяет отдых',
    body: `
      <p class="hint-inline">Настроение: <b>${Math.floor(state.mood)}</b>, потолок вечера — ${BALANCE.eveningMoodCap}.
      Вечернее развлечение даёт ${Math.round(BALANCE.eveningMoodGain * 100)}% от дневного: рабочий день съедает больше, чем возвращает вечер.</p>
      <table class="grid">
        <thead><tr><th>Куда пойти</th><th>Настроение</th><th class="hide-sm">Энергия</th><th>Цена</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`,
  });
}

function renderReceipt() {
  const r = state.pendingReceipt || { rent: 0, tax: 0, income: 0, total: 0, month: 1, phone: 0, phoneMinutes: 0 };
  const job = jobById(state.jobId);
  return `
    <div class="titlebar">
      <span class="titlebar-text" id="dialog-title">Квитанции — ${escapeHtml(MONTHS_NOM_RU[(r.month || 1) - 1])}</span>
      <span class="titlebar-spacer"></span>
      <button class="dialog-close" data-act="receipt-ok" aria-label="Закрыть">×</button>
    </div>
    <div class="dialog-body">
      <p class="hint-inline">Первое число — день платежей. Аренда зависит от работы, налог — прогрессивный, еда списывается каждый день.</p>
      <div class="receipt">
        <div class="receipt-line"><span>Аренда комнаты${job ? ` (по работе «${escapeHtml(job.name)}»)` : ''}${state.office ? ' и офис' : ''}</span><span>−${fmtMoney(r.rent)}</span></div>
        <div class="receipt-line"><span>Налог (13% до $1200, 20% выше) с дохода ${fmtMoney(r.income)}</span><span>−${fmtMoney(r.tax)}</span></div>
        ${r.phone ? `<div class="receipt-line"><span>Телефон — ${r.phoneMinutes || 0} мин. линии (списано поминутно)</span><span>−${fmtMoney(r.phone)}</span></div>` : ''}
        <div class="receipt-line receipt-total"><span>Итого списано сейчас</span><span>−${fmtMoney(r.total)}</span></div>
        <div class="receipt-line"><span>Остаток на руках</span><span>${fmtMoney(state.cash)}</span></div>
      </div>
      ${state.cash < 0 ? `<div class="warn-box">Баланс отрицательный. Это долг до ${formatDateRu(state.debtDeadline || state.day)}: не вылезешь — игра закончится.</div>` : ''}
    </div>
    <div class="dialog-actions"><span class="spacer"></span><button data-act="receipt-ok">Оплатить</button></div>`;
}

function renderResult() {
  const result = state.result || scoreOf(state);
  const finish = result.type === 'finish';
  const arrest = result.type === 'arrest';
  const title = finish
    ? 'Итоги года — 31 декабря 1998'
    : (arrest ? 'Игра окончена — вас вычислили' : 'Игра окончена — долг');
  return `
    <div class="titlebar">
      <span class="titlebar-text" id="dialog-title">${escapeHtml(title)}</span>
      <span class="titlebar-spacer"></span>
    </div>
    <div class="dialog-body">
      <div class="final-box">
        <div class="final-sub">Ваше звание</div>
        <div class="final-rank">${escapeHtml(result.rank)}</div>
        <div class="final-sub">${result.raw} ${pluralRu(result.raw, 'очко', 'очка', 'очков')}</div>
      </div>
      <div class="receipt">
        <div class="receipt-line"><span>Деньги на руках</span><span>${fmtMoney(state.cash)}</span></div>
        <div class="receipt-line"><span>Знания</span><span>${Math.round(result.knowledge)} / ${BALANCE.maxKnowledge}</span></div>
        <div class="receipt-line"><span>Мощность компьютера</span><span>${result.power}</span></div>
        <div class="receipt-line"><span>Сдано заказов</span><span>${result.contracts}</span></div>
        <div class="receipt-line"><span>Репутация</span><span>${result.rep}</span></div>
        <div class="receipt-line"><span>Успешных взломов</span><span>${state.hacks}</span></div>
        <div class="receipt-line"><span>Отработано дней</span><span>${state.stats.workDays}</span></div>
        <div class="receipt-line"><span>Всего заработано</span><span>${fmtMoney(state.stats.totalEarned)}</span></div>
      </div>
      ${arrest
        ? '<div class="warn-box">След вырос до предела: утром — звонок в дверь, понятые и изъятие компьютера.</div>'
        : ''}
      ${!finish && !arrest ? '<div class="warn-box">Вы не смогли расплатиться с долгом. В 1998-м за это выключали свет и забирали компьютер.</div>' : ''}
      <p class="hint-inline" style="margin-top:10px">Очки: деньги/100 (не больше ${BALANCE.scoreCashCap}) + знания + ${BALANCE.scorePowerMult}×мощность + ${BALANCE.scoreContract}×заказы + ${BALANCE.scoreHack}×взломы. Звание — по должности.</p>
    </div>
    <div class="dialog-actions"><span class="spacer"></span><button class="primary" data-act="new-game-now">Играть снова</button></div>`;
}

function renderWeekReport() {
  const report = ui.weekReport;
  if (!report) return '';
  const rows = report.days.map((d) => `
    <li><b>д${d.day}</b>: ${d.events.map((e) => escapeHtml(e.text || e.type)).join(' · ') || 'без событий'}</li>`).join('');
  return `
    <div class="titlebar">
      <span class="titlebar-text" id="dialog-title">Неделя по плану</span>
      <span class="titlebar-spacer"></span>
      <button class="dialog-close" data-act="close-dialog" aria-label="Закрыть">×</button>
    </div>
    <div class="dialog-body">
      <p class="hint-inline">Прокручено дней: <b>${report.daysAdvanced}</b>${report.stoppedBy ? ` · остановились: <b>${escapeHtml(report.stoppedBy)}</b>` : ' · план выполнен до конца'}.</p>
      <ul class="log">${rows}</ul>
    </div>
    <div class="dialog-actions"><span class="spacer"></span><button data-act="close-dialog">Понятно</button></div>`;
}

function renderDialog() {
  const overlay = $('overlay');
  const dialog = $('dialog');

  if (ui.alert) {
    overlay.classList.remove('hidden');
    dialog.className = 'window dialog narrow';
    dialog.innerHTML = `
      <div class="titlebar"><span class="titlebar-text" id="dialog-title">Сообщение</span></div>
      <div class="dialog-body"><p class="alert-text">${escapeHtml(ui.alert)}</p></div>
      <div class="dialog-actions"><span class="spacer"></span><button class="primary" data-act="alert-ok">ОК</button></div>`;
    return;
  }

  if (!ui.dialog) {
    overlay.classList.add('hidden');
    dialog.innerHTML = '';
    return;
  }

  overlay.classList.remove('hidden');
  dialog.className = 'window dialog';

  let html = '';
  let narrow = false;
  switch (ui.dialog) {
    case 'shop': html = renderShop(); break;
    case 'machine': html = renderMachine(); break;
    case 'server': html = renderServer(); break;
    case 'skills': html = renderSkills(); break;
    case 'home': html = renderHome(); break;
    case 'software': html = renderSoftware(); break;
    case 'jobs': html = renderJobs(); break;
    case 'contracts': html = renderContracts(); break;
    case 'study': html = renderStudy(); break;
    case 'rest': html = renderRest(); break;
    case 'evening-rest': html = renderEveningRest(); break;
    case 'receipt': narrow = true; html = renderReceipt(); break;
    case 'result': narrow = true; html = renderResult(); break;
    case 'week': narrow = true; html = renderWeekReport(); break;
    case 'confirm-new':
      narrow = true;
      html = dialogShell({
        title: 'Новая игра',
        body: '<p class="alert-text">Начать новую игру? Текущий прогресс будет потерян.</p>',
        actions: '<button data-act="new-game-now">Да, начать</button>',
      });
      break;
    default: html = '';
  }
  if (narrow) dialog.classList.add('narrow');
  dialog.innerHTML = html;
}

function render() {
  renderDiary();
  renderHero();
  renderJob();
  renderPc();
  renderActions();
  renderLog();
  renderStatus();
  renderDialog();
}

// ---------------------------------------------------------------------------
// Действия пользователя
// ---------------------------------------------------------------------------

function afterAction(result, { keepHint = false } = {}) {
  if (!result) return;
  if (!result.ok) {
    ui.alert = result.error;
  } else {
    ui.hint = keepHint ? ui.hint : result.message;
    save();
  }
  render();
}

const act = {
  work: () => game.work(state),
  'evening-study': () => game.eveningStudy(state),
  'evening-library': () => game.eveningLibrary(state),
  'evening-hack': () => game.eveningHack(state),
  'contract-work': () => game.doContractWork(state),
};

function doEveningHack() {
  const result = game.eveningHack(state);
  if (!result.ok) {
    ui.alert = result.error;
    render();
    return;
  }
  save();
  ui.hint = result.arrested
    ? 'Вас вычислили. Игра окончена.'
    : `${result.message} След: ${state.heat} / ${BALANCE.heatLimit}.`;
  if (state.result) ui.dialog = 'result';
  render();
}

function doSleep() {
  const result = game.sleep(state);
  if (!result.ok) {
    ui.alert = result.error;
    render();
    return;
  }
  save();
  if (state.result) {
    ui.dialog = 'result';
    ui.hint = state.result.type === 'finish' ? 'Год закончился.' : 'Игра окончена.';
  } else if (state.pendingReceipt) {
    ui.dialog = 'receipt';
    ui.hint = 'Первое число — день платежей.';
  } else {
    ui.hint = result.message;
  }
  render();
}

function doWeek() {
  const daySelect = $('week-day');
  const eveningSelect = $('week-evening');
  if (daySelect) ui.weekPlan.day = daySelect.value;
  if (eveningSelect) ui.weekPlan.evening = eveningSelect.value === 'none' ? null : eveningSelect.value;

  const report = game.advanceDays(state, {
    day: ui.weekPlan.day,
    evening: ui.weekPlan.evening,
    stopIf: { moodBelow: BALANCE.weekStopMood, cashBelow: BALANCE.weekStopCash },
  }, BALANCE.weekDays);

  ui.weekReport = report;
  save();
  ui.hint = `Прокручено дней: ${report.daysAdvanced}${report.stoppedBy ? `, остановка: ${report.stoppedBy}` : ''}.`;
  if (state.result) ui.dialog = 'result';
  else ui.dialog = 'week';
  render();
}

function newGame() {
  state = createInitialState();
  ui.dialog = null;
  ui.alert = null;
  ui.weekReport = null;
  ui.hint = 'Новая игра. 1 января 1998 года.';
  save();
  render();
}

function takeContract(id) {
  const result = acceptContract(state, id);
  afterAction(result);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const action = button.dataset.act;

  switch (action) {
    case 'work': afterAction(act.work()); break;
    case 'sleep': doSleep(); break;
    case 'week': doWeek(); break;
    case 'dialog':
      ui.dialog = button.dataset.dialog;
      ui.alert = null;
      renderDialog();
      break;
    case 'close-dialog':
      ui.dialog = null;
      renderDialog();
      break;
    case 'alert-ok':
      ui.alert = null;
      render();
      break;
    case 'buy': afterAction(game.buyPart(state, button.dataset.id)); break;
    case 'srv-buy': afterAction(game.buyServerUpgrade(state, button.dataset.id)); break;
    case 'srv-maint': afterAction(game.serverMaintenance(state)); break;
    case 'srv-pirate': afterAction(game.setServerPirate(state, !state.server.pirate)); break;
    case 'skill-learn': afterAction(game.startSkill(state, button.dataset.id)); break;
    case 'skill-next': afterAction(game.advanceSkill(state)); break;
    case 'lux-buy': afterAction(game.buyLuxury(state, button.dataset.id)); break;
    case 'sell': afterAction(game.sellPart(state, button.dataset.slot)); break;
    case 'install-os': afterAction(game.installOS(state, button.dataset.id)); break;
    case 'install-sw': afterAction(game.installSoftware(state, button.dataset.id)); break;
    case 'study': afterAction(game.study(state, button.dataset.id)); break;
    case 'rest': afterAction(game.rest(state, button.dataset.id)); break;
    case 'evening-rest': afterAction(game.eveningRest(state, button.dataset.id)); break;
    case 'evening-study': afterAction(act['evening-study']()); break;
    case 'evening-library': afterAction(act['evening-library']()); break;
    case 'evening-hack': doEveningHack(); break;
    case 'contract-work': afterAction(act['contract-work']()); break;
    case 'take-contract': takeContract(button.dataset.id); break;
    case 'take-job': afterAction(game.takeJob(state, button.dataset.id)); break;
    case 'quit': afterAction(game.quitJob(state)); break;
    case 'bbs': afterAction(game.downloadFromBbs(state, button.dataset.id)); break;
    case 'buy-av': afterAction(game.buyAntivirus(state, button.dataset.id)); break;
    case 'update-av': afterAction(game.updateAntivirus(state)); break;
    case 'scan': afterAction(game.runAntivirus(state)); break;
    case 'buy-proxy': afterAction(game.buyProxy(state)); break;
    case 'receipt-ok':
      state.pendingReceipt = null;
      ui.dialog = null;
      save();
      render();
      break;
    case 'racket': {
      const chosen = button.dataset.choice;
      const evs = game.resolveRacket(state, chosen);
      save();
      const last = evs.length ? evs[evs.length - 1] : null;
      ui.hint = last
        ? ({
          'racket-paid': `Заплатил $${last.amount}. Аппетит ${last.appetite}%.`,
          'racket-repelled': `Отбился. Аппетит ${last.appetite}%.`,
          'racket-beaten': `Проиграл: $${last.cash}, день потерян.`,
          'racket-moved': 'Переехал: аппетит сброшен.',
          'racket-became-krysha': 'Теперь ты крыша.',
          'racket-laylow': 'Лёг на дно.',
          'racket-protection': 'Защита нанята.',
        }[last.type] || 'Записано в журнал.') : 'Записано в журнал.';
      if (chosen === 'protect') ui.hint = 'Защита нанята — карточка ещё висит, решай.';
      if (state.result) ui.dialog = 'result';
      render();
      break;
    }
    case 'new-game':
      ui.dialog = 'confirm-new';
      ui.alert = null;
      renderDialog();
      break;
    case 'new-game-now': newGame(); break;
    default: break;
  }
});

// Esc закрывает диалог/сообщение.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (ui.alert) { ui.alert = null; render(); return; }
  if (ui.dialog && ui.dialog !== 'result') { ui.dialog = null; render(); }
});

// ---------------------------------------------------------------------------
// Отладочный доступ из консоли (для тестировщика и быстрой игры года)
// ---------------------------------------------------------------------------

window.komp1998 = {
  get state() { return state; },
  save,
  newGame,
  saveNow: save,
  logic: game,
  render,
  openDialog(name) { ui.dialog = name; renderDialog(); return name; },
  sleepDays(count = 1) {
    for (let i = 0; i < count && !state.result; i += 1) {
      game.sleep(state);
      state.pendingReceipt = null;
    }
    save();
    if (state.result) ui.dialog = 'result';
    render();
    return state.result;
  },
  week(days = 7, plan = {}) {
    const report = game.advanceDays(state, plan, days);
    save();
    render();
    return report;
  },
};

render();
// После перезагрузки показываем незакрытые окна: итог года/долг и неоплаченные квитанции.
if (state.result) {
  ui.dialog = 'result';
  ui.hint = state.result.type === 'finish' ? 'Год закончился.' : 'Игра окончена.';
  render();
} else if (state.pendingReceipt) {
  ui.dialog = 'receipt';
  ui.hint = 'Первое число — день платежей.';
  render();
}
save();
