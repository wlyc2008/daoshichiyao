const storage = require('../../utils/storage');

Page({
  data: {
    wake: '06:30',
    nap: '13:00',
    bedtime: '21:30'
  },

  onLoad() {
    this.setData(storage.getRoutineTimes());
  },

  onTimeChange(event) {
    const key = event.currentTarget.dataset.key;
    const patch = {};
    patch[key] = event.detail.value;
    this.setData(patch);
  },

  save() {
    storage.setRoutineTimes(this.data);
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 500);
  }
});
