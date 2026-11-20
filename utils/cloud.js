/**
 * 云开发客户端封装
 * 未配置环境 ID 时所有方法安全降级，不影响本地功能
 */
const config = require('./config');

let inited = false;

function init() {
  if (inited) return !!config.CLOUD_ENV;
  inited = true;
  if (!config.CLOUD_ENV || !wx.cloud) return false;
  try {
    wx.cloud.init({ env: config.CLOUD_ENV, traceUser: true });
    return true;
  } catch (err) {
    return false;
  }
}

function isEnabled() {
  return !!config.CLOUD_ENV && !!wx.cloud;
}

/**
 * 同步提醒计划到云端
 * @param {Array} items [{ time: '08:00', name: '阿司匹林', dose: 1 }]
 * @param {number} grant 本次新增的授权次数，通常为 1
 */
function syncPlan(items, grant) {
  if (!init()) {
    return Promise.reject(new Error('云开发未配置'));
  }
  return wx.cloud.callFunction({
    name: 'syncPlan',
    data: {
      items: items || [],
      grant: grant || 0
    }
  }).then((res) => res.result || {});
}

/**
 * 读取云端最近一次执行时间，用于确认定时触发器在工作
 * 返回 { lastRunAt, lastRunTime, fromTimer }
 */
function fetchStatus() {
  if (!init()) {
    return Promise.reject(new Error('云开发未配置'));
  }
  return wx.cloud.callFunction({
    name: 'sendDue',
    data: { action: 'status' }
  }).then((res) => res.result || {});
}

/**
 * 通用云函数调用，未配置环境时统一返回 rejected，调用方只需 catch
 */
function callFunction(name, data) {
  if (!init()) {
    return Promise.reject(new Error('云开发未配置'));
  }
  return wx.cloud.callFunction({
    name: name,
    data: data || {}
  }).then((res) => res.result || {});
}

/**
 * 登记 / 读取用户身份（users 集合）
 * @param {string} role 'caregiver' | 'caree'
 */
function registerProfile(role) {
  return callFunction('userProfile', { action: 'setRole', role: role });
}

function fetchProfile() {
  return callFunction('userProfile', { action: 'get' });
}

module.exports = {
  init: init,
  isEnabled: isEnabled,
  syncPlan: syncPlan,
  fetchStatus: fetchStatus,
  callFunction: callFunction,
  registerProfile: registerProfile,
  fetchProfile: fetchProfile
};
