/**
 * 库存计算
 * 规则：每日消耗片数 = 单次片数 × 每日服用次数
 * before / after 默认对应三餐各一次，其余规则默认每日一次
 */
const TIMES_PER_DAY = {
  before: 3,
  after: 3,
  anytime: 1,
  wake: 1,
  nap: 1,
  bedtime: 1,
  morning: 1,
  noon: 1,
  evening: 1
};

/** 优先使用药品上的一日次数，老数据按服用规则推算；自选模式最多 5 次 */
function timesPerDay(med) {
  const explicit = parseInt(med && med.times, 10);
  if (!isNaN(explicit) && explicit > 0) return Math.min(5, explicit);
  return TIMES_PER_DAY[(med && med.rule) || 'after'] || 1;
}

/** 每日消耗片数 */
function calcDailyDose(med, mealTimes) {
  const dose = Math.max(0, Number(med && med.dose) || 0);
  return dose * timesPerDay(med);
}

/**
 * 计算可支撑天数
 * @returns {{daysLeft:number, needRefill:boolean, dailyDose:number, remainingPills:number}}
 * daysLeft 保留一位小数；dailyDose 为 0 时返回 Infinity 且不告警
 */
function calcStock(remainingPills, dailyDose) {
  const remain = Math.max(0, Number(remainingPills) || 0);
  const perDay = Math.max(0, Number(dailyDose) || 0);

  if (perDay <= 0) {
    return { daysLeft: Infinity, needRefill: false, dailyDose: perDay, remainingPills: remain };
  }

  const daysLeft = Math.floor((remain / perDay) * 10) / 10;
  return { daysLeft: daysLeft, needRefill: daysLeft < 1, dailyDose: perDay, remainingPills: remain };
}

/** 直接对药品对象计算库存状态 */
function calcMedStock(med) {
  return calcStock(med && med.remainingPills, calcDailyDose(med));
}

module.exports = {
  timesPerDay,
  calcDailyDose,
  calcStock,
  calcMedStock
};
