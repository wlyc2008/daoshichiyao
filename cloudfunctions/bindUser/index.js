const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const USERS = 'users';
const INVITES = 'invites';

// 去掉容易混淆的 0/O、1/I，方便口头转述
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const INVITE_TTL = 7 * 24 * 3600 * 1000;

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (err) {
    // 已存在时忽略
  }
}

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return code;
}

async function findUser(openid) {
  const found = await db.collection(USERS).where({ openid: openid }).get();
  return found.data.length ? found.data[0] : null;
}

async function updateUser(user, patch) {
  await db.collection(USERS).doc(user._id).update({
    data: Object.assign({ updatedAt: Date.now() }, patch)
  });
}

async function createUser(openid, role, linkedId) {
  const now = Date.now();
  await db.collection(USERS).add({
    data: {
      openid: openid,
      role: role,
      linkedId: linkedId || '',
      nickname: '',
      createdAt: now,
      updatedAt: now
    }
  });
}

/** 子女端：生成（或复用）一张 7 天有效的关怀邀请 */
async function createInvite(openid) {
  const user = await findUser(openid);
  if (!user) {
    await createUser(openid, 'caregiver', '');
  } else if (user.role !== 'caregiver') {
    await updateUser(user, { role: 'caregiver' });
  }

  const now = Date.now();
  const alive = await db.collection(INVITES).where({
    caregiverOpenId: openid,
    used: false,
    expireAt: _.gt(now)
  }).get();
  if (alive.data.length) {
    return { ok: true, code: alive.data[0].code, expireAt: alive.data[0].expireAt };
  }

  const code = randomCode();
  const expireAt = now + INVITE_TTL;
  await db.collection(INVITES).add({
    data: {
      code: code,
      caregiverOpenId: openid,
      used: false,
      usedBy: '',
      createdAt: now,
      expireAt: expireAt
    }
  });
  return { ok: true, code: code, expireAt: expireAt };
}

/** 长辈端：接受邀请，双向写入 linkedId */
async function acceptInvite(openid, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, code: 'INVALID_CODE', msg: '邀请码无效' };

  const found = await db.collection(INVITES).where({ code: code }).get();
  if (!found.data.length) return { ok: false, code: 'NOT_FOUND', msg: '邀请不存在，请让家人重新发送' };

  const invite = found.data[0];
  if (invite.caregiverOpenId === openid) {
    return { ok: false, code: 'SELF_INVITE', msg: '这是您自己的邀请，请转发给家人打开' };
  }
  if (invite.used) return { ok: false, code: 'USED', msg: '邀请已被使用，请让家人重新发送' };
  if (invite.expireAt < Date.now()) return { ok: false, code: 'EXPIRED', msg: '邀请已过期，请让家人重新发送' };

  const caree = await findUser(openid);
  if (caree) {
    await updateUser(caree, { role: 'caree', linkedId: invite.caregiverOpenId, boundAt: Date.now() });
  } else {
    await createUser(openid, 'caree', invite.caregiverOpenId);
  }

  const caregiver = await findUser(invite.caregiverOpenId);
  if (caregiver) {
    await updateUser(caregiver, { linkedId: openid, boundAt: Date.now() });
  }

  await db.collection(INVITES).doc(invite._id).update({
    data: { used: true, usedBy: openid, usedAt: Date.now() }
  });

  return { ok: true };
}

/** 读取自己的绑定状态，顺便带回对方的昵称（暂用 openid 后 4 位占位） */
async function getStatus(openid) {
  const user = await findUser(openid);
  if (!user) return { ok: true, profile: null, partner: null };

  let partner = null;
  if (user.linkedId) {
    const other = await findUser(user.linkedId);
    partner = other
      ? { role: other.role, nickname: other.nickname || '', boundAt: other.boundAt || 0 }
      : null;
  }
  return { ok: true, profile: user, partner: partner };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, msg: '缺少用户标识' };

  await ensureCollection(USERS);
  await ensureCollection(INVITES);

  const action = event.action || 'status';
  if (action === 'create') return createInvite(OPENID);
  if (action === 'accept') return acceptInvite(OPENID, event.code);
  return getStatus(OPENID);
};
