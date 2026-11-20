const role = require('../../utils/role');
const bind = require('../../utils/bind');
const config = require('../../utils/config');

Page({
  data: {
    code: '',
    typedCode: '',
    state: 'loading', // loading | input | ready | done | error
    errorCode: '',
    errorText: '',
    submitting: false
  },

  onLoad(options) {
    const code = String((options && options.code) || '').trim().toUpperCase();
    if (!code) {
      // 没有邀请码时允许手动输入，便于当面或电话告诉家人
      this.setData({ state: 'input' });
      return;
    }
    this.setData({ code: code, state: 'ready' });
  },

  onCodeInput(e) {
    this.setData({ typedCode: String(e.detail.value || '').toUpperCase() });
  },

  onSubmitCode() {
    const code = String(this.data.typedCode || '').trim().toUpperCase();
    if (code.length !== 6) {
      wx.showToast({ title: '请输入 6 位邀请码', icon: 'none' });
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
        errorCode: (err && err.code) || '',
        errorText: (err && err.message) || '绑定失败，请让家人重新发送'
      });
    });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  /** 邀请码输错或过期后，回到输入态重新填 */
  onReinput() {
    this.setData({
      state: 'input',
      code: '',
      typedCode: '',
      errorCode: '',
      errorText: ''
    });
  }
});
