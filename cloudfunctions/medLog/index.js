const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const PLANS = 'med_plans';
const LOGS = 'med_logs';
const USERS = 'users';

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

/** 云函数运行环境时区不确定，统一按北京时间取「今天」 */
function beijingDateKey() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1) + '-' + pad(now.getUTCDate());
}

function normalizeTime(value) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!matched) return '';
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return '';
  return pad(hour) + ':' + pad(minute);
}

async function findUser(openid) {
  const found = await db.collection(USERS).where({ openid: openid }).limit(1).get();
  return found.data.length ? found.data[0] : null;
}

async function ensureCollections() {
  try {
    await db.createCollection(LOGS);
  } catch (err) {
    // 已存在时忽略
  }
}

/**
 * 今日用药：长辈看自己的，子女看长辈的
 * 计划按 ownerId 读取，兼容 targetId 尚未刷新的历史数据
 */
async function getToday(openid) {
  const user = await findUser(openid);
  if (!user || !user.linkedId) {
    return { ok: true, bound: false, items: [], total: 0, done: 0 };
  }

  const isCaree = user.role === 'caree';
  const ownerId = isCaree ? user.linkedId : openid;
  const day = beijingDateKey();

  let plans;
  let logs;
  try {
    plans = await db.collection(PLANS).where({ ownerId: ownerId, status: 'active' }).limit(100).get();
    logs = await db.collection(LOGS).where({ ownerId: ownerId, dateKey: day }).limit(200).get();
  } catch (err) {
    // 集合尚未创建时按空计划处理
    return { ok: true, bound: true, items: [], total: 0, done: 0, day: day };
  }

  const takenMap = {};
  logs.data.forEach((log) => {
    if (log.status === 'taken') takenMap[log.planId + '|' + log.time] = log.confirmedAt || 0;
  });

  const items = [];
  plans.data.forEach((plan) => {
    (plan.schedule || []).forEach((time) => {
      const key = plan._id + '|' + time;
      items.push({
        planId: plan._id,
        medId: plan.medId,
        medName: plan.medName,
        dose: plan.dose,
        unit: plan.unit,
        time: time,
        intensity: plan.intensity || 'standard',
        taken: !!takenMap[key],
        confirmedAt: takenMap[key] || 0
      });
    });
  });
  items.sort((a, b) => (a.time < b.time ? -1 : 1));

  return {
    ok: true,
    bound: true,
    role: isCaree ? 'caree' : 'caregiver',
    day: day,
    items: items,
    total: items.length,
    done: items.filter((item) => item.taken).length,
    paused: isCaree ? !!user.notifyPaused : false
  };
}

/** 长辈点「已吃药」：写 med_logs 并扣减云端库存，同一时刻重复确认直接返回已有记录 */
async function confirmDose(openid, event) {
  const user = await findUser(openid);
  if (!user || user.role !== 'caree' || !user.linkedId) {
    return { ok: false, msg: '请先绑定家人的提醒' };
  }

  const planId = String(event.planId || '');
  const time = normalizeTime(event.time);
  if (!planId || !time) return { ok: false, msg: '参数不完整' };

  let plan;
  try {
    const found = await db.collection(PLANS).doc(planId).get();
    plan = found.data;
  } catch (err) {
    return { ok: false, msg: '这条提醒已经不存在了' };
  }
  if (!plan || plan.ownerId !== user.linkedId) return { ok: false, msg: '这条提醒已失效' };
  if (plan.status !== 'active') return { ok: false, msg: '这种药已停用' };
  if ((plan.schedule || []).indexOf(time) === -1) return { ok: false, msg: '提醒时间不匹配' };

  const day = beijingDateKey();
  const plannedTime = day + ' ' + time;

  const existed = await db.collection(LOGS).where({
    planId: planId,
    targetId: openid,
    plannedTime: plannedTime,
    status: 'taken'
  }).limit(1).get();
  if (existed.data.length) return { ok: true, duplicate: true, log: existed.data[0] };

  const now = Date.now();
  const log = {
    planId: planId,
    medId: plan.medId,
    ownerId: plan.ownerId,
    targetId: openid,
    medName: plan.medName,
    dose: plan.dose,
    unit: plan.unit,
    time: time,
    plannedTime: plannedTime,
    dateKey: day,
    status: 'taken',
    confirmedAt: now,
    createdAt: now
  };
  await db.collection(LOGS).add({ data: log });

  // 云端库存只减不增，最低为 0；本地库存由子女端补货时重新覆盖
  const stock = Math.max(0, Number(plan.stock) || 0);
  const dose = Math.max(1, Number(plan.dose) || 1);
  await db.collection(PLANS).doc(planId).update({
    data: { stock: Math.max(0, stock - dose), updatedAt: now }
  });

  return { ok: true, log: log };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, msg: '缺少用户标识' };

  await ensureCollections();

  if (event.action === 'confirm') return confirmDose(OPENID, event);
  return getToday(OPENID);
};
