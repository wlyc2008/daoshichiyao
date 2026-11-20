/**
 * 备份与换机恢复
 * 备份内容：药品、医疗档案、用药记录、饮食作息与设置
 * 照片是本机文件，无法跨设备恢复，备份时统一清空 photoPath
 */
const storage = require('./storage');
const role = require('./role');
const cloud = require('./cloud');
const KEYS = require('./storageKeys');

const BACKUP_VERSION = 1;
// 与云函数保持一致，避免上传后才发现超限
const MAX_SIZE = 240 * 1024;

function withoutPhoto(item) {
  const next = Object.assign({}, item);
  next.photoPath = '';
  return next;
}

function collect() {
  return {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    role: role.getRole(),
    meds: storage.getMeds({ includeInactive: true }).map(withoutPhoto),
    docs: storage.getDocs().map(withoutPhoto),
    logs: storage.getLogs(),
    mealTimes: storage.getMealTimes(),
    routineTimes: storage.getRoutineTimes(),
    settings: storage.getSettings()
  };
}

function save() {
  const payload = collect();
  if (JSON.stringify(payload).length > MAX_SIZE) {
    return Promise.reject(new Error('数据较多，请精简后再备份'));
  }
  return cloud.callFunction('backupData', { action: 'save', payload: payload }).then((res) => {
    if (!res || res.ok !== true) throw new Error((res && res.msg) || '备份失败');
    return res;
  });
}

function info() {
  return cloud.callFunction('backupData', { action: 'info' }).then((res) => res || { ok: true, exists: false });
}

function fetchBackup() {
  return cloud.callFunction('backupData', { action: 'load' }).then((res) => {
    if (!res || res.ok !== true) throw new Error((res && res.msg) || '读取备份失败');
    return res;
  });
}

function sanitizeList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

/** 把云端备份写回本机；恢复后清空计划签名，强制重新同步云端计划 */
function apply(payload) {
  if (!payload || Number(payload.version) !== BACKUP_VERSION) {
    throw new Error('备份版本不兼容，请更新小程序后重试');
  }

  wx.setStorageSync(KEYS.MEDS, sanitizeList(payload.meds).map(withoutPhoto));
  wx.setStorageSync(KEYS.GLOBAL_DOCS, sanitizeList(payload.docs).map(withoutPhoto));
  wx.setStorageSync(KEYS.DOSE_LOGS, sanitizeList(payload.logs));
  storage.setMealTimes(payload.mealTimes || {});
  storage.setRoutineTimes(payload.routineTimes || {});

  const settings = Object.assign({}, payload.settings || {});
  settings.planSignature = '';
  settings.medPlanSignature = '';
  settings.boundTargetId = '';
  storage.setSettings(settings);

  if (payload.role && role.roleText(payload.role)) role.setRole(payload.role);
  return true;
}

function restore() {
  return fetchBackup().then((res) => {
    apply(res.payload);
    return res;
  });
}

module.exports = {
  collect,
  save,
  info,
  fetchBackup,
  apply,
  restore
};
