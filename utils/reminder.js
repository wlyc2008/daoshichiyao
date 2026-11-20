/**
 * 提醒引擎：生成每日时刻表、判断当前应服药品、处理稍后提醒
 * 纯逻辑模块，不操作页面，便于在 Console 中单独验证
 */
const date = require('./date');
const storage = require('./storage');
const stock = require('./stock');
const medSchedule = require('./medSchedule');

const DUE_WINDOW_MINUTES = 5;
const SNOOZE_MINUTES = 10;

// 起居类规则读取用户在「起居时间」页的设置；早/中/晚沿用三餐时间
const ROUTINE_RULES = ['wake', 'nap', 'bedtime'];
const MEAL_PERIODS = { morning: 'breakfast', noon: 'lunch', evening: 'dinner' };
const SINGLE_RULES = ['wake', 'nap', 'bedtime', 'morning', 'noon', 'evening'];

/** 单次规则对应的具体时刻，缺少配置时退回默认值 */
function singleTimeOf(rule, mealTimes) {
  if (ROUTINE_RULES.indexOf(rule) >= 0) {
    const routine = storage.getRoutineTimes();
    return routine[rule] || storage.DEFAULT_ROUTINE_TIMES[rule];
  }
  const key = MEAL_PERIODS[rule];
  const times = mealTimes || storage.getMealTimes();
  return (key && times[key]) || '08:00';
}

function mealList(mealTimes) {
  const times = mealTimes || storage.DEFAULT_MEAL_TIMES;
  return [times.breakfast, times.lunch, times.dinner].filter(Boolean);
}

/** 按一日次数挑选用餐时刻：1 次早餐；2 次早晚餐；3 次三餐；4 次三餐加睡前 */
function pickMeals(mealTimes, count) {
  const meals = mealList(mealTimes);
  if (count >= 4) {
    const routine = storage.getRoutineTimes();
    return meals.concat([routine.bedtime || storage.DEFAULT_ROUTINE_TIMES.bedtime]);
  }
  if (count === 3) return meals;
  if (count === 2) return [meals[0], meals[meals.length - 1]];
  return [meals[0]];
}

/**
 * 生成某一日的提醒时刻表
 * @param {Array} meds 药品列表（已停用的会被自动跳过）
 * @param {Object} mealTimes 三餐时间
 * @param {Date|string} dateInput 目标日期，默认今天
 * @returns {Array} 按时间升序的 { medId, name, dose, unit, rule, time, plannedTime }
 */
function buildSchedule(meds, mealTimes, dateInput) {
  const day = date.formatDate(dateInput || new Date());
  const items = [];

  (meds || []).forEach((med) => {
    if (!med || med.isActive === false) return;

    const count = stock.timesPerDay(med);
    const unit = med.unit || '片';

    // 新版服药模式：时刻完全由模式配置决定
    if (med.schedule) {
      const times = medSchedule.timesOf(med.schedule, mealTimes, storage.getRoutineTimes());
      if (times.length) {
        times.forEach((time) => {
          items.push({
            medId: med.id,
            name: med.name,
            dose: med.dose,
            unit: unit,
            rule: med.schedule.mode,
            time: time,
            plannedTime: day + ' ' + time
          });
        });
        return;
      }
      // 配置异常（没有任何时刻）时退回旧规则，避免药品从提醒里静默消失
    }

    // 起居时间、早中晚等规则只对应一天一个时刻
    if (SINGLE_RULES.indexOf(med.rule) >= 0) {
      const time = singleTimeOf(med.rule, mealTimes);
      items.push({
        medId: med.id,
        name: med.name,
        dose: med.dose,
        unit: unit,
        rule: med.rule,
        time: time,
        plannedTime: day + ' ' + time
      });
      return;
    }

    // 不限餐时且每日一次：使用固定时刻
    if (med.rule === 'anytime' && count <= 1) {
      const time = med.fixedTime || '09:00';
      items.push({
        medId: med.id,
        name: med.name,
        dose: med.dose,
        unit: unit,
        rule: med.rule,
        time: time,
        plannedTime: day + ' ' + time
      });
      return;
    }

    // 不限餐时不加餐前餐后偏移，餐前抵前半小时、餐后延后一小时
    const offset = med.rule === 'before' ? -30 : (med.rule === 'after' ? 60 : 0);
    pickMeals(mealTimes, count).forEach((meal) => {
      const time = date.addMinutes(meal, offset);
      items.push({
        medId: med.id,
        name: med.name,
        dose: med.dose,
        unit: unit,
        rule: med.rule,
        time: time,
        plannedTime: day + ' ' + time
      });
    });
  });

  return items.sort((a, b) => date.minutesOfDay(a.time) - date.minutesOfDay(b.time));
}

function hasTaken(logs, medId, plannedTime) {
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (log.medId === medId && log.plannedTime === plannedTime && log.status === 'taken') return true;
  }
  return false;
}

function hasPendingSnooze(logs, medId, plannedTime, now) {
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (log.medId !== medId || log.plannedTime !== plannedTime || log.status !== 'snoozed') continue;
    const until = date.parseKey(log.snoozeUntil);
    if (until && until.getTime() > now.getTime()) return true;
  }
  return false;
}

/**
 * 返回当前时刻应服且未确认的药品
 * 命中窗口：计划时刻起 5 分钟内
 * @returns {Object|null} { med, plannedTime, reason: 'planned' | 'snooze' }
 */
function getDueDose(now) {
  const current = now instanceof Date ? now : new Date();
  const meds = storage.getMeds();
  if (!meds.length) return null;

  const logs = storage.getLogs();
  const windowMs = DUE_WINDOW_MINUTES * 60000;

  // 1. 稍后提醒已到期
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (log.status !== 'snoozed' || !log.snoozeUntil) continue;
    const until = date.parseKey(log.snoozeUntil);
    if (!until) continue;
    const diff = current.getTime() - until.getTime();
    if (diff < 0 || diff >= windowMs) continue;
    if (hasTaken(logs, log.medId, log.plannedTime)) continue;
    for (let j = 0; j < meds.length; j++) {
      if (meds[j].id === log.medId) {
        return { med: meds[j], plannedTime: log.plannedTime, reason: 'snooze' };
      }
    }
  }

  // 2. 计划时刻到点
  const schedule = buildSchedule(meds, storage.getMealTimes(), current);
  for (let i = 0; i < schedule.length; i++) {
    const item = schedule[i];
    const planned = date.parseKey(item.plannedTime);
    if (!planned) continue;
    const diff = current.getTime() - planned.getTime();
    if (diff < 0 || diff >= windowMs) continue;
    if (hasTaken(logs, item.medId, item.plannedTime)) continue;
    if (hasPendingSnooze(logs, item.medId, item.plannedTime, current)) continue;
    for (let j = 0; j < meds.length; j++) {
      if (meds[j].id === item.medId) {
        return { med: meds[j], plannedTime: item.plannedTime, reason: 'planned' };
      }
    }
  }

  return null;
}

/**
 * 确认服药：写 taken 日志并扣减库存
 * 同一计划时刻重复调用返回 null，避免重复扣减
 */
function confirmDose(med, plannedTime, now) {
  if (!med) return null;
  const current = now instanceof Date ? now : new Date();
  const logs = storage.getLogs();
  if (hasTaken(logs, med.id, plannedTime)) return null;

  const log = storage.addLog({
    medId: med.id,
    plannedTime: plannedTime,
    confirmedTime: date.toKey(current),
    status: 'taken'
  });
  const updated = storage.deductStock(med.id, med.dose);
  return { log: log, med: updated || med };
}

/**
 * 稍后提醒：同一计划时刻只保留一条 snoozed 记录
 * @returns {Object|null} 更新或新建的日志
 */
function markSnooze(medId, plannedTime, minutes, now) {
  const current = now instanceof Date ? now : new Date();
  const logs = storage.getLogs();
  if (hasTaken(logs, medId, plannedTime)) return null;

  const delay = typeof minutes === 'number' ? minutes : SNOOZE_MINUTES;
  const until = new Date(current.getTime() + delay * 60000);
  const untilKey = date.toKey(until);

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (log.medId === medId && log.plannedTime === plannedTime && log.status === 'snoozed') {
      return storage.updateLog(log.logId, { snoozeUntil: untilKey });
    }
  }

  return storage.addLog({
    medId: medId,
    plannedTime: plannedTime,
    confirmedTime: '',
    status: 'snoozed',
    snoozeUntil: untilKey
  });
}

module.exports = {
  DUE_WINDOW_MINUTES,
  SNOOZE_MINUTES,
  SINGLE_RULES,
  buildSchedule,
  getDueDose,
  confirmDose,
  markSnooze
};
