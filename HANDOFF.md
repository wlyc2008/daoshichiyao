# 到时吃药 · 开发交接说明（2026-11-20）

> 用途：在新会话中继续开发时，先读本文件即可恢复上下文。

---

## 1. 现状一句话

V1.0 已上线（单机版，面向能自己操作手机的用户）；V2.0 正在把产品转型为**「子女远程设置 + 长辈极简接收」**的关怀模式，已完成**身份识别**、**亲情绑定**、**Phase 3 计划上云 + 按 targetId 推送**、**Phase 4 服药确认**、**Phase 5 漏服看护/历史记录**、**Phase 6 完成率周报**、**Phase 8 上线准备**，以及**提醒消息弹窗确认 + 漏服补吃**、**强力模式灰度**。云端备份已按需求移除，剩余为后台配置与真机验收。

---

## 2. Git 状态

| 项 | 内容 |
| :-- | :-- |
| 当前分支 | `v2.0` |
| 1.0 基线 | `ef92c92`，tag `v1.0.0`，分支 `master` |
| 1.0 物理快照 | `c:\Users\Administrator\Documents\Trae-CN\wx-v1.0-frozen`（独立可运行，勿改动） |
| 最近提交 | 以 `git log --oneline -5` 为准 |
| 远程仓库 | `origin` → https://github.com/wlyc2008/daoshichiyao（公开） |
| 未提交 | 以 `git status` 为准 |

常用命令：

```bash
git checkout v1.0.0     # 回看 1.0
git checkout v2.0       # 回到 2.0
git diff v1.0.0 v2.0
```

---

## 3. 产品原则

- **复杂留给子女（管理者），极简留给长辈（执行者）**
- 身份选定后**不可切换**（无切换入口，避免混淆）
- 长辈端全流程只有：输码 → 点一下 → 看一句提示
- 状态只有两态加一个暂停：`未绑定 / 已绑定（接收中） / 已暂停`

---

## 4. 已完成能力

### V1.0（线上）
- 四种服药模式（餐后/作息/间隔/自定义时间），统一由 `utils/medSchedule.js` 推导
- 双通道提醒：把 `.ics` 日历文件转发给长辈导入系统日历 + 微信订阅消息（`sendDue` 云函数 + 定时触发器）
- 本地数据：药品、用药记录、医疗档案、设置（`utils/storage.js`）
- 计划同步：`utils/planSync.js` 用签名比对，仅变化时上云

### V2.0 已完成
1. **身份识别**：`utils/role.js` + 云函数 `userProfile`，写入 `users` 集合
2. **亲情绑定**：
   - 子女生成 6 位邀请码（7 天有效，去除易混字符）
   - 长辈可点分享卡片，也可在首页直接输码
   - 绑定双向写入 `linkedId`
   - 支持解绑（双方同时清空，旧码作废）
3. **通知授权状态**：读取 `wx.requestSubscribeMessage` 返回值 → `accept/reject/ban/filter` 落库 → 两端都能看到
4. **暂停/恢复接收**：保留绑定只停推送，`notifyPaused` 字段
5. **防死循环**：`bindUser.peek` 提前校验，子女点「查看分享页」直接进静态说明页
6. **药品计划上云（Phase 3）**：
   - 药品编辑页新增「提醒强度」：柔和 / 标准 / 强力
   - `utils/planSync.js` 用 `medPlanSignature` 判断变化，只有改动时才调 `syncMedPlans` 写 `med_plans`
   - 药品保存、补货、停用、删除后立即触发同步，不必等回到首页
   - 绑定/解绑后首页强制重写计划，保证 `med_plans.targetId` 最新
   - `sendDue` 保留 V1 逻辑，并行按 targetId 推给长辈：跳过暂停、解绑、额度耗尽
   - 长辈授权额度落在 `users.quota`：`accept` / `resume` / `renew` +1，发送成功 -1
7. **服药确认（Phase 4）**：
   - 云函数 `medLog`：`today` 按角色返回今日用药，`confirm` 写 `med_logs` 并扣减云端库存
   - 长辈首页「今天的用药」只展示状态：待服 / 已完成 / 漏服 / 已补吃，不再放确认按钮
   - 子女首页「长辈今天」模块已于 2026-11-20 移除
   - 同一时刻重复确认幂等；暂停接收时长辈端不展示清单
8. **漏服看护与历史（Phase 5，2026-11-21 调整）**：
   - `sendDue` 每 5 分钟边界扫描 `intensity` 为 `standard` 或 `strong` 的计划，计划后 30~35 分钟未确认则写 `med_logs.status = 'missed'`；`gentle` 不判定
   - 同一长辈同一时刻多种药合并，漏服通知**发给父母**，消耗 `users.missedQuota`；关系失效或暂停时不误报
   - 漏服提醒使用独立模板「服药超时提醒」（`thing1` 药品 / `time2` 时间 / `phrase3` 状态 / `thing7` 温馨提示）
   - 子女端首页 24 小时图：红色「超时未服」、黄色「补吃」
   - 长辈补吃：`medLog.confirm` 把已有 `missed` 原地升级为 `taken + late`，不新增记录；历史显示「补吃」
9. **完成率周报（Phase 6）**：
   - `medLog.stats` 统计最近 7 天应服 / 已服 / 漏服与逐日完成率
   - 新页面 `pages/care-stats`：大号完成率 + 三项汇总 + 每天条形趋势
   - 子女首页「长辈今天」底部曾有本周统计 / 查看历史记录入口（随模块移除，页面保留）
10. **云端备份（Phase 7，已移除）**：
   - 2026-11-21 起删除 `backupData`、`utils/backup.js`、`pages/restore`
   - 设置页只保留「导出数据到剪贴板」；身份选择页不再提供换机恢复
11. **上线准备（Phase 8）**：
   - 版本号更新为 `2.0.0`，`MINIPROGRAM_STATE` 两端均为 `formal`
   - 合规文案扫描：无 OCR/识别/用药建议类表述
   - 新增 `pages/privacy/privacy` 隐私说明，设置页与身份选择页均可进入
   - 发布前人工清单见 `MASTER_PLAN.md` 12.13
12. **日历文件改为发给长辈**：
   - 「设置日历提醒」不再导入到子女手机，改为生成 `.ics` 并转发给父母
   - 页面内置导入步骤与「复制导入步骤发给父母」，取消说明也改为父母手机操作
   - 「调整三餐时间 / 调整起居时间」统一改名为「调整父母三餐时间 / 调整父母起居时间」
13. **微信提醒只发给父母**：
   - 子女端「微信提醒」页取消订阅与 V1 计划写入，「开启微信提醒」改为强制提交当前计划到云端
   - 未绑定父母时引导去亲情提醒页；父母未授权时提示让父母点「重新开启」
   - 子女首页 24 小时服药图改用长辈云端记录，过点未服标红，补吃标黄，每 2 分钟同步一次
14. **消息弹窗确认与漏服补吃（2026-11-21）**：
   - 正常提醒与漏服提醒的 `page` 都带 `notify=1&date=...&time=...`
   - 父母点消息打开小程序后弹窗列出该时刻药品，点「已吃药」一次记录全部
   - 冷启动、后台唤醒、换机后无身份都能进入长辈模式并弹窗
   - 当天有漏服时首页出现「漏服补吃」卡片，已有消息弹窗时不强制使用
   - 授权正常 + 漏服两个模板后，确认一次同时续订两个额度
15. **强力模式灰度**：
   - 柔和 / 标准 / 强力三档保留，强力选项置灰标注「即将开放」
   - `utils/config.js` 的 `STRONG_ENABLED = false`；存量强力计划在启动时降级为标准
   - 标准强度已参与漏服判定，补吃功能当前即可用

---

## 5. 关键文件

| 文件 | 职责 |
| :-- | :-- |
| `pages/index/index.js` | 首页：身份选择、长辈状态/消息弹窗确认/补吃卡、子女状态条与 24 小时图 |
| `pages/bind/bind.js` | 分享卡片落地页：peek → ready / self / done / error |
| `pages/settings/settings.js` | 设置页：亲情提醒入口、用药与提醒、健康档案、数据与云服务、关于、危险操作 |
| `pages/family/family.js` | 亲情提醒：绑定状态、分享邀请、邀请码复制、解除绑定 |
| `pages/care-history/care-history.js` | 子女端执行记录：按日期查看已吃药 / 漏服 / 补吃 |
| `pages/care-stats/care-stats.js` | 子女端本周统计：完成率、应服/已服/漏服、每天趋势 |
| `pages/privacy/privacy.js` | 隐私说明：收集范围、照片、云端数据、订阅消息与医疗声明 |
| `utils/bind.js` | 绑定接口封装：`requestSubscribe / createInvite / peek / acceptInvite / pause / resume / renew / unbind / fetchStatus` |
| `utils/role.js` | 身份读写（本地 + 云端登记） |
| `utils/cloud.js` | 云开发封装，含通用 `callFunction` |
| `utils/planSync.js` | 计划上云：V2 `med_plans` 双指纹同步 |
| `utils/medLog.js` | 今日用药读取、历史记录与「已吃药」确认封装 |
| `cloudfunctions/bindUser/index.js` | `create / peek / accept / status / pause / resume / renew / grant / unbind`，维护 `quota` 与 `missedQuota` |
| `cloudfunctions/syncMedPlans/index.js` | 按 `ownerId + medId` upsert `med_plans`，删除本地已移除的计划 |
| `cloudfunctions/sendDue/index.js` | 定时推送：`med_plans` 按 targetId 推给长辈；标准+强力漏服 Watchdog，漏服通知发父母 |
| `cloudfunctions/medLog/index.js` | `today` 今日用药与库存/复诊提示、`confirm` 写记录或升级补吃、`history` 历史、`stats` 周报 |
| `MASTER_PLAN.md` | 第 12 章已记录 v2.0 交互逻辑，改完逻辑记得同步 |

---

## 6. 云端资源

- 环境 ID：`cloud1-d6g89v5us18443dd8`（`utils/config.js`）
- 订阅消息模板：`TEMPLATE_ID`（用药提醒）、`MISSED_TEMPLATE_ID`（服药超时提醒）
- 集合：

| 集合 | 关键字段 |
| :-- | :-- |
| `users` | `openid / role / linkedId / boundAt / notifyState / missedState / notifyAt / notifyPaused / quota / missedQuota` |
| `invites` | `code / caregiverOpenId / used / usedBy / expireAt` |
| `reminder_plans` | V1 自提醒计划（仅兼容旧客户端） |
| `med_plans` | `ownerId / targetId / medId / medName / dose / unit / intensity / schedule / stock / nextVisit / status` |
| `med_logs` | `planId / medId / ownerId / targetId / medName / dose / unit / time / plannedTime / dateKey / status（taken / missed）/ late / lateAt / confirmedAt / detectedAt` |

部署命令（已验证可用）：

```powershell
& "C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" cloud functions deploy `
  --e cloud1-d6g89v5us18443dd8 --n bindUser --r `
  --project "c:\Users\Administrator\Documents\Trae-CN\wx"
```

---

## 7. 当前交互规则

### 子女端
- 首页只显示一条状态栏：`已与长辈绑定 / 尚未绑定长辈 / 长辈未开启微信通知 / 长辈已暂停接收`，点击进设置
- 设置页顶部「亲情提醒」入口 → 亲情提醒页：未绑定显示「发送给父母」+ 邀请码复制；已绑定显示状态说明 + 解除绑定
- 首页不再展示「长辈今天」模块，子女端只保留绑定状态栏与本地用药清单
- 「设置日历提醒」：生成 `.ics` 后在微信里选择父母的聊天发送；页面与取消说明都按「父母手机上操作」描述
- 「微信提醒」页只展示父母授权状态与「复制开启步骤发给父母」；子女端不再订阅，也不会收到用药提醒
- 首页「24 小时服药」图使用长辈的云端记录：过点未服红色、补吃黄色，父母确认后自动更新
- 设置页「数据与云服务」：导出数据到剪贴板 / 检查云端状态（云端备份已移除）
- 设置页「关于」：隐私说明；身份选择页也有隐私说明入口
- 邀请码仅在未绑定时生成，首页不再预生成

### 长辈端
- 进入方式：聊天卡片 / 提醒消息 / 首页选长辈 / 邀请码链接
- 输码 →「确认开启提醒」一次点击完成「授权 + 绑定」（同时授权正常与漏服两个模板）
- 已开启态：始终展示日期、状态说明与「暂停接收」，不再有「我知道了」
- 暂停态：「恢复接收」（重新授权）、「解除绑定」（小字）
- 未授权：橙色提示 +「重新开启」；`ban` 时给「订阅消息」指引
- 今日用药列表只展示状态：待服 / 已完成 / 漏服 / 已补吃，没有确认按钮
- 正常提醒与漏服提醒点开后都会弹窗，点「已吃药」完成记录；漏服消息确认后自动记为补吃
- 当天有漏服时首页出现「漏服补吃」卡片，可手动补记

---

## 8. 已知限制（不要当 bug 改）

1. `wx.exitMiniProgram` 仅在聊天卡片等少数入口生效，已改为引导「点右上角圆点关闭」
2. 订阅消息一次授权一条额度；正常提醒与漏服提醒使用两个模板、两个额度池，确认一次同时续订
4. 强力模式当前灰度：选项置灰，存量计划降级为标准；标准强度已参与漏服判定
5. 身份不可逆，选错只能删除小程序重进
6. 开发者工具单账号无法完成绑定闭环，需双机或「多账号调试」
7. 开发者工具模拟器点击分享不会弹好友列表，`open-type="share"` 需真机验证

---

## 9. 下一步：验收与上线准备

Phase 8 已完成（代码侧就绪，剩余后台配置与真机验收）：

1. `sendDue` 每 5 分钟边界执行漏服 Watchdog（标准+强力），写 `med_logs.status = 'missed'` 并通知父母
2. 漏服模板已创建（「服药超时提醒」）并填入 `utils/config.js` 与 `sendDue`，真机验证到达即可
3. `medLog.today` 返回库存不足 3 天 / 7 天内复诊提示
4. `medLog.history` + `pages/care-history` 按日期查看执行记录，补吃显示为「补吃」
5. `medLog.stats` + `pages/care-stats` 最近 7 天完成率与每天趋势
6. 长辈首页消息弹窗确认、漏服补吃卡、24 小时图红/黄状态
7. `pages/privacy` 隐私说明；版本号 `2.0.0`，`MINIPROGRAM_STATE` 已为 `formal`

### 建议后续（均为人工步骤）
1. 微信后台填写《用户隐私保护指引》，声明拍照选图、剪贴板写入、云开发等接口
2. 双机联调完整链路：绑定（授权两个模板）→ 到点提醒 → 弹窗确认 → 超时未确认 → 父母收到漏服提醒 → 补吃
3. 真机验证订阅消息额度：两个模板各 +1、发送后各 -1，确认后续订是否生效
4. 上传体验版，iOS / Android 各一台走查字号与点击区域
5. 发布前确认 `utils/config.js` 与 `sendDue` 的 `MINIPROGRAM_STATE` 仍为 `formal`
6. 不要破坏 V1 的 `reminder_plans`，做增量；云函数 3 秒超时，批量发送保持分批
7. 改完同步更新 `MASTER_PLAN.md` 第 12 章

---

## 10. 测试方法

- **云端逻辑**：可用内存版 `wx-server-sdk` 桩跑真实云函数代码
  - 现有脚本：`C:\Users\Administrator\AppData\Local\Temp\wxbind\run.js`、`peek.js`
  - Phase 3 脚本：`C:\Users\Administrator\AppData\Local\Temp\wxphase3\run.js`（计划写入 + 推送/暂停/解绑/额度）、`client.js`（本地计划构建）
  - Phase 4 脚本：`C:\Users\Administrator\AppData\Local\Temp\wxphase3\phase4.js`（今日用药 + 确认/幂等/库存）
  - Phase 5/6 脚本：`C:\Users\Administrator\AppData\Local\Temp\wxphase3\phase5.js`（标准+强力漏服、通知父母、补吃、幂等、历史、额度、库存/复诊）
  - Phase 6 脚本：`C:\Users\Administrator\AppData\Local\Temp\wxphase3\phase6.js`（7 天应服/已服/漏服、完成率、每天趋势）
  - 备份相关测试已随功能移除，`phase7.js` 不再保留
  - 用法：把对应 `cloudfunctions/*` 复制到该目录，`node run.js`
- **双机联调**：子女端复制邀请码 → 长辈端首页输码 → 双方状态互看
- **前端结构自检**：

```powershell
node --check pages/index/index.js
# WXML 标签配对可用正则统计 <block>/<view> 开闭数量
```

---

## 11. 新会话开场提示

> 继续「到时吃药」小程序 2.0 开发。先读 `HANDOFF.md` 与 `MASTER_PLAN.md` 第 12 章，当前在 `v2.0` 分支。Phase 8（上线准备）代码侧已完成：版本 2.0.0、合规文案扫描、隐私说明页面；剩余微信后台《用户隐私保护指引》与双机/真机验收。
