Component({
  properties: {
    visible: { type: Boolean, value: false },
    name: { type: String, value: '' },
    dose: { type: Number, value: 1 },
    unit: { type: String, value: '片' },
    timeText: { type: String, value: '' }
  },

  methods: {
    onConfirm() {
      this.triggerEvent('confirm');
    },
    onSnooze() {
      this.triggerEvent('snooze');
    }
  }
});
