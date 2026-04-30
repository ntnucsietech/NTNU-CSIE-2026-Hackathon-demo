# Specification: Game Template Constraints & Rules

## 1. File Structure

| 檔案 | 職責 | 學員可修改？ |
|---|---|---|
| `index.html` | 所有畫面容器（迷宮、戰鬥、商店、小遊戲） | ✅ 可 |
| `style.css` | 版面配置（Flex）、各格外觀、動畫 | ✅ 可 |
| `engine.js` | 核心引擎（渲染、移動、霧中探索、事件觸發、狀態 API） | ⛔ 不建議 |
| `data.js` | 地圖陣列、角色數值、敵人清單、物品、對話 | ✅ 核心 |
| `student.js` | 戰鬥 Hook、小遊戲完成回調 | ✅ 核心 |
| `assets/` | 所有圖片 Sprite、音效（預留）| ✅ 可替換 |

---

## 2. Map Grid Specification

- 地圖以二維陣列 `mapGrid` 定義，預設大小 10×10，但可由學員自行調整。
- 每一格大小固定（建議 60px × 60px），整張地圖以 `display: flex; flex-wrap: wrap` 渲染。
- 格子數值對應表：

| 數值 | 常數名 | 說明 |
|---|---|---|
| `0` | `EMPTY` | 空地，可通行 |
| `1` | `WALL` | 牆壁，不可通行 |
| `2` | `CHEST` | 寶箱，踩到觸發掉落獎勵，踩後轉為空地 |
| `3` | `ENEMY` | 一般敵人，觸發戰鬥，戰鬥勝利後轉為空地 |
| `4` | `DOOR` | 門，需持有鑰匙（`keys > 0`）才可通行，通行後消耗 1 把鑰匙並轉為空地 |
| `5` | `MINI_GAME` | 小遊戲觸發點，通關後轉為空地並給予鑰匙 |
| `6` | `SHOP` | 商店，首次踩到後永久可用（不轉換為空地） |
| `9` | `FINAL_BOSS` | 最終 Boss，擊敗後觸發過關畫面 |

- `playerStart` 定義玩家出生座標 `{ x, y }`，一定要是可通行格（值為 `0`）。
- 商店格可選擇性放在 10×10 主地圖以外的區域（例如固定 UI 按鈕形式），由 `shopAlwaysOpen: true` 設定控制。

---

## 3. Vision System Specification

- `visionRadius`（預設值 `2`）定義玩家視野半徑，以 Chebyshev 距離計算。
- 超出 `visionRadius` 的格子套用 CSS class `.tile--hidden`（例如深色半透明遮罩）。
- 玩家走過、曾經看過的格子，保留在一個 `visitedTiles` 陣列中，可選擇套用「已探索但現不在視野內」的淡化樣式（`.tile--explored`）。

---

## 4. Movement & Collision Specification

- 使用 `keydown` 監聽 WASD 或方向鍵觸發移動。
- 每次移動前確認目標格不是 `WALL (1)`，否則無視按鍵。
- 移動完成後，判斷當前格的數值，觸發對應事件（見第 2 節表格）。

---

## 5. Combat System Specification

### 界面（Engine 負責）
- 顯示：玩家 HP 條、敵人 HP 條、回合訊息 Log 框、行動按鈕。
- 預設按鈕：**攻擊**、**防禦**、**逃跑**。
- 按下按鈕後，Engine 呼叫 `student.js` 中的 `playerTurn(action, player, enemy)` Hook。

### Hook 規格 (student.js)
```
playerTurn(action, player, enemy)
  → 回傳 { enemyDamage, playerDefense, playerFlee, message }

enemyTurn(player, enemy)
  → 回傳 { playerDamage, message }
```
- `enemyDamage`：對敵人造成的傷害（數字）。
- `playerDefense`：是否進入防禦狀態（下一次被打時減傷，布林）。
- `playerFlee`：是否逃跑成功（布林）。
- `message`：顯示在 Log 框的文字（字串）。

### 回合流程（Engine 負責）
1. 顯示三個按鈕，等待玩家點擊。
2. 呼叫 `playerTurn()`，根據回傳結果扣敵人 HP、顯示 Log。
3. 檢查敵人是否死亡（HP ≤ 0）→ 若是：結算戰鬥勝利、給予 `enemy.reward`。
4. 若敵人未死：呼叫 `enemyTurn()`，根據回傳結果扣玩家 HP、顯示 Log。
5. 檢查玩家是否死亡（HP ≤ 0）→ 若是：觸發 Game Over。
6. 若雙方存活：重複回到第 1 步。

---

## 6. Mini-game Specification

- 預設小遊戲：**滑鼠射擊遊戲**
  - 玩家移動滑鼠控制準心（`<div id="crosshair">`），點擊左鍵射擊出現在畫面上的敵人。
  - 敵人行為：**單點靜止出現** → 停留約 1.5 秒 → 自動消失，接著在另一個隨機位置重新出現。敵人不會移動，玩家需在消失前點擊才算命中。
  - 計時 30 秒，在時間內擊中達到門檻數量（預設 `MG_TARGET = 5` 隻）視為通關。
  - 通關後呼叫 `onMiniGameEnd(true)`，失敗呼叫 `onMiniGameEnd(false)`。
  - 學員可調整的參數（寫在 `data.js`）：`MG_TARGET`（目標擊中數）、`MG_TIME`（秒數）、`MG_ENEMY_DURATION`（敵人停留秒數）。
- Engine 的 `onMiniGameEnd(result)` 將切換回迷宮畫面，並：
  - `result === true`：呼叫 `updatePlayerKeys(1)`，並顯示「你獲得了一把鑰匙！」
  - `result === false`：顯示「小遊戲失敗，格子保留，可再次嘗試。」

---

## 7. Shop Specification

- 商店顯示 `shopItems` 陣列中所有道具，每個道具顯示：名稱、效果、價格。
- 玩家點擊購買：確認 `player.money >= item.price`，若足夠則扣錢並套用效果。
- 套用效果呼叫對應的 `updatePlayer*()` 函式。

---

## 8. JS Syntax Constraints (Hard Rules)

| 允許 ✅ | 禁止 ❌ |
|---|---|
| `var`, `let`, `const` | `class` 關鍵字 |
| 一般 `function` 宣告 | 箭頭函式 `=>` |
| `forEach`, `for` loop | `Promise`, `async/await` |
| 全域變數 | 直接修改 `playerStats.hp` 等（須透過 API 函式） |
| `document.getElementById` / `.querySelector` | 複雜的解構賦值 `const { a, b } = obj` |

---

## 9. Sound Effects (預留，本版本不實作)

- `assets/sounds/` 資料夾預留音效位置：`attack.mp3`、`chest.mp3`、`victory.mp3`、`defeat.mp3`、`bgm.mp3`。
- Engine 中預留 `playSound(name)` 函式（目前為空實作 `function playSound(name) {}`），之後學員或後續版本可補充。

---

## 10. CSS Constraints

- 版面排版限用 `display: flex` 及其屬性（`flex-direction`, `justify-content`, `align-items`, `flex-wrap`）。
- 禁止使用 `display: grid` 或任何 Grid 相關屬性。
- 動畫限用 `transition` 搭配 `transform: scale()` / `opacity` 實現（例如 Hover 放大圖示）。
