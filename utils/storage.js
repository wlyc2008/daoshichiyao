/**
 * 本地数据唯一读写入口
 * 约定：页面不得直接调用 wx.setStorageSync，一律经由本模块
 * 每次写入前重新读取最新数据，避免多页面操作时相互覆盖
 */
const KEYS = require('./storageKeys');
const fileManager = require('./fileManager');
const medSchedule = require('./medSchedule');

const RULES = [
  'before', 'after', 'anytime',
  'wake', 'nap', 'bedtime',
  'morning', 'noon', 'evening'
];
const UNITS = ['片', '支', '毫升'];
const DOC_TYPES = ['discharge', 'prescription'];

const DEFAULT_MEAL_TIMES = { breakfast: '08:00', lunch: '12:00', dinner: '18:00' };
const DEFAULT_ROUTINE_TIMES = { wake: '06:30', nap: '13:00', bedtime: '21:30' };
const DEFAULT_SETTINGS = {
  icsExportedAt: '',
  icsSignature: '',
  subscribeRequestedAt: '',
  wechatSignature: '',
  planSignature: ''
};

/** 生成唯一 ID：时间戳 + 三位随机数，避免同一毫秒内重复 */
function genId() {
  return String(Date.now()) + String(Math.floor(Math.random() * 900) + 100);
}

function readArray(key) {
  try {
    const value = wx.getStorageSync(key);
    return Array.isArray(value) ? value : [];
  } catch (err) {
    return [];
  }
}

function writeArray(key, list) {
  wx.setStorageSync(key, list);
}

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function clampInt(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/* ------------------------------ 药品 MEDS ------------------------------ */

/** 获取药品列表，默认只返回在服药品 */
function getMeds(options) {
  const includeInactive = !!(options && options.includeInactive);
  const list = readArray(KEYS.MEDS);
  return includeInactive ? list : list.filter((med) => med && med.isActive !== false);
}

/** 按 ID 查找药品，包含已停用 */
function getMedById(id) {
  const list = readArray(KEYS.MEDS);
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

/** 新增药品，返回落库后的完整对象 */
function addMed(input) {
  const source = input || {};
  const name = String(source.name || '').trim();
  if (!name) throw new Error('请填写药名');

  const med = {
    id: genId(),
    name: name,
    dose: clampInt(source.dose, 1, 999, 1),
    times: clampInt(source.times, 1, 5, 1),
    unit: UNITS.indexOf(source.unit) >= 0 ? source.unit : '片',
    rule: RULES.indexOf(source.rule) >= 0 ? source.rule : 'after',
    fixedTime: source.fixedTime || '09:00',
    remainingPills: Math.max(0, toInt(source.remainingPills, 0)),
    photoPath: source.photoPath || '',
    isActive: true,
    createdAt: Date.now()
  };
  if (source.schedule) {
    med.schedule = medSchedule.normalizeSchedule(source.schedule);
  }

  const list = readArray(KEYS.MEDS);
  list.push(med);
  writeArray(KEYS.MEDS, list);
  return med;
}

/** 更新药品的可编辑字段，id 与 createdAt 不允许被覆盖 */
function updateMed(id, patch) {
  const list = readArray(KEYS.MEDS);
  let index = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      index = i;
      break;
    }
  }
  if (index < 0) return null;

  const current = list[index];
  const next = Object.assign({}, current);
  const changes = patch || {};

  if (changes.name !== undefined) {
    const name = String(changes.name).trim();
    if (!name) throw new Error('请填写药名');
    next.name = name;
  }
  if (changes.dose !== undefined) {
    next.dose = clampInt(changes.dose, 1, 999, current.dose);
  }
  if (changes.times !== undefined) {
    next.times = clampInt(changes.times, 1, 5, current.times || 1);
  }
  if (changes.schedule !== undefined) {
    if (changes.schedule) {
      next.schedule = medSchedule.normalizeSchedule(changes.schedule);
    } else {
      delete next.schedule;
    }
  }
  if (changes.unit !== undefined && UNITS.indexOf(changes.unit) >= 0) {
    next.unit = changes.unit;
  }
  if (changes.rule !== undefined && RULES.indexOf(changes.rule) >= 0) {
    next.rule = changes.rule;
  }
  if (changes.fixedTime !== undefined) {
    next.fixedTime = changes.fixedTime;
  }
  if (changes.remainingPills !== undefined) {
    next.remainingPills = Math.max(0, toInt(changes.remainingPills, current.remainingPills));
  }
  if (changes.photoPath !== undefined) {
    next.photoPath = changes.photoPath;
  }

  list[index] = next;
  writeArray(KEYS.MEDS, list);
  return next;
}

/** 补货：库存累加，数量必须为正整数 */
function addStock(id, amount) {
  const delta = parseInt(amount, 10);
  if (isNaN(delta) || delta <= 0) throw new Error('补货数量必须大于 0');

  const med = getMedById(id);
  if (!med) return null;
  return updateMed(id, { remainingPills: Math.max(0, toInt(med.remainingPills, 0)) + delta });
}

/** 确认服药时扣减库存，不足时归零并返回实际扣减结果 */
function deductStock(id, amount) {
  const med = getMedById(id);
  if (!med) return null;
  const delta = Math.max(0, toInt(amount, 0));
  const next = Math.max(0, toInt(med.remainingPills, 0) - delta);
  return updateMed(id, { remainingPills: next });
}

/** 停用 / 恢复药品（逻辑删除，保留历史日志可读性） */
function toggleMed(id) {
  const list = readArray(KEYS.MEDS);
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      const next = Object.assign({}, list[i], { isActive: list[i].isActive === false });
      list[i] = next;
      writeArray(KEYS.MEDS, list);
      return next;
    }
  }
  return null;
}

/** 物理删除药品，同时清理关联照片文件 */
function deleteMed(id) {
  const list = readArray(KEYS.MEDS);
  let removed = null;
  const rest = list.filter((med) => {
    if (med.id === id) {
      removed = med;
      return false;
    }
    return true;
  });
  if (!removed) return null;

  writeArray(KEYS.MEDS, rest);
  if (removed.photoPath) {
    fileManager.removePhoto(removed.photoPath);
  }
  return removed;
}

/* --------------------------- 三餐时间 MEAL_TIMES --------------------------- */

function getMealTimes() {
  try {
    const saved = wx.getStorageSync(KEYS.MEAL_TIMES);
    if (saved && typeof saved === 'object') {
      return Object.assign({}, DEFAULT_MEAL_TIMES, saved);
    }
  } catch (err) {
    // 读取失败时回落到默认值
  }
  return Object.assign({}, DEFAULT_MEAL_TIMES);
}

function setMealTimes(times) {
  const next = Object.assign({}, DEFAULT_MEAL_TIMES);
  ['breakfast', 'lunch', 'dinner'].forEach((key) => {
    if (times && times[key]) next[key] = times[key];
  });
  wx.setStorageSync(KEYS.MEAL_TIMES, next);
  return next;
}

/* ---------------------------- 起居时间 ROUTINE_TIMES ---------------------------- */

function getRoutineTimes() {
  try {
    const saved = wx.getStorageSync(KEYS.ROUTINE_TIMES);
    if (saved && typeof saved === 'object') {
      return Object.assign({}, DEFAULT_ROUTINE_TIMES, saved);
    }
  } catch (err) {
    // 读取失败时回落到默认值
  }
  return Object.assign({}, DEFAULT_ROUTINE_TIMES);
}

function setRoutineTimes(times) {
  const next = Object.assign({}, DEFAULT_ROUTINE_TIMES);
  ['wake', 'nap', 'bedtime'].forEach((key) => {
    if (times && times[key]) next[key] = times[key];
  });
  wx.setStorageSync(KEYS.ROUTINE_TIMES, next);
  return next;
}

/* ---------------------------- 服药日志 DOSE_LOGS ---------------------------- */

function getLogs() {
  return readArray(KEYS.DOSE_LOGS);
}

/** 写一条日志，status 仅支持 taken / snoozed */
function addLog(entry) {
  const source = entry || {};
  const log = {
    logId: genId(),
    medId: source.medId,
    plannedTime: source.plannedTime || '',
    confirmedTime: source.confirmedTime || '',
    status: source.status === 'snoozed' ? 'snoozed' : 'taken',
    snoozeUntil: source.snoozeUntil || ''
  };
  const list = readArray(KEYS.DOSE_LOGS);
  list.push(log);
  writeArray(KEYS.DOSE_LOGS, list);
  return log;
}

/** 更新日志字段，用于稍后提醒改期 */
function updateLog(logId, patch) {
  const list = readArray(KEYS.DOSE_LOGS);
  for (let i = 0; i < list.length; i++) {
    if (list[i].logId === logId) {
      list[i] = Object.assign({}, list[i], patch || {});
      writeArray(KEYS.DOSE_LOGS, list);
      return list[i];
    }
  }
  return null;
}

/** 删除日志，用于撤销误操作 */
function removeLog(logId) {
  const list = readArray(KEYS.DOSE_LOGS);
  let removed = null;
  const rest = list.filter((log) => {
    if (log.logId === logId) {
      removed = log;
      return false;
    }
    return true;
  });
  if (!removed) return null;
  writeArray(KEYS.DOSE_LOGS, rest);
  return removed;
}

/* --------------------------- 医疗档案 GLOBAL_DOCS --------------------------- */

function getDocs() {
  return readArray(KEYS.GLOBAL_DOCS);
}

function addDoc(input) {
  const source = input || {};
  const doc = {
    docId: genId(),
    type: DOC_TYPES.indexOf(source.type) >= 0 ? source.type : 'discharge',
    title: String(source.title || '').trim() || '未命名单据',
    photoPath: source.photoPath || '',
    note: source.note || '',
    needFollowup: source.needFollowup === true,
    followupDate: source.followupDate || '',
    createdAt: Date.now()
  };
  const list = readArray(KEYS.GLOBAL_DOCS);
  list.push(doc);
  writeArray(KEYS.GLOBAL_DOCS, list);
  return doc;
}

function deleteDoc(docId) {
  const list = readArray(KEYS.GLOBAL_DOCS);
  let removed = null;
  const rest = list.filter((doc) => {
    if (doc.docId === docId) {
      removed = doc;
      return false;
    }
    return true;
  });
  if (!removed) return null;
  writeArray(KEYS.GLOBAL_DOCS, rest);
  if (removed.photoPath) {
    fileManager.removePhoto(removed.photoPath);
  }
  return removed;
}

/* ----------------------------- 全局状态 SETTINGS ----------------------------- */

function getSettings() {
  try {
    const saved = wx.getStorageSync(KEYS.SETTINGS);
    if (saved && typeof saved === 'object') {
      return Object.assign({}, DEFAULT_SETTINGS, saved);
    }
  } catch (err) {
    // 读取失败时回落到默认值
  }
  return Object.assign({}, DEFAULT_SETTINGS);
}

function setSettings(patch) {
  const next = Object.assign({}, getSettings(), patch || {});
  wx.setStorageSync(KEYS.SETTINGS, next);
  return next;
}

module.exports = {
  DEFAULT_MEAL_TIMES,
  DEFAULT_ROUTINE_TIMES,
  DEFAULT_SETTINGS,
  genId,
  getMeds,
  getMedById,
  addMed,
  updateMed,
  addStock,
  deductStock,
  toggleMed,
  deleteMed,
  getMealTimes,
  setMealTimes,
  getRoutineTimes,
  setRoutineTimes,
  getLogs,
  addLog,
  updateLog,
  removeLog,
  getDocs,
  addDoc,
  deleteDoc,
  getSettings,
  setSettings
};
