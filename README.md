# LAKELINE / 湖线铁三
地址链接 /
https://lakeline-triathlon-gb58th14x4p.qoder.zone

- **名称**：LAKELINE（湖线铁三）
- **取景**：千岛湖 · 湖山绿道（薄荷色湖水 + 环湖公路 + 湖畔绿道，青绿与橙色配色）
- **分类**：3D 铁人三项 / 三段式连续可玩竞速
- **玩法**：一条 1.34 公里的连续赛道，SWIM → T1 → BIKE → T2 → RUN 五段各有独立操控逻辑、障碍与相机，统一按时间结算。
- **技术栈**：React 19 + TypeScript + Vite 7 + Three.js 0.180
- **来源**：基于 SNOWLINE（雪线速降）模板源码改造（MIT），代码与素材均为本项目原创程序化生成。

---

## 运行与构建

需要 Node.js ≥ 22.12.0。

```bash
npm install

npm run dev        # 开发服务器，默认 http://127.0.0.1:5193/
npm run build      # tsc --noEmit && vite build，产物在 dist/
npm run preview    # 预览生产构建，http://127.0.0.1:5194/
npm test           # 单元测试（tsx --test tests/*.test.ts）
```

项目设置 `base: './'`，资源使用相对路径，`dist/` 可直接交给任意静态托管。当前交付范围为**本地预览**，尚未发布。

`dist/` 与 `screenshots/` 都是生成物，仓库里不保留；用 `npm run preview` 之前先跑一次 `npm run build`。

---

## 赛道结构

| 分段 | 里程 | 内容 |
|---|---|---|
| SWIM 游泳 | 0 – 300 m | 公开水域绕标，4 道浮标门、5 个补给、皮划艇障碍与对手身体接触 |
| T1 换项一 | 300 – 330 m | 浮台上岸，脱泳镜戴头盔，空格快换抢时间、Shift 慢走回体力 |
| BIKE 骑行 | 330 – 950 m | 环湖公路，8 道门、15 个补给、7 个弯道与路障，抓地预算决定过弯速度 |
| T2 换项二 | 950 – 980 m | 挂车换跑鞋，同样可以用空格与 Shift 在时间和体力之间做选择 |
| RUN 跑步 | 980 – 1340 m | 湖畔绿道，5 道门、10 个补给，最后 110 m 进入广告板围合的终点场，1300 m 冲线后滑行 40 m |

全场 17 道标志门、30 个补给点、15 个障碍；同场对手桌面端 9 人、移动端 5 人。

---

## 操控

- **← / →**：横向转向。松开按键时人物会自动跟住中线（赛道转弯不再需要一直反打方向），按键只负责在路面内左右移动。
- **空格**：发力。游泳＝冲刺划水，骑行＝起身摇车（一次冲刺，7 秒冷却），跑步＝冲刺，换项＝快换抢时间（消耗体力）。
- **Shift**：收力。游泳＝放松漂游回体力，骑行＝刹车（唯一能压住抓地比的手段），跑步＝放松，换项＝慢走（回体力最多）。
- **Esc**：暂停，暂停时清空所有按住按键并冻结时钟。
- **移动端**：左侧左右转向键，右侧冲刺键与刹车键。

核心取舍：体力条越用力掉得越快（游 2.6/s、跑 7.7/s，放松为负值即恢复），跑步段体力见底会「撞墙」，速度上限掉到 58%、连击清零；骑行段侧向加速度与 8.2 m/s² 抓地预算之比越过 1 就摔车，最紧的弯道要求降到约 63 km/h。补给站回补体力，跟滑省力并加分。

---

## 项目结构

```
.
├── index.html              # 入口 HTML
├── vite.config.ts          # Vite 配置（base: './'，dev 5193 / preview 5194）
├── public/fonts/           # Lilita One 显示字体 + OFL 授权
├── src/
│   ├── config.ts           # 品牌、文案、配色、赛道曲线、门/障碍/补给、五段驱动参数
│   ├── main.tsx            # React 入口
│   ├── game/
│   │   ├── input.ts        # 键盘与触屏按键状态
│   │   ├── rules.ts        # 分段计时、门与补给判定、失误与连击、结算
│   │   ├── simulation.ts   # 固定步长物理：stepSwim / stepBike / stepRun / stepTransition
│   │   └── audio.ts        # 程序化水声、风声、胎噪与撞击
│   ├── scene/
│   │   ├── scene.ts        # 渲染器、相机切换、后期与上下文丢失处理
│   │   ├── course.ts       # 湖水、湖床、公路、绿道、门与补给实体
│   │   ├── athlete.ts      # 三项运动员模型与动画姿态
│   │   ├── environment.ts  # 天空、云、光照、雾
│   │   ├── scenery-models.ts # 程序化树、岩石、帐篷、皮划艇等道具
│   │   ├── particles.ts    # 水花、尾迹、尘土、摔车碎片
│   │   ├── textures.ts     # 程序化贴图
│   │   ├── mapstyle.ts     # 地图风格解析与配色注入
│   │   └── util.ts         # 随机数与几何辅助
│   └── ui/
│       ├── App.tsx         # 封面、HUD、换项卡片、暂停与结算面板
│       └── styles.css      # 玻璃态 HUD 与响应式断点
├── scripts/
│   ├── cdp.mjs             # 无头 Chrome 的 CDP 连接封装
│   ├── verify-browser.mjs  # 真实浏览器逐段验证
│   └── capture-scenes.mjs  # 建模参考图集拍摄
├── docs/
│   ├── MODELING.md         # 建模图集 + 建模代码地图
│   └── modeling/           # 61 张分段建模参考图与 manifest.json
└── tests/game.test.ts      # 14 条规则与物理单元测试
```

---

## 外部依赖

运行时：`react` 19.1.1、`react-dom` 19.1.1、`three` 0.180.0。
开发时：`vite` 7.1.7、`@vitejs/plugin-react` 5.0.4、`typescript` 5.9.2、`tsx` 4.20.6。

**无外部图片、模型或音频链接**：所有几何时、贴图与音效均在项目内程序化生成，离线可运行。字体 Lilita One 为 SIL Open Font License 1.1，见 `public/fonts/OFL.txt`；代码许可见 `LICENSE` 与 `licenses/THIRD-PARTY-NOTICES.txt`。

---

## 如何改造内容

| 内容 | 位置 |
|---|---|
| 品牌、赛事名、三词大标题 | `CONFIG.brand` |
| 全部界面文案与提示 | `CONFIG.text` |
| 天空、水、草地、沥青、UI 配色 | `CONFIG.colors`、`CONFIG.lighting` |
| 五段划分与横向路面宽度 | `CONFIG.disciplines`、`CONFIG.course.halfWidth` |
| 弯道形状 | `config.ts` 的 `ROUTE_TURNS` |
| 门 / 障碍 / 补给 / 地标位置 | `GATE_SPECS`、`OBSTACLE_SPECS`、`PICKUPS`、`MARKS` |
| 每段速度、转向、抓地、消耗 | `CONFIG.drive` |
| 体力、失误与得分 | `CONFIG.stamina`、`CONFIG.mistake`、`CONFIG.scoring` |
| 分段相机参数 | `CONFIG.camera` |
| 画质分级（DPR、粒子、阴影） | `CONFIG.quality` |

改完运行 `npm run dev` 或 `npm run build` 即可。

---

## 验证

```bash
# 单元测试
npm test

# 类型检查 + 构建
npm run build

# 真实浏览器验证：先起 dev server，再起一个带 CDP 端口的 Chrome
# 桌面 1440×900 与移动 390×844 两种模式，逐段跑完五段并检查布局
CDP_PORT=9230 npx tsx scripts/verify-browser.mjs desktop
CDP_PORT=9230 npx tsx scripts/verify-browser.mjs mobile
```

验证脚本会启动页面、检查封面布局、逐段验证操控与物理、以自动导航跑完整场比赛（不使用瞬移，分段成绩必须真实跑出），并断言无未捕获异常、无失败请求、无控制台报错，把 `screenshots/<mode>-*.png` 与 `screenshots/<mode>-verification.json` 写进自动创建的 `screenshots/`（生成物，不随仓库分发）。

调试提示：`http://127.0.0.1:5193/?diagnostics` 会暴露 `window.__lakeline = { read, state, scene, audio, warp, objects }`，可在控制台直接查看物理状态、把运动员移动到赛道任意位置，或用 `objects().inspectView = { position, target, fov }` 摆一个检查相机（置 `null` 交回跟随相机）。

---

## 建模参考图集

每个赛段的侧面、正面与俯瞰参考图，以及"哪段代码画哪个模型"的行号索引，见 [docs/MODELING.md](docs/MODELING.md)。改完模型重跑：

```bash
npm run dev                                              # 另开一个带 --remote-debugging-port=9230 的 Chrome
npm run shots                                            # 61 张全部重出到 docs/modeling/
SHOT_FILTER="hairpin|pontoon" npm run shots              # 只重拍关心的机位
```
