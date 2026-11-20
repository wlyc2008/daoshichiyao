const cloud = require('./utils/cloud');
const storage = require('./utils/storage');
const config = require('./utils/config');

/** 强力模式灰度期间，把本机存量强力计划降级为标准 */
function migrateStrong() {
  if (config.STRONG_ENABLED) return;
  try {
    storage.getMeds({ includeInactive: true }).forEach((med) => {
      if (med && med.intensity === 'strong') {
        storage.updateMed(med.id, { intensity: 'standard' });
      }
    });
  } catch (err) {
    // 迁移失败不影响启动，编辑保存时还会再归一化一次
  }
}

App({
  onLaunch() {
    // 未配置云环境时自动跳过，不影响本地功能
    cloud.init();
    migrateStrong();
  },
  globalData: {}
});
