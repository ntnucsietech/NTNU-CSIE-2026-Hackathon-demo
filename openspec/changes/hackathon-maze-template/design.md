# Design: Hackathon Maze RPG Template

## Architecture Overview
系統主要分為五個層級（檔案劃分），以保護核心不被改壞，並提供學生足夠的自由度：

| 檔案 | 可修改 | 用途 |
|---|---|---|
| `index.html` | ✅ 可 | HTML 骨架，標示各畫面容器 |
| `style.css` | ✅ 可 | 版面配置、Hover 動畫、各格子外觀 |
| `engine.js` | ⛔ 不建議 | 核心引擎：移動、碰撞、霧中探索、事件觸發 |
| `data.js` | ✅ 核心 | 地圖陣列、角色/敵人數值、物品、對話文本 |
| `student.js` | ✅ 核心 | 戰鬥與小遊戲邏輯 Hook（學員主要工作區） |

---

## Data Structure Design

### 1. 迷宮地圖 (Map Grid)
使用二維陣列代表迷宮（預設 10×10），數值對應格子類型：

```javascript
// data.js
const MAP_TILE = {
  EMPTY:      0,
  WALL:       1,
  CHEST:      2,
  ENEMY:      3,
  DOOR:       4,   // 需要鑰匙才能通過
  MINI_GAME:  5,   // 射擊小遊戲，通關獲得鑰匙
  SHOP:       6,   // 首次踩到後永久可用
  FINAL_BOSS: 9
};

const mapGrid = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 2, 1, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 4, 0, 3, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  [1, 5, 1, 0, 1, 0, 0, 0, 6, 1],  // 5=小遊戲, 6=商店
  [1, 0, 0, 0, 1, 1, 0, 0, 0, 1],
  [1, 1, 0, 3, 0, 0, 1, 2, 0, 1],
  [1, 0, 0, 1, 1, 0, 0, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 9, 1],  // 9=最終 Boss
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
];

const playerStart = { x: 1, y: 1 }; // 出生點
```

### 2. 角色與敵人配置
```javascript
// data.js
const playerStats = {
  hp: 100, maxHp: 100,
  atk: 15, def: 5,
  money: 0, keys: 0
};

const enemies = [
  { name: "哥布林",  hp: 30, maxHp: 30, atk: 8,  def: 2, reward: { money: 10 } },
  { name: "骷髏武士", hp: 55, maxHp: 55, atk: 14, def: 6, reward: { money: 20 } },
  { name: "魔王",    hp: 200, maxHp: 200, atk: 25, def: 10, reward: { money: 50 } }
];
```

### 3. 商店與寶箱掉落物
```javascript
// data.js
const shopItems = [
  { name: "攻擊強化藥水",  price: 20, effect: { atk: 5 }  },
  { name: "防禦強化藥水",  price: 15, effect: { def: 3 }  },
  { name: "血量恢復藥水",  price: 10, effect: { hp:  30 } }
];

const chestRewards = [
  { money: 15 },
  { hp: 20 },
  { atk: 3 }
];
```

---

## Vision System (霧中探索)

玩家只能看到以自身為中心、**半徑 2 格**內的格子（可在 `data.js` 調整 `visionRadius`）。
Engine 在渲染每一格時，會計算該格與玩家的 Chebyshev 距離，超過視野範圍的格子套用 `.tile--hidden` CSS class（例如深色遮罩），讓玩家需要探索才能看到地圖。

```
  ████ ████ ████ ████ ████
  ████  ░░   ░░   ░░  ████
  ████  ░░   @    ░░  ████    ← 視野半徑 2
  ████  ░░   ░░   ░░  ████
  ████ ████ ████ ████ ████
```

---

## Sprite System (角色外觀)

每種格子類型對應一張圖片（放在 `assets/` 資料夾）。預設由 AI 生成，學員可直接替換同名圖片，無需修改任何 JS。

```
assets/
  player.png        ← 玩家角色
  enemy.png         ← 一般敵人
  boss.png          ← 最終 Boss
  chest.png         ← 寶箱
  door.png          ← 門（需要鑰匙）
  shop.png          ← 商店
  minigame.png      ← 小遊戲觸發點
  wall.png          ← 牆壁（或純 CSS 顏色）
```

---

## Combat System Design (回合制)

戰鬥介面（HTML 畫面）由框架預先設計，學員只需在 `student.js` 的 Hook 中填寫邏輯。

```
┌─────────────────────────────────┐
│  [敵人名稱]  HP: ██████░░    45 │
│  [你的名稱]  HP: ████████    80 │
├─────────────────────────────────┤
│  > 敵人使用了 普通攻擊！         │
│    造成了 8 點傷害！              │
│    你使用了 攻擊！ 造成 12 傷害！ │
├─────────────────────────────────┤
│  [ 攻擊 ]  [ 防禦 ]  [ 逃跑 ]  │
└─────────────────────────────────┘
```

### Combat Hooks (student.js 的工作區)
```javascript
// student.js
// 【學員任務】在這個函式裡填寫每一回合的攻擊/防禦邏輯

function playerTurn(action, player, enemy) {
  // action 可以是 "attack"、"defend"、"flee"
  // 回傳一個 result 物件，engine 會用它來更新畫面

  let result = { playerDamage: 0, enemyDamage: 0, playerFlee: false, message: "" };

  if (action === "attack") {
    // 學員在這裡計算傷害
    result.enemyDamage = player.atk - enemy.def;
    result.message = "你發動了攻擊！";
  }

  if (action === "defend") {
    // 學員可以設計防禦的效果
    result.message = "你擺出了防禦姿態！";
  }

  return result;
}

function enemyTurn(player, enemy) {
  // 學員在這裡設計敵人 AI 邏輯（最簡單：直接普通攻擊）
  let result = { playerDamage: 0, message: "" };
  result.playerDamage = enemy.atk - player.def;
  result.message = enemy.name + " 攻擊了你！";
  return result;
}
```

---

## Mini-game Subsystem (射擊小遊戲)

踩到 `MINI_GAME (5)` 格後，迷宮畫面切換為小遊戲畫面（`display: none` / `display: flex`）。

**預設小遊戲範例：滑鼠射擊**
- 玩家拖動滑鼠移動準心，點擊左鍵射擊出現在畫面上的敵人。
- 計時 30 秒或 HP 歸零時遊戲結束，擊中足夠敵人則過關。
- 在 `student.js` 裡，回傳 `miniGameResult = true/false` 給引擎。
- Engine Hook：`onMiniGameEnd(result)` → 若 `true` 自動 `player.keys++`，可由學員決定其他獎勵。

---

## State Management Rules

- 允許全域變數（掛在 `window` 或直接宣告在最外層的 `var/let/const`）。
- **禁止直接修改全域物件屬性**，所有狀態更新必須透過 engine 提供的函式：
  - `updatePlayerHp(amount)` — 更新 HP（負數為扣血，正數為回血）
  - `updatePlayerAtk(amount)` — 更新攻擊力
  - `updatePlayerMoney(amount)` — 更新金幣
  - `updatePlayerKeys(amount)` — 更新鑰匙數量
  - `logMessage(text)` — 在戰鬥 log 框輸出文字

## DOM & Styling Approach

- 不用 Canvas，全部使用 `<div>` 排列格子（每格固定像素大小）。
- 迷宮容器使用 `display: flex; flex-wrap: wrap` 排列所有格子，配合固定格子寬度達到換行效果（排列成方形地圖）。
- 各格子加上對應 `class`（如 `.tile--wall`、`.tile--hidden`、`.tile--chest`）控制外觀。
- Hover 效果與 UI 動畫統一在 `style.css` 中以 `transition` + `transform: scale()` 實現。
