const storage = require('../../utils/storage');
const date = require('../../utils/date');
const cloud = require('../../utils/cloud');
const fileManager = require('../../utils/fileManager');
const planSync = require('../../utils/planSync');
const config = require('../../utils/config');
const backup = require('../../utils/backup');

Page({
  data: {
    version: config.VERSION,
    backingUp: false
  },

  cancelCalendar() {
    wx.navigateTo({ url: '/pages/cancel-calendar/cancel-calendar' });
  },

  /** 备份到云端：覆盖式保存，照片不包含在备份中 */
  backupToCloud() {
    if (this.data.backingUp) return;
    wx.showModal({
      title: '备份到云端',
      content: '将药品、医疗档案、用药记录与设置备份到云端，照片不会包含。确定备份吗？',
      confirmText: '备份',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ backingUp: true });
        wx.showLoading({ title: '正在备份', mask: true });
        backup.save().then(() => {
          wx.hideLoading();
          this.setData({ backingUp: false });
          wx.showToast({ title: '已备份到云端', icon: 'success' });
        }).catch((err) => {
          wx.hideLoading();
          this.setData({ backingUp: false });
          wx.showModal({
            title: '备份失败',
            content: (err && err.message) || '请稍后重试',
            showCancel: false
          });
        });
      }
    });
  },

  exportBackup() {
    const payload = {
      version: 1,
      exportedAt: date.toKey(new Date()),
      meds: storage.getMeds({ includeInactive: true }),
      mealTimes: storage.getMealTimes(),
      routineTimes: storage.getRoutineTimes(),
      docs: storage.getDocs(),
      logs: storage.getLogs(),
      settings: storage.getSettings()
    };
    wx.setClipboardData({
      data: JSON.stringify(payload),
      success: () => {
        wx.showModal({
          title: '已复制备份',
          content: '请粘贴到备忘录或发给自己保存，更换手机时可据此恢复。',
          showCancel: false
        });
      }
    });
  },

  checkCloud() {
    if (!cloud.isEnabled()) {
      wx.showModal({
        title: '云开发未配置',
        content: '请先在 utils/config.js 填入云环境 ID。',
        showCancel: false
      });
      return;
    }

    wx.showLoading({ title: '检查中' });
    cloud.fetchStatus().then((res) => {
      wx.hideLoading();
      if (!res || !res.lastRunAt) {
        wx.showModal({
          title: '云端尚未执行',
          content: '暂时没有执行记录，可能是定时触发器还没上传，或刚部署未满五分钟。',
          showCancel: false
        });
        return;
      }
      wx.showModal({
        title: '云端运行正常',
        content: '最近一次执行：' + res.lastRunTime
          + (res.fromTimer ? '（定时触发）' : '（手动调用）'),
        showCancel: false
      });
    }).catch((err) => {
      wx.hideLoading();
      wx.showModal({
        title: '检查失败',
        content: (err && err.errMsg) || '云函数调用失败',
        showCancel: false
      });
    });
  },

  resetAll() {
    wx.showModal({
      title: '还原到初始状态？',
      content: '将清空本机所有药品、用药记录、医疗档案和设置，且无法恢复。',
      confirmText: '清空',
      confirmColor: '#C62828',
      success: (res) => {
        if (!res.confirm) return;
        storage.getMeds({ includeInactive: true }).forEach((med) => {
          if (med.photoPath) fileManager.removePhoto(med.photoPath);
        });
        storage.getDocs().forEach((doc) => {
          if (doc.photoPath) fileManager.removePhoto(doc.photoPath);
        });
        wx.showLoading({ title: '正在清空' });
        // 先清空云端计划，避免本地数据没了但云端仍在推送
        planSync.clearCloudPlan().then(() => {
          wx.clearStorageSync();
          wx.hideLoading();
          wx.reLaunch({ url: '/pages/index/index' });
        });
      }
    });
  },

  goPage(event) {
    const url = event.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url: url });
  }
});
