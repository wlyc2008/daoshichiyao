/**
 * 用户身份（角色）
 * caregiver：子女 / 照护者，负责登记药品、设置提醒
 * caree：长辈 / 被照护者，只负责接收提醒并确认服药
 * 本地存储为主，云开发可用时顺带在 users 集合登记，便于后续建立绑定关系
 */
const KEYS = require('./storageKeys');
const cloud = require('./cloud');

const ROLE_TEXT = {
  caregiver: '子女',
  caree: '长辈'
};

function getRole() {
  try {
    const role = wx.getStorageSync(KEYS.USER_ROLE) || '';
    return ROLE_TEXT[role] ? role : '';
  } catch (err) {
    return '';
  }
}

/** 只写本地，用于云端返回的身份校正，避免反向再登记一次 */
function cacheRole(role) {
  if (!ROLE_TEXT[role]) return;
  wx.setStorageSync(KEYS.USER_ROLE, role);
}

/** 写入本地并异步登记到云端，云端失败不影响本地使用 */
function setRole(role) {
  if (!ROLE_TEXT[role]) return;
  cacheRole(role);
  if (cloud.isEnabled()) {
    cloud.registerProfile(role).catch(() => {});
  }
}

function clearRole() {
  try {
    wx.removeStorageSync(KEYS.USER_ROLE);
  } catch (err) {
    // 忽略
  }
}

function roleText(role) {
  return ROLE_TEXT[role] || '';
}

module.exports = {
  getRole,
  setRole,
  cacheRole,
  clearRole,
  roleText
};
