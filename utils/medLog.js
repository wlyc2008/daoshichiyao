/**
 * 用药执行记录
 * today：长辈读自己的今日计划，子女读长辈的完成情况
 * confirm：长辈确认「已吃药」，写入 med_logs
 */
const cloud = require('./cloud');

function fetchToday() {
  return cloud.callFunction('medLog', { action: 'today' }).then((res) => {
    if (res && res.ok === false) throw new Error(res.msg || '读取今日用药失败');
    return res || {};
  });
}

function confirm(planId, time) {
  return cloud.callFunction('medLog', {
    action: 'confirm',
    planId: planId,
    time: time
  }).then((res) => {
    if (!res || res.ok !== true) throw new Error((res && res.msg) || '记录失败');
    return res;
  });
}

/** 按日期读取执行记录（已吃药 / 漏服） */
function fetchHistory(dateKey) {
  return cloud.callFunction('medLog', {
    action: 'history',
    dateKey: dateKey || ''
  }).then((res) => {
    if (res && res.ok === false) throw new Error(res.msg || '读取历史记录失败');
    return res || {};
  });
}

module.exports = {
  fetchToday,
  confirm,
  fetchHistory
};
