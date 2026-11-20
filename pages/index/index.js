const storage = require('../../utils/storage');
const reminder = require('../../utils/reminder');
const stock = require('../../utils/stock');
const date = require('../../utils/date');
const ics = require('../../utils/ics');
const medSchedule = require('../../utils/medSchedule');
const planSync = require('../../utils/planSync');
const role = require('../../utils/role');
const bind = require('../../utils/bind');
const medLog = require('../../utils/medLog');

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

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

/** 本机日期键，用于校验消息里的计划日期 */
function localDayKey() {
  const now = new Date();
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

/** 今日用药：补齐渲染字段，planId + time 作为列表键 */
function decorateToday(res) {
  const now = new Date();
  const nowKey = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const items = (res.items || []).map((item) => {
    const taken = !!item.taken;
    const late = taken && !!item.late;
    let statusText = '待服';
    let statusClass = 'tag-idle';
    if (late) {
      statusText = '已补吃';
      statusClass = 'tag-late';
    } else if (taken) {
      statusText = '已完成';
      statusClass = 'tag-done';
    } else if (item.missed) {
      statusText = '漏服';
      statusClass = 'tag-danger';
    }
    return Object.assign({}, item, {
      key: item.planId + '|' + item.time,
      doseText: item.dose + (item.unit || '片'),
      late: late,
      statusText: statusText,
      statusClass: statusClass,
      // 过点未服：用于首页 24 小时图标的红色标记
      overdue: !taken && String(item.time) < nowKey
    });
  });
  return {
    careItems: items,
    careTotal: res.total || 0,
    careDone: res.done || 0,
    careLoaded: true,
    missedItems: items.filter((item) => item.missed && !item.taken)
  };
}

/** 用长辈的云端记录重建 24 小时服药图：红色漏服、黄色补吃 */
function buildCareHours(items) {
  const hours = [];
  for (let h = 0; h < 24; h += 1) {
    hours.push({ hour: h, names: [], total: 0, done: 0, overdue: 0, late: 0, statusClass: 'dot-none' });
  }

  (items || []).forEach((item) => {
    const cell = hours[Number(String(item.time).split(':')[0])];
    if (!cell) return;
    cell.total += 1;
    if (item.taken) cell.done += 1;
    else if (item.overdue) cell.overdue += 1;
    if (item.late) cell.late += 1;
    if (cell.names.indexOf(item.medName) === -1) cell.names.push(item.medName);
  });

  hours.forEach((cell) => {
    if (cell.total === 0) cell.statusClass = 'dot-none';
    else if (cell.overdue > 0) cell.statusClass = 'dot-missed';
    else if (cell.late > 0) cell.statusClass = 'dot-late';
    else if (cell.done === cell.total) cell.statusClass = 'dot-done';
    else cell.statusClass = 'dot-pending';
  });

  return hours.map((cell) => ({
    hour: cell.hour,
    names: cell.names,
    statusClass: cell.statusClass
  }));
}

/** 未绑定时清空今日用药，避免旧数据残留 */
function emptyToday() {
  return {
    careItems: [],
    careTotal: 0,
    careDone: 0,
    careLoaded: false,
    careConfirming: '',
    missedItems: []
  };
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
    typedCode: '',
    binding: false,
    bindError: '',
    notifyState: '',
    notifyPaused: false,
    partnerNotifyState: '',
    partnerPaused: false,
    bindStatusText: '',
    // Phase 4：今日用药（仅长辈可确认）
    careItems: [],
    careTotal: 0,
    careDone: 0,
    careLoaded: false,
    careConfirming: '',
    // 消息进入：待确认的计划时刻
    notifyDate: '',
    notifyTime: '',
    lateNotice: ''
  },

  onLoad(options) {
    this.handleNotifyOptions(options);
  },

  onShow() {
    // 小程序已在后台时，从消息进入的参数通过 EnterOptions 获取
    if (typeof wx.getEnterOptionsSync === 'function') {
      const enter = wx.getEnterOptionsSync();
      if (enter && enter.query) this.handleNotifyOptions(enter.query);
    }
    this.setData({ lateNotice: '' });
    this.loadRole();
  },

  /** 记录消息带来的计划时刻，等今日数据加载完再弹确认 */
  handleNotifyOptions(options) {
    if (!options || String(options.notify) !== '1') return;
    const day = String(options.date || '');
    const time = String(options.time || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return;

    const key = day + '|' + time;
    if (this.notifyHandledKey === key) return;
    this.notifyHandledKey = key;
    this.pendingNotify = { date: day, time: time };
    this.setData({ notifyDate: day, notifyTime: time });
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
      return;
    }

    // 从提醒消息进入但本机没有身份时，先查云端，是长辈就直接进入长辈首页
    if (!current && this.pendingNotify) {
      bind.fetchStatus().then((res) => {
        const profile = res.profile;
        if (profile && profile.role === 'caree' && profile.linkedId) {
          role.setRole('caree');
          this.setData({ userRole: 'caree' });
        }
        this.stopTimer();
        this.loadBindStatus();
      }).catch(() => {
        this.stopTimer();
        this.loadBindStatus();
      });
      return;
    }

    this.stopTimer();
    this.loadBindStatus();
  },

  initApp() {
    this.refresh();
    this.startTimer();
    this.checkDue();
    // 药品增删改后即使没进过提醒页，也把变化同步到云端
    planSync.syncIfChanged();
    this.loadBindStatus();
  },

  /** 读取绑定状态：长辈看自己的通知状态，子女看长辈的通知状态 */
  loadBindStatus() {
    bind.fetchStatus().then((res) => {
      const profile = res.profile;
      const partner = res.partner;
      if (!profile || !profile.linkedId || !partner) {
        // 对方解除或本地缓存过期时，首页状态要跟着回退
        this.setData(Object.assign({
          bound: false,
          bindStatusText: '',
          partnerNotifyState: '',
          partnerPaused: false
        }, emptyToday()));
        this.syncTarget('');
        return;
      }

      if (profile.role === 'caree') {
        this.setData({
          bound: true,
          notifyState: profile.notifyState || '',
          notifyPaused: !!profile.notifyPaused
        });
        this.loadToday();
        return;
      }

      const partnerNotifyState = partner.notifyState || '';
      const partnerPaused = !!partner.notifyPaused;
      let bindStatusText = '已与长辈绑定';
      if (partnerPaused) bindStatusText = '长辈已暂停接收';
      else if (partnerNotifyState !== 'accept') bindStatusText = '长辈未开启微信通知';

      this.setData({
        bound: true,
        partnerNotifyState: partnerNotifyState,
        partnerPaused: partnerPaused,
        bindStatusText: bindStatusText
      });
      this.syncTarget(profile.linkedId || '');
      this.loadToday();
    }).catch(() => {});
  },

  /** 读取今日用药：长辈读自己的，子女读长辈的 */
  loadToday() {
    medLog.fetchToday().then((res) => {
      const patch = decorateToday(res);
      this.setData(patch);
      this.applyCareChart(patch);
      this.maybeShowNotifyModal(patch);
    }).catch(() => {
      this.setData({ careLoaded: true });
    });
  },

  /** 子女首页的 24 小时图改用长辈的真实记录；云端无计划时保留本地视图 */
  applyCareChart(patch) {
    if (!patch.careTotal) return;
    this.setData({
      hours: buildCareHours(patch.careItems),
      todayTotal: patch.careTotal,
      todayDone: patch.careDone,
      todayRemaining: patch.careTotal - patch.careDone,
      allDone: patch.careDone === patch.careTotal
    });
  },

  /** 消息进入后，等今日数据加载完弹确认框 */
  maybeShowNotifyModal(patch) {
    const pending = this.pendingNotify;
    if (!pending || this.data.userRole !== 'caree') return;

    if (pending.date !== localDayKey()) {
      this.pendingNotify = null;
      wx.showToast({ title: '这条提醒已过期', icon: 'none' });
      return;
    }

    const items = (patch.careItems || []).filter((item) => item.time === pending.time);
    const pendingItems = items.filter((item) => !item.taken);
    this.pendingNotify = null;

    if (!items.length) return;
    if (!pendingItems.length) {
      wx.showToast({ title: '这条提醒已经记录过了', icon: 'none' });
      return;
    }

    const content = pendingItems.map((item) => item.medName + ' ' + item.doseText).join('\n')
      + '\n计划时间 ' + pending.time;
    const missed = pendingItems.some((item) => item.missed);

    wx.showModal({
      title: missed ? '漏服提醒' : '该吃药了',
      content: content,
      confirmText: '已吃药',
      cancelText: '稍后',
      success: (res) => {
        if (res.confirm) this.confirmNotify(pendingItems);
      }
    });
  },

  /** 消息弹窗确认：先续订授权，再逐条记录，云端自动判断是否补吃 */
  confirmNotify(items) {
    if (this.data.careConfirming) return;
    this.setData({ careConfirming: 'notify' });

    bind.requestSubscribe().then((states) => {
      return Promise.all(items.map((item) => medLog.confirm(item.planId, item.time).catch(() => null)))
        .then((results) => ({ states: states, results: results }));
    }).then((out) => {
      const results = out.results || [];
      const anyNew = results.some((res) => res && res.ok && !res.duplicate);
      if (anyNew && (out.states.due === 'accept' || out.states.missed === 'accept')) {
        bind.renew(out.states.due, out.states.missed).catch(() => {});
      }
      const ok = results.some((res) => res && res.ok);
      this.setData({ careConfirming: '' });
      this.loadToday();
      wx.showToast({ title: ok ? '已记录' : '记录失败，请重试', icon: 'none' });
    }).catch(() => {
      this.setData({ careConfirming: '' });
      wx.showToast({ title: '记录失败，请稍后重试', icon: 'none' });
    });
  },

  /** 漏服补吃卡：确认后云端把 missed 升级为补吃 */
  onLateTaken(e) {
    const planId = e.currentTarget.dataset.planId;
    const time = e.currentTarget.dataset.time;
    if (!planId || !time || this.data.careConfirming) return;

    this.setData({ careConfirming: planId + '|' + time });

    bind.requestSubscribe().then((states) => {
      return medLog.confirm(planId, time).then((res) => ({ states: states, res: res }));
    }).then((out) => {
      if (!(out.res && out.res.duplicate)
        && (out.states.due === 'accept' || out.states.missed === 'accept')) {
        bind.renew(out.states.due, out.states.missed).catch(() => {});
      }
      this.setData({
        careConfirming: '',
        lateNotice: '已经补吃，下次记得按时服药'
      });
      this.loadToday();
      wx.showToast({ title: '已经补吃', icon: 'none' });
    }).catch((err) => {
      this.setData({ careConfirming: '' });
      wx.showToast({ title: (err && err.message) || '记录失败，请稍后重试', icon: 'none' });
    });
  },

  /** 绑定关系变化后强制重写云端计划，保证 med_plans.targetId 是最新的 */
  syncTarget(targetId) {
    const next = targetId || '';
    if (storage.getSettings().boundTargetId === next) return;
    storage.setSettings({ boundTargetId: next });
    planSync.syncIfChanged(true);
  },

  /** 长辈端彻底解除绑定：双方关系解除，需重新邀请才能恢复 */
  onCareeUnbind() {
    wx.showModal({
      title: '解除绑定',
      content: '解除后您和家人都会回到未绑定状态，需要重新邀请才能恢复。确定要解除吗？',
      confirmText: '解除',
      confirmColor: '#C62828',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '正在处理', mask: true });
        bind.unbind().then(() => {
          wx.hideLoading();
          this.setData(Object.assign({
            bound: false,
            typedCode: '',
            bindError: ''
          }, emptyToday()));
          wx.showToast({ title: '已停止接收提醒', icon: 'none' });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' });
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
    bind.requestSubscribe().then((states) => this.doBind(code, states));
  },

  doBind(code, states) {
    const notifyState = states.due;
    bind.acceptInvite(code, states.due, states.missed).then(() => {
      role.setRole('caree');
      this.setData({
        binding: false,
        bound: true,
        typedCode: '',
        notifyPaused: false,
        notifyState: notifyState || ''
      });
      this.loadToday();
      wx.showToast({
        title: notifyState === 'accept' ? '已开启家人的提醒' : '已绑定，但通知未开启',
        icon: 'none'
      });
    }).catch((err) => {
      this.setData({
        binding: false,
        bindError: (err && err.message) || '绑定失败，请核对邀请码'
      });
    });
  },

  /** 未授权时重新请求，成功后写回云端 */
  onEnableNotify() {
    if (this.data.binding) return;
    this.setData({ binding: true });
    bind.requestSubscribe().then((states) => {
      bind.resume(states.due, states.missed).then(() => {
        this.setData({ binding: false, notifyState: states.due || '' });
        wx.showToast({
          title: states.due === 'accept' ? '已开启微信通知' : '仍未开启，请检查微信设置',
          icon: 'none'
        });
      }).catch(() => {
        this.setData({ binding: false });
        wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' });
      });
    });
  },

  /** 暂停接收：保留绑定，只停掉推送给自己的提醒 */
  onPause() {
    wx.showModal({
      title: '暂停接收提醒',
      content: '暂停后家人设置的提醒不会再推送给您，随时可以在本页恢复。',
      confirmText: '暂停',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '正在处理', mask: true });
        bind.pause().then(() => {
          wx.hideLoading();
          this.setData({ notifyPaused: true });
          wx.showToast({ title: '已暂停接收', icon: 'none' });
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '操作失败，请稍后重试', icon: 'none' });
        });
      }
    });
  },

  /** 恢复接收：重新申请微信通知授权，再恢复推送 */
  onResume() {
    if (this.data.binding) return;
    this.setData({ binding: true });
    bind.requestSubscribe().then((states) => {
      bind.resume(states.due, states.missed).then(() => {
        this.setData({ binding: false, notifyPaused: false, notifyState: states.due || '' });
        this.loadToday();
        wx.showToast({
          title: states.due === 'accept' ? '已恢复接收' : '已恢复，但通知未开启',
          icon: 'none'
        });
      }).catch(() => {
        this.setData({ binding: false });
        wx.showToast({ title: '恢复失败，请稍后重试', icon: 'none' });
      });
    });
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
    this.timer = setInterval(() => {
      this.checkDue();
      // 子女端每 2 分钟同步一次长辈的服药记录，及时更新 24 小时图
      this.careTick = (this.careTick || 0) + 1;
      if (this.data.userRole === 'caregiver' && this.data.bound && this.careTick % 4 === 0) {
        this.loadToday();
      }
    }, 30000);
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
  },

  /** 隐私说明：未选身份时也能查看 */
  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  }
});
