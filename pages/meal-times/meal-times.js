const storage = require('../../utils/storage');

Page({
  data: {
    breakfast: '08:00',
    lunch: '12:00',
    dinner: '18:00'
  },

  onLoad() {
    this.setData(storage.getMealTimes());
  },

  onTimeChange(event) {
    const key = event.currentTarget.dataset.key;
    const patch = {};
    patch[key] = event.detail.value;
    this.setData(patch);
  },

  save() {
    storage.setMealTimes(this.data);
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 500);
  }
});
