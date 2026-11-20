/**
 * 云开发配置
 * 在微信开发者工具「云开发」中创建环境后，把环境 ID 填入 CLOUD_ENV
 * 留空时小程序仍可正常使用，只是不会同步提醒计划、不会收到微信推送
 */
module.exports = {
  // 当前小程序版本号，展示在设置页底部
  VERSION: '2.0.0',

  CLOUD_ENV: 'cloud1-d6g89v5us18443dd8',

  // 订阅消息模板「用药提醒」（正常提醒，发给父母）
  // 关键词字段：thing5 药品名称 / time1 服药时间 / short_thing7 剂量说明
  TEMPLATE_ID: 'CTeOMRptscUEp21jFiUKz3drmBP9YxioGNdgAKlTX-I',

  // 订阅消息模板「服药超时提醒」（漏服后发给父母，与用药提醒是两个独立额度池）
  // 已在微信后台创建：标题「服药超时提醒」，关键词 药品、时间、状态、温馨提示
  // 对应字段：thing1 药品 / time2 时间 / phrase3 状态 / thing7 温馨提示
  MISSED_TEMPLATE_ID: 'gviur2jv-JkL1aDRbsh92U1Su1IMnK9dzti_FIxoxsE',

  // 强力模式灰度：false 时页面置灰，存量强力计划按标准处理
  STRONG_ENABLED: false,

  // 正式发布必须为 formal；体验版调试可临时改为 developer
  MINIPROGRAM_STATE: 'formal',

  // 云数据库集合名
  PLAN_COLLECTION: 'reminder_plans'
};
