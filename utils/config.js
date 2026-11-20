/**
 * 云开发配置
 * 在微信开发者工具「云开发」中创建环境后，把环境 ID 填入 CLOUD_ENV
 * 留空时小程序仍可正常使用，只是不会同步提醒计划、不会收到微信推送
 */
module.exports = {
  // 当前小程序版本号，展示在设置页底部
  VERSION: '2.0.0',

  CLOUD_ENV: 'cloud1-d6g89v5us18443dd8',

  // 订阅消息模板「用药提醒」：药品 / 服药时间 / 剂量
  TEMPLATE_ID: 'CTeOMRptscUEp21jFiUKz3drmBP9YxioGNdgAKlTX-I',

  // 正式发布必须为 formal；体验版调试可临时改为 developer
  MINIPROGRAM_STATE: 'formal',

  // 云数据库集合名
  PLAN_COLLECTION: 'reminder_plans'
};
