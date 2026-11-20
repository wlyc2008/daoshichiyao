const storage = require('../../utils/storage');
const reminder = require('../../utils/reminder');
const ics = require('../../utils/ics');
const date = require('../../utils/date');

// 复制给子女，方便直接粘贴到和父母的聊天里
const IMPORT_STEPS = '在微信里点开「用药提醒.ics」→ 右上角「···」→「用其他应用打开」→「日历」，导入到名为「到时吃药」的日历即可。以后不再需要时，删除这个日历就能一次清空提醒。';

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
        ? '用药时间已变更，请重新发送给父母'
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
    if (typeof wx.shareFileMessage !== 'function') {
      wx.showModal({
        title: '微信版本过低',
        content: '当前微信版本不支持转发日历文件，请升级微信后重试。',
        showCancel: false
      });
      return;
    }

    const mealTimes = storage.getMealTimes();
    const text = ics.buildIcs(meds, mealTimes, new Date());
    const signature = ics.buildSignature(meds, mealTimes);

    // 内部文件用英文名，避免部分安卓机分享中文路径失败；发送时再指定中文文件名
    ics.saveIcsFile(text).then((filePath) => {
      this.shareIcs(filePath, signature);
    }).catch(() => {
      wx.showToast({ title: '生成日历文件失败', icon: 'none' });
    });
  },

  /**
   * 转发日历文件给父母
   * 分享面板首次拉起可能失败，失败时重试一次；用户主动取消则不打扰
   */
  shareIcs(filePath, signature, retried) {
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
          title: '已发送日历文件',
          content: '请提醒父母在微信里点开「用药提醒.ics」，选择「用其他应用打开」→「日历」导入。建议导入到「到时吃药」专用日历，以后删除该日历即可一次清空。',
          showCancel: false,
          confirmText: '知道了'
        });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') >= 0) return;
        if (!retried) {
          setTimeout(() => this.shareIcs(filePath, signature, true), 300);
          return;
        }
        wx.showModal({
          title: '发送失败',
          content: '没能打开微信的转发面板，请确认微信已升级到最新版后重试。',
          showCancel: false
        });
      }
    });
  },

  /** 把导入步骤复制给子女，便于直接发给父母 */
  copyImportSteps() {
    wx.setClipboardData({
      data: IMPORT_STEPS,
      success: () => wx.showToast({ title: '步骤已复制，可粘贴发给父母', icon: 'none' })
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
