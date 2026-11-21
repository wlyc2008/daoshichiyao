const storage = require('../../utils/storage');
const planSync = require('../../utils/planSync');

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
    // 三餐时间会改变部分药品的提醒时刻，保存后立即推送到父母端
    planSync.syncIfChanged();
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => planSync.guideResubmit(), 500);
  }
});
