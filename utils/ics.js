/**
 * 日历兜底：生成标准 .ics 文件，由子女转发给长辈导入手机日历
 * 说明：小程序被关闭后无法定时提醒，系统日历是唯一可靠的到点响铃手段
 * 采用「本地浮动时间」，由手机日历按所在时区解释，不做 UTC 转换
 */
const date = require('./date');
const reminder = require('./reminder');

/** ICS 文本转义，遵循 RFC 5545 */
function escapeText(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function utf8Length(text) {
  let length = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code < 0x10000) length += 3;
    else length += 4;
  }
  return length;
}

/** 按 75 字节折行，续行以单个空格开头 */
function foldLine(line) {
  const text = String(line);
  if (utf8Length(text) <= 73) return text;

  let out = '';
  let chunk = '';
  for (const ch of text) {
    if (utf8Length(chunk + ch) > 73) {
      out += chunk + '\r\n ';
      chunk = ch;
    } else {
      chunk += ch;
    }
  }
  return out + chunk;
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

/** "YYYY-MM-DD HH:mm" -> "YYYYMMDDTHHmm00"（本地浮动时间） */
function toIcsLocal(timeKey) {
  const parsed = date.parseKey(timeKey);
  if (!parsed) return '';
  return String(parsed.getFullYear())
    + pad2(parsed.getMonth() + 1)
    + pad2(parsed.getDate())
    + 'T'
    + pad2(parsed.getHours())
    + pad2(parsed.getMinutes())
    + '00';
}

/** 生成 UTC 时间戳，用于 DTSTAMP */
function toIcsStamp(moment) {
  return String(moment.getUTCFullYear())
    + pad2(moment.getUTCMonth() + 1)
    + pad2(moment.getUTCDate())
    + 'T'
    + pad2(moment.getUTCHours())
    + pad2(moment.getUTCMinutes())
    + pad2(moment.getUTCSeconds())
    + 'Z';
}

/**
 * 生成完整日历文本
 * @param {Array} meds 药品列表
 * @param {Object} mealTimes 三餐时间
 * @returns {string} CRLF 分隔的 .ics 文本
 */
function buildIcs(meds, mealTimes, now) {
  const current = now instanceof Date ? now : new Date();
  const day = date.formatDate(current);
  const active = (meds || []).filter((med) => med && med.isActive !== false);
  const schedule = reminder.buildSchedule(active, mealTimes, current);
  const stamp = toIcsStamp(current);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DaoShiChiYao//Medication Reminder//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText('到时吃药·用药提醒')
  ];

  schedule.forEach((item, index) => {
    const summary = '服药：' + item.name + ' ' + item.dose + (item.unit || '片');
    const endTime = day + ' ' + date.addMinutes(item.time, 15);
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + item.medId + '-' + index + '@daoshichiyao');
    lines.push('DTSTAMP:' + stamp);
    lines.push('DTSTART:' + toIcsLocal(item.plannedTime));
    lines.push('DTEND:' + toIcsLocal(endTime));
    lines.push('SUMMARY:' + escapeText(summary));
    lines.push('DESCRIPTION:' + escapeText('到时吃药本地提醒，请按时服药'));
    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:OPAQUE');
    lines.push('RRULE:FREQ=DAILY');
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:PT0M');
    lines.push('ACTION:DISPLAY');
    lines.push('DESCRIPTION:' + escapeText(summary));
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** 当前提醒计划的指纹，用于判断导出后时间是否发生变化 */
function buildSignature(meds, mealTimes) {
  return reminder.buildSchedule(meds || [], mealTimes, new Date())
    .map((item) => [item.medId, item.name, item.time, item.dose, item.unit || '片'].join(','))
    .join('|');
}

/** 把 ICS 写成文件，便于转发给长辈后用日历应用打开 */
function saveIcsFile(text, fileName) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager();
    const name = fileName || 'med-reminder.ics';
    const filePath = wx.env.USER_DATA_PATH + '/' + name;
    fs.writeFile({
      filePath: filePath,
      data: String(text || ''),
      encoding: 'utf8',
      success: () => resolve(filePath),
      fail: (err) => reject(err)
    });
  });
}

module.exports = {
  buildIcs,
  buildSignature,
  saveIcsFile,
  escapeText
};
