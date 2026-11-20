const bind = require('../../utils/bind');

Page({
  data: {
    bound: false,
    boundText: '',
    inviteCode: '',
    inviteError: ''
  },

  onShow() {
    this.syncStatus();
  },

  /** 下拉刷新绑定状态，长辈刚绑定完可立即看到 */
  onPullDownRefresh() {
    this.syncStatus();
    wx.stopPullDownRefresh();
  },

  syncStatus() {
    bind.fetchStatus().then((res) => {
      const profile = res.profile;
      const partner = res.partner;
      const bound = !!(profile && profile.linkedId && partner);
      this.setData({
        bound: bound,
        boundText: bound ? (partner.nickname || '长辈') : ''
      });
      // 已绑定时不必再生成邀请
      if (!bound) this.loadInvite();
    }).catch(() => {
      this.loadInvite();
    });
  },

  /** 预先生成邀请，保证「发送给父母」一步就能分享 */
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

  onUnbind() {
    wx.showModal({
      title: '解除绑定',
      content: '解除后长辈将不再收到您设置的用药提醒。',
      confirmText: '解除',
      confirmColor: '#C62828',
      success: (res) => {
        if (!res.confirm) return;
        bind.unbind().then(() => {
          this.setData({ bound: false, boundText: '', inviteCode: '' });
          this.loadInvite();
          wx.showToast({ title: '已解除', icon: 'none' });
        }).catch(() => {
          wx.showToast({ title: '解除失败，请稍后重试', icon: 'none' });
        });
      }
    });
  },

  /** 长辈直接打开小程序时，可凭邀请码在绑定页输入 */
  onShareAppMessage() {
    const code = this.data.inviteCode;
    return {
      title: '家人给您设置好吃药提醒了，点开就能用',
      path: code ? '/pages/bind/bind?code=' + code : '/pages/bind/bind'
    };
  }
});
