const backup = require('../../utils/backup');

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

function formatTime(stamp) {
  const d = new Date(Number(stamp) || Date.now());
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

Page({
  data: {
    loading: true,
    exists: false,
    updatedAtText: '',
    counts: { meds: 0, docs: 0, logs: 0 },
    restoring: false
  },

  onLoad() {
    this.loadInfo();
  },

  loadInfo() {
    backup.info().then((res) => {
      this.setData({
        loading: false,
        exists: !!res.exists,
        updatedAtText: res.updatedAt ? formatTime(res.updatedAt) : '',
        counts: res.counts || { meds: 0, docs: 0, logs: 0 }
      });
    }).catch(() => {
      this.setData({ loading: false, exists: false });
      wx.showToast({ title: '读取备份信息失败', icon: 'none' });
    });
  },

  onRestore() {
    if (!this.data.exists || this.data.restoring) return;
    wx.showModal({
      title: '恢复到本机？',
      content: '将用云端备份覆盖本机的药品、医疗档案、用药记录与设置，照片不会恢复。',
      confirmText: '恢复',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ restoring: true });
        wx.showLoading({ title: '正在恢复', mask: true });
        backup.restore().then(() => {
          wx.hideLoading();
          wx.showToast({ title: '已恢复，正在重启', icon: 'none' });
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/index/index' });
          }, 600);
        }).catch((err) => {
          wx.hideLoading();
          this.setData({ restoring: false });
          wx.showModal({
            title: '恢复失败',
            content: (err && err.message) || '请稍后重试',
            showCancel: false
          });
        });
      }
    });
  }
});
