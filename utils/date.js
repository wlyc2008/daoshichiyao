/**
 * 时间工具：统一使用本地时间字符串 "YYYY-MM-DD HH:mm"
 * 不引入第三方日期库，避免小程序包体积膨胀
 */

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

/** 格式化为 HH:mm */
function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 格式化为 YYYY-MM-DD */
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 格式化为 YYYY-MM-DD HH:mm，作为日志与计划的统一时间键 */
function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return formatDate(d) + ' ' + formatTime(d);
}

/** 时间键别名，便于调用方语义化使用 */
function toKey(date) {
  return formatDateTime(date);
}

/**
 * 解析 "YYYY-MM-DD HH:mm" 或 "YYYY-MM-DD"
 * 解析失败返回 null，调用方需判空
 */
function parseKey(key) {
  if (key instanceof Date) return new Date(key.getTime());
  const matched = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(key || ''));
  if (!matched) return null;
  return new Date(
    Number(matched[1]),
    Number(matched[2]) - 1,
    Number(matched[3]),
    Number(matched[4] || 0),
    Number(matched[5] || 0),
    0,
    0
  );
}

/**
 * 在 "HH:mm" 上加减分钟，跨天时按 24 小时循环
 * 例：addMinutes('08:00', -30) => '07:30'
 */
function addMinutes(time, minutes) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!matched) return String(time || '');
  const total = Number(matched[1]) * 60 + Number(matched[2]) + Number(minutes || 0);
  const normalized = ((total % 1440) + 1440) % 1440;
  return pad(Math.floor(normalized / 60)) + ':' + pad(normalized % 60);
}

/** 判断两个时间是否同一天，支持 Date 与时间键字符串 */
function isSameDay(a, b) {
  const left = a instanceof Date ? a : parseKey(a);
  const right = b instanceof Date ? b : parseKey(b);
  if (!left || !right) return false;
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

/** 取当天 00:00 */
function startOfDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** 在日期上加减天数，返回新的 Date */
function addDays(date, days) {
  const d = date instanceof Date ? date : new Date(date);
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

/** 把 "HH:mm" 转成当天第几分钟，非法输入返回 0 */
function minutesOfDay(time) {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!matched) return 0;
  return Number(matched[1]) * 60 + Number(matched[2]);
}

module.exports = {
  pad,
  formatTime,
  formatDate,
  formatDateTime,
  toKey,
  parseKey,
  addMinutes,
  isSameDay,
  startOfDay,
  addDays,
  minutesOfDay
};
