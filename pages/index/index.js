const storage = require('../../utils/storage');
const reminder = require('../../utils/reminder');
const stock = require('../../utils/stock');
const date = require('../../utils/date');
const ics = require('../../utils/ics');
const medSchedule = require('../../utils/medSchedule');
const planSync = require('../../utils/planSync');
const role = require('../../utils/role');
const bind = require('../../utils/bind');
const config = require('../../utils/config');

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
    inviteCode: '',
    inviteError: '',
    bound: false,
    boundText: '',
    typedCode: '',
    binding: false,
    bindError: ''
  },

  onShow() {
    this.loadRole();
  },

  /** 读取本地身份；未选择时停留在身份选择页 */
  loadRole() {
    const current = role.getRole();
    this.setData({
      userRole: current,
      today: todayText()
    });
    if (current === 'caregiver') {
      this.initApp();
    } else {
      this.stopTimer();
      this.loadBindStatus();
    }
  },

  initApp() {
    this.refresh();
    this.startTimer();
    this.checkDue();
    // 药品增删改后即使没进过提醒页，也把变化同步到云端
    planSync.syncIfChanged();
    this.loadInvite();
    this.loadBindStatus();
  },

  /** 预先生成关怀邀请，保证「发送给父母」能一步分享出去 */
  loadInvite() {
    if (this.data.inviteCode || this.inviteLoading) return;
    this.inviteLoading = true;
    bind.createInvite().then((res) => {
      this.setData({ inviteCode: res.code, inviteError: '' });
    }).catch(() => {
      this.setData({ inviteError: '暂时无法生成邀请，请检查网络后重试' });
    }).then(() => {
      this.inviteLoading = false;
    });
  },

  onRetryInvite() {
    this.setData({ inviteError: '' });
    this.loadInvite();
  },

  /** 复制邀请码，便于当面或电话告诉父母 */
  onCopyCode() {
    const code = this.data.inviteCode;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: '邀请码已复制', icon: 'none' })
    });
  },

  /** 已绑定的长辈信息，用于告诉子女「提醒已经送达」 */
  loadBindStatus() {
    bind.fetchStatus().then((res) => {
      const profile = res.profile;
      const partner = res.partner;
      if (profile && profile.linkedId && partner) {
        this.setData({ bound: true, boundText: partner.nickname || '长辈' });
      }
    }).catch(() => {});
  },

  /** 长辈确认开启提醒后直接退出小程序，避免在首页误触其他入口 */
  onExit() {
    wx.exitMiniProgram({
      fail: () => {
        wx.showToast({ title: '请点右上角关闭', icon: 'none' });
      }
    });
  },

  /** 长辈端退出：停止接收家人设置的提醒，双方绑定一起解除 */
  onCareeUnbind() {
    wx.showModal({
      title: '不再接收提醒',
      content: '停止后家人设置的提醒不会再发给您，家人也会看到已解除。确定要停止吗？',
      confirmText: '停止',
      confirmColor: '#C62828',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '正在处理', mask: true });
        bind.unbind().then(() => {
          wx.hideLoading();
          this.setData({
            bound: false,
            boundText: '',
            inviteCode: '',
            typedCode: '',
            bindError: ''
          });
          wx.showToast({ title: '已停止接收提醒', icon: 'none' });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' });
        });
      }
    });
  },

  /** 解除与长辈的绑定，双方同时失效，之后可重新邀请 */
  onUnbind() {
    wx.showModal({
      title: '解除绑定',
      content: '解除后长辈将不再收到您设置的提醒，确定要解除吗？',
      confirmText: '解除',
      confirmColor: '#C62828',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '正在解除', mask: true });
        bind.unbind().then(() => {
          wx.hideLoading();
          this.setData({ bound: false, boundText: '', inviteCode: '', inviteError: '' });
          this.loadInvite();
          wx.showToast({ title: '已解除绑定', icon: 'none' });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '解除失败，请稍后重试', icon: 'none' });
        });
      }
    });
  },

  /** 身份选择页的邀请码入口：切到长辈身份，直接在本页输入，不再跳转 */
  goBind() {
    role.setRole('caree');
    this.setData({ userRole: 'caree', bindError: '' });
    this.loadBindStatus();
  },

  onCodeInput(e) {
    this.setData({
      typedCode: String(e.detail.value || '').toUpperCase(),
      bindError: ''
    });
  },

  /** 长辈端一次点击完成「订阅授权 + 绑定」 */
  onConfirmBind() {
    if (this.data.binding) return;
    const code = String(this.data.typedCode || '').trim().toUpperCase();
    if (code.length !== 6) {
      this.setData({ bindError: '请输入 6 位邀请码' });
      return;
    }
    this.setData({ binding: true, bindError: '' });
    wx.requestSubscribeMessage({
      tmplIds: [config.TEMPLATE_ID],
      // 拒绝授权也允许绑定，只是收不到微信推送
      complete: () => this.doBind(code)
    });
  },

  doBind(code) {
    bind.acceptInvite(code).then(() => {
      role.setRole('caree');
      this.setData({ binding: false, bound: true, typedCode: '', inviteCode: '' });
      wx.showToast({ title: '已开启家人的提醒', icon: 'success' });
    }).catch((err) => {
      this.setData({
        binding: false,
        bindError: (err && err.message) || '绑定失败，请核对邀请码'
      });
    });
  },

  onShareAppMessage() {
    const code = this.data.inviteCode;
    return {
      title: '家人给您设置好吃药提醒了，点开就能用',
      path: code ? '/pages/bind/bind?code=' + code : '/pages/bind/bind'
    };
  },

  onChooseRole(e) {
    const next = e.currentTarget.dataset.role;
    if (!role.roleText(next)) return;
    role.setRole(next);
    this.setData({ userRole: next });
    if (next === 'caregiver') this.initApp();
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
