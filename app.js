const cloud = require('./utils/cloud');

App({
  onLaunch() {
    // 未配置云环境时自动跳过，不影响本地功能
    cloud.init();
  },
  globalData: {}
});
