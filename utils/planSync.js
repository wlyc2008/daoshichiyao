/**
 * 云端提醒计划同步
 * V1 reminder_plans 已停用：首次同步时清空旧数据，避免子女端收到用药提醒
 * V2 med_plans：按 targetId 推送给已绑定的长辈
 * 仅在计划指纹变化时写入云端，避免每次进入页面都占用云函数额度
 */
const storage = require('./storage');
const reminder = require('./reminder');
const cloud = require('./cloud');
const bind = require('./bind');
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

/** 本地计划指纹：药品、时刻、库存、复诊任一变化都会产生新指纹 */
function localSignature() {
  return buildPlanSignature(buildPlans());
}

/** 云端指纹与本地不一致时说明还没提交成功 */
function isSubmitPending(cloudSignature) {
  return localSignature() !== (cloudSignature || '');
}

/** 计划变化后的引导：直接去「微信提醒」页重新提交 */
function guideResubmit() {
  wx.showModal({
    title: '用药计划已更新',
    content: '新的用药计划和库存已同步到父母端。请到「微信提醒」页重新提交，确保到点按最新时间提醒。',
    confirmText: '去更新',
    showCancel: false,
    success: (res) => {
      if (!res.confirm) return;
      const pages = getCurrentPages();
      const prev = pages[pages.length - 2];
      // 从「微信提醒」页过来的调整页，返回即可看到提交入口
      if (prev && prev.route === 'pages/plan-preview/plan-preview') {
        wx.navigateBack();
      } else {
        wx.navigateTo({ url: '/pages/plan-preview/plan-preview' });
      }
    }
  });
}

/**
 * 计划有变化时才同步，返回是否真正发起了云端写入
 * 指纹只保存在云端 users.planSign，本地不存副本
 * @param {boolean} force 绑定关系变化时强制重写，刷新云端 targetId
 */
function syncIfChanged(force) {
  if (!cloud.isEnabled()) return Promise.resolve(false);

  const settings = storage.getSettings();
  const plans = buildPlans();
  const signature = localSignature();

  return bind.fetchStatus().then((res) => {
    const cloudSignature = (res.profile && res.profile.planSign) || '';
    const tasks = [];
    // 老版本会把自己的提醒计划写到 V1 reminder_plans，升级后清空一次
    if (!settings.v1Cleared) {
      tasks.push(cloud.syncPlan([], 0).then(() => {
        storage.setSettings({ v1Cleared: true });
      }).catch(() => {}));
    }
    if (force || cloudSignature !== signature) {
      tasks.push(cloud.callFunction('syncMedPlans', {
        plans: plans,
        signature: signature
      }).then((out) => {
        if (out && out.ok === false) throw new Error(out.msg || '计划同步失败');
      }));
    }

    if (!tasks.length) return false;
    return Promise.all(tasks).then(() => true);
  }).catch(() => false);
}

/** 清空云端计划，用于「还原初始状态」 */
function clearCloudPlan() {
  if (!cloud.isEnabled()) return Promise.resolve(false);
  return Promise.all([
    cloud.syncPlan([], 0),
    cloud.callFunction('syncMedPlans', { plans: [] })
  ]).then(() => {
    storage.setSettings({ v1Cleared: true });
    return true;
  }).catch(() => false);
}

module.exports = {
  buildPlans,
  buildPlanSignature,
  localSignature,
  isSubmitPending,
  guideResubmit,
  syncIfChanged,
  clearCloudPlan
};
