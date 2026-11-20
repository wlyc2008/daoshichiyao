# 到时吃药 · 开发交接说明（2026-11-20）

> 用途：在新会话中继续开发时，先读本文件即可恢复上下文。

---

## 1. 现状一句话

V1.0 已上线（单机版，面向能自己操作手机的用户）；V2.0 正在把产品转型为**「子女远程设置 + 长辈极简接收」**的关怀模式，已完成**身份识别**、**亲情绑定**、**Phase 3 计划上云 + 按 targetId 推送**与 **Phase 4 服药确认**，下一步是 **Phase 5 漏服看护**。

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
- 双通道提醒：导出 `.ics` 到系统日历 + 微信订阅消息（`sendDue` 云函数 + 定时触发器）
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
   - 长辈授权额度落在 `users.quota`：`accept` / `resume` +1，发送成功 -1
7. **服药确认（Phase 4）**：
   - 云函数 `medLog`：`today` 按角色返回今日用药，`confirm` 写 `med_logs` 并扣减云端库存
   - 长辈首页「今天的用药」：点「已吃药」即记录，进度即时刷新
   - 子女首页「长辈今天」：只读展示完成进度与逐条状态
   - 同一时刻重复确认幂等；暂停接收时长辈端不展示清单

---

## 5. 关键文件

| 文件 | 职责 |
| :-- | :-- |
| `pages/index/index.js` | 首页：身份选择、长辈输码/三态、子女状态条与用药展示 |
| `pages/bind/bind.js` | 分享卡片落地页：peek → ready / self / done / error |
| `pages/settings/settings.js` | 设置页：顶部「亲情提醒」卡片（分享、邀请码、解绑） |
| `utils/bind.js` | 绑定接口封装：`createInvite / peek / acceptInvite / pause / resume / unbind / fetchStatus` |
| `utils/role.js` | 身份读写（本地 + 云端登记） |
| `utils/cloud.js` | 云开发封装，含通用 `callFunction` |
| `utils/planSync.js` | 计划上云：V1 `reminder_plans` + V2 `med_plans` 双指纹同步 |
| `utils/medLog.js` | 今日用药读取与「已吃药」确认封装 |
| `cloudfunctions/bindUser/index.js` | `create / peek / accept / status / pause / resume / unbind`，并维护长辈 `quota` |
| `cloudfunctions/syncMedPlans/index.js` | 按 `ownerId + medId` upsert `med_plans`，删除本地已移除的计划 |
| `cloudfunctions/sendDue/index.js` | 定时推送：V1 计划 + `med_plans` 按 targetId 推给长辈 |
| `cloudfunctions/medLog/index.js` | `today` 今日用药（按角色）、`confirm` 写 `med_logs` 并扣减云端库存 |
| `MASTER_PLAN.md` | 第 12 章已记录 v2.0 交互逻辑，改完逻辑记得同步 |

---

## 6. 云端资源

- 环境 ID：`cloud1-d6g89v5us18443dd8`（`utils/config.js`）
- 订阅消息模板：`TEMPLATE_ID`（用药提醒）
- 集合：

| 集合 | 关键字段 |
| :-- | :-- |
| `users` | `openid / role / linkedId / boundAt / notifyState / notifyAt / notifyPaused / quota` |
| `invites` | `code / caregiverOpenId / used / usedBy / expireAt` |
| `reminder_plans` | V1 自提醒计划（未绑定也能用） |
| `med_plans` | `ownerId / targetId / medId / medName / dose / unit / intensity / schedule / stock / nextVisit / status` |
| `med_logs` | `planId / medId / ownerId / targetId / medName / dose / unit / time / plannedTime / dateKey / status / confirmedAt` |

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
- 设置页顶部「亲情提醒」：未绑定显示「发送给父母」+ 邀请码复制；已绑定显示状态说明 + 解除绑定
- 邀请码仅在未绑定时生成，首页不再预生成

### 长辈端
- 进入方式：聊天卡片 / 首页选长辈 / 邀请码链接
- 输码 →「确认开启提醒」一次点击完成「授权 + 绑定」
- 已开启态：可「我知道了」（收起全部操作只留提示）、「暂停接收」
- 暂停态：「恢复接收」（重新授权）、「解除绑定」（小字）
- 未授权：橙色提示 +「重新开启」；`ban` 时给通知管理指引

---

## 8. 已知限制（不要当 bug 改）

1. `wx.exitMiniProgram` 仅在聊天卡片等少数入口生效，已改为引导「点右上角圆点关闭」
2. 订阅消息一次授权一条额度，`notifyState` 只代表「最近一次授权结果」
3. 身份不可逆，选错只能删除小程序重进
4. 开发者工具单账号无法完成绑定闭环，需双机或「多账号调试」
5. 开发者工具模拟器点击分享不会弹好友列表，`open-type="share"` 需真机验证

---

## 9. 下一步：Phase 5（漏服看护）

Phase 4 已完成并验证：`med_logs` 记录、长辈「已吃药」确认、子女只读进度。

### Phase 5 目标
强力模式超过 30 分钟未确认时反向通知子女；库存与复诊提醒接入云端。

### 任务清单
1. Watchdog：定时扫描 `med_plans` 的 `intensity = strong`，超时未确认 → 通知 `ownerId`
2. 漏服日志补写 `status = missed`，供子女端展示
3. 库存不足/复诊临近的通知（沿用 `nextVisit` 与 `stock`）
4. 子女端可查看历史执行记录（按日期）

### 注意
- 不要破坏 V1 的 `reminder_plans`，做增量
- 云函数超时 3 秒，批量发送需并发分批（V1/Phase 3 已用每批 20）
- 改完同步更新 `MASTER_PLAN.md` 第 12 章
- Phase 4 新增云函数已部署：`medLog`

---

## 10. 测试方法

- **云端逻辑**：可用内存版 `wx-server-sdk` 桩跑真实云函数代码
  - 现有脚本：`C:\Users\Administrator\AppData\Local\Temp\wxbind\run.js`、`peek.js`
  - Phase 3 脚本：`C:\Users\Administrator\AppData\Local\Temp\wxphase3\run.js`（计划写入 + 推送/暂停/解绑/额度）、`client.js`（本地计划构建）
  - Phase 4 脚本：`C:\Users\Administrator\AppData\Local\Temp\wxphase3\phase4.js`（今日用药 + 确认/幂等/库存）
  - 用法：把对应 `cloudfunctions/*` 复制到该目录，`node run.js`
- **双机联调**：子女端复制邀请码 → 长辈端首页输码 → 双方状态互看
- **前端结构自检**：

```powershell
node --check pages/index/index.js
# WXML 标签配对可用正则统计 <block>/<view> 开闭数量
```

---

## 11. 新会话开场提示

> 继续「到时吃药」小程序 2.0 开发。先读 `HANDOFF.md` 与 `MASTER_PLAN.md` 第 12 章，当前在 `v2.0` 分支。Phase 4（长辈「已吃药」→ `med_logs`）已完成，本次做 Phase 5：强力模式漏服 Watchdog → 反向通知子女。
