const storage = require('../../utils/storage');
const reminder = require('../../utils/reminder');
const stock = require('../../utils/stock');
const date = require('../../utils/date');
const ics = require('../../utils/ics');
const medSchedule = require('../../utils/medSchedule');
const planSync = require('../../utils/planSync');
const role = require('../../utils/role');
const bind = require('../../utils/bind');

const WEEK_TEXT = ['日', '一', '二', '三', '四', '五', '六'];

function todayText() {
  const now = new Date();
  return (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + WEEK_TEXT[now.getDay()];
}

/** 把 24 小时制转成「早上 8:00」这类口语时间 */
function friendlyTime(time) {
  const hour = Number(String(time).split(':')[0]) || 0;
  let period = '晚上';
  if (hour < 11) period = '早上';
  else if (hour < 14) period = '中午';
  else if (hour < 18) period = '下午';
  return period + ' ' + String(time).replace(/^0/, '');
}

/** 下一个服药点的时间描述：今天 / 明天 / 具体日期 */
function formatDoseTime(plannedTime, now) {
  const parsed = date.parseKey(plannedTime);
  if (!parsed) return plannedTime;
  const timeText = friendlyTime(date.formatTime(parsed));
  if (date.isSameDay(parsed, now)) return '今天 ' + timeText;
  if (date.isSameDay(parsed, date.addDays(now, 1))) return '明天 ' + timeText;
  return (parsed.getMonth() + 1) + '月' + parsed.getDate() + '日 ' + timeText;
}

/** 把剩余分钟转成「1 小时 20 分钟」这类口语描述 */
function durationText(minutes) {
  if (minutes < 60) return minutes + ' 分钟';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours + ' 小时' + (rest ? ' ' + rest + ' 分钟' : '');
}

/** 距离某个日期还有几天，按自然日计算，解析失败返回 null */
function daysUntil(dateKey) {
  const target = date.parseKey(dateKey);
  if (!target) return null;
  const today = date.startOfDay(new Date());
  const day = date.startOfDay(target);
  return Math.round((day.getTime() - today.getTime()) / 86400000);
}

/** 把日期键转成「11月25日」 */
function monthDay(dateKey) {
  const d = date.parseKey(dateKey);
  return d ? (d.getMonth() + 1) + '月' + d.getDate() + '日' : String(dateKey || '');
}

Page({
  data: {
    userRole: '',
    today: '',
    hasMeds: false,
    medsList: [],
    nextDose: [],
    nextDoseTime: '',
    nextDoseHint: '',
    todayTotal: 0,
    todayDone: 0,
    todayRemaining: 0,
    allDone: false,
    alertText: '',
    alertDuration: 20,
    hours: [],
    due: null,
    icsExported: true,
    icsOutdated: false,
    bound: false,
    boundText: ''
  },

  onShow() {
    this.loadRole();
  },

  /**
   * 身份不再由用户选择，而是由入口隐式决定：
   * 直接打开小程序 = 管理者（子女）；点邀请完成绑定后 = 被照护者（长辈）
   */
  loadRole() {
    const current = role.getRole() || 'caregiver';
    this.setData({ userRole: current, today: todayText() });
    if (current === 'caregiver') {
      this.initApp();
    } else {
      this.stopTimer();
    }
    this.syncBindState();
  },

  initApp() {
    this.refresh();
    this.startTimer();
    this.checkDue();
    // 药品增删改后即使没进过提醒页，也把变化同步到云端
    planSync.syncIfChanged();
  },

  /** 用云端绑定状态校正本地：清缓存或换机后仍能回到正确的身份 */
  syncBindState() {
    bind.fetchStatus().then((res) => {
      const profile = res.profile;
      const partner = res.partner;
      if (!profile) return;

      if (profile.role === 'caree' && this.data.userRole !== 'caree') {
        role.cacheRole('caree');
        this.setData({ userRole: 'caree' });
        this.stopTimer();
      }

      if (profile.linkedId && partner) {
        this.setData({ bound: true, boundText: partner.nickname || '长辈' });
      }
    }).catch(() => {});
  },

  /** 亲情提醒的分享、邀请码、解除绑定都收在二级页 */
  goFamily() {
    wx.navigateTo({ url: '/pages/family/family' });
  },

  /** 长辈端：凭邀请码完成绑定 */
  goBind() {
    wx.navigateTo({ url: '/pages/bind/bind' });
  },

  onHide() {
    this.stopTimer();
  },

  onUnload() {
    this.stopTimer();
  },

  startTimer() {
    this.stopTimer();
    this.timer = setInterval(() => this.checkDue(), 30000);
  },

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  refresh() {
    const meds = storage.getMeds();
    const logs = storage.getLogs();
    const allMeds = storage.getMeds({ includeInactive: true });
    const now = new Date();

    // 找到下一个服药点：今天的剩余时刻 + 明天全天，取最早一次
    const mealTimes = storage.getMealTimes();
    const upcoming = reminder.buildSchedule(meds, mealTimes, now)
      .concat(reminder.buildSchedule(meds, mealTimes, date.addDays(now, 1)))
      .filter((item) => item.plannedTime > date.toKey(now))
      .sort((a, b) => (a.plannedTime < b.plannedTime ? -1 : 1));

    let nextDose = [];
    let nextDoseTime = '';
    let nextDoseHint = '';
    if (upcoming.length) {
      const next = upcoming[0];
      nextDose = upcoming
        .filter((item) => item.plannedTime === next.plannedTime)
        .map((item) => ({
          medId: item.medId,
          name: item.name,
          doseText: item.dose + ' ' + (item.unit || '片')
        }));
      nextDoseTime = formatDoseTime(next.plannedTime, now);

      const nextAt = date.parseKey(next.plannedTime);
      const diffMin = nextAt ? Math.round((nextAt.getTime() - now.getTime()) / 60000) : 0;
      nextDoseHint = diffMin <= 1 ? '马上就到时间' : '还有 ' + durationText(diffMin);
    }

    const takenSet = {};
    logs.forEach((log) => {
      if (log.status === 'taken') takenSet[log.medId + '|' + log.plannedTime] = true;
    });

    // 今天的全部服药点，同时用于进度摘要与 24 小时网格
    const todaySchedule = reminder.buildSchedule(meds, mealTimes, now);
    const todayTotal = todaySchedule.length;
    let todayDone = 0;

    const hours = [];
    for (let h = 0; h < 24; h += 1) {
      hours.push({ hour: h, names: [], total: 0, done: 0, statusClass: 'dot-none' });
    }
    todaySchedule.forEach((item) => {
      const cell = hours[Number(item.time.split(':')[0])];
      if (!cell) return;
      cell.total += 1;
      if (takenSet[item.medId + '|' + item.plannedTime]) {
        cell.done += 1;
        todayDone += 1;
      }
      if (cell.names.indexOf(item.name) === -1) cell.names.push(item.name);
    });
    hours.forEach((cell) => {
      if (cell.total === 0) cell.statusClass = 'dot-none';
      else if (cell.done === cell.total) cell.statusClass = 'dot-done';
      else cell.statusClass = 'dot-pending';
    });

    const shortage = [];
    const medsList = allMeds.map((med) => {
      const state = stock.calcMedStock(med);
      if (med.isActive !== false && isFinite(state.daysLeft) && state.daysLeft < 3) {
        shortage.push({ name: med.name, days: state.daysLeft });
      }
      return {
        id: med.id,
        name: med.name,
        dose: med.dose,
        unit: med.unit || '片',
        times: stock.timesPerDay(med),
        isActive: med.isActive !== false,
        ruleText: medSchedule.summaryOf(med),
        remainingPills: state.remainingPills,
        daysText: state.daysLeft === Infinity ? '未知' : state.daysLeft + ' 天',
        needRefill: state.needRefill,
        statusText: med.isActive === false ? '已停用' : '在服'
      };
    });

    const settings = storage.getSettings();
    const todayRemaining = todayTotal - todayDone;

    // 顶部滚动提示：7 天内复诊 + 任一药品库存不足 3 天
    const alerts = [];

    const nextFollowup = (storage.getDocs() || [])
      .filter((doc) => doc.followupDate)
      .map((doc) => ({ doc: doc, days: daysUntil(doc.followupDate) }))
      .filter((item) => item.days !== null && item.days >= 0 && item.days <= 7)
      .sort((a, b) => a.days - b.days)[0];

    if (nextFollowup) {
      const when = nextFollowup.days === 0 ? '今天' : '还有 ' + nextFollowup.days + ' 天';
      alerts.push('复诊提醒：' + monthDay(nextFollowup.doc.followupDate) + ' ' + when + '复诊，请带好病历和用药清单');
    }

    shortage
      .sort((a, b) => a.days - b.days)
      .slice(0, 3)
      .forEach((item) => {
        const daysText = item.days < 1 ? '不到 1 天' : item.days + ' 天';
        alerts.push('补药提醒：「' + item.name + '」只剩 ' + daysText + '用量，请及时补货');
      });

    const alertText = alerts.join('　｜　');

    // 导出日历后若提醒时刻发生变化，提示重新导出
    let icsOutdated = false;
    if (settings.icsExportedAt && settings.icsSignature) {
      icsOutdated = ics.buildSignature(meds, mealTimes) !== settings.icsSignature;
    }

    this.setData({
      today: todayText(),
      hasMeds: meds.length > 0,
      medsList: medsList,
      nextDose: nextDose,
      nextDoseTime: nextDoseTime,
      nextDoseHint: nextDoseHint,
      todayTotal: todayTotal,
      todayDone: todayDone,
      todayRemaining: todayRemaining,
      allDone: todayTotal > 0 && todayRemaining === 0,
      alertText: alertText,
      alertDuration: Math.max(16, Math.round(alertText.length * 0.42)),
      hours: hours.map((cell) => ({
        hour: cell.hour,
        names: cell.names,
        statusClass: cell.statusClass
      })),
      icsExported: !!settings.icsExportedAt,
      icsOutdated: icsOutdated
    });
  },

  checkDue() {
    if (this.data.due) return;
    const due = reminder.getDueDose(new Date());
    if (!due) return;

    const planned = date.parseKey(due.plannedTime);
    this.setData({
      due: {
        medId: due.med.id,
        name: due.med.name,
        dose: due.med.dose,
        unit: due.med.unit || '片',
        plannedTime: due.plannedTime,
        timeText: planned ? friendlyTime(date.formatTime(planned)) : ''
      }
    });

    try {
      wx.enableAlertBeforeUnload({ message: '请先确认本次服药' });
    } catch (err) {
      // 低版本基础库不支持时忽略
    }
  },

  onConfirmDose() {
    const due = this.data.due;
    if (!due) return;
    const med = storage.getMedById(due.medId);
    reminder.confirmDose(med, due.plannedTime);
    this.dismissDue();
    this.refresh();
    wx.showToast({ title: '已记录', icon: 'success' });
  },

  onSnoozeDose() {
    const due = this.data.due;
    if (!due) return;
    reminder.markSnooze(due.medId, due.plannedTime, 10);
    this.dismissDue();
    this.refresh();
    wx.showToast({ title: '10 分钟后再提醒', icon: 'none' });
  },

  dismissDue() {
    this.setData({ due: null });
    try {
      wx.disableAlertBeforeUnload();
    } catch (err) {
      // 忽略
    }
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  }
});
