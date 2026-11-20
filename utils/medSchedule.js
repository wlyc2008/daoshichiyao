/**
 * 服药模式：把四种模式统一换算成每天的提醒时刻
 * 纯逻辑模块，不读写页面数据；三餐与起居时间由调用方传入
 */
const date = require('./date');

const MODES = [
  { value: 'meal', label: '依据饭点' },
  { value: 'routine', label: '依据作息' },
  { value: 'interval', label: '依据服药间隔' },
  { value: 'custom', label: '自选时间点' }
];

const MEAL_OPTIONS = [
  { value: 'breakfast', label: '早' },
  { value: 'lunch', label: '中' },
  { value: 'dinner', label: '晚' }
];

const OFFSET_OPTIONS = [
  { value: 'before', label: '餐前' },
  { value: 'during', label: '餐中' },
  { value: 'after', label: '餐后' }
];

const ROUTINE_OPTIONS = [
  { value: 'wake', label: '早起床' },
  { value: 'nap', label: '午休前' },
  { value: 'bedtime', label: '晚睡前' }
];

const INTERVAL_OPTIONS = [
  { value: 8, label: '间隔 8 小时' },
  { value: 12, label: '间隔 12 小时' }
];

const OFFSET_MINUTES = { before: -30, during: 0, after: 60 };
const DEFAULT_INTERVAL_START = '08:00';
const MAX_CUSTOM_TIMES = 5;

const DEFAULT_MEAL_TIMES = { breakfast: '08:00', lunch: '12:00', dinner: '18:00' };
const DEFAULT_ROUTINE_TIMES = { wake: '06:30', nap: '13:00', bedtime: '21:30' };

const LEGACY_RULE_TEXT = {
  before: '餐前半小时',
  after: '餐后一小时',
  anytime: '不限餐时',
  wake: '早起床',
  nap: '午休前',
  bedtime: '晚睡前',
  morning: '早上',
  noon: '中午',
  evening: '晚上'
};

const MEAL_TO_PERIOD = { morning: 'breakfast', noon: 'lunch', evening: 'dinner' };

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function minutesToTime(total) {
  const normalized = ((total % 1440) + 1440) % 1440;
  return pad(Math.floor(normalized / 60)) + ':' + pad(normalized % 60);
}

/** 统一成 "HH:mm"，非法输入返回空串 */
function normalizeTime(value) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!matched) return '';
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return '';
  return pad(hour) + ':' + pad(minute);
}

function unique(values) {
  const out = [];
  (values || []).forEach((value) => {
    if (out.indexOf(value) === -1) out.push(value);
  });
  return out;
}

/** 补齐并校验模式字段，保证提醒引擎拿到的数据永远合法 */
function normalizeSchedule(raw) {
  const source = raw || {};
  const mode = MODES.some((item) => item.value === source.mode) ? source.mode : 'meal';
  const meals = unique((source.meals || []).filter((key) => MEAL_OPTIONS.some((o) => o.value === key))).slice(0, 3);
  const routines = unique((source.routines || []).filter((key) => ROUTINE_OPTIONS.some((o) => o.value === key))).slice(0, 3);
  const mealOffset = OFFSET_OPTIONS.some((o) => o.value === source.mealOffset) ? source.mealOffset : 'after';
  const intervalHours = Number(source.intervalHours) === 12 ? 12 : 8;
  const intervalStart = normalizeTime(source.intervalStart) || DEFAULT_INTERVAL_START;

  let customTimes = unique((source.customTimes || []).map(normalizeTime).filter(Boolean));
  customTimes.sort((a, b) => date.minutesOfDay(a) - date.minutesOfDay(b));
  customTimes = customTimes.slice(0, MAX_CUSTOM_TIMES);

  return {
    mode: mode,
    meals: meals,
    mealOffset: mealOffset,
    routines: routines,
    intervalHours: intervalHours,
    intervalStart: intervalStart,
    customTimes: customTimes
  };
}

/** 按模式算出每天的时刻列表，已排序去重 */
function timesOf(schedule, mealTimes, routineTimes) {
  const config = normalizeSchedule(schedule);
  const meals = Object.assign({}, DEFAULT_MEAL_TIMES, mealTimes || {});
  const routine = Object.assign({}, DEFAULT_ROUTINE_TIMES, routineTimes || {});
  let times = [];

  if (config.mode === 'meal') {
    const offset = OFFSET_MINUTES[config.mealOffset];
    times = config.meals.map((key) => date.addMinutes(meals[key], offset));
  } else if (config.mode === 'routine') {
    times = config.routines.map((key) => routine[key]);
  } else if (config.mode === 'interval') {
    const step = config.intervalHours * 60;
    const count = Math.round(1440 / step);
    const start = date.minutesOfDay(config.intervalStart);
    for (let i = 0; i < count; i++) {
      times.push(minutesToTime(start + i * step));
    }
  } else {
    times = config.customTimes;
  }

  return unique(times.map(normalizeTime).filter(Boolean))
    .sort((a, b) => date.minutesOfDay(a) - date.minutesOfDay(b));
}

function modeLabel(mode) {
  const found = MODES.filter((item) => item.value === mode)[0];
  return found ? found.label : '';
}

function offsetLabel(value) {
  const found = OFFSET_OPTIONS.filter((item) => item.value === value)[0];
  return found ? found.label : '餐后';
}

/** 模式摘要，用于首页与药品管理列表 */
function summaryOf(med) {
  if (!med) return '';
  if (!med.schedule) {
    return LEGACY_RULE_TEXT[med.rule] || '餐后一小时';
  }
  const config = normalizeSchedule(med.schedule);

  if (config.mode === 'meal') {
    const labels = config.meals
      .map((key) => (MEAL_OPTIONS.filter((o) => o.value === key)[0] || {}).label)
      .filter(Boolean);
    if (!labels.length) return '依据饭点';
    return labels.join('、') + ' ' + offsetLabel(config.mealOffset);
  }
  if (config.mode === 'routine') {
    const labels = config.routines
      .map((key) => (ROUTINE_OPTIONS.filter((o) => o.value === key)[0] || {}).label)
      .filter(Boolean);
    return labels.length ? labels.join('、') : '依据作息';
  }
  if (config.mode === 'interval') {
    return '每 ' + config.intervalHours + ' 小时（' + config.intervalStart + ' 起）';
  }
  if (!config.customTimes.length) return '自选时间点';
  return '自选 ' + config.customTimes.join('、');
}

/**
 * 把旧版 rule/times 迁移成等价的服药模式
 * 目的：首次编辑旧药品时，页面能直接显示并保存为新结构
 */
function fromLegacy(med, mealTimes, routineTimes) {
  if (!med) return normalizeSchedule({ mode: 'meal', meals: [], mealOffset: 'after' });
  if (med.schedule) return normalizeSchedule(med.schedule);

  const rule = med.rule || 'after';
  const count = Math.max(1, Math.min(4, parseInt(med.times, 10) || (rule === 'anytime' ? 1 : 3)));
  const meals = Object.assign({}, DEFAULT_MEAL_TIMES, mealTimes || {});
  const routine = Object.assign({}, DEFAULT_ROUTINE_TIMES, routineTimes || {});

  if (ROUTINE_OPTIONS.some((o) => o.value === rule)) {
    return normalizeSchedule({ mode: 'routine', routines: [rule] });
  }

  if (MEAL_TO_PERIOD[rule]) {
    const time = meals[MEAL_TO_PERIOD[rule]] || meals.breakfast;
    return normalizeSchedule({ mode: 'custom', customTimes: [time] });
  }

  if (rule === 'anytime' && count <= 1) {
    return normalizeSchedule({ mode: 'custom', customTimes: [med.fixedTime || '09:00'] });
  }

  // 旧版餐前/餐后：1 次早餐，2 次早晚餐，3 次三餐
  if (count <= 3 && rule !== 'anytime') {
    const selected = count === 1
      ? ['breakfast']
      : (count === 2 ? ['breakfast', 'dinner'] : ['breakfast', 'lunch', 'dinner']);
    return normalizeSchedule({
      mode: 'meal',
      meals: selected,
      mealOffset: rule === 'before' ? 'before' : 'after'
    });
  }

  // 4 次或“不限餐时”多次：按实际时刻转成自选，保持原有提醒不变
  const bases = ['breakfast', 'lunch', 'dinner'].map((key) => meals[key]);
  if (count >= 4) bases.push(routine.bedtime);
  const offset = rule === 'before' ? -30 : (rule === 'after' ? 60 : 0);
  return normalizeSchedule({
    mode: 'custom',
    customTimes: bases.map((time) => date.addMinutes(time, offset))
  });
}

module.exports = {
  MODES,
  MEAL_OPTIONS,
  OFFSET_OPTIONS,
  ROUTINE_OPTIONS,
  INTERVAL_OPTIONS,
  MAX_CUSTOM_TIMES,
  normalizeSchedule,
  normalizeTime,
  timesOf,
  summaryOf,
  fromLegacy,
  modeLabel
};
