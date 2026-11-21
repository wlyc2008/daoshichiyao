const storage = require('../../utils/storage');
const reminder = require('../../utils/reminder');
const bind = require('../../utils/bind');
const planSync = require('../../utils/planSync');

Page({
  data: {
    items: [],
    hasMeds: false,
    bound: false,
    statusText: '',
    statusWarn: false,
    pendingSubmit: false,
    submitting: false
  },

  onShow() {
    this.refresh();
    this.loadStatus();
  },

  refresh() {
    const meds = storage.getMeds();
    const mealTimes = storage.getMealTimes();
    const items = reminder.buildSchedule(meds, mealTimes, new Date()).map((item) => ({
      text: item.time + '  ' + item.name + '  ' + item.dose + (item.unit || '片')
    }));

    this.setData({
      hasMeds: meds.length > 0,
      items: items
    });
  },

  /** 微信提醒绑定在父母账号上，子女端只展示状态 */
  loadStatus() {
    bind.fetchStatus().then((res) => {
      const profile = res.profile;
      const partner = res.partner;
      const pending = !!(profile && profile.linkedId && partner)
        && planSync.isSubmitPending(profile.planSign || '');

      if (!profile || !profile.linkedId || !partner) {
        this.setData({
          bound: false,
          statusText: '还没有绑定父母。绑定后，微信提醒会发送到父母手机。',
          statusWarn: true,
          pendingSubmit: false
        });
        return;
      }

      if (partner.notifyPaused) {
        this.setData({
          bound: true,
          statusText: '父母已暂停接收提醒。请让父母在小程序里点「恢复接收」。',
          statusWarn: true,
          pendingSubmit: pending
        });
        return;
      }

      if ((partner.notifyState || '') !== 'accept') {
        this.setData({
          bound: true,
          statusText: '父母还没有允许微信通知。请让父母在小程序里点「重新开启」并选择允许。',
          statusWarn: true,
          pendingSubmit: pending
        });
        return;
      }

      this.setData({
        bound: true,
        statusText: '已开启。到点提醒会发送到父母手机，父母点「已吃药」后会自动记录。',
        statusWarn: false,
        pendingSubmit: pending
      });
    }).catch(() => {
      this.setData({
        statusText: '暂时读不到绑定状态，请检查网络后重试。',
        statusWarn: true
      });
    });
  },

  /**
   * 开启微信提醒：把当前提醒计划强制同步到云端
   * 通知授权只能由父母在自己手机上完成，这里负责提交计划并说明状态
   */
  onOpenReminder() {
    if (this.data.submitting) return;
    if (!this.data.bound) {
      wx.showModal({
        title: '还没有绑定父母',
        content: '请先在亲情提醒页发送邀请，父母确认绑定后才能收到提醒。',
        confirmText: '去绑定',
        success: (res) => {
          if (res.confirm) this.goFamily();
        }
      });
      return;
    }

    const ready = !this.data.statusWarn;
    this.setData({ submitting: true });
    wx.showLoading({ title: '正在提交', mask: true });
    planSync.syncIfChanged(true).then((ok) => {
      wx.hideLoading();
      this.setData({ submitting: false });
      if (!ok) {
        wx.showModal({
          title: '提交失败',
          content: '提醒计划没有提交成功，请检查网络后重试。',
          showCancel: false
        });
        return;
      }
      this.setData({ pendingSubmit: false });
      this.refresh();
      wx.showModal({
        title: '提醒计划已提交',
        content: ready
          ? '到点后云端会把提醒推送到父母手机，父母点「已吃药」后首页 24 小时服药图会同步更新。'
          : '计划已同步到云端，但父母还没有允许微信通知。请让父母在小程序里点「重新开启」，到点才能收到提醒。',
        showCancel: false
      });
    });
  },

  goFamily() {
    wx.navigateTo({ url: '/pages/family/family' });
  },

  goMealTimes() {
    wx.navigateTo({ url: '/pages/meal-times/meal-times' });
  },

  goRoutineTimes() {
    wx.navigateTo({ url: '/pages/routine-times/routine-times' });
  }
});
