# 到时吃药 · 开发交接说明（2026-11-20）

> 用途：在新会话中继续开发时，先读本文件即可恢复上下文。

---

## 1. 现状一句话

V1.0 已上线（单机版，面向能自己操作手机的用户）；V2.0 正在把产品转型为**「子女远程设置 + 长辈极简接收」**的关怀模式，已完成**身份识别**与**亲情绑定全链路**，下一步是**药品计划上云与推送**。

---

## 2. Git 状态

| 项 | 内容 |
| :-- | :-- |
| 当前分支 | `v2.0` |
| 1.0 基线 | `ef92c92`，tag `v1.0.0`，分支 `master` |
| 1.0 物理快照 | `c:\Users\Administrator\Documents\Trae-CN\wx-v1.0-frozen`（独立可运行，勿改动） |
| 最近提交 | `6aca784` 绑定操作归入设置页，支持通知授权状态与暂停恢复 |
| **未提交** | `bindUser/index.js`、`pages/bind/bind.js`、`pages/bind/bind.wxml`、`utils/bind.js`（peek 防死循环修复，已部署但未 commit） |

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
| `cloudfunctions/bindUser/index.js` | `create / peek / accept / status / pause / resume / unbind` |
| `cloudfunctions/sendDue/index.js` | 定时推送（V1 逻辑，Phase 3 需改造） |
| `MASTER_PLAN.md` | 第 12 章已记录 v2.0 交互逻辑，改完逻辑记得同步 |

---

## 6. 云端资源

- 环境 ID：`cloud1-d6g89v5us18443dd8`（`utils/config.js`）
- 订阅消息模板：`TEMPLATE_ID`（用药提醒）
- 集合：

| 集合 | 关键字段 |
| :-- | :-- |
| `users` | `openid / role / linkedId / boundAt / notifyState / notifyAt / notifyPaused` |
| `invites` | `code / caregiverOpenId / used / usedBy / expireAt` |
| `reminder_plans` | V1 的计划集合（Phase 3 需要与 `med_plans` 关系梳理） |

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

## 9. 下一步：Phase 3（药品计划上云 + 推送）

### 目标
子女登记的药品变成云端计划，`sendDue` 按 `target_id` 推给长辈，并跳过已暂停用户。

### 任务清单
1. 新建 `med_plans` 集合：`ownerId / targetId / medName / dosage / intensity(gentle|standard|strong) / schedule[] / stock / nextVisit / status`
2. 药品编辑页增加「提醒强度」选择（柔和/标准/强力），语义见下
3. 保存时写入云端（沿用 `planSync` 的签名机制，避免重复写）
4. 改造 `sendDue`：
   - 按 `targetId` 查找长辈 openid
   - 跳过 `notifyPaused = true`
   - 按 `intensity` 决定消息文案/优先级
5. 长辈端「已吃药」确认 → 写 `med_logs`（Phase 4）
6. Watchdog：强力模式超时未确认 → 反向通知子女（Phase 5）

### 强度语义
| 强度 | 行为 |
| :-- | :-- |
| 柔和 | 仅微信订阅消息 |
| 标准 | 微信消息 + 可导出 `.ics` |
| 强力 | 微信消息 + 30 分钟未确认则通知子女 |

### 注意
- 不要破坏 V1 的 `reminder_plans`，做增量
- 云函数超时 3 秒，批量发送需并发分批（V1 已用每批 20）
- 改完同步更新 `MASTER_PLAN.md` 第 12 章

---

## 10. 测试方法

- **云端逻辑**：可用内存版 `wx-server-sdk` 桩跑真实云函数代码
  - 现有脚本：`C:\Users\Administrator\AppData\Local\Temp\wxbind\run.js`、`peek.js`
  - 用法：把 `cloudfunctions/bindUser` 复制到该目录，`node run.js`
- **双机联调**：子女端复制邀请码 → 长辈端首页输码 → 双方状态互看
- **前端结构自检**：

```powershell
node --check pages/index/index.js
# WXML 标签配对可用正则统计 <block>/<view> 开闭数量
```

---

## 11. 新会话开场提示

> 继续「到时吃药」小程序 2.0 开发。先读 `HANDOFF.md` 与 `MASTER_PLAN.md` 第 12 章，当前在 `v2.0` 分支，有 4 个未提交的 peek 相关改动（已部署）。本次要做 Phase 3：药品计划上云 + 按 targetId 推送。
