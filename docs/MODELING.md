# 建模参考图集 · 代码地图（千岛湖 · 湖山绿道）

> 本文只为**改模型**服务：每个赛段的每张参考图都指向画它的那段代码，并列出我在图上看到的粗糙点。
> 图集由 [`scripts/capture-scenes.mjs`](../scripts/capture-scenes.mjs) 自动生成，改完模型重跑一次就能拿到同一批机位的对比图。
> 所有行号基于当前工作区 `lakeline/`，路径均可直接点开。

---

## 0. 五十秒看懂项目结构

赛道不是手工摆的模型，而是**沿弧长 `s` 的解析曲面**：

- `s` = 沿中线前进的米数；`u = x - centerAt(s)` = 偏离中线的横向米数。
- 每个网格都用同一批函数取高度：`surfaceHeight(s,u)`（路面/水面）与 `groundHeight(s,u)`（地形），所以改一个高度字段，地形、路面、道具会一起跟着动。
- 中线由 `ROUTE_TURNS` 的曲率样本积分得到，所以**改弯道 = 改全线所有道具的落点**，不需要重新摆位。

分段边界（`src/config.ts:8-13`）：

| 段 | s 区间 | 说明 |
| --- | --- | --- |
| SWIM | 0 – 300 | 湖面 + 浮台 + 浮标门 |
| T1 | 300 – 330 | 上岸 + 换项架 |
| BIKE | 330 – 950 | 堤道路 + 山脊 + 发夹弯 + 下坡 |
| T2 | 950 – 980 | 第二次换项 |
| RUN | 980 – 1300 | 绿道 + 观赛带 + 终点 |
| （余量） | 1300 – 1340 | 冲线缓冲 |

---

## 1. 建模代码地图

### 1.1 文件职责

| 文件 | 行数 | 负责什么 |
| --- | --- | --- |
| [src/config.ts](../src/config.ts) | ~490 | **所有形状/高度/颜色参数**：分段边界、调色板、路宽、中线曲率、高度场、门/障碍/补给/地标/弯道表、相机与画质档 |
| [src/scene/course.ts](../src/scene/course.ts) | ~1070 | 赛道本体：地形网格、水面 shader、沥青/铺装/跑道条带、门、障碍、补给、地标、LOD 实例化、总装 `createCourse` |
| [src/scene/scenery-models.ts](../src/scene/scenery-models.ts) | ~530 | **单体道具几何**：树/芦苇/巨石/岛/皮划艇/浮标/锥桶/帐篷/换项架/看台/旗/灯/浮台，含顶点着色与合并工具 |
| [src/scene/athlete.ts](../src/scene/athlete.ts) | ~550 | **人物与自行车**：胶囊骨架、两骨 IK、`makeBike` 管架、三套装备 `KIT`、四套动作 `animate` |
| [src/scene/textures.ts](../src/scene/textures.ts) | ~360 | 程序化 canvas 贴图：沥青、跑道、木栈道、沙、绳索、辉光、水波法线、横幅、门牌、标签、警示、人字纹、格子 |
| [src/scene/environment.ts](../src/scene/environment.ts) | ~350 | 远景：远山环、雾墙、天穹、云、PMREM 反射环境贴图 |
| [src/scene/particles.ts](../src/scene/particles.ts) | ~345 | 水花/尾迹/扬尘点精灵（也影响"看起来粗不粗"） |
| [src/scene/scene.ts](../src/scene/scene.ts) | ~300 | 渲染器、灯光、阴影、跟随相机、`inspectView` 检查相机、`diagnostics()` |
| [scripts/capture-scenes.mjs](../scripts/capture-scenes.mjs) | ~250 | 本图集的拍摄脚本（61 个机位定义在 `SHOTS`） |

### 1.2 course.ts 内部索引

| 内容 | 位置 |
| --- | --- |
| 材质 / 网格包装 | [course.ts:24](../src/scene/course.ts#L24) `material`、[:28](../src/scene/course.ts#L28) `mesh` |
| 横幅面片 | [course.ts:36](../src/scene/course.ts#L36) `bannerPlane` |
| **通用条带网格生成器**（路面/水/跑道都用它） | [course.ts:49](../src/scene/course.ts#L49) `strip(rows, vInMetres)` |
| 地形取样点 | [course.ts:74](../src/scene/course.ts#L74) `groundPoint` |
| 朝向 | [course.ts:80](../src/scene/course.ts#L80) `yawAt(s) = -atan(centerSlope)` |
| 地形网格密度 | [course.ts:84](../src/scene/course.ts#L84) `terrainColumns` / [:95](../src/scene/course.ts#L95) `terrainRows`（1.5–70 m 变距） |
| **地形 + 顶点配色**（河床/沙/草/岩/远雾带） | [course.ts:115-182](../src/scene/course.ts#L115-L182)，色带分支 [:150-169](../src/scene/course.ts#L150-L169) |
| 水域轮廓扫描 | [course.ts:188-222](../src/scene/course.ts#L188-L222) `waterRuns`（s 步长 6 m、u 步长 9 m → 边缘台阶感来源） |
| **水面 + shader** | [course.ts:224-298](../src/scene/course.ts#L224-L298)，顶点色 `aEdge` [:241](../src/scene/course.ts#L241)，片元 [:261-291](../src/scene/course.ts#L261-L291)（波纹用世界 x 正弦 → 横条纹） |
| 任意曲面条带 | [course.ts:302-316](../src/scene/course.ts#L302-L316) `ribbon` |
| 路缘线 | [course.ts:318-325](../src/scene/course.ts#L318-L325) `edgeLine` |
| 沥青路面 + 路缘 | [course.ts:330-341](../src/scene/course.ts#L330-L341) |
| T1/T2 铺装 | [course.ts:343-346](../src/scene/course.ts#L343-L346) |
| 跑道（含 `track-run` 命名） | [course.ts:348-354](../src/scene/course.ts#L348-L354) |
| 终点地毯 + 黑白格 | [course.ts:356-368](../src/scene/course.ts#L356-L368) |
| 泳道绳 + 浮子 | [course.ts:371-397](../src/scene/course.ts#L371-L397) |
| 出发浮台 | [course.ts:399-410](../src/scene/course.ts#L399-L410) |
| **门（浮标 / 拱门 / 补给）** | [course.ts:418-520](../src/scene/course.ts#L418-L520)：pylon/foot/beam/banner/pennant/plate；浮标分支 [:459-480](../src/scene/course.ts#L459-L480)；拱门分支 [:483-517](../src/scene/course.ts#L483-L517)；补给帐篷 [:498-516](../src/scene/course.ts#L498-L516) |
| **障碍（皮划艇 / 锥桶 / 木板墙 / 警示牌 / 营地帐篷）** | [course.ts:524-607](../src/scene/course.ts#L524-L607)：锥桶 [:547](../src/scene/course.ts#L547)、营地 [:550-555](../src/scene/course.ts#L550-L555)、人字木板 [:574-589](../src/scene/course.ts#L574-L589)、警示牌 [:590-606](../src/scene/course.ts#L590-L606) |
| **补给（能量胶 + 光环）** | [course.ts:611-648](../src/scene/course.ts#L611-L648) |
| 实例化 + 三级 LOD 分块 | [course.ts:663-735](../src/scene/course.ts#L663-L735)（`cached`/`model`/`addChunks`，cellSize 128 m） |
| 林带 | [course.ts:743-778](../src/scene/course.ts#L743-L778)（固定步距 4.4 m → 树分布均匀） |
| 岸线道具（芦苇/巨石/树） | [course.ts:780-818](../src/scene/course.ts#L780-L818) |
| 岛 | [course.ts:820-842](../src/scene/course.ts#L820-L842) |
| **观赛带基础设施** | [course.ts:845-932](../src/scene/course.ts#L845-L932)：`models` 清单 [:848-853](../src/scene/course.ts#L848-L853)、横幅 UV [:855-860](../src/scene/course.ts#L855-L860)、护栏条 [:864-874](../src/scene/course.ts#L864-L874)、场地旗 [:875-882](../src/scene/course.ts#L875-L882)、路灯 [:899-908](../src/scene/course.ts#L899-L908)、看台 [:909-918](../src/scene/course.ts#L909-L918)、换项架 [:919-930](../src/scene/course.ts#L919-L930) |
| 拱门（共用一台） | [course.ts:936-976](../src/scene/course.ts#L936-L976) |
| 里程/地标牌 | [course.ts:978-1005](../src/scene/course.ts#L978-L1005) |
| **总装** | [course.ts:1009-1068](../src/scene/course.ts#L1009-L1068)，5 座拱门 s 值在 [:1022-1030](../src/scene/course.ts#L1022-L1030)（-16 / 306 / 545 / 956 / 1300） |

### 1.3 scenery-models.ts 内部索引

| 内容 | 位置 |
| --- | --- |
| 统一材质工厂（顶点色 + 平面着色开关） | [scenery-models.ts:10](../src/scene/scenery-models.ts#L10) |
| `PropKind` 枚举 + 名义高度表 | [:18](../src/scene/scenery-models.ts#L18) / [:23](../src/scene/scenery-models.ts#L23) `PROP_HEIGHTS` |
| 顶点着色工具 | [:42](../src/scene/scenery-models.ts#L42) `paint`、[:53](../src/scene/scenery-models.ts#L53) `blend`、[:69](../src/scene/scenery-models.ts#L69) `mottle`、[:84](../src/scene/scenery-models.ts#L84) `combine`（会拍平索引，别混用） |
| 回转体 / 轮廓 / 树干 | [:99](../src/scene/scenery-models.ts#L99) `radialSurface`、[:131](../src/scene/scenery-models.ts#L131) `profileOf`、[:138](../src/scene/scenery-models.ts#L138) `trunkOf` |
| 针叶裙 / 松 / 阔叶冠 | [:145](../src/scene/scenery-models.ts#L145) `firSkirt`、[:156](../src/scene/scenery-models.ts#L156) `pine`、[:176](../src/scene/scenery-models.ts#L176) `canopy` |
| 芦苇 / 巨石 | [:194](../src/scene/scenery-models.ts#L194) / [:217](../src/scene/scenery-models.ts#L217) |
| 岛 | [:236](../src/scene/scenery-models.ts#L236) `ISLAND_R`/`ISLAND_H`、[:240](../src/scene/scenery-models.ts#L240) |
| 皮划艇 / 浮标 | [:273](../src/scene/scenery-models.ts#L273) / [:299](../src/scene/scenery-models.ts#L299) |
| 锥桶 / 帐篷 | [:320](../src/scene/scenery-models.ts#L320) / [:332](../src/scene/scenery-models.ts#L332) |
| 换项架 | [:363](../src/scene/scenery-models.ts#L363) |
| 看台 | [:391](../src/scene/scenery-models.ts#L391) |
| 旗 | [:417](../src/scene/scenery-models.ts#L417) |
| 路灯 | [:437](../src/scene/scenery-models.ts#L437) |
| 出发浮台 | [:451](../src/scene/scenery-models.ts#L451) |
| 按 kind 分发 + 名义高度归一 | [:478](../src/scene/scenery-models.ts#L478) `createPropGeometry`、[:510](../src/scene/scenery-models.ts#L510) `createProp` |

### 1.4 athlete.ts 内部索引

| 内容 | 位置 |
| --- | --- |
| 骨长常量（HIP 0.9 / THIGH=SHIN 0.42 / UPPER_ARM 0.3 / FOREARM 0.28 / CHEST 0.44） | [athlete.ts:13-19](../src/scene/athlete.ts#L13-L19) |
| 胶囊（总高 = length + 2r，改错就是"多两根白棍"） | [:40](../src/scene/athlete.ts#L40) `capsule` |
| 材质 / 皮肤-泳装-车架配色表 | [:44](../src/scene/athlete.ts#L44) / [:50](../src/scene/athlete.ts#L50) `MATS` |
| 静态件合并 | [:72](../src/scene/athlete.ts#L72) `packRigidParts` |
| **两骨 IK** | [:102](../src/scene/athlete.ts#L102) `placeBetween`、[:121](../src/scene/athlete.ts#L121) `makeLimb`、[:135](../src/scene/athlete.ts#L135) `solveLimb` |
| **自行车**（WHEEL_R 0.33、CRANK 0.16、BB/PAD、管架） | [:159](../src/scene/athlete.ts#L159) 常量、[:171](../src/scene/athlete.ts#L171) `makeBike`、[:200](../src/scene/athlete.ts#L200) `tube`、管架调用 [:202-215](../src/scene/athlete.ts#L202-L215) |
| 装备类型与三套 `KIT` | [:268](../src/scene/athlete.ts#L268) `Kit`、swim [:290](../src/scene/athlete.ts#L290)、t1 [:291](../src/scene/athlete.ts#L291)、bike [:292](../src/scene/athlete.ts#L292)、t2 [:293](../src/scene/athlete.ts#L293)、run [:294](../src/scene/athlete.ts#L294) |
| 装配整体 | [:307](../src/scene/athlete.ts#L307) `createAthlete`、[:435](../src/scene/athlete.ts#L435) `applyKit` |
| **动作** | [:473](../src/scene/athlete.ts#L473) `animate`；游泳 [:479](../src/scene/athlete.ts#L479)、骑行 [:499](../src/scene/athlete.ts#L499)、换项慢走 [:520](../src/scene/athlete.ts#L520)、跑步步幅/抬腿 [:525-526](../src/scene/athlete.ts#L525-L526) |

### 1.5 textures.ts / environment.ts / particles.ts

| 内容 | 位置 |
| --- | --- |
| 沥青（裂纹强度在这里） | [textures.ts:39-81](../src/scene/textures.ts#L39-L81) |
| 跑道（颗粒 + 白线） | [:82-105](../src/scene/textures.ts#L82-L105) |
| 木栈道 / 沙 / 绳索 | [:106](../src/scene/textures.ts#L106) / [:137](../src/scene/textures.ts#L137) / [:157](../src/scene/textures.ts#L157) |
| 辉光 / 水波法线 | [:171](../src/scene/textures.ts#L171) / [:184](../src/scene/textures.ts#L184) |
| 横幅 / 门牌 / 标签 / 警示 / 人字 / 格子 | [:222](../src/scene/textures.ts#L222) / [:265](../src/scene/textures.ts#L265) / [:283](../src/scene/textures.ts#L283) / [:303](../src/scene/textures.ts#L303) / [:332](../src/scene/textures.ts#L332) / [:351](../src/scene/textures.ts#L351) |
| 远景半径 4 层（INNER/OUTER/WALL/SKY） | [environment.ts:20-23](../src/scene/environment.ts#L20-L23) |
| 远山顶点 + 高度函数 | [:27](../src/scene/environment.ts#L27) `SUMMITS`、[:45](../src/scene/environment.ts#L45) `ridgeHeight`、[:73](../src/scene/environment.ts#L73) `createHillRingModel` |
| 雾墙 / 天穹 / 云 | [:144](../src/scene/environment.ts#L144) / [:185](../src/scene/environment.ts#L185) / [:231](../src/scene/environment.ts#L231) |
| 总装 | [:335](../src/scene/environment.ts#L335) `createEnvironment` |
| 尾迹采样数 / 点材质 / 类 | [particles.ts:10](../src/scene/particles.ts#L10) `WAKE_SAMPLES=26` / [:15](../src/scene/particles.ts#L15) / [:33](../src/scene/particles.ts#L33) |
| 尾迹更新 / 主更新 | [:207](../src/scene/particles.ts#L207) `updateWake` / [:254](../src/scene/particles.ts#L254) `update` |

### 1.6 几何基础工具（改任何条带前先看）

[src/scene/geometry.ts](../src/scene/geometry.ts)：`boxGeometry`、`roundedBox`（躯干/箱体）、`capsule`（四肢/桩）、`cylinder`、`plane`、`cone`、`torus` — 全项目共用，动它会全线变形。

---

## 2. 参数索引：改哪个数字 = 改哪个视觉

全部在 [src/config.ts](../src/config.ts)。

| 想改的东西 | 字段 | 位置 |
| --- | --- | --- |
| 各段长度 / 总长 | `SWIM_END`…`FINISH_S`、`COURSE_LENGTH` | [:8-13](../src/config.ts#L8-L13) |
| 阳光方向与强度、环境光、雾 | `lighting` | [:61-66](../src/config.ts#L61-L66) |
| 全线配色（湖/沙/草/岩/沥青/跑道/强调橙） | `colors` | [:67-88](../src/config.ts#L67-L88) |
| 路面宽窄（含 T1/T2 更宽、终点更宽） | `course.halfWidth` | [:89-94](../src/config.ts#L89-L94) |
| 车身半径、回正手感 `lineReturn` | `physics` | [:102-106](../src/config.ts#L102-L106) |
| 三种操控的速度/转向/抓地 | `drive`（swim/bike/run） | [:113-150](../src/config.ts#L113-L150) |
| 相机高低远近（试玩画面构图） | `camera` 分段 profile | [:161-167](../src/config.ts#L161-L167) |
| 地形细分、阴影、雾距离 | `quality` | [:169-172](../src/config.ts#L169-L172) |
| **中线形状**（每段直度/弧度） | `ROUTE_TURNS` | [:178-192](../src/config.ts#L178-L192) |
| 弯道横向倾斜（压弯） | `turnBank` | [:324](../src/config.ts#L324) |
| 路面高度（堤道/山脊/下坡） | `roadHeight` | [:267](../src/config.ts#L267) |
| 换项区/场地地坪 | `parkHeight` | [:271](../src/config.ts#L271) |
| 湖床、岸坡 | `reliefSwim` / `reliefCoast` | [:289](../src/config.ts#L289) / [:300](../src/config.ts#L300) |
| 路边起伏（护栏/树的高低） | `sideRelief` | [:331](../src/config.ts#L331) |
| 门（浮标/拱门/补给）位置与横向偏移 | `GATES` + `gateHalfWidth` | [:364-388](../src/config.ts#L364-L388) |
| 障碍（皮划艇/锥桶/帐篷/木板/警示牌） | `OBSTACLES` + `obstacleBand` | [:395-422](../src/config.ts#L395-L422) |
| 补给点 | `PICKUPS` | [:426-435](../src/config.ts#L426-L435) |
| 地标牌（里程、沙滩、补给文案） | `MARKS` | [:438-457](../src/config.ts#L438-L457) |
| 发夹弯定义（限速牌读它） | `CORNERS` | [:463-476](../src/config.ts#L463-L476) |

---

## 3. 图集（61 张）

每张图下方第一行是**画它的代码**；图块尺寸固定 1280×800。清单与逐机位统计在 [docs/modeling/manifest.json](modeling/manifest.json)。

### 3.1 全局 · 俯瞰与远景

**`00-plan-swim`** — 游泳段正俯瞰，看中线走向、泳道绳、岛、岸线  
[course.ts:115](../src/scene/course.ts#L115) 地形 · [course.ts:224](../src/scene/course.ts#L224) 水面 · [config.ts:178](../src/config.ts#L178) 中线
![00-plan-swim](modeling/00-plan-swim.png)

**`00-plan-bike`** — 骑行段正俯瞰：堤道、山脊、发夹弯、下坡  
[course.ts:330](../src/scene/course.ts#L330) 沥青 · [config.ts:267](../src/config.ts#L267) 路面高 · [config.ts:463](../src/config.ts#L463) 弯道
![00-plan-bike](modeling/00-plan-bike.png)

**`00-plan-run`** — 跑步段正俯瞰：绿道、观赛带、场地、终点  
[course.ts:348](../src/scene/course.ts#L348) 跑道 · [course.ts:845](../src/scene/course.ts#L845) 观赛带 · [course.ts:1028](../src/scene/course.ts#L1028) 终点门
![00-plan-run](modeling/00-plan-run.png)

**`00-horizon-hills`** — 远山环 / 雾墙 / 云 / 天穹  
[environment.ts:73](../src/scene/environment.ts#L73) 山环 · [:144](../src/scene/environment.ts#L144) 雾墙 · [:231](../src/scene/environment.ts#L231) 云
![00-horizon-hills](modeling/00-horizon-hills.png)

### 3.2 游泳段 0 – 300 m

**`10-swim-start`** — 出发视角（跟随相机，唯一带玩家主体的动态机位）  
[scene.ts:219](../src/scene/scene.ts#L219) `updateCamera` · [config.ts:162](../src/config.ts#L162) swim profile
![10-swim-start](modeling/10-swim-start.png)

**`11-swim-start-plan`** — 出发区斜俯瞰：浮台排布 + 前 120 m 泳道绳  
[course.ts:399](../src/scene/course.ts#L399) 浮台 · [course.ts:371](../src/scene/course.ts#L371) 绳索
![11-swim-start-plan](modeling/11-swim-start-plan.png)

**`12-swim-pontoon`** — 出发浮台特写（几何很薄很方，注意甲板与水面高差）  
[scenery-models.ts:451](../src/scene/scenery-models.ts#L451) `pontoon` · 摆放 [course.ts:399-410](../src/scene/course.ts#L399-L410)
![12-swim-pontoon](modeling/12-swim-pontoon.png)

**`13-swim-arch-face`** — 起点拱门正面（横梁 + 横幅 + 牌）  
[course.ts:936](../src/scene/course.ts#L936) `addArch` · 文案贴图 [textures.ts:222](../src/scene/textures.ts#L222)
![13-swim-arch-face](modeling/13-swim-arch-face.png)

**`14-swim-buoy-gate`** — 浮标门整体（左右各一列 + 中间通道）  
[course.ts:459-480](../src/scene/course.ts#L459-L480) 浮标分支 · 规格 [config.ts:364](../src/config.ts#L364)
![14-swim-buoy-gate](modeling/14-swim-buoy-gate.png)

**`15-swim-buoy-close`** — 单只浮标（球 + 杆 + 小旗）  
[scenery-models.ts:299](../src/scene/scenery-models.ts#L299) `buoy`
![15-swim-buoy-close](modeling/15-swim-buoy-close.png)

**`16-swim-lane-rope`** — 泳道绳与浮子串  
纹理 [textures.ts:157](../src/scene/textures.ts#L157) · 绳条带 [course.ts:371-386](../src/scene/course.ts#L371-L386) · 浮子 [course.ts:388-397](../src/scene/course.ts#L388-L397)
![16-swim-lane-rope](modeling/16-swim-lane-rope.png)

**`17-swim-kayak`** — 赛道中的皮划艇障碍  
几何 [scenery-models.ts:273](../src/scene/scenery-models.ts#L273) · 实例化 [course.ts:534-557](../src/scene/course.ts#L534-L557) · 位置 [config.ts:395](../src/config.ts#L395)
![17-swim-kayak](modeling/17-swim-kayak.png)

**`18-swim-athlete`** — 自由泳姿态主体  
装配 [athlete.ts:307](../src/scene/athlete.ts#L307) · 动作 [athlete.ts:479](../src/scene/athlete.ts#L479) · 装备 [athlete.ts:290](../src/scene/athlete.ts#L290)
![18-swim-athlete](modeling/18-swim-athlete.png)

**`19-swim-islands`** — 湖心岛  
几何 [scenery-models.ts:240](../src/scene/scenery-models.ts#L240)（半径/高度 [:236](../src/scene/scenery-models.ts#L236)）· 摆放 [course.ts:820](../src/scene/course.ts#L820)
![19-swim-islands](modeling/19-swim-islands.png)

**`20-swim-water-exit`** — 出水段：水面→坡道→T1 铺装交接  
高差混合 [config.ts:277-279](../src/config.ts#L277-L279) · 铺装 [course.ts:343](../src/scene/course.ts#L343) · T1 拱门 [course.ts:1025](../src/scene/course.ts#L1025)
![20-swim-water-exit](modeling/20-swim-water-exit.png)

**`21-swim-shore-waterline`** — 岸线水陆交界（顶点配色分带）  
[course.ts:150-169](../src/scene/course.ts#L150-L169) 色带 · 水边淡出 [course.ts:241](../src/scene/course.ts#L241) `aEdge` · 岸坡 [config.ts:300](../src/config.ts#L300)
![21-swim-shore-waterline](modeling/21-swim-shore-waterline.png)

### 3.3 换项区 T1 300 – 330 m

**`22-t1-entry`** — 进 T1 的跟随视角（此段操控最"空"，值得优先加内容）  
铺装 [course.ts:343-346](../src/scene/course.ts#L343-L346) · 相机 [config.ts:163](../src/config.ts#L163)
![22-t1-entry](modeling/22-t1-entry.png)

**`23-t1-arch-face`** — T1 拱门正面  
[course.ts:936](../src/scene/course.ts#L936) · 调用 [course.ts:1025](../src/scene/course.ts#L1025)
![23-t1-arch-face](modeling/23-t1-arch-face.png)

**`24-t1-plan`** — T1 正俯瞰（架位在 `u=±(半宽+4.8)`，明显出ribbon 外）  
[course.ts:919-930](../src/scene/course.ts#L919-L930) · 宽度 [config.ts:92](../src/config.ts#L92)
![24-t1-plan](modeling/24-t1-plan.png)

**`25-t1-racks`** — 换项架排布  
摆放 [course.ts:919-930](../src/scene/course.ts#L919-L930) · 几何 [scenery-models.ts:363](../src/scene/scenery-models.ts#L363)
![25-t1-racks](modeling/25-t1-racks.png)

**`26-t1-rack-close`** — 单架特写（现在只有横杆 + 挂钩）  
[scenery-models.ts:363-390](../src/scene/scenery-models.ts#L363-L390) · 实例化 [course.ts:683](../src/scene/course.ts#L683)
![26-t1-rack-close](modeling/26-t1-rack-close.png)

**`27-t1-athlete`** — T1 慢走姿态 + 换项装备  
[athlete.ts:291](../src/scene/athlete.ts#L291) KIT · [athlete.ts:520](../src/scene/athlete.ts#L520) jog 分支
![27-t1-athlete](modeling/27-t1-athlete.png)

### 3.4 骑行段 330 – 950 m

**`30-bike-causeway`** — 堤道直路（路面 + 路缘 + 两侧水/坡）  
路面 [course.ts:334-336](../src/scene/course.ts#L334-L336) · 路缘 [course.ts:338-341](../src/scene/course.ts#L338-L341) · 沥青纹 [textures.ts:39](../src/scene/textures.ts#L39)
![30-bike-causeway](modeling/30-bike-causeway.png)

**`31-bike-mark-board`** — 里程/指示牌  
[course.ts:978-1005](../src/scene/course.ts#L978-L1005) · 文案 [config.ts:438](../src/config.ts#L438) · 版面 [textures.ts:222](../src/scene/textures.ts#L222)
![31-bike-mark-board](modeling/31-bike-mark-board.png)

**`32-bike-gate-arch`** — 骑行拱门侧面（立柱 + 斜撑 + 横梁）  
[course.ts:483-517](../src/scene/course.ts#L483-L517)
![32-bike-gate-arch](modeling/32-bike-gate-arch.png)

**`33-bike-gate-face`** — 骑行拱门正面（含门牌贴图）  
[course.ts:483-517](../src/scene/course.ts#L483-L517) · 门牌 [textures.ts:265](../src/scene/textures.ts#L265)
![33-bike-gate-face](modeling/33-bike-gate-face.png)

**`34-bike-hairpin`** — 发夹弯（本段最值得修的机位：草从沥青里顶出来、白线浮空）  
压弯 [config.ts:324](../src/config.ts#L324) · 弯道 [config.ts:463](../src/config.ts#L463) · 条带 [course.ts:302](../src/scene/course.ts#L302)
![34-bike-hairpin](modeling/34-bike-hairpin.png)

**`35-bike-hairpin-plan`** — 发夹弯正俯瞰（对比路面 8 列采样 vs 地形网格密度）  
[course.ts:302-316](../src/scene/course.ts#L302-L316) · [course.ts:84-101](../src/scene/course.ts#L84-L101)
![35-bike-hairpin-plan](modeling/35-bike-hairpin-plan.png)

**`36-bike-hairpin-arch`** — 发夹弯处拱门  
[course.ts:1026](../src/scene/course.ts#L1026) · [course.ts:936](../src/scene/course.ts#L936)
![36-bike-hairpin-arch](modeling/36-bike-hairpin-arch.png)

**`37-bike-cone-close`** — 锥桶  
几何 [scenery-models.ts:320](../src/scene/scenery-models.ts#L320) · 摆放 [course.ts:547](../src/scene/course.ts#L547)
![37-bike-cone-close](modeling/37-bike-cone-close.png)

**`38-bike-barrier`** — 人字纹路障木板  
[course.ts:574-589](../src/scene/course.ts#L574-L589) · 纹理 [textures.ts:332](../src/scene/textures.ts#L332)
![38-bike-barrier](modeling/38-bike-barrier.png)

**`39-bike-hazard-sign`** — 危险警示牌  
[course.ts:590-606](../src/scene/course.ts#L590-L606) · 纹理 [textures.ts:303](../src/scene/textures.ts#L303)
![39-bike-hazard-sign](modeling/39-bike-hazard-sign.png)

**`40-bike-ridge`** — 山脊路段（路最高，两侧直接掉下去）  
[config.ts:267](../src/config.ts#L267) `roadHeight` · 林 [course.ts:743](../src/scene/course.ts#L743)
![40-bike-ridge](modeling/40-bike-ridge.png)

**`41-bike-forest`** — 林带内部（松树 + 阔叶冠 + LOD 远近档）  
[pine](../src/scene/scenery-models.ts#L156) / [canopy](../src/scene/scenery-models.ts#L176) · LOD [course.ts:701-728](../src/scene/course.ts#L701-L728)
![41-bike-forest](modeling/41-bike-forest.png)

**`42-bike-athlete`** — 骑行主体（躯干/头盔/手是主要粗糙源）  
[athlete.ts:171](../src/scene/athlete.ts#L171) `makeBike` · 动作 [athlete.ts:499](../src/scene/athlete.ts#L499) · KIT [athlete.ts:292](../src/scene/athlete.ts#L292)
![42-bike-athlete](modeling/42-bike-athlete.png)

**`43-bike-frame-close`** — 车架特写（管径、几何角度）  
管架调用 [athlete.ts:202-215](../src/scene/athlete.ts#L202-L215) · 常量 [athlete.ts:159](../src/scene/athlete.ts#L159)
![43-bike-frame-close](modeling/43-bike-frame-close.png)

**`44-bike-camp-tent`** — 路边营地帐篷  
几何 [scenery-models.ts:332](../src/scene/scenery-models.ts#L332) · 营地分支 [course.ts:550-555](../src/scene/course.ts#L550-L555)
![44-bike-camp-tent](modeling/44-bike-camp-tent.png)

**`45-bike-descent-plan`** — 下坡段俯瞰（高差曲线是否顺滑看这张）  
[config.ts:267](../src/config.ts#L267) · [config.ts:324](../src/config.ts#L324)
![45-bike-descent-plan](modeling/45-bike-descent-plan.png)

**`46-bike-aid`** — 骑行补给门（桌 + 帐篷 + 牌）  
[course.ts:498-516](../src/scene/course.ts#L498-L516) · 位置 [config.ts:364](../src/config.ts#L364)
![46-bike-aid](modeling/46-bike-aid.png)

**`47-bike-asphalt`** — 沥青特写（裂纹贴图当前偏强）  
[textures.ts:39-81](../src/scene/textures.ts#L39-L81) · repeat [course.ts:330](../src/scene/course.ts#L330)
![47-bike-asphalt](modeling/47-bike-asphalt.png)

**`48-bike-gel`** — 能量胶补给物（胶囊 + 光环）  
[course.ts:611-648](../src/scene/course.ts#L611-L648) · 位置 [config.ts:426](../src/config.ts#L426)
![48-bike-gel](modeling/48-bike-gel.png)

### 3.5 换项区 T2 950 – 980 m

**`50-t2-entry`** — 进 T2 视角  
[course.ts:346](../src/scene/course.ts#L346) · T2 拱门 [course.ts:1027](../src/scene/course.ts#L1027)
![50-t2-entry](modeling/50-t2-entry.png)

**`51-t2-plan`** — T2 正俯瞰  
[course.ts:919-930](../src/scene/course.ts#L919-L930) · [config.ts:92](../src/config.ts#L92)
![51-t2-plan](modeling/51-t2-plan.png)

**`52-t2-rack-close`** — T2 架特写  
[scenery-models.ts:363](../src/scene/scenery-models.ts#L363)
![52-t2-rack-close](modeling/52-t2-rack-close.png)

**`53-t2-athlete`** — T2 装备  
KIT [athlete.ts:293](../src/scene/athlete.ts#L293)
![53-t2-athlete](modeling/53-t2-athlete.png)

**`54-t2-arch-face`** — T2 拱门正面  
[course.ts:936](../src/scene/course.ts#L936)
![54-t2-arch-face](modeling/54-t2-arch-face.png)

### 3.6 跑步段 980 – 1300 m

**`60-run-greenway`** — 绿道跟随视角  
跑道 [course.ts:354](../src/scene/course.ts#L354) · 纹理 [textures.ts:82](../src/scene/textures.ts#L82)
![60-run-greenway](modeling/60-run-greenway.png)

**`61-run-track-close`** — 跑道表面特写（颗粒 + 分道白线）  
[textures.ts:82-105](../src/scene/textures.ts#L82-L105) · repeat [course.ts:349](../src/scene/course.ts#L349)
![61-run-track-close](modeling/61-run-track-close.png)

**`62-run-aid-gate`** — 跑步补给门  
[course.ts:498-516](../src/scene/course.ts#L498-L516)
![62-run-aid-gate](modeling/62-run-aid-gate.png)

**`63-run-aid-tent`** — 补给帐篷  
帐篷几何 [scenery-models.ts:332](../src/scene/scenery-models.ts#L332) · 生成 [course.ts:512](../src/scene/course.ts#L512)
![63-run-aid-tent](modeling/63-run-aid-tent.png)

**`64-run-furniture-line`** — 观赛带家具排（旗/灯/看台/护栏成排）  
清单 [course.ts:848-853](../src/scene/course.ts#L848-L853) · 混合排布 [course.ts:886-897](../src/scene/course.ts#L886-L897)
![64-run-furniture-line](modeling/64-run-furniture-line.png)

**`65-run-lamp-close`** — 路灯  
几何 [scenery-models.ts:437](../src/scene/scenery-models.ts#L437) · 摆放 [course.ts:899-908](../src/scene/course.ts#L899-L908)
![65-run-lamp-close](modeling/65-run-lamp-close.png)

**`66-run-reed-close`** — 芦苇丛  
几何 [scenery-models.ts:194](../src/scene/scenery-models.ts#L194) · 岸线循环 [course.ts:789-803](../src/scene/course.ts#L789-L803)
![66-run-reed-close](modeling/66-run-reed-close.png)

**`67-run-stand-close`** — 观众看台  
几何 [scenery-models.ts:391-416](../src/scene/scenery-models.ts#L391-L416) · 摆放 [course.ts:909-918](../src/scene/course.ts#L909-L918)
![67-run-stand-close](modeling/67-run-stand-close.png)

**`68-run-athlete`** — 跑步主体  
动作 [athlete.ts:520-543](../src/scene/athlete.ts#L520-L543)（步幅/抬腿 [:525-526](../src/scene/athlete.ts#L525-L526)）· KIT [athlete.ts:294](../src/scene/athlete.ts#L294)
![68-run-athlete](modeling/68-run-athlete.png)

**`69-run-beach`** — 沙滩地标区  
[config.ts:449](../src/config.ts#L449) MARKS · 沙色顶点色 [course.ts:150-169](../src/scene/course.ts#L150-L169)
![69-run-beach](modeling/69-run-beach.png)

**`70-run-flag-close`** — 场地旗  
几何 [scenery-models.ts:417](../src/scene/scenery-models.ts#L417) · 摆放 [course.ts:875-882](../src/scene/course.ts#L875-L882)
![70-run-flag-close](modeling/70-run-flag-close.png)

**`71-run-promenade`** — 护栏 + 连续横幅  
护栏条 [course.ts:864-874](../src/scene/course.ts#L864-L874) · 横幅 UV 平铺 [course.ts:855-860](../src/scene/course.ts#L855-L860)
![71-run-promenade](modeling/71-run-promenade.png)

**`72-run-arena-plan`** — 终点场正俯瞰  
`ARENA_FROM` [course.ts:22](../src/scene/course.ts#L22) · 总装 [course.ts:845-932](../src/scene/course.ts#L845-L932)
![72-run-arena-plan](modeling/72-run-arena-plan.png)

**`73-run-finish-arch`** — 终点拱门  
[course.ts:1028](../src/scene/course.ts#L1028) · [course.ts:936](../src/scene/course.ts#L936)
![73-run-finish-arch](modeling/73-run-finish-arch.png)

**`74-run-finish-line`** — 终点地毯 + 黑白格  
[course.ts:356-368](../src/scene/course.ts#L356-L368) · 格子 [textures.ts:351](../src/scene/textures.ts#L351)
![74-run-finish-line](modeling/74-run-finish-line.png)

---

## 4. 图上确认存在的粗糙点（改动优先级从高到低）

| # | 现象 | 出现图 | 代码位置 | 可试的改法 |
| --- | --- | --- | --- | --- |
| 1 | 发夹弯处草地穿透沥青，路缘白线浮空 | `34/35/36` | 路面 8 列采样 [course.ts:302-316](../src/scene/course.ts#L302-L316) vs 地形 [course.ts:84-101](../src/scene/course.ts#L84-L101)；路缘 [course.ts:318-325](../src/scene/course.ts#L318-L325) | 提高 `ribbon` 列数；路缘高度改用 `surfaceHeight` 同采样，或贴地偏移 |
| 2 | 出发浮台甲板盖住运动员上半身 | `12` 对比 `10/11` | 浮台 [course.ts:399-410](../src/scene/course.ts#L399-L410) 与出生高度 [config.ts:349](../src/config.ts#L349) | 浮台降到水面以下一点，或出生点沿 s 前移出浮台 |
| 3 | 水面读作横向条纹，不是涟漪 | 全部含水的图 | 片元用世界 x 正弦 [course.ts:277-281](../src/scene/course.ts#L277-L281) | 改成沿 `s/u` 的坐标 + 法线贴图 [textures.ts:184](../src/scene/textures.ts#L184) 混合 |
| 4 | 水域多边形边缘呈台阶锯齿 | `11/19/21` | 扫描步长 s 6 m / u 9 m [course.ts:204](../src/scene/course.ts#L204)、[:231](../src/scene/course.ts#L231) | 步长减半 + 顶点色 `aEdge` 羽化加宽 |
| 5 | 骑行车手躯干是方板、头盔是团、手是光棍 | `42/43` | 躯干盒 [athlete.ts:307](../src/scene/athlete.ts#L307)、头盔 [athlete.ts:292](../src/scene/athlete.ts#L292)、`capsule` [athlete.ts:40](../src/scene/athlete.ts#L40) | 躯干用 `roundedBox` 加大圆角 + 肩胛；手加小掌块 |
| 6 | T1/T2 空旷：大片素色铺装，架子在路面外 4.8 m | `22/24/25/50/51` | 摆放 [course.ts:919-930](../src/scene/course.ts#L919-L930)、铺装 [course.ts:343](../src/scene/course.ts#L343) | 架位收进 `u=±(hw-1.5)`；补地面标线、地垫、自行车靠架 |
| 7 | 远山像锥片，雾墙在天上留一条灰带 | `00-horizon-hills` | [environment.ts:73](../src/scene/environment.ts#L73) / [:144](../src/scene/environment.ts#L144) | 提高 `SUMMITS` 采样、雾墙改渐变透明顶部 |
| 8 | 看台只有 4 级台阶 + 一块背板，下方透光 | `64/67` | [scenery-models.ts:391-416](../src/scene/scenery-models.ts#L391-L416) | 补实心侧墙/底座 + 座椅实例 |
| 9 | 沥青裂纹过强，近看像碎瓷 | `47` | [textures.ts:39-81](../src/scene/textures.ts#L39-L81) | 降低裂纹 alpha、加大噪点、减小 repeat |
| 10 | 树木间距固定成行 | `40/41` | 步距 4.4 m [course.ts:751](../src/scene/course.ts#L751) | 加泊松抖动 + 半径/朝向随机缩放 |
| 11 | 里程牌读作"悬空空板" | `31` | [course.ts:978-1005](../src/scene/course.ts#L978-L1005) | 双柱改单柱落沙 + 底座 |
| 12 | 补给胶是胶囊 + 圆环，像泡泡 | `48` | [course.ts:611-648](../src/scene/course.ts#L611-L648) | 换成纸杯/水瓶轮廓（`profileOf` 够用） |

---

## 5. 重拍与自定义机位

```bash
npm run dev                       # 127.0.0.1:5193
# 另一个终端，起一个带调试端口的无头 Chrome
chrome.exe --headless=new --remote-debugging-port=9230 --user-data-dir=%TEMP%/chrome-shots
npm run shots                     # 61 张全部重出 → docs/modeling/
SHOT_FILTER="hairpin|pontoon" npm run shots   # 只重拍关心的机位
```

可用环境变量（[capture-scenes.mjs](../scripts/capture-scenes.mjs) 顶部）：`CDP_PORT` 9230、`SHOT_URL` http://127.0.0.1:5193/、`SHOT_WIDTH/HEIGHT` 1280×800、`SHOT_FILTER`、`SHOT_DIR` docs/modeling。

改机位只改 `SHOTS` 数组：`{ file, s, u?, fx/fz/side/up/fov?, live? }`。
- 不带 `live`：把主体瞬移到 `s` 并冻结，适合纯道具（`prop()`/`named()` 还能直接对准某个实例）。
- 带 `live: true`：跑 0.9 s 后暂停，抓真实姿态，适合 `18/27/42/53/68` 这五张人物图。
- 只想在浏览器里手调：控制台执行 `__lakeline.objects().inspectView = { position:[x,y,z], target:[x,y,z], fov:42 }`，置 `null` 交回跟随相机。实现见 [scene.ts:31](../src/scene/scene.ts#L31)、[:269](../src/scene/scene.ts#L269)。

## 6. 面数 / 批次参考（来自 manifest.json）

| 机位 | draw calls | 三角 |
| --- | --- | --- |
| `00-plan-swim` | 57 | 128 k |
| `15-swim-buoy-close` | 55 | 152 k |
| `42-bike-athlete` | 75 | 177 k |
| `60-run-greenway` | 254 | 268 k |
| `34-bike-hairpin` | 485 | 335 k |
| `10-swim-start`（最高 calls） | 643 | — |
| `73-run-finish-arch`（最高面数） | — | 362 k |

场景常驻统计：`{ mobile:false, terrain:{columns:89, rows:376, vertices:33464}, water:{vertices:9591, rows:417}, trees:488, shore:99, islands:2, furniture:119, gates:17, pickups:30, obstacles:15, marks:12 }`。

结论：**加细节前先加在实例数少的地方**（门、拱门、架、看台、道具顶点预算都很宽裕）；林带和地形已经吃掉大头，`34/10` 这类机位 calls 高，主要是分块 LOD 切换边界，加模型时优先复用 `addChunks` 的实例通道，别新增独立 Mesh。
