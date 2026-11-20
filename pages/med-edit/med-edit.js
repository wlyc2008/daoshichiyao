const storage = require('../../utils/storage');
const fileManager = require('../../utils/fileManager');
const medSchedule = require('../../utils/medSchedule');

const UNIT_LIST = ['片', '支', '毫升'];

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function decorate(options, selected) {
  return options.map((item) => Object.assign({}, item, {
    active: selected.indexOf(item.value) >= 0
  }));
}

function sortByOptions(values, options) {
  return values.slice().sort((a, b) => {
    const ai = options.map((o) => o.value).indexOf(a);
    const bi = options.map((o) => o.value).indexOf(b);
    return ai - bi;
  });
}

/** 24 格：1–24 点，24 代表次日 0 点 */
function hourTime(hour) {
  return hour === 24 ? '00:00' : pad(hour) + ':00';
}

function hourOf(time) {
  const value = Number(String(time).slice(0, 2));
  return value === 0 ? 24 : value;
}

function buildHourCells(times) {
  const cells = [];
  for (let hour = 1; hour <= 24; hour += 1) {
    cells.push({
      hour: hour,
      selected: times.some((time) => hourOf(time) === hour)
    });
  }
  return cells;
}

/** 统一补齐分钟、去重并按时间排序，保证界面与保存结果一致 */
function normalizeCustomTimes(times) {
  const list = [];
  (times || []).forEach((raw) => {
    const value = medSchedule.normalizeTime(raw);
    if (value && list.indexOf(value) === -1) list.push(value);
  });
  list.sort((a, b) => a.localeCompare(b));
  return list.slice(0, medSchedule.MAX_CUSTOM_TIMES);
}

Page({
  data: {
    id: '',
    isEdit: false,
    name: '',
    dose: '1',
    unitOptions: UNIT_LIST,
    unitIndex: 0,

    modes: medSchedule.MODES,
    mode: 'meal',
    mealOptions: decorate(medSchedule.MEAL_OPTIONS, []),
    meals: [],
    offsetOptions: decorate(medSchedule.OFFSET_OPTIONS, ['after']),
    mealOffset: 'after',
    routineOptions: decorate(medSchedule.ROUTINE_OPTIONS, []),
    routines: [],
    intervalOptions: decorate(medSchedule.INTERVAL_OPTIONS, [8]),
    intervalHours: 8,
    intervalStart: '08:00',
    customHours: buildHourCells([]),
    customTimes: [],
    previewText: '请至少选择一个服药时间',

    remainingPills: '',
    photoPath: '',
    saving: false
  },

  onLoad(options) {
    const id = options && options.id ? options.id : '';
    if (!id) {
      this.updatePreview();
      return;
    }

    const med = storage.getMedById(id);
    if (!med) {
      this.updatePreview();
      return;
    }

    const unitIndex = Math.max(0, UNIT_LIST.indexOf(med.unit || '片'));
    const schedule = medSchedule.fromLegacy(med, storage.getMealTimes(), storage.getRoutineTimes());

    this.setData({
      id: id,
      isEdit: true,
      name: med.name,
      dose: String(med.dose || 1),
      unitIndex: unitIndex,
      remainingPills: med.remainingPills === undefined ? '' : String(med.remainingPills),
      photoPath: med.photoPath || ''
    });
    this.applySchedule(schedule);
    wx.setNavigationBarTitle({ title: '编辑药品' });
  },

  /** 把模式配置写回页面，并同步预览 */
  applySchedule(schedule) {
    this.setData({
      mode: schedule.mode,
      meals: schedule.meals,
      mealOptions: decorate(medSchedule.MEAL_OPTIONS, schedule.meals),
      mealOffset: schedule.mealOffset,
      offsetOptions: decorate(medSchedule.OFFSET_OPTIONS, [schedule.mealOffset]),
      routines: schedule.routines,
      routineOptions: decorate(medSchedule.ROUTINE_OPTIONS, schedule.routines),
      intervalHours: schedule.intervalHours,
      intervalStart: schedule.intervalStart,
      intervalOptions: decorate(medSchedule.INTERVAL_OPTIONS, [schedule.intervalHours]),
      customTimes: schedule.customTimes,
      customHours: buildHourCells(schedule.customTimes)
    }, () => this.updatePreview());
  },

  collectSchedule() {
    return {
      mode: this.data.mode,
      meals: this.data.meals,
      mealOffset: this.data.mealOffset,
      routines: this.data.routines,
      intervalHours: this.data.intervalHours,
      intervalStart: this.data.intervalStart,
      customTimes: normalizeCustomTimes(this.data.customTimes)
    };
  },

  updatePreview() {
    const times = medSchedule.timesOf(
      this.collectSchedule(),
      storage.getMealTimes(),
      storage.getRoutineTimes()
    );
    this.setData({
      previewText: times.length
        ? '每天 ' + times.length + ' 次：' + times.join(' / ')
        : '请至少选择一个服药时间'
    });
  },

  onNameInput(event) {
    this.setData({ name: event.detail.value });
  },

  onDoseInput(event) {
    this.setData({ dose: event.detail.value });
  },

  onUnitTap(event) {
    this.setData({ unitIndex: Number(event.currentTarget.dataset.index) });
  },

  onStockInput(event) {
    this.setData({ remainingPills: event.detail.value });
  },

  onModeTap(event) {
    this.setData({ mode: event.currentTarget.dataset.mode }, () => this.updatePreview());
  },

  onMealTap(event) {
    const value = event.currentTarget.dataset.value;
    const meals = this.data.meals.slice();
    const index = meals.indexOf(value);
    if (index >= 0) meals.splice(index, 1);
    else meals.push(value);
    const sorted = sortByOptions(meals, medSchedule.MEAL_OPTIONS);

    this.setData({
      meals: sorted,
      mealOptions: decorate(medSchedule.MEAL_OPTIONS, sorted)
    }, () => this.updatePreview());
  },

  onOffsetTap(event) {
    const value = event.currentTarget.dataset.value;
    this.setData({
      mealOffset: value,
      offsetOptions: decorate(medSchedule.OFFSET_OPTIONS, [value])
    }, () => this.updatePreview());
  },

  onRoutineTap(event) {
    const value = event.currentTarget.dataset.value;
    const routines = this.data.routines.slice();
    const index = routines.indexOf(value);
    if (index >= 0) routines.splice(index, 1);
    else routines.push(value);
    const sorted = sortByOptions(routines, medSchedule.ROUTINE_OPTIONS);

    this.setData({
      routines: sorted,
      routineOptions: decorate(medSchedule.ROUTINE_OPTIONS, sorted)
    }, () => this.updatePreview());
  },

  onIntervalTap(event) {
    const value = Number(event.currentTarget.dataset.value) === 12 ? 12 : 8;
    this.setData({
      intervalHours: value,
      intervalOptions: decorate(medSchedule.INTERVAL_OPTIONS, [value])
    }, () => this.updatePreview());
  },

  onIntervalStartChange(event) {
    const value = medSchedule.normalizeTime(event.detail.value);
    if (!value) return;
    this.setData({ intervalStart: value }, () => this.updatePreview());
  },

  onHourTap(event) {
    const hour = Number(event.currentTarget.dataset.hour);
    const exists = this.data.customTimes.some((time) => hourOf(time) === hour);
    let times;

    if (exists) {
      times = this.data.customTimes.filter((time) => hourOf(time) !== hour);
    } else {
      if (this.data.customTimes.length >= medSchedule.MAX_CUSTOM_TIMES) {
        wx.showToast({ title: '最多选 ' + medSchedule.MAX_CUSTOM_TIMES + ' 个时间', icon: 'none' });
        return;
      }
      times = this.data.customTimes.concat([hourTime(hour)]);
    }

    times = normalizeCustomTimes(times);
    this.setData({
      customTimes: times,
      customHours: buildHourCells(times)
    }, () => this.updatePreview());
  },

  onCustomTimeChange(event) {
    // 用旧的时刻值定位，避免列表排序后下标错位
    const oldTime = event.currentTarget.dataset.time;
    const index = this.data.customTimes.indexOf(oldTime);
    if (index < 0) return;

    const value = medSchedule.normalizeTime(event.detail.value);
    if (!value || value === oldTime) return;

    const others = this.data.customTimes.filter((time) => time !== oldTime);
    if (others.indexOf(value) >= 0) {
      wx.showToast({ title: '该时间已存在', icon: 'none' });
      return;
    }
    if (others.some((time) => hourOf(time) === hourOf(value))) {
      wx.showToast({ title: '同一小时只能有一个时间', icon: 'none' });
      return;
    }

    const times = normalizeCustomTimes(others.concat([value]));
    this.setData({
      customTimes: times,
      customHours: buildHourCells(times)
    }, () => this.updatePreview());
  },

  removeCustomTime(event) {
    const time = event.currentTarget.dataset.time;
    const times = normalizeCustomTimes(this.data.customTimes.filter((item) => item !== time));
    this.setData({
      customTimes: times,
      customHours: buildHourCells(times)
    }, () => this.updatePreview());
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

        fileManager.savePhoto(file.tempFilePath).then((savedPath) => {
          const oldPath = this.data.photoPath;
          this.setData({ photoPath: savedPath });
          if (oldPath && oldPath !== savedPath) fileManager.removePhoto(oldPath);
          wx.showToast({ title: '已保存', icon: 'none' });
        }).catch(() => {
          wx.showToast({ title: '照片保存失败', icon: 'none' });
        });
      }
    });
  },

  previewPhoto() {
    if (!this.data.photoPath) return;
    wx.previewImage({ urls: [this.data.photoPath] });
  },

  save() {
    if (this.data.saving) return;

    const name = String(this.data.name || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写药名', icon: 'none' });
      return;
    }

    const dose = parseInt(this.data.dose, 10);
    if (isNaN(dose) || dose <= 0) {
      wx.showToast({ title: '请填写数量', icon: 'none' });
      return;
    }

    const stockValue = parseInt(this.data.remainingPills, 10);
    if (isNaN(stockValue) || stockValue < 0) {
      wx.showToast({ title: '请填写库存数量', icon: 'none' });
      return;
    }

    const schedule = medSchedule.normalizeSchedule(this.collectSchedule());
    const times = medSchedule.timesOf(schedule, storage.getMealTimes(), storage.getRoutineTimes());
    if (!times.length) {
      wx.showToast({ title: '请选择服药时间', icon: 'none' });
      return;
    }

    const payload = {
      name: name,
      dose: dose,
      times: times.length,
      unit: this.data.unitOptions[this.data.unitIndex],
      schedule: schedule,
      remainingPills: stockValue,
      photoPath: this.data.photoPath
    };

    this.setData({ saving: true });
    try {
      if (this.data.isEdit) {
        storage.updateMed(this.data.id, payload);
      } else {
        storage.addMed(payload);
      }
      wx.showToast({ title: this.data.isEdit ? '已保存' : '已添加', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  }
});
