const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTION = 'reminder_plans';

/**
 * 同步提醒计划到云端
 * event.items: [{ time: '08:00', name: '阿司匹林', dose: 1 }]
 * event.grant: 本次新增的一次性订阅授权次数
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, msg: '缺少用户标识' };

  const raw = Array.isArray(event.items) ? event.items : [];
  const items = raw.slice(0, 20).map((item) => ({
    time: String(item.time || '').slice(0, 5),
    name: String(item.name || '').slice(0, 20),
    dose: Number(item.dose) > 0 ? Number(item.dose) : 1,
    unit: String(item.unit || '片').slice(0, 2)
  })).filter((item) => /^\d{2}:\d{2}$/.test(item.time));

  const timeKeys = Array.from(new Set(items.map((item) => item.time)));
  const grant = Math.max(0, Math.min(20, Number(event.grant) || 0));

  const collection = db.collection(COLLECTION);
  // 集合首次使用时自动创建，避免要求用户手动建表
  try {
    await db.createCollection(COLLECTION);
  } catch (err) {
    // 已存在时忽略
  }
  const found = await collection.where({ openid: OPENID }).get();

  if (found.data.length) {
    const doc = found.data[0];
    const quota = Math.max(0, Number(doc.quota) || 0) + grant;
    await collection.doc(doc._id).update({
      data: { items, timeKeys, quota, updatedAt: Date.now() }
    });
    return { ok: true, quota };
  }

  await collection.add({
    data: { openid: OPENID, items, timeKeys, quota: grant, updatedAt: Date.now() }
  });
  return { ok: true, quota: grant };
};
