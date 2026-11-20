const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTION = 'users';
const ROLES = ['caregiver', 'caree'];

/**
 * 用户身份登记
 * event.action = 'setRole' | 'get'
 * event.role = 'caregiver' | 'caree'
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, msg: '缺少用户标识' };

  const action = event.action || 'get';

  // 集合首次使用时自动创建，避免要求用户手动建表
  try {
    await db.createCollection(COLLECTION);
  } catch (err) {
    // 已存在时忽略
  }

  const collection = db.collection(COLLECTION);
  const found = await collection.where({ openid: OPENID }).get();
  const existing = found.data.length ? found.data[0] : null;

  if (action === 'setRole') {
    const role = ROLES.indexOf(event.role) >= 0 ? event.role : 'caregiver';
    const profile = {
      role: role,
      updatedAt: Date.now()
    };
    if (existing) {
      await collection.doc(existing._id).update({ data: profile });
      return { ok: true, profile: Object.assign({}, existing, profile) };
    }
    const data = Object.assign({
      openid: OPENID,
      linkedId: '',
      nickname: '',
      createdAt: Date.now()
    }, profile);
    const added = await collection.add({ data: data });
    return { ok: true, profile: Object.assign({ _id: added._id }, data) };
  }

  return {
    ok: true,
    profile: existing || null
  };
};
