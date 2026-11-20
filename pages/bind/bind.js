const role = require('../../utils/role');
const bind = require('../../utils/bind');
const config = require('../../utils/config');

Page({
  data: {
    code: '',
    state: 'loading', // loading | ready | done | error
    errorText: '',
    submitting: false
  },

  onLoad(options) {
    const code = String((options && options.code) || '').trim().toUpperCase();
    if (!code) {
      this.setData({
        state: 'error',
        errorText: '邀请链接不完整，请让家人重新发送一次'
      });
      return;
    }
    this.setData({ code: code, state: 'ready' });
  },

  /** 一次点击同时完成订阅授权与绑定 */
  onConfirm() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });

    const templateId = config.TEMPLATE_ID;
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      // 无论接受还是拒绝都不阻断绑定，只是收不到微信推送
      complete: () => this.doBind()
    });
  },

  doBind() {
    bind.acceptInvite(this.data.code).then(() => {
      role.setRole('caree');
      this.setData({ state: 'done', submitting: false });
      wx.showToast({ title: '已开启', icon: 'success' });
    }).catch((err) => {
      this.setData({
        state: 'error',
        submitting: false,
        errorText: (err && err.message) || '绑定失败，请让家人重新发送'
      });
    });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  }
});
