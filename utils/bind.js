/**
 * 子女与长辈的绑定
 * createInvite：子女端生成关怀邀请码
 * acceptInvite：长辈端凭邀请码完成绑定
 * fetchStatus：读取自己与对方的绑定状态
 */
const cloud = require('./cloud');

function createInvite() {
  return cloud.callFunction('bindUser', { action: 'create' }).then((res) => {
    if (!res.ok) throw new Error(res.msg || '生成邀请失败');
    return res;
  });
}

function acceptInvite(code) {
  return cloud.callFunction('bindUser', { action: 'accept', code: code }).then((res) => {
    if (!res.ok) {
      const err = new Error(res.msg || '绑定失败');
      err.code = res.code || '';
      throw err;
    }
    return res;
  });
}

function unbind() {
  return cloud.callFunction('bindUser', { action: 'unbind' }).then((res) => {
    if (!res.ok) throw new Error(res.msg || '解除绑定失败');
    return res;
  });
}

function fetchStatus() {
  return cloud.callFunction('bindUser', { action: 'status' }).then((res) => (res.ok ? res : {}));
}

module.exports = {
  createInvite,
  acceptInvite,
  unbind,
  fetchStatus
};
