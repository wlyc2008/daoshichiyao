const storage = require('../../utils/storage');
const fileManager = require('../../utils/fileManager');

const TYPES = [
  { value: 'discharge', label: '出院小结' },
  { value: 'prescription', label: '处方' }
];

// 旧数据兼容：已下线的单据类型仍按原名称显示
const LEGACY_TYPE_LABELS = { medlist: '带药清单', followup: '复诊安排' };

function typeLabel(value) {
  for (let i = 0; i < TYPES.length; i++) {
    if (TYPES[i].value === value) return TYPES[i].label;
  }
  return LEGACY_TYPE_LABELS[value] || '其他';
}

Page({
  data: {
    types: TYPES,
    type: 'discharge',
    title: '',
    needFollowup: false,
    followupDate: '',
    photoPath: '',
    docs: []
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const docs = storage.getDocs().slice().sort((a, b) => b.createdAt - a.createdAt)
      .map((doc) => Object.assign({}, doc, { typeLabel: typeLabel(doc.type) }));
    this.setData({ docs: docs });
  },

  onTypeTap(event) {
    this.setData({ type: event.currentTarget.dataset.value });
  },

  onTitleInput(event) {
    this.setData({ title: event.detail.value });
  },

  onFollowupTap(event) {
    const need = event.currentTarget.dataset.value === 'yes';
    this.setData({ needFollowup: need, followupDate: need ? this.data.followupDate : '' });
  },

  onDateChange(event) {
    this.setData({ followupDate: event.detail.value });
  },

  takePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['original'],
      success: (res) => {
        const file = (res.tempFiles || [])[0];
        if (!file) return;
        const previous = this.data.photoPath;
        fileManager.savePhoto(file.tempFilePath).then((savedPath) => {
          this.setData({ photoPath: savedPath });
          // 重拍时删掉上一张，避免留下无人引用的本地文件
          if (previous && previous !== savedPath) fileManager.removePhoto(previous);
          wx.showToast({ title: '已保存', icon: 'none' });
        }).catch(() => {
          wx.showToast({ title: '照片保存失败', icon: 'none' });
        });
      }
    });
  },

  previewPhoto(event) {
    const url = event.currentTarget.dataset.path || this.data.photoPath;
    if (url) wx.previewImage({ urls: [url] });
  },

  save() {
    if (!this.data.photoPath) {
      wx.showToast({ title: '请先拍下单据', icon: 'none' });
      return;
    }

    if (this.data.needFollowup && !this.data.followupDate) {
      wx.showToast({ title: '请选择复诊日期', icon: 'none' });
      return;
    }

    storage.addDoc({
      type: this.data.type,
      title: this.data.title,
      needFollowup: this.data.needFollowup,
      followupDate: this.data.needFollowup ? this.data.followupDate : '',
      photoPath: this.data.photoPath
    });

    this.setData({ title: '', needFollowup: false, followupDate: '', photoPath: '' });
    this.refresh();
    wx.showToast({ title: '已存档', icon: 'success' });
  },

  removeDoc(event) {
    const docId = event.currentTarget.dataset.id;
    wx.showModal({
      title: '删除这张单据？',
      content: '删除后照片也会从手机里清除',
      success: (res) => {
        if (!res.confirm) return;
        storage.deleteDoc(docId);
        this.refresh();
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  }
});
