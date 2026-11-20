/**
 * 子女与长辈的绑定
 * createInvite：子女端生成关怀邀请码
 * acceptInvite：长辈端凭邀请码完成绑定
 * fetchStatus：读取自己与对方的绑定状态
 */
const cloud = require('./cloud');
const config = require('./config');

/**
 * 一次弹窗同时申请正常提醒与漏服提醒
 * 未配置漏服模板时只申请正常提醒
 */
function requestSubscribe() {
  return new Promise((resolve) => {
    const states = { due: '', missed: '', errMsg: '' };
    if (!wx.requestSubscribeMessage) {
      resolve(states);
      return;
    }

    const ids = [config.TEMPLATE_ID];
    if (config.MISSED_TEMPLATE_ID) ids.push(config.MISSED_TEMPLATE_ID);

    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: (res) => {
        states.due = res[config.TEMPLATE_ID] || '';
        if (config.MISSED_TEMPLATE_ID) {
          states.missed = res[config.MISSED_TEMPLATE_ID] || '';
        }
        resolve(states);
      },
      fail: (err) => {
        states.errMsg = (err && err.errMsg) || 'requestSubscribeMessage:fail';
        resolve(states);
      }
    });
  });
}

function createInvite() {
  return cloud.callFunction('bindUser', { action: 'create' }).then((res) => {
    if (!res.ok) throw new Error(res.msg || '生成邀请失败');
    return res;
  });
}

/** 打开卡片时先校验邀请是否可用，自己打开自己的邀请可直接拦下 */
function peek(code) {
  return cloud.callFunction('bindUser', { action: 'peek', code: code }).then((res) => {
    if (!res.ok) {
      const err = new Error(res.msg || '邀请不可用');
      err.code = res.code || '';
      throw err;
    }
    return res;
  });
}

function acceptInvite(code, notifyState, missedNotifyState) {
  return cloud.callFunction('bindUser', {
    action: 'accept',
    code: code,
    notifyState: notifyState || '',
    missedNotifyState: missedNotifyState || ''
  }).then((res) => {
    if (!res.ok) {
      const err = new Error(res.msg || '绑定失败');
      err.code = res.code || '';
      throw err;
    }
    return res;
  });
}

/** 暂停接收：保留绑定，之后可恢复 */
function pause() {
  return cloud.callFunction('bindUser', { action: 'pause' }).then((res) => {
    if (!res.ok) throw new Error(res.msg || '暂停失败');
    return res;
  });
}

/** 恢复接收：需重新授权微信通知，顺带记录本次授权结果 */
function resume(notifyState, missedNotifyState) {
  return cloud.callFunction('bindUser', {
    action: 'resume',
    notifyState: notifyState || '',
    missedNotifyState: missedNotifyState || ''
  }).then((res) => {
    if (!res.ok) throw new Error(res.msg || '恢复失败');
    return res;
  });
}

/** 长辈确认服药时续订正常提醒与漏服提醒各一条额度 */
function renew(notifyState, missedNotifyState) {
  return cloud.callFunction('bindUser', {
    action: 'renew',
    notifyState: notifyState || '',
    missedNotifyState: missedNotifyState || ''
  }).then((res) => {
    if (!res.ok) throw new Error(res.msg || '续订失败');
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
  peek,
  acceptInvite,
  pause,
  resume,
  renew,
  requestSubscribe,
  unbind,
  fetchStatus
};
