const storage = require('../../utils/storage');
const reminder = require('../../utils/reminder');
const ics = require('../../utils/ics');
const date = require('../../utils/date');

// 导入与删除合并为一条说明，发送文件后自动复制，粘贴到同一聊天即可发给父母
const CALENDAR_GUIDE = '请父母在微信里点开「用药提醒.ics」→ 右上角「···」→「用其他应用打开」→「日历」，导入到名为「到时吃药」的日历。以后不再需要时，删除这个日历即可一次清空全部提醒。';

/** 转发文件只在手机微信可用，电脑微信和开发者工具会直接失败 */
function isPcRuntime() {
  try {
    const info = wx.getSystemInfoSync();
    return ['devtools', 'windows', 'mac'].indexOf(info.platform) >= 0;
  } catch (err) {
    return false;
  }
}

/** 仅微信开发者工具：用于模拟发送成功，不参与真机逻辑 */
function isDevtools() {
  try {
    return wx.getSystemInfoSync().platform === 'devtools';
  } catch (err) {
    return false;
  }
}

Page({
  data: {
    items: [],
    hasMeds: false,
    exportedText: '',
    exportedStale: false,
    isDevtools: false,
    simulateSend: false
  },

  onShow() {
    this.setData({ isDevtools: isDevtools() });
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

    this.prepareIcsFile(meds, mealTimes);
  },

  /**
   * 提前生成日历文件
   * wx.shareFileMessage 只能在点击行为中调用，现场写文件会错过点击态
   */
  prepareIcsFile(meds, mealTimes) {
    this.icsPath = '';
    if (!meds.length) return;
    const text = ics.buildIcs(meds, mealTimes, new Date());
    ics.saveIcsFile(text).then((filePath) => {
      this.icsPath = filePath;
    }).catch(() => {
      // 生成失败时在点击后再重试
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
    if (isPcRuntime()) {
      if (this.data.isDevtools && this.data.simulateSend) {
        this.applyExported(ics.buildSignature(meds, storage.getMealTimes()), true);
        return;
      }
      wx.showModal({
        title: '请用手机操作',
        content: '转发日历文件只支持手机微信，电脑微信和开发者工具里无法发送。请用手机打开小程序再试。',
        showCancel: false
      });
      return;
    }

    const mealTimes = storage.getMealTimes();
    const signature = ics.buildSignature(meds, mealTimes);

    // 文件已在进页面时准备好，这里同步调用才能满足「仅限点击行为」
    if (this.icsPath) {
      this.shareIcs(this.icsPath, signature);
      return;
    }

    const text = ics.buildIcs(meds, mealTimes, new Date());
    // 内部文件用英文名，避免部分安卓机分享中文路径失败；发送时再指定中文文件名
    ics.saveIcsFile(text).then((filePath) => {
      this.icsPath = filePath;
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
        // 说明紧跟日历文件发到同一聊天：微信只能单独转文件，这里自动复制说明供粘贴
        wx.setClipboardData({ data: CALENDAR_GUIDE });
        this.applyExported(signature, false);
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') >= 0) return;
        if (!retried) {
          setTimeout(() => this.shareIcs(filePath, signature, true), 300);
          return;
        }
        // 带上原始错误，便于区分是环境不支持还是文件问题
        console.error('shareFileMessage fail', err);
        wx.showModal({
          title: '发送失败',
          content: '没能打开微信的转发面板，请确认微信已升级到最新版后重试。'
            + (msg ? '（' + msg + '）' : ''),
          showCancel: false
        });
      }
    });
  },

  /** 记录导出状态：真机发送成功与开发者工具模拟共用 */
  applyExported(signature, simulated) {
    storage.setSettings({
      icsExportedAt: date.toKey(new Date()),
      icsSignature: signature || ''
    });
    this.refresh();
    wx.showModal({
      title: simulated ? '已模拟发送' : '已发送日历文件',
      content: simulated
        ? '仅在开发者工具中标记为已发送，用于验证首页状态与后续流程；真机才会实际转发文件。'
        : '导入与删除说明已复制到剪贴板，请粘贴到同一聊天发给父母。父母按说明导入「到时吃药」日历，以后删除该日历即可清空提醒。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /** 开发者工具模拟开关 */
  onSimulateChange(event) {
    this.setData({ simulateSend: !!event.detail.value });
  },

  goMealTimes() {
    wx.navigateTo({ url: '/pages/meal-times/meal-times' });
  },

  goRoutineTimes() {
    wx.navigateTo({ url: '/pages/routine-times/routine-times' });
  }
});
