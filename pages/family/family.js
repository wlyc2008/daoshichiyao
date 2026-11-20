const config = require('../../utils/config');
const bind = require('../../utils/bind');

Page({
  data: {
    bound: false,
    bindStatusText: '',
    partnerNotifyState: '',
    partnerPaused: false,
    inviteCode: '',
    inviteError: '',
    isCaregiver: false,
    careQuota: 0,
    careNotifyState: '',
    grantingCare: false
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
  }
});
