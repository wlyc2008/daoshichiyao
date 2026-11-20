const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTION = 'reminder_plans';
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

// 心跳写频率：每 5 分钟一次即可满足状态自检，避免占满免费额度
const HEARTBEAT_MINUTE_STEP = 5;
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

  let matched;
  try {
    matched = await db.collection(COLLECTION)
      .where({ timeKeys: timeKey, quota: _.gt(0) })
      .limit(100)
      .get();
  } catch (err) {
    // 集合尚未创建时直接跳过
    return { timeKey, matched: 0, sent: 0 };
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

  return { timeKey, matched: matched.data.length, sent };
};
