const medLog = require('../../utils/medLog');

function rateClass(rate) {
  if (rate >= 80) return 'bar-done';
  if (rate >= 50) return 'bar-warn';
  return 'bar-danger';
}

Page({
  data: {
    loaded: false,
    bound: true,
    rate: 0,
    expected: 0,
    taken: 0,
    missed: 0,
    alerted: 0,
    daily: []
  },

  onLoad() {
    this.load();
  },

  load() {
    medLog.fetchStats().then((res) => {
      const daily = (res.daily || []).map((item) => Object.assign({}, item, {
        rateClass: rateClass(item.rate)
      }));
      this.setData({
        loaded: true,
        bound: res.bound !== false,
        rate: res.rate || 0,
        expected: res.expected || 0,
        taken: res.taken || 0,
        missed: res.missed || 0,
        alerted: res.alerted || 0,
        daily: daily
      });
    }).catch(() => {
      this.setData({ loaded: true, daily: [] });
      wx.showToast({ title: '读取失败，请稍后重试', icon: 'none' });
    });
  }
});
