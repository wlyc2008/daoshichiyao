/**
 * 云端提醒计划同步
 * V1 reminder_plans 已停用：首次同步时清空旧数据，避免子女端收到用药提醒
 * V2 med_plans：按 targetId 推送给已绑定的长辈
 * 仅在计划指纹变化时写入云端，避免每次进入页面都占用云函数额度
 */
const storage = require('./storage');
const reminder = require('./reminder');
const cloud = require('./cloud');
const date = require('./date');

/** 单个药品的每日提醒时刻，已停用药品也保留时刻，便于云端标记 stopped */
function timesOfMed(med) {
  const source = med.isActive === false ? Object.assign({}, med, { isActive: true }) : med;
  const times = reminder.buildSchedule([source], storage.getMealTimes(), new Date())
    .map((item) => item.time);
  return times.filter((time, index) => time && times.indexOf(time) === index).sort();
}

/** 最近一次未来的复诊日期，写入计划供云端展示 */
function nextVisit() {
  const today = date.formatDate(new Date());
  return storage.getDocs()
    .map((doc) => doc.followupDate)
    .filter((day) => day && day >= today)
    .sort()[0] || '';
}

/** 与 syncMedPlans 云函数约定的计划结构 */
function buildPlans() {
  const visit = nextVisit();
  return storage.getMeds({ includeInactive: true }).map((med) => ({
    medId: med.id,
    medName: med.name,
    dose: med.dose,
    unit: med.unit || '片',
    intensity: storage.normalizeIntensity(med.intensity),
    schedule: timesOfMed(med),
    stock: Math.max(0, parseInt(med.remainingPills, 10) || 0),
    nextVisit: visit,
    status: med.isActive === false ? 'stopped' : 'active'
  })).filter((plan) => plan.schedule.length);
}

/** 计划指纹：任一药品的强度、时刻、库存变化都会触发上云 */
function buildPlanSignature(plans) {
  return plans.map((plan) => [
    plan.medId,
    plan.medName,
    plan.dose,
    plan.unit,
    plan.intensity,
    plan.schedule.join('/'),
    plan.stock,
    plan.nextVisit,
    plan.status
  ].join(',')).sort().join('|');
}

/**
 * 计划有变化时才同步，返回是否真正发起了云端写入
 * @param {boolean} force 绑定关系变化时强制重写，刷新云端 targetId
 */
function syncIfChanged(force) {
  if (!cloud.isEnabled()) return Promise.resolve(false);

  const settings = storage.getSettings();
  const plans = buildPlans();
  const planSignature = buildPlanSignature(plans);

  const tasks = [];
  // 老版本会把自己的提醒计划写到 V1 reminder_plans，升级后清空一次
  if (!settings.v1Cleared) {
    tasks.push(cloud.syncPlan([], 0).then(() => {
      storage.setSettings({ planSignature: '', v1Cleared: true });
    }).catch(() => {}));
  }
  if (force || settings.medPlanSignature !== planSignature) {
    tasks.push(cloud.callFunction('syncMedPlans', { plans: plans }).then((res) => {
      if (res && res.ok === false) throw new Error(res.msg || '计划同步失败');
      storage.setSettings({ medPlanSignature: planSignature });
    }));
  }

  if (!tasks.length) return Promise.resolve(false);
  return Promise.all(tasks).then(() => true).catch(() => false);
}

/** 清空云端计划，用于「还原初始状态」 */
function clearCloudPlan() {
  if (!cloud.isEnabled()) return Promise.resolve(false);
  return Promise.all([
    cloud.syncPlan([], 0),
    cloud.callFunction('syncMedPlans', { plans: [] })
  ]).then(() => {
    storage.setSettings({ planSignature: '', medPlanSignature: '', v1Cleared: true });
    return true;
  }).catch(() => false);
}

module.exports = {
  buildPlans,
  buildPlanSignature,
  syncIfChanged,
  clearCloudPlan
};
