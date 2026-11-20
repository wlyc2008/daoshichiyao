const storage = require('../../utils/storage');
const stock = require('../../utils/stock');
const medSchedule = require('../../utils/medSchedule');

Page({
  data: {
    meds: []
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const meds = storage.getMeds({ includeInactive: true }).map((med) => {
      const state = stock.calcMedStock(med);
      return Object.assign({}, med, {
        ruleText: medSchedule.summaryOf(med),
        times: stock.timesPerDay(med),
        unit: med.unit || '片',
        daysText: state.daysLeft === Infinity ? '未知' : state.daysLeft + ' 天',
        needRefill: state.needRefill,
        statusText: med.isActive === false ? '已停用' : '在服'
      });
    });
    this.setData({ meds: meds });
  },

  goAdd() {
    wx.navigateTo({ url: '/pages/med-edit/med-edit' });
  },

  goEdit(event) {
    wx.navigateTo({ url: '/pages/med-edit/med-edit?id=' + event.currentTarget.dataset.id });
  },

  restock(event) {
    const id = event.currentTarget.dataset.id;
    const med = storage.getMedById(id);
    const unit = (med && med.unit) || '片';
    wx.showModal({
      title: '补充库存',
      editable: true,
      placeholderText: '请输入新买的' + unit + '数',
      success: (res) => {
        if (!res.confirm) return;
        const amount = parseInt(res.content, 10);
        if (isNaN(amount) || amount <= 0) {
          wx.showToast({ title: '请输入正确的数量', icon: 'none' });
          return;
        }
        storage.addStock(id, amount);
        this.refresh();
        wx.showToast({ title: '已补充', icon: 'success' });
      }
    });
  },

  toggleMed(event) {
    const id = event.currentTarget.dataset.id;
    const med = storage.getMedById(id);
    if (!med) return;

    const stopping = med.isActive !== false;
    wx.showModal({
      title: stopping ? '停止服用这种药？' : '恢复服用这种药？',
      content: stopping ? '停止后首页不再显示，历史记录仍会保留。' : '恢复后会重新出现在首页提醒里。',
      success: (res) => {
        if (!res.confirm) return;
        storage.toggleMed(id);
        this.refresh();
        wx.showToast({ title: stopping ? '已停用' : '已恢复', icon: 'none' });
      }
    });
  },

  removeMed(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这种药？',
      content: '删除后历史记录仍会保留，但无法恢复药品信息。',
      success: (res) => {
        if (!res.confirm) return;
        storage.deleteMed(id);
        this.refresh();
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  }
});
