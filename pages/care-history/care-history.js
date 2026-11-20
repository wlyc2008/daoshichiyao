const medLog = require('../../utils/medLog');

function todayKey() {
  const now = new Date();
  const pad = (value) => (value < 10 ? '0' + value : String(value));
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

Page({
  data: {
    day: '',
    maxDay: '',
    items: [],
    total: 0,
    taken: 0,
    missed: 0,
    bound: true,
    loaded: false
  },

  onLoad() {
    const day = todayKey();
    this.setData({ day: day, maxDay: day });
    this.load(day);
  },

  load(day) {
    medLog.fetchHistory(day).then((res) => {
      const items = (res.items || []).map((item) => Object.assign({}, item, {
        key: item.planId + '|' + item.time,
        doseText: item.dose + (item.unit || '片'),
        statusText: item.status === 'taken' ? '已吃药' : '漏服',
        statusClass: item.status === 'taken' ? 'tag-done' : 'tag-danger'
      }));
      this.setData({
        day: res.day || day,
        bound: res.bound !== false,
        items: items,
        total: res.total || 0,
        taken: res.taken || 0,
        missed: res.missed || 0,
        loaded: true
      });
    }).catch(() => {
      this.setData({ loaded: true, items: [], total: 0 });
      wx.showToast({ title: '读取失败，请稍后重试', icon: 'none' });
    });
  },

  onPickDay(e) {
    const day = e.detail.value;
    if (!day || day === this.data.day) return;
    this.setData({ day: day, loaded: false });
    this.load(day);
  }
});
