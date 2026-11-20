const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTION = 'reminder_plans';
const MED_PLANS = 'med_plans';
const LOGS = 'med_logs';
const USERS = 'users';
const HEARTBEAT = 'heartbeat';
const TEMPLATE_ID = 'CTeOMRptscUEp21jFiUKz3drmBP9YxioGNdgAKlTX-I';

// 体验版调试用 developer，正式发布前改为 formal
const MINIPROGRAM_STATE = 'formal';
const PAGE = 'pages/index/index';

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

/** 云函数运行环境时区不确定，统一换算为北京时间 */
function beijingNow() {
  return new Date(Date.now() + 8 * 3600 * 1000);
}

/** 取北京时间日期键 YYYY-MM-DD（传入的 Date 已偏移到北京时间） */
function beijingDateKey(value) {
  return value.getUTCFullYear() + '-' + pad(value.getUTCMonth() + 1) + '-' + pad(value.getUTCDate());
}

/** HH:mm 转成当天分钟数，非法值返回 -1 */
function minutesOf(time) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!matched) return -1;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return -1;
  return hour * 60 + minute;
}

// 心跳写频率：每 5 分钟一次即可满足状态自检，避免占满免费额度
const HEARTBEAT_MINUTE_STEP = 5;
// 漏服判定窗口：计划时刻后 30~35 分钟仍未确认，配合 5 分钟一次的扫描刚好覆盖
const MISS_MIN_MINUTES = 30;
const MISS_MAX_MINUTES = 35;
const WATCH_MINUTE_STEP = 5;
// 集合创建只需成功一次，后续复用同一容器时不再重复调用
let heartbeatReady = false;

/**
 * 每次执行写一条心跳，用于确认定时触发器是否真的在运行
 * 集合不存在时自动创建，失败不影响主流程
 */
async function writeHeartbeat(payload) {
  if (!heartbeatReady) {
    try {
      await db.createCollection(HEARTBEAT);
    } catch (err) {
      // 已存在时忽略
    }
    heartbeatReady = true;
  }
  try {
    await db.collection(HEARTBEAT).doc('latest').set({ data: payload });
    return true;
  } catch (err) {
    return false;
  }
}

function truncate(text, max) {
  const value = String(text || '');
  return value.length > max ? value.slice(0, max) : value;
}

async function findUser(openid) {
  const found = await db.collection(USERS).where({ openid: openid }).limit(1).get();
  return found.data.length ? found.data[0] : null;
}

/**
 * Phase 3：把子女登记的药品计划推给长辈
 * 以 owner 当前的 linkedId 作为 targetId，解绑/换绑后立即停止；
 * 跳过暂停接收、关系失效、授权额度耗尽的用户
 */
async function sendCarePlans(timeKey, timeText) {
  let found;
  try {
    found = await db.collection(MED_PLANS)
      .where({ timeKeys: timeKey, status: 'active' })
      .limit(100)
      .get();
  } catch (err) {
    // 集合尚未创建时跳过
    return { matched: 0, sent: 0 };
  }

  // 同一子女在同一时刻的多种药合并为一条消息
  const groups = {};
  found.data.forEach((plan) => {
    if (!plan.ownerId) return;
    groups[plan.ownerId] = groups[plan.ownerId] || [];
    groups[plan.ownerId].push(plan);
  });

  const userCache = {};
  async function cachedUser(openid) {
    if (!openid) return null;
    if (!userCache[openid]) userCache[openid] = await findUser(openid);
    return userCache[openid];
  }

  let matched = 0;
  let sent = 0;

  async function sendGroup(ownerId) {
    const owner = await cachedUser(ownerId);
    const targetId = owner && owner.linkedId ? owner.linkedId : '';
    if (!targetId) return;

    const target = await cachedUser(targetId);
    if (!target || target.role !== 'caree') return;
    if (target.notifyPaused) return;
    if (!target.linkedId || target.linkedId !== ownerId) return;
    if ((Number(target.quota) || 0) <= 0) return;

    matched += 1;

    const plans = groups[ownerId];
    const names = [];
    const doses = [];
    let strong = false;

    plans.forEach((plan) => {
      if (names.indexOf(plan.medName) === -1) names.push(plan.medName);
      const doseText = plan.dose + (plan.unit || '片');
      if (doses.indexOf(doseText) === -1) doses.push(doseText);
      if (plan.intensity === 'strong') strong = true;
    });

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: targetId,
        templateId: TEMPLATE_ID,
        page: PAGE,
        miniprogramState: MINIPROGRAM_STATE,
        lang: 'zh_CN',
        data: {
          thing5: { value: truncate((strong ? '【重要】' : '') + names.join('、'), 20) },
          time1: { value: timeText },
          short_thing7: { value: truncate(doses.join('、') + (strong ? '，请立即服用' : ''), 20) }
        }
      });

      await db.collection(USERS).doc(target._id).update({
        data: { quota: _.inc(-1), lastNotifyAt: Date.now() }
      });
      sent += 1;
    } catch (err) {
      // 43101：长辈未订阅或授权已耗尽，清零避免反复无效调用
      if (err && String(err.errCode) === '43101') {
        await db.collection(USERS).doc(target._id).update({ data: { quota: 0 } });
      }
    }
  }

  const ownerIds = Object.keys(groups);
  const CONCURRENCY = 20;
  for (let i = 0; i < ownerIds.length; i += CONCURRENCY) {
    // 单个账号读库失败不能影响其他长辈，也不能拖垮 V1 推送
    await Promise.all(ownerIds.slice(i, i + CONCURRENCY).map((ownerId) => sendGroup(ownerId).catch(() => {})));
  }

  return { matched: matched, sent: sent };
}

/**
 * Phase 5：强力模式漏服看护
 * 计划时刻后 30~35 分钟仍未确认，补写 missed 日志并反向通知子女
 * 仅在 5 分钟边界执行，避免每分钟扫全表
 */
async function checkMissedDoses(now) {
  try {
    await db.createCollection(LOGS);
  } catch (err) {
    // 已存在时忽略
  }

  let found;
  try {
    found = await db.collection(MED_PLANS)
      .where({ intensity: 'strong', status: 'active' })
      .limit(100)
      .get();
  } catch (err) {
    // 集合尚未创建时跳过
    return { checked: 0, missed: 0, sent: 0 };
  }

  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const todayKey = beijingDateKey(now);
  const yesterdayKey = beijingDateKey(new Date(now.getTime() - 24 * 3600 * 1000));

  // 先收集命中窗口的计划时刻；跨零点时归属到前一天
  const candidates = [];
  found.data.forEach((plan) => {
    (plan.schedule || []).forEach((time) => {
      const planned = minutesOf(time);
      if (planned < 0) return;
      let diff = nowMinutes - planned;
      let dateKey = todayKey;
      if (diff < 0) {
        diff += 24 * 60;
        dateKey = yesterdayKey;
      }
      if (diff < MISS_MIN_MINUTES || diff > MISS_MAX_MINUTES) return;
      candidates.push({ plan: plan, time: time, dateKey: dateKey });
    });
  });

  const userCache = {};
  async function cachedUser(openid) {
    if (!openid) return null;
    if (!userCache[openid]) userCache[openid] = await findUser(openid);
    return userCache[openid];
  }

  let missed = 0;
  const groups = {};

  async function markMissed(candidate) {
    const plan = candidate.plan;
    // 关系失效或长辈暂停接收时不再判定漏服，避免误报
    const owner = await cachedUser(plan.ownerId);
    const targetId = owner && owner.linkedId ? owner.linkedId : '';
    if (!targetId) return;
    const target = await cachedUser(targetId);
    if (!target || target.role !== 'caree' || target.linkedId !== plan.ownerId) return;
    if (target.notifyPaused) return;

    const plannedTime = candidate.dateKey + ' ' + candidate.time;

    // 已确认或已记过漏服时直接跳过，保证幂等
    const existed = await db.collection(LOGS).where({
      planId: plan._id,
      plannedTime: plannedTime
    }).limit(1).get();
    if (existed.data.length) return;

    const stamp = Date.now();
    await db.collection(LOGS).add({
      data: {
        planId: plan._id,
        medId: plan.medId,
        ownerId: plan.ownerId,
        targetId: targetId,
        medName: plan.medName,
        dose: plan.dose,
        unit: plan.unit,
        time: candidate.time,
        plannedTime: plannedTime,
        dateKey: candidate.dateKey,
        status: 'missed',
        detectedAt: stamp,
        createdAt: stamp
      }
    });
    missed += 1;

    // 同一子女同一时刻的多种药合并成一条通知
    const key = plan.ownerId + '|' + plannedTime;
    groups[key] = groups[key] || {
      ownerId: plan.ownerId,
      plannedTime: plannedTime,
      names: []
    };
    if (groups[key].names.indexOf(plan.medName) === -1) groups[key].names.push(plan.medName);
  }

  const BATCH = 10;
  for (let i = 0; i < candidates.length; i += BATCH) {
    await Promise.all(candidates.slice(i, i + BATCH).map((item) => markMissed(item).catch(() => {})));
  }

  let sent = 0;

  async function notifyGroup(key) {
    const group = groups[key];
    const owner = await cachedUser(group.ownerId);
    if (!owner || !owner.openid) return;
    if ((Number(owner.quota) || 0) <= 0) return;
    // 先占用额度，避免同一子女的多条漏服并发发送时超发
    owner.quota = (Number(owner.quota) || 0) - 1;

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: owner.openid,
        templateId: TEMPLATE_ID,
        page: PAGE,
        miniprogramState: MINIPROGRAM_STATE,
        lang: 'zh_CN',
        data: {
          thing5: { value: truncate(group.names.join('、'), 20) },
          time1: { value: group.plannedTime },
          short_thing7: { value: '长辈还未确认' }
        }
      });

      await db.collection(USERS).doc(owner._id).update({
        data: { quota: _.inc(-1), lastNotifyAt: Date.now() }
      });
      sent += 1;
    } catch (err) {
      // 43101：子女未订阅或额度已耗尽，清零避免反复无效调用
      if (err && String(err.errCode) === '43101') {
        owner.quota = 0;
        await db.collection(USERS).doc(owner._id).update({ data: { quota: 0 } });
      } else {
        // 其他失败把预占的额度还回去
        owner.quota = (Number(owner.quota) || 0) + 1;
      }
    }
  }

  const keys = Object.keys(groups);
  const CONCURRENCY = 20;
  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    await Promise.all(keys.slice(i, i + CONCURRENCY).map((key) => notifyGroup(key).catch(() => {})));
  }

  return { checked: found.data.length, missed: missed, sent: sent };
}

/**
 * 定时触发：每分钟检查一次，命中计划时刻且有授权次数的用户发送订阅消息
 * 客户端可用 { action: 'status' } 调用，读取最近一次执行时间
 */
exports.main = async (event = {}) => {
  const now = beijingNow();
  const timeKey = pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes());
  const timeText = now.getUTCFullYear() + '-'
    + pad(now.getUTCMonth() + 1) + '-'
    + pad(now.getUTCDate()) + ' ' + timeKey;

  const stamp = Date.now();
  const fromTimer = event.Type === 'Timer' || !!event.TriggerName;

  // 状态查询只读心跳，不能写，否则会覆盖掉定时器留下的执行记录
  if (event.action === 'status') {
    try {
      const found = await db.collection(HEARTBEAT).doc('latest').get();
      const data = found.data || {};
      return {
        ok: true,
        lastRunAt: data.lastRunAt || 0,
        lastRunTime: data.lastRunTime || '',
        fromTimer: !!data.fromTimer
      };
    } catch (err) {
      return { ok: true, lastRunAt: 0, lastRunTime: '', fromTimer: false };
    }
  }

  // 定时触发时每 5 分钟写一次心跳；手动调用（状态自检/调试）始终写入
  if (!fromTimer || now.getUTCMinutes() % HEARTBEAT_MINUTE_STEP === 0) {
    await writeHeartbeat({
      lastRunAt: stamp,
      lastRunTime: timeText,
      fromTimer: fromTimer
    });
  }

  // 长辈端计划与 V1 计划互不影响，并行发送以压缩总耗时
  const careTask = sendCarePlans(timeKey, timeText);

  // 漏服看护只在 5 分钟边界扫描，手动调用（调试）时始终执行
  const shouldWatch = !fromTimer || now.getUTCMinutes() % WATCH_MINUTE_STEP === 0;
  const watchTask = shouldWatch ? checkMissedDoses(now) : Promise.resolve(null);

  let matched;
  try {
    matched = await db.collection(COLLECTION)
      .where({ timeKeys: timeKey, quota: _.gt(0) })
      .limit(100)
      .get();
  } catch (err) {
    // 集合尚未创建时，V1 计划为空，但长辈计划仍要推送
    const care = await careTask.catch(() => ({ matched: 0, sent: 0 }));
    const watch = await watchTask.catch(() => null);
    return { timeKey, matched: 0, sent: 0, care: care, watch: watch };
  }

  /** 发送单个用户的提醒，成功返回 1，失败返回 0 */
  async function sendOne(doc) {
    const items = (doc.items || []).filter((item) => item.time === timeKey);
    if (!items.length) return 0;

    const names = items.map((item) => item.name).join('、').slice(0, 20);
    const doses = items.map((item) => item.dose + (item.unit || '片')).join('、').slice(0, 8);

    try {
      await cloud.openapi.subscribeMessage.send({
        touser: doc.openid,
        templateId: TEMPLATE_ID,
        page: PAGE,
        miniprogramState: MINIPROGRAM_STATE,
        lang: 'zh_CN',
        data: {
          thing5: { value: names },
          time1: { value: timeText },
          short_thing7: { value: doses }
        }
      });

      await db.collection(COLLECTION).doc(doc._id).update({
        data: { quota: _.inc(-1), lastSentAt: Date.now() }
      });
      return 1;
    } catch (err) {
      // 43101：用户未订阅或授权已耗尽，清零避免反复无效调用
      if (err && String(err.errCode) === '43101') {
        await db.collection(COLLECTION).doc(doc._id).update({ data: { quota: 0 } });
      }
      return 0;
    }
  }

  // 分组并发发送：个人版套餐超时上限为 3 秒，串行调用只能发出十几条
  const CONCURRENCY = 20;
  let sent = 0;
  for (let i = 0; i < matched.data.length; i += CONCURRENCY) {
    const group = matched.data.slice(i, i + CONCURRENCY);
    const results = await Promise.all(group.map(sendOne));
    results.forEach((count) => { sent += count; });
  }

  const care = await careTask.catch(() => ({ matched: 0, sent: 0 }));
  const watch = await watchTask.catch(() => null);

  return { timeKey, matched: matched.data.length, sent, care: care, watch: watch };
};
