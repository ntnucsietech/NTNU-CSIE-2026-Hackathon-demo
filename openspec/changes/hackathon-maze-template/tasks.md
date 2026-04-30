# Implementation Tasks: Hackathon Maze RPG Template

## Phase 1: Project Setup

- [x] 建立 `index.html`, `style.css`, `engine.js`, `data.js`, `student.js` 基本檔案
- [x] 建立 `assets/` 資料夾（含 `sounds/` 子資料夾）
- [x] 在 `index.html` 中建立四個主要畫面容器：`#screen-map`、`#screen-combat`、`#screen-shop`、`#screen-minigame`
- [x] 在 `engine.js` 中建立畫面切換工具函式 `showScreen(screenId)`

## Phase 2: Asset Generation

- [x] 使用 AI 生成並儲存預設 Sprite 圖片：`player.png`、`enemy.png`、`boss.png`、`chest.png`、`door.png` 到 `assets/`（`shop.png`/`minigame.png` 因配額限制改用 emoji 備援）
- [x] 建立 `assets/sounds/` 預留資料夾（本版本為空）
- [x] 在 `engine.js` 預留 `playSound(name)` 空函式

## Phase 3: Data Layer

- [x] 在 `data.js` 定義 `MAP_TILE` 常數物件（0–9 格子類型）
- [x] 在 `data.js` 定義預設 10×10 `mapGrid` 二維陣列（含所有事件格）
- [x] 在 `data.js` 定義 `playerStart`, `visionRadius`, `playerStats`
- [x] 在 `data.js` 定義 `enemies` 陣列、`shopItems` 陣列、`chestRewards` 陣列
- [x] 在 `data.js` 定義小遊戲參數 `MG_TARGET`, `MG_TIME`, `MG_ENEMY_DURATION`

## Phase 4: Core Engine

- [x] 在 `engine.js` 實作 `renderMap()` 函式（Flex 排列，每格依類型套用 class）
- [x] 在 `engine.js` 實作 `updateVision()` 函式（Chebyshev 距離，套用 `.tile--hidden` / `.tile--explored`）
- [x] 在 `engine.js` 實作鍵盤移動監聽（`keydown` WASD/方向鍵），碰撞判定後更新玩家座標
- [x] 在 `engine.js` 實作 `checkTileEvent(x, y)` 事件分派（CHEST/ENEMY/DOOR/MINI_GAME/SHOP/FINAL_BOSS）
- [x] 在 `engine.js` 實作狀態更新 API：`updatePlayerHp`, `updatePlayerAtk`, `updatePlayerDef`, `updatePlayerMoney`, `updatePlayerKeys`, `logMessage`, `updateHUD`

## Phase 5: UI Screens

- [x] 在 `index.html` + `style.css` 設計戰鬥畫面（敵人/玩家 HP 條、Log 框、攻擊/防禦/逃跑按鈕）
- [x] 在 `index.html` + `style.css` 設計商店畫面（道具卡片列表、金幣顯示、關閉按鈕）
- [x] 在 `index.html` + `style.css` 設計 HUD 資訊欄（HP / 金幣 / 鑰匙數量）
- [x] 在 `engine.js` 中實作商店邏輯（購買確認、扣金幣、套用效果）

## Phase 6: Combat Logic Hook

- [x] 在 `engine.js` 串接戰鬥按鈕點擊到 `playerTurn()` Hook，執行回合流程（玩家→敵人→勝敗判定）
- [x] 在 `student.js` 提供 `playerTurn(action, player, enemy)` 與 `enemyTurn(player, enemy)` 函式骨架（含詳細中文注解與範例傳統 RPG 邏輯）

## Phase 7: Mini-game

- [x] 實作射擊小遊戲：滑鼠移動準心、定時在隨機位置靜止出現敵人圖示（停留 MG_ENEMY_DURATION 秒後消失）、點擊命中偵測、倒計時條、過關/失敗回呼 `onMiniGameEnd(result)`

## Phase 8: Styling

- [x] 在 `style.css` 完成基礎 Tile 樣式（固定 60px、`.tile--hidden`、`.tile--explored`）
- [x] 在 `style.css` 完成 HP 條（`<div>` 寬度動態更新，`transition: width 0.3s`）
- [x] 在 `style.css` 完成 Hover 動畫（`transition` + `transform: scale()`）

## Phase 9: Integration Testing

- [x] 確認玩家可在地圖上正常移動並觸發所有事件格（寶箱、敵人、門、小遊戲、商店、最終 Boss）
- [x] 確認霧中探索遮罩正確顯示/隱藏/已探索狀態
- [x] 確認完整戰鬥回合流程（攻擊→敵人回合→勝利→返回地圖）
- [x] 確認商店購買（金幣扣除、屬性更新）
- [x] 確認門與鑰匙邏輯（不足無法通過、通過後消耗）
- [x] 確認小遊戲完整流程（進入→射擊→通關/失敗→返回地圖）
- [x] 確認最終 Boss 戰鬥後觸發通關畫面

## Phase 10: Bug Fixes

- [x] 修正 `visitedTiles` 重複 push（每次渲染都追加同一格）
- [x] 修正戰鬥按鈕在敵人回合期間未鎖定（可重複點擊造成狀態損壞）
- [x] 修正 `triggerMiniGame` 啟動順序（先顯示畫面再啟動遊戲，避免計時器問題）

## Phase 11: Press Turn System

- [x] `data.js` 新增 `COMBAT_MODE`（`"traditional"` / `"press_turn"`）
- [x] `data.js` 新增 `PRESS_TURN_TOKENS`（令牌數量）
- [x] `index.html` 新增 `#press-turn-display`（令牌顯示區，含玩家/敵人兩列）
- [x] `style.css` 新增令牌顯示樣式與 `btn:disabled` 樣式
- [x] `engine.js` 新增 `setCombatButtonsEnabled()` 函式
- [x] `engine.js` 新增 `updateTokenDisplay()` 函式
- [x] `engine.js` 重構 `executeCombatRound()`：加入按鈕鎖定、Press Turn token 邏輯
- [x] `engine.js` 新增 `runEnemyPhase()` / `runNextEnemyTurn()` / `startNewCombatRound()`
- [x] `engine.js` 修改 `startCombat()` 初始化令牌
- [x] `student.js` `playerTurn` / `enemyTurn` 回傳物件新增 `bonusTurn`、`loseTurn` 欄位
- [x] `student.js` 加入 Press Turn 範例程式碼（暴擊/空擊觸發條件）

## Phase 12: Dialogue System

- [x] `data.js` 新增 `dialogues` 物件（`intro`、`boss_pre`、`shop_first`）
- [x] `index.html` 新增 `#screen-dialogue`（獨立對話框畫面）
- [x] `style.css` 新增對話框樣式（底部對話視窗風格）
- [x] `engine.js` 新增 `showDialogue(lines, callback)` 函式
- [x] `engine.js` 新增 `advanceDialogue()` 函式（對話框「下一頁」邏輯）
- [x] `engine.js` `window.onload` 串接開場對話 `dialogues.intro`
- [x] `engine.js` `triggerFinalBoss()` 串接戰前對話 `dialogues.boss_pre`
- [x] `engine.js` `triggerShop()` 串接首次商店對話 `dialogues.shop_first`
