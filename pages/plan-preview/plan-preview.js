const storage = require('../../utils/storage');
const reminder = require('../../utils/reminder');
const date = require('../../utils/date');
const cloud = require('../../utils/cloud');
const ics = require('../../utils/ics');
const planSync = require('../../utils/planSync');
const config = require('../../utils/config');

Page({
  data: {
    items: [],
    hasMeds: false,
    syncText: '',
    syncStale: false
  },

  onShow() {
    this.refresh();
    this.syncQuietly();
  },

  refresh() {
    const meds = storage.getMeds();
    const mealTimes = storage.getMealTimes();
    const items = reminder.buildSchedule(meds, mealTimes, new Date());
    const settings = storage.getSettings();

    let syncText = '';
    let syncStale = false;
    if (settings.subscribeRequestedAt) {
      const signature = ics.buildSignature(meds, mealTimes);
      syncStale = !settings.wechatSignature || settings.wechatSignature !== signature;
      syncText = syncStale
        ? '用药时间已变更，请重新开启微信提醒'
        : '已开启微信提醒，如无变化无需重复操作';
    }

    this.setData({
      hasMeds: meds.length > 0,
      syncText: syncText,
      syncStale: syncStale,
      items: items.map((item) => ({
        medId: item.medId,
        name: item.name,
        dose: item.dose,
        time: item.time,
        text: item.time + '  ' + item.name + '  ' + item.dose + item.unit
      }))
    });
  },

  requestSubscribe() {
    const templateId = config.TEMPLATE_ID;
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (res) => {
        if (res[templateId] !== 'accept') {
          wx.showToast({ title: '未开启', icon: 'none' });
          return;
        }
        storage.setSettings({ subscribeRequestedAt: date.toKey(new Date()) });
        this.syncToCloud(1);
      },
      fail: () => {
        wx.showToast({ title: '未开启订阅', icon: 'none' });
      }
    });
  },

  syncToCloud(grant) {
    cloud.syncPlan(planSync.buildItems(), grant).then(() => {
      const signature = ics.buildSignature(storage.getMeds(), storage.getMealTimes());
      storage.setSettings({ wechatSignature: signature, planSignature: signature });
      wx.showToast({ title: '已开启', icon: 'success' });
      // 授权并同步成功后直接返回设置页
      setTimeout(() => wx.navigateBack(), 600);
    }).catch(() => {
      wx.showModal({
        title: '授权成功',
        content: '云端尚未配置，暂时收不到微信提醒。请先开通云开发并部署云函数。',
        showCancel: false
      });
    });
  },

  syncQuietly() {
    planSync.syncIfChanged();
  },

  goMealTimes() {
    wx.navigateTo({ url: '/pages/meal-times/meal-times' });
  },

  goRoutineTimes() {
    wx.navigateTo({ url: '/pages/routine-times/routine-times' });
  }
});
