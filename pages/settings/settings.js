const storage = require('../../utils/storage');
const date = require('../../utils/date');
const cloud = require('../../utils/cloud');
const fileManager = require('../../utils/fileManager');
const planSync = require('../../utils/planSync');
const config = require('../../utils/config');
const bind = require('../../utils/bind');
const backup = require('../../utils/backup');

Page({
  data: {
    version: config.VERSION,
    bound: false,
    bindStatusText: '',
    partnerNotifyState: '',
    partnerPaused: false,
    inviteCode: '',
    inviteError: '',
    // Phase 5：子女侧漏服通知额度
    isCaregiver: false,
    careQuota: 0,
    careNotifyState: '',
    grantingCare: false,
    backingUp: false
  },

  onShow() {
    this.loadBindStatus();
  },

  /** 绑定状态与长辈的通知状态，供子女判断提醒是否真的送达 */
  loadBindStatus() {
    bind.fetchStatus().then((res) => {
      const profile = res.profile;
      const partner = res.partner;
      if (!profile || !profile.linkedId || !partner) {
        this.setData({
          bound: false,
          isCaregiver: false,
          careQuota: 0,
          careNotifyState: '',
          inviteCode: '',
          inviteError: ''
        });
        this.loadInvite();
        return;
      }

      const partnerNotifyState = partner.notifyState || '';
      const partnerPaused = !!partner.notifyPaused;
      let bindStatusText = '已与长辈绑定';
      if (partnerPaused) bindStatusText = '长辈已暂停接收提醒';
      else if (partnerNotifyState !== 'accept') bindStatusText = '长辈尚未开启微信通知';

      this.setData({
        bound: true,
        bindStatusText: bindStatusText,
        partnerNotifyState: partnerNotifyState,
        partnerPaused: partnerPaused,
        isCaregiver: profile.role !== 'caree',
        careQuota: Number(profile.quota) || 0,
        careNotifyState: profile.careNotifyState || ''
      });
    }).catch(() => {
      // 读不到状态时按未绑定处理，至少让邀请入口可用/可重试
      this.setData({ bound: false });
      this.loadInvite();
    });
  },

  /** 未绑定时预先生成邀请码，保证分享一步完成 */
  loadInvite() {
    if (this.data.inviteCode || this.inviteLoading) return;
    this.inviteLoading = true;
    bind.createInvite().then((res) => {
      this.setData({ inviteCode: res.code, inviteError: '' });
    }).catch(() => {
      this.setData({ inviteError: '暂时无法生成邀请，请检查网络后重试' });
    }).then(() => {
      this.inviteLoading = false;
    });
  },

  onRetryInvite() {
    this.setData({ inviteError: '' });
    this.loadInvite();
  },

  /** 复制邀请码，便于当面或电话告诉父母 */
  onCopyCode() {
    const code = this.data.inviteCode;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: '邀请码已复制', icon: 'none' })
    });
  },

  /** 子女端：申请「漏服通知」额度，一次授权可接收一次提醒 */
  onGrantCareNotify() {
    if (this.data.grantingCare) return;
    this.setData({ grantingCare: true });
    wx.requestSubscribeMessage({
      tmplIds: [config.TEMPLATE_ID],
      success: (res) => {
        this.doGrantCare((res && res[config.TEMPLATE_ID]) || '');
      },
      // 低版本或弹窗打不开时按未授权处理
      fail: () => this.doGrantCare('')
    });
  },

  doGrantCare(state) {
    bind.grant(state).then(() => {
      this.setData({ grantingCare: false });
      wx.showToast({
        title: state === 'accept' ? '已开启漏服通知' : '未开启，请检查微信通知设置',
        icon: 'none'
      });
      this.loadBindStatus();
    }).catch(() => {
      this.setData({ grantingCare: false });
      wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' });
    });
  },

  onUnbind() {
    wx.showModal({
      title: '解除绑定',
      content: '解除后长辈将不再收到您设置的提醒，需要重新邀请才能恢复。确定要解除吗？',
      confirmText: '解除',
      confirmColor: '#C62828',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '正在解除', mask: true });
        bind.unbind().then(() => {
          wx.hideLoading();
          this.setData({ bound: false, inviteCode: '', inviteError: '' });
          this.loadInvite();
          wx.showToast({ title: '已解除绑定', icon: 'none' });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '解除失败，请稍后重试', icon: 'none' });
        });
      }
    });
  },

  onShareAppMessage() {
    const code = this.data.inviteCode;
    return {
      title: '家人给您设置好吃药提醒了，点开就能用',
      path: code ? '/pages/bind/bind?code=' + code : '/pages/bind/bind'
    };
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
