const storage = require('../../utils/storage');
const date = require('../../utils/date');

const DUE_WINDOW = 5 * 60000;

Page({
  data: {
    logs: [],
    hasLogs: false
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const now = new Date();
    const meds = storage.getMeds({ includeInactive: true });
    const nameMap = {};
    meds.forEach((med) => {
      nameMap[med.id] = med.name;
    });

    const all = storage.getLogs();
    const takenSet = {};
    all.forEach((log) => {
      if (log.status === 'taken') takenSet[log.medId + '|' + log.plannedTime] = true;
    });

    const list = all.filter((log) => log.plannedTime)
      .sort((a, b) => {
        if (a.plannedTime === b.plannedTime) return 0;
        return a.plannedTime < b.plannedTime ? 1 : -1;
      })
      .map((log) => {
        const planned = date.parseKey(log.plannedTime);
        const confirmed = takenSet[log.medId + '|' + log.plannedTime];

        let status = log.status;
        let statusText = '已服用';
        let statusClass = 'tag-done';

        if (log.status !== 'taken') {
          const until = date.parseKey(log.snoozeUntil);
          if (until && until.getTime() > now.getTime()) {
            status = 'snoozed';
            statusText = '稍后提醒';
            statusClass = 'tag-pending';
          } else if (!confirmed && planned && now.getTime() - planned.getTime() > DUE_WINDOW) {
            status = 'missed';
            statusText = '漏服';
            statusClass = 'tag-danger';
          } else {
            status = 'snoozed';
            statusText = '稍后提醒';
            statusClass = 'tag-pending';
          }
        }

        return {
          logId: log.logId,
          medId: log.medId,
          name: nameMap[log.medId] || '已删除的药品',
          plannedTime: log.plannedTime,
          confirmedTime: log.confirmedTime,
          status: status,
          statusText: statusText,
          statusClass: statusClass,
          canUndo: false
        };
      });

    for (let i = 0; i < list.length; i++) {
      if (list[i].status === 'taken') {
        list[i].canUndo = true;
        break;
      }
    }

    this.setData({ logs: list, hasLogs: list.length > 0 });
  },

  undo(event) {
    const logId = event.currentTarget.dataset.id;
    wx.showModal({
      title: '撤销这次确认？',
      content: '库存会加回去，这条记录会被删除。',
      success: (res) => {
        if (!res.confirm) return;
        const target = storage.getLogs().filter((log) => log.logId === logId)[0];
        if (!target) return;

        storage.removeLog(logId);
        const med = storage.getMedById(target.medId);
        if (med) storage.addStock(target.medId, med.dose);

        this.refresh();
        wx.showToast({ title: '已撤销', icon: 'none' });
      }
    });
  }
});
