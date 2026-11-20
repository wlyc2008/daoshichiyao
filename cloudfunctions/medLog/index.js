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

/** 只接受 YYYY-MM-DD，避免历史查询传入任意字符串 */
function normalizeDateKey(value) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!matched) return '';
  return matched[1] + '-' + matched[2] + '-' + matched[3];
}

/** 日期键转天数序号，用于计算复诊倒计时 */
function dayNumber(dateKey) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!matched) return null;
  return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) / 86400000;
}

/** 库存不足 3 天或 7 天内复诊时给子女的提示 */
function buildAlerts(plans, dayKey) {
  const alerts = [];
  const todayNum = dayNumber(dayKey);

  plans.forEach((plan) => {
    const times = (plan.schedule || []).length;
    const dose = Math.max(1, Number(plan.dose) || 1);
    const daily = times * dose;
    const stock = Math.max(0, Number(plan.stock) || 0);
    if (daily > 0 && stock / daily < 3) {
      const days = Math.floor(stock / daily);
      alerts.push({
        type: 'stock',
        text: '「' + plan.medName + '」只剩 ' + (days < 1 ? '不到 1 天' : days + ' 天') + '用量，请及时补药'
      });
    }

    const visitNum = dayNumber(plan.nextVisit);
    if (todayNum !== null && visitNum !== null) {
      const diff = visitNum - todayNum;
      if (diff >= 0 && diff <= 7) {
        alerts.push({
          type: 'visit',
          text: (diff === 0 ? '今天' : '还有 ' + diff + ' 天') + '复诊，请提醒长辈带好病历'
        });
      }
    }
  });

  // 多个药品共享同一复诊日期时只保留一条
  const seen = {};
  return alerts.filter((item) => {
    const key = item.type + '|' + item.text;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
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
    return { ok: true, bound: false, items: [], total: 0, done: 0, missed: 0, alerts: [] };
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
    return { ok: true, bound: true, items: [], total: 0, done: 0, missed: 0, alerts: [], day: day };
  }

  const takenMap = {};
  const missedMap = {};
  logs.data.forEach((log) => {
    const key = log.planId + '|' + log.time;
    if (log.status === 'taken') takenMap[key] = log.confirmedAt || 0;
    else if (log.status === 'missed') missedMap[key] = true;
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
        missed: !takenMap[key] && !!missedMap[key],
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
    missed: items.filter((item) => item.missed).length,
    alerts: buildAlerts(plans.data, day),
    paused: isCaree ? !!user.notifyPaused : false
  };
}

/**
 * 历史执行记录：按日期返回当天有记录（已吃药 / 漏服）的条目
 * 计划表只保留当前版本，历史仅依据 med_logs 还原
 */
async function getHistory(openid, rawDay) {
  const user = await findUser(openid);
  if (!user || !user.linkedId) {
    return { ok: true, bound: false, day: '', items: [], total: 0, taken: 0, missed: 0 };
  }

  const isCaree = user.role === 'caree';
  const ownerId = isCaree ? user.linkedId : openid;
  const day = normalizeDateKey(rawDay) || beijingDateKey();

  let logs;
  try {
    logs = await db.collection(LOGS).where({ ownerId: ownerId, dateKey: day }).limit(200).get();
  } catch (err) {
    return { ok: true, bound: true, day: day, items: [], total: 0, taken: 0, missed: 0 };
  }

  // 直接读取日志快照，药品后来被删除也能看到当时的记录
  const items = logs.data
    .filter((log) => log.status === 'taken' || log.status === 'missed')
    .map((log) => ({
      planId: log.planId,
      medId: log.medId,
      medName: log.medName,
      dose: log.dose,
      unit: log.unit,
      time: log.time,
      status: log.status,
      confirmedAt: log.confirmedAt || log.detectedAt || 0
    }));
  items.sort((a, b) => (a.time < b.time ? -1 : 1));

  return {
    ok: true,
    bound: true,
    day: day,
    items: items,
    total: items.length,
    taken: items.filter((item) => item.status === 'taken').length,
    missed: items.filter((item) => item.status === 'missed').length
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
  if (event.action === 'history') return getHistory(OPENID, event.dateKey);
  return getToday(OPENID);
};
