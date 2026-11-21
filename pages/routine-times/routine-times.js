const storage = require('../../utils/storage');
const planSync = require('../../utils/planSync');

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
    // 起居时间会改变部分药品的提醒时刻，保存后立即推送到父母端
    planSync.syncIfChanged();
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => planSync.guideResubmit(), 500);
  }
});
