/**
 * 云端提醒计划同步
 * 仅在计划指纹变化时写入云端，避免每次进入页面都占用云函数额度
 */
const storage = require('./storage');
const reminder = require('./reminder');
const ics = require('./ics');
const cloud = require('./cloud');

/** 云端计划项：与 syncPlan 云函数约定的结构一致 */
function buildItems() {
  return reminder.buildSchedule(storage.getMeds(), storage.getMealTimes(), new Date()).map((item) => ({
    time: item.time,
    name: item.name,
    dose: item.dose,
    unit: item.unit || '片'
  }));
}

/** 计划有变化时才同步，返回是否真正发起了云端写入 */
function syncIfChanged() {
  if (!cloud.isEnabled()) return Promise.resolve(false);
  const signature = ics.buildSignature(storage.getMeds(), storage.getMealTimes());
  if (storage.getSettings().planSignature === signature) return Promise.resolve(false);
  return cloud.syncPlan(buildItems(), 0).then(() => {
    storage.setSettings({ planSignature: signature });
    return true;
  }).catch(() => false);
}

/** 清空云端计划，用于「还原初始状态」 */
function clearCloudPlan() {
  if (!cloud.isEnabled()) return Promise.resolve(false);
  return cloud.syncPlan([], 0).then(() => {
    storage.setSettings({ planSignature: '' });
    return true;
  }).catch(() => false);
}

module.exports = {
  buildItems,
  syncIfChanged,
  clearCloudPlan
};
