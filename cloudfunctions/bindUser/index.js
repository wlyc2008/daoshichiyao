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

/** 只接受微信订阅授权的四种结果，其他一律视为未授权 */
function normalizeNotifyState(value) {
  const state = String(value || '');
  return ['accept', 'reject', 'ban', 'filter'].indexOf(state) >= 0 ? state : '';
}

/** 长辈端：接受邀请，双向写入 linkedId */
async function acceptInvite(openid, rawCode, rawNotifyState) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, code: 'INVALID_CODE', msg: '邀请码无效' };

  const found = await db.collection(INVITES).where({ code: code }).get();
  if (!found.data.length) return { ok: false, code: 'NOT_FOUND', msg: '邀请不存在，请让家人重新发送' };

  const invite = found.data[0];
  if (invite.caregiverOpenId === openid) {
    return { ok: false, code: 'SELF_INVITE', msg: '这是您自己的邀请，请转发给家人打开' };
  }
  if (invite.used) {
    const invalidated = invite.usedBy === 'unbind';
    return {
      ok: false,
      code: 'USED',
      msg: invalidated ? '邀请已失效，请让家人重新发送' : '邀请已被使用，请让家人重新发送'
    };
  }
  if (invite.expireAt < Date.now()) return { ok: false, code: 'EXPIRED', msg: '邀请已过期，请让家人重新发送' };

  const notifyState = normalizeNotifyState(rawNotifyState);
  const now = Date.now();

  const caree = await findUser(openid);
  if (caree) {
    await updateUser(caree, {
      role: 'caree',
      linkedId: invite.caregiverOpenId,
      boundAt: now,
      notifyState: notifyState,
      notifyAt: now,
      notifyPaused: false
    });
  } else {
    await db.collection(USERS).add({
      data: {
        openid: openid,
        role: 'caree',
        linkedId: invite.caregiverOpenId,
        nickname: '',
        createdAt: now,
        updatedAt: now,
        boundAt: now,
        notifyState: notifyState,
        notifyAt: now,
        notifyPaused: false
      }
    });
  }

  const caregiver = await findUser(invite.caregiverOpenId);
  if (caregiver) {
    await updateUser(caregiver, { linkedId: openid, boundAt: now });
  }

  await db.collection(INVITES).doc(invite._id).update({
    data: { used: true, usedBy: openid, usedAt: now }
  });

  return { ok: true };
}

/** 长辈端：暂停接收，保留绑定关系，之后可随时恢复 */
async function pauseNotify(openid) {
  const user = await findUser(openid);
  if (!user) return { ok: false, msg: '用户不存在' };
  if (!user.linkedId) return { ok: false, msg: '尚未绑定家人' };

  await updateUser(user, { notifyPaused: true });
  return { ok: true };
}

/** 长辈端：恢复接收，同时记录本次授权结果 */
async function resumeNotify(openid, rawNotifyState) {
  const user = await findUser(openid);
  if (!user) return { ok: false, msg: '用户不存在' };
  if (!user.linkedId) return { ok: false, msg: '尚未绑定家人，请先输入邀请码' };

  await updateUser(user, {
    notifyPaused: false,
    notifyState: normalizeNotifyState(rawNotifyState),
    notifyAt: Date.now()
  });
  return { ok: true };
}

/** 打开卡片时先校验，避免自己打开自己的邀请还要走到「确认」才知道 */
async function peekInvite(openid, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, code: 'INVALID_CODE', msg: '邀请码无效' };

  const found = await db.collection(INVITES).where({ code: code }).get();
  if (!found.data.length) return { ok: false, code: 'NOT_FOUND', msg: '邀请不存在，请让家人重新发送' };

  const invite = found.data[0];
  if (invite.caregiverOpenId === openid) {
    return { ok: false, code: 'SELF_INVITE', msg: '这是您自己的邀请，请转发给家人打开' };
  }
  if (invite.used) {
    return { ok: false, code: 'USED', msg: invite.usedBy === 'unbind' ? '邀请已失效，请让家人重新发送' : '邀请已被使用，请让家人重新发送' };
  }
  if (invite.expireAt < Date.now()) return { ok: false, code: 'EXPIRED', msg: '邀请已过期，请让家人重新发送' };

  return { ok: true };
}

/** 解除绑定：双方 linkedId 一起清空，避免一边停了提醒另一边还以为在生效 */
async function unbindUser(openid) {
  const user = await findUser(openid);
  if (!user) return { ok: true };

  const partnerId = user.linkedId || '';
  await updateUser(user, { linkedId: '', notifyPaused: false });

  if (partnerId) {
    const partner = await findUser(partnerId);
    if (partner && partner.linkedId === openid) {
      await updateUser(partner, { linkedId: '' });
    }
  }

  // 旧的邀请码一律作废，重新邀请时用新码
  await db.collection(INVITES).where({
    caregiverOpenId: openid,
    used: false
  }).update({ data: { used: true, usedBy: 'unbind' } });

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
      ? {
        role: other.role,
        nickname: other.nickname || '',
        boundAt: other.boundAt || 0,
        notifyState: other.notifyState || '',
        notifyPaused: !!other.notifyPaused
      }
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
  if (action === 'peek') return peekInvite(OPENID, event.code);
  if (action === 'accept') return acceptInvite(OPENID, event.code, event.notifyState);
  if (action === 'pause') return pauseNotify(OPENID);
  if (action === 'resume') return resumeNotify(OPENID, event.notifyState);
  if (action === 'unbind') return unbindUser(OPENID);
  return getStatus(OPENID);
};
