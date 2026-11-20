const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const PLANS = 'med_plans';
const USERS = 'users';
const INTENSITIES = ['gentle', 'standard', 'strong'];
const MAX_PLANS = 50;
const CONCURRENCY = 10;

async function findUser(openid) {
  const found = await db.collection(USERS).where({ openid: openid }).limit(1).get();
  return found.data.length ? found.data[0] : null;
}

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

/** 只接受 HH:mm，避免脏数据进入 timeKeys 导致永远不命中 */
function normalizeTime(value) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!matched) return '';
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return '';
  return pad(hour) + ':' + pad(minute);
}

/** 分批并发执行，兼顾云函数 3 秒上限与写库稳定性 */
async function runBatches(tasks) {
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    await Promise.all(tasks.slice(i, i + CONCURRENCY).map((task) => task()));
  }
}

/**
 * 子女端：把本机药品计划写入 med_plans
 * event.plans: [{ medId, medName, dose, unit, intensity, schedule[], stock, nextVisit, status }]
 * targetId 由 users.linkedId 决定，解绑后为空，sendDue 会自行跳过
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, msg: '缺少用户标识' };

  try {
    await db.createCollection(PLANS);
  } catch (err) {
    // 已存在时忽略
  }

  let targetId = '';
  try {
    const user = await findUser(OPENID);
    targetId = user && user.linkedId ? user.linkedId : '';
  } catch (err) {
    // 读不到 users 时按未绑定处理，计划仍写入，绑定后由 sendDue 动态解析
  }

  const raw = Array.isArray(event.plans) ? event.plans.slice(0, MAX_PLANS) : [];
  const now = Date.now();
  const incoming = [];
  const seen = {};

  raw.forEach((item) => {
    const source = item || {};
    const medId = String(source.medId || '').slice(0, 32);
    if (!medId || seen[medId]) return;
    seen[medId] = true;

    const schedule = [];
    (source.schedule || []).forEach((time) => {
      const value = normalizeTime(time);
      if (value && schedule.indexOf(value) === -1) schedule.push(value);
    });
    schedule.sort();
    if (!schedule.length) return;

    incoming.push({
      ownerId: OPENID,
      targetId: targetId,
      medId: medId,
      medName: String(source.medName || '').slice(0, 20),
      dose: Number(source.dose) > 0 ? Number(source.dose) : 1,
      unit: String(source.unit || '片').slice(0, 2),
      intensity: INTENSITIES.indexOf(source.intensity) >= 0 ? source.intensity : 'standard',
      schedule: schedule,
      timeKeys: schedule,
      stock: Math.max(0, Number(source.stock) || 0),
      nextVisit: String(source.nextVisit || '').slice(0, 10),
      status: source.status === 'stopped' ? 'stopped' : 'active',
      updatedAt: now
    });
  });

  const collection = db.collection(PLANS);
  const existing = await collection.where({ ownerId: OPENID }).get();
  const byMedId = {};
  existing.data.forEach((doc) => {
    byMedId[doc.medId] = doc;
  });

  const incomingIds = {};
  incoming.forEach((doc) => {
    incomingIds[doc.medId] = true;
  });
  // 本地已删除的药品同步清理，避免云端继续推送
  const stale = existing.data.filter((doc) => !incomingIds[doc.medId]);
  stale.forEach((doc) => {
    delete byMedId[doc.medId];
  });

  const upserts = incoming.map((doc) => () => {
    const found = byMedId[doc.medId];
    if (found) return collection.doc(found._id).update({ data: doc });
    return collection.add({ data: doc });
  });
  const removes = stale.map((doc) => () => collection.doc(doc._id).remove());

  await runBatches(upserts.concat(removes));

  return { ok: true, count: incoming.length, removed: removes.length, targetId: targetId };
};
