const storage = require('../../utils/storage');
const reminder = require('../../utils/reminder');
const ics = require('../../utils/ics');
const date = require('../../utils/date');

Page({
  data: {
    items: [],
    hasMeds: false,
    exportedText: '',
    exportedStale: false
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const meds = storage.getMeds();
    const mealTimes = storage.getMealTimes();
    const items = reminder.buildSchedule(meds, mealTimes, new Date()).map((item) => ({
      text: item.time + '  ' + item.name + '  ' + item.dose + (item.unit || '片')
    }));

    const settings = storage.getSettings();
    let exportedText = '';
    let exportedStale = false;
    if (settings.icsExportedAt) {
      const signature = ics.buildSignature(meds, mealTimes);
      exportedStale = !settings.icsSignature || settings.icsSignature !== signature;
      exportedText = exportedStale
        ? '用药时间已变更，请重新发送日历文件'
        : '已发送过日历文件，如无变化无需重复操作';
    }

    this.setData({
      hasMeds: meds.length > 0,
      items: items,
      exportedText: exportedText,
      exportedStale: exportedStale
    });
  },

  exportCalendar() {
    const meds = storage.getMeds();
    if (!meds.length) {
      wx.showToast({ title: '请先添加药品', icon: 'none' });
      return;
    }
    const mealTimes = storage.getMealTimes();
    const text = ics.buildIcs(meds, mealTimes, new Date());
    const signature = ics.buildSignature(meds, mealTimes);

    // 内部文件用英文名，避免部分安卓机分享中文路径失败；发送时再指定中文文件名
    ics.saveIcsFile(text).then((filePath) => {
      this.shareIcs(filePath, text, signature);
    }).catch(() => this.copyIcs(text, signature));
  },

  /**
   * 发送日历文件
   * 分享面板首次拉起可能失败，失败时重试一次；用户主动取消则不打扰
   */
  shareIcs(filePath, text, signature, retried) {
    wx.shareFileMessage({
      filePath: filePath,
      fileName: '用药提醒.ics',
      success: () => {
        storage.setSettings({
          icsExportedAt: date.toKey(new Date()),
          icsSignature: signature || ''
        });
        this.refresh();
        wx.showModal({
          title: '已生成日历文件',
          content: '在微信里点开该文件，选择「用其他应用打开」→ 日历。建议导入到名为「到时吃药」的专用日历；以后改时间或取消提醒，删除这个日历即可一次清空，再回来重新发送。',
          showCancel: false,
          confirmText: '知道了'
        });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') >= 0) return;
        if (!retried) {
          setTimeout(() => this.shareIcs(filePath, text, signature, true), 300);
          return;
        }
        this.copyIcs(text, signature);
      }
    });
  },

  copyIcs(text, signature) {
    ics.copyToClipboard(text).then(() => {
      storage.setSettings({
        icsExportedAt: date.toKey(new Date()),
        icsSignature: signature || ''
      });
      this.refresh();
      wx.showModal({
        title: '已复制日历内容',
        content: '已复制日历文本，请再次点击「发送到手机日历」',
        showCancel: false,
        confirmText: '知道了'
      });
    }).catch(() => {
      wx.showToast({ title: '复制失败', icon: 'none' });
    });
  },

  goMealTimes() {
    wx.navigateTo({ url: '/pages/meal-times/meal-times' });
  },

  goRoutineTimes() {
    wx.navigateTo({ url: '/pages/routine-times/routine-times' });
  },

  goCancel() {
    wx.navigateTo({ url: '/pages/cancel-calendar/cancel-calendar' });
  }
});
