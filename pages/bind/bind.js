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
    this.setData({ code: code });
    this.checkStatus(code);
  },

  /** 已绑定的长辈再次进入时，直接显示「已开启」，不再让他重复输码 */
  checkStatus(code) {
    const fallback = code ? 'ready' : 'input';
    bind.fetchStatus().then((res) => {
      const profile = res.profile;
      const bound = !!(profile && profile.linkedId && res.partner);
      const isCaree = !!(profile && profile.role === 'caree');
      if (bound && (isCaree || !code)) {
        this.setData({ state: 'done' });
        return;
      }
      this.setData({ state: fallback });
    }).catch(() => {
      this.setData({ state: fallback });
    });
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

  /** 长辈不想进入小程序时，直接退出，省得找不到关闭入口 */
  onClose() {
    if (typeof wx.exitMiniProgram !== 'function') {
      this.goHome();
      return;
    }
    wx.exitMiniProgram({ fail: () => this.goHome() });
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
