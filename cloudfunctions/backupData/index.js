const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTION = 'backups';
const VERSION = 1;
// 单条记录上限 256KB，远小于云数据库限制，避免误传大文件
const MAX_SIZE = 256 * 1024;

async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION);
  } catch (err) {
    // 已存在时忽略
  }
}

function countOf(value) {
  return Array.isArray(value) ? value.length : 0;
}

/** 只保留约定的字段，避免客户端误传大字段或脏数据 */
function sanitizePayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    version: VERSION,
    exportedAt: Number(raw.exportedAt) || Date.now(),
    role: raw.role === 'caree' || raw.role === 'caregiver' ? raw.role : '',
    meds: Array.isArray(raw.meds) ? raw.meds : [],
    docs: Array.isArray(raw.docs) ? raw.docs : [],
    logs: Array.isArray(raw.logs) ? raw.logs : [],
    mealTimes: raw.mealTimes && typeof raw.mealTimes === 'object' ? raw.mealTimes : {},
    routineTimes: raw.routineTimes && typeof raw.routineTimes === 'object' ? raw.routineTimes : {},
    settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {}
  };
}

async function findBackup(openid) {
  const found = await db.collection(COLLECTION).where({ ownerId: openid }).limit(1).get();
  return found.data.length ? found.data[0] : null;
}

/** 每个用户只保留最新一份备份，重复备份直接覆盖 */
async function saveBackup(openid, rawPayload) {
  const payload = sanitizePayload(rawPayload);
  if (!payload) return { ok: false, msg: '备份内容无效' };

  if (JSON.stringify(payload).length > MAX_SIZE) {
    return { ok: false, msg: '数据较多，请精简后再备份' };
  }

  const counts = {
    meds: countOf(payload.meds),
    docs: countOf(payload.docs),
    logs: countOf(payload.logs)
  };
  const updatedAt = Date.now();
  const data = {
    ownerId: openid,
    version: VERSION,
    updatedAt: updatedAt,
    counts: counts,
    payload: payload
  };

  const existing = await findBackup(openid);
  if (existing) {
    await db.collection(COLLECTION).doc(existing._id).update({ data: data });
  } else {
    await db.collection(COLLECTION).add({ data: data });
  }

  return { ok: true, updatedAt: updatedAt, counts: counts };
}

async function getInfo(openid) {
  const found = await findBackup(openid);
  if (!found) return { ok: true, exists: false };
  return {
    ok: true,
    exists: true,
    updatedAt: found.updatedAt || 0,
    counts: found.counts || { meds: 0, docs: 0, logs: 0 }
  };
}

async function loadBackup(openid) {
  const found = await findBackup(openid);
  if (!found) return { ok: false, msg: '还没有云端备份' };
  return { ok: true, updatedAt: found.updatedAt || 0, payload: found.payload || null };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, msg: '缺少用户标识' };

  await ensureCollection();

  const action = event.action || 'info';
  if (action === 'save') return saveBackup(OPENID, event.payload);
  if (action === 'load') return loadBackup(OPENID);
  return getInfo(OPENID);
};
