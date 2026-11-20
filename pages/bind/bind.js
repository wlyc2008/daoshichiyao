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
    submitting: false,
    notifyState: ''
  },

  onLoad(options) {
    const code = String((options && options.code) || '').trim().toUpperCase();
    if (!code) {
      // 没有邀请码时允许手动输入，便于当面或电话告诉家人
      this.setData({ state: 'input' });
      return;
    }
    this.setData({ code: code, state: 'loading' });
    this.checkInvite(code);
  },

  /**
   * 先校验再展示确认页：
   * 子女点「查看分享页」会用自己的微信打开自己的邀请，必须提前拦下，避免反复确认的死循环
   */
  checkInvite(code) {
    bind.peek(code).then(() => {
      this.setData({ state: 'ready' });
    }).catch((err) => {
      const errorCode = (err && err.code) || '';
      // 网络异常时不要卡住，交给确认环节的云端再校验一次
      if (!errorCode) {
        this.setData({ state: 'ready' });
        return;
      }
      if (errorCode === 'SELF_INVITE') {
        this.setData({ state: 'self' });
        return;
      }
      this.setData({
        state: 'error',
        errorCode: errorCode,
        errorText: (err && err.message) || '邀请不可用，请让家人重新发送'
      });
    });
  },

  /** 返回上一页；从分享卡片冷启动时没有上一页，则回首页 */
  goHome() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
      return;
    }
    wx.reLaunch({ url: '/pages/index/index' });
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
    this.requestNotify((state) => this.doBind(state));
  },

  /** 请求微信通知授权，回调里带回 accept / reject / ban / filter */
  requestNotify(done) {
    wx.requestSubscribeMessage({
      tmplIds: [config.TEMPLATE_ID],
      success: (res) => {
        done((res && res[config.TEMPLATE_ID]) || '');
      },
      // 授权弹窗打不开时按未授权处理，不阻断绑定
      fail: () => done('')
    });
  },

  doBind(notifyState) {
    bind.acceptInvite(this.data.code, notifyState).then(() => {
      role.setRole('caree');
      this.setData({ state: 'done', submitting: false, notifyState: notifyState || '' });
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

  /** 未授权时重新请求，成功后写回云端 */
  onEnableNotify() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    this.requestNotify((state) => {
      bind.resume(state).then(() => {
        this.setData({ submitting: false, notifyState: state || '' });
        wx.showToast({
          title: state === 'accept' ? '已开启微信通知' : '仍未开启，请检查微信设置',
          icon: 'none'
        });
      }).catch(() => {
        this.setData({ submitting: false });
        wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' });
      });
    });
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
