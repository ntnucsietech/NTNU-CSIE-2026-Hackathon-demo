// ============================================================
//  engine.js  ── 遊戲核心引擎
// ============================================================

// ── 偽隨機數（固定種子，保證地圖每次相同） ────────────────────
function makeRng(seed) {
  var s = (seed >>> 0) || 1;
  return function() {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 用固定種子洗牌（地圖生成用）
function shuffleSeeded(arr, rng) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

// 記錄兩道隔牆的 x 座標，供 triggerEnemy 判斷敵人強度
var mazeDivX1 = -1;
var mazeDivX2 = -1;

// ── 迷宮生成：三區分隔，固定種子 ────────────────────────────
// A區（左）→ 門1 → B區（中）→ 門2 → C區（右，鎖定）
function generateMaze() {
  var W = (typeof MAP_WIDTH  !== "undefined") ? MAP_WIDTH  : 33;
  var H = (typeof MAP_HEIGHT !== "undefined") ? MAP_HEIGHT : 27;
  if (W % 2 === 0) W++;
  if (H % 2 === 0) H++;

  var seed = (typeof MAP_SEED !== "undefined") ? MAP_SEED : 42;
  var rng  = makeRng(seed);

  var grid = [];
  for (var y = 0; y < H; y++) {
    var row = [];
    for (var x = 0; x < W; x++) row.push(MAP_TILE.WALL);
    grid.push(row);
  }

  // 三等分隔牆（偶數 x 座標）
  var d1 = Math.floor(W / 3);
  if (d1 % 2 !== 0) d1++;
  var d2 = Math.floor(W * 2 / 3);
  if (d2 % 2 !== 0) d2++;
  mazeDivX1 = d1;
  mazeDivX2 = d2;

  // A 區 (x: 1 到 d1-1)
  generateMazeSection(grid, 1,    1, d1 - 1, H - 2, 1,    1, rng);
  // B 區 (x: d1+1 到 d2-1)
  var bx0 = d1 + 1; if (bx0 % 2 === 0) bx0++;
  generateMazeSection(grid, d1+1, 1, d2 - 1, H - 2, bx0,  1, rng);
  // C 區 (x: d2+1 到 W-2)
  var cx0 = d2 + 1; if (cx0 % 2 === 0) cx0++;
  generateMazeSection(grid, d2+1, 1, W  - 2, H - 2, cx0,  1, rng);

  // 各區內部增加迴路（更連通）
  addExtraConnections(grid, W, H, d1, d2, 0.4, rng);

  // 兩道門位置錯開（上 1/3 和下 2/3）
  var row1 = Math.floor(H / 3);     if (row1 % 2 === 0) row1++;
  var row2 = Math.floor(H * 2 / 3); if (row2 % 2 === 0) row2++;
  grid[row1][d1] = MAP_TILE.DOOR;
  grid[row2][d2] = MAP_TILE.DOOR;

  placeTilesOnMaze(grid, W, H, d1, d2, rng);
  return grid;
}

function generateMazeSection(grid, x1, y1, x2, y2, startX, startY, rng) {
  var visited = {};
  var stack   = [];
  grid[startY][startX] = MAP_TILE.EMPTY;
  visited[startX + "," + startY] = true;
  stack.push({ x: startX, y: startY });

  var dirs = [{ dx: 2, dy: 0 }, { dx: -2, dy: 0 },
              { dx: 0, dy: 2 }, { dx:  0, dy: -2 }];

  while (stack.length > 0) {
    var cur = stack[stack.length - 1];
    var nb  = [];
    for (var i = 0; i < dirs.length; i++) {
      var nx = cur.x + dirs[i].dx;
      var ny = cur.y + dirs[i].dy;
      if (nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2 &&
          !visited[nx + "," + ny]) {
        nb.push({ x: nx, y: ny,
                  wx: cur.x + dirs[i].dx / 2,
                  wy: cur.y + dirs[i].dy / 2 });
      }
    }
    if (nb.length > 0) {
      var next = nb[Math.floor(rng() * nb.length)];
      grid[next.wy][next.wx] = MAP_TILE.EMPTY;
      grid[next.y][next.x]   = MAP_TILE.EMPTY;
      visited[next.x + "," + next.y] = true;
      stack.push({ x: next.x, y: next.y });
    } else {
      stack.pop();
    }
  }
}

// 隨機打通各區內部的牆，增加迴路，不跨越隔牆
function addExtraConnections(grid, W, H, d1, d2, prob, rng) {
  for (var y = 1; y < H - 1; y++) {
    for (var x = 1; x < W - 1; x++) {
      if (x === d1 || x === d2) continue;
      if (grid[y][x] !== MAP_TILE.WALL) continue;
      if (rng() > prob) continue;
      var hOk = grid[y][x-1] === MAP_TILE.EMPTY && grid[y][x+1] === MAP_TILE.EMPTY;
      var vOk = grid[y-1][x] === MAP_TILE.EMPTY && grid[y+1][x] === MAP_TILE.EMPTY;
      if (hOk || vOk) grid[y][x] = MAP_TILE.EMPTY;
    }
  }
}

function placeTilesOnMaze(grid, W, H, d1, d2, rng) {
  var sx = playerStart.x, sy = playerStart.y;

  function openCount(c) {
    var n = 0;
    if (grid[c.y-1] && grid[c.y-1][c.x] === MAP_TILE.EMPTY) n++;
    if (grid[c.y+1] && grid[c.y+1][c.x] === MAP_TILE.EMPTY) n++;
    if (grid[c.y][c.x-1] === MAP_TILE.EMPTY) n++;
    if (grid[c.y][c.x+1] === MAP_TILE.EMPTY) n++;
    return n;
  }

  var secA = [], secB = [], secC = [];
  for (var y = 1; y < H - 1; y++) {
    for (var x = 1; x < W - 1; x++) {
      if (grid[y][x] !== MAP_TILE.EMPTY) continue;
      if      (x < d1 && !(x === sx && y === sy)) secA.push({ x: x, y: y });
      else if (x > d1 && x < d2)                  secB.push({ x: x, y: y });
      else if (x > d2)                             secC.push({ x: x, y: y });
    }
  }

  var deadA = secA.filter(function(c) { return openCount(c) === 1; });
  var deadB = secB.filter(function(c) { return openCount(c) === 1; });
  var deadC = secC.filter(function(c) { return openCount(c) === 1; });

  // FINAL_BOSS 在 C 區最深的死路
  deadC.sort(function(a, b) { return (b.x - d2) - (a.x - d2); });
  if (deadC.length > 0) { var boss = deadC.shift(); grid[boss.y][boss.x] = MAP_TILE.FINAL_BOSS; }

  shuffleSeeded(deadA, rng);
  shuffleSeeded(deadB, rng);
  shuffleSeeded(deadC, rng);

  // A 區：小遊戲、商店、寶箱 ×3
  var specA = [MAP_TILE.MINI_GAME, MAP_TILE.SHOP,
               MAP_TILE.CHEST, MAP_TILE.CHEST, MAP_TILE.CHEST];
  for (var k = 0; k < specA.length && deadA.length > 0; k++) {
    var c = deadA.shift(); grid[c.y][c.x] = specA[k];
  }

  // B 區：小遊戲、寶箱 ×3
  var specB = [MAP_TILE.MINI_GAME,
               MAP_TILE.CHEST, MAP_TILE.CHEST, MAP_TILE.CHEST];
  for (var k = 0; k < specB.length && deadB.length > 0; k++) {
    var c = deadB.shift(); grid[c.y][c.x] = specB[k];
  }

  // C 區：寶箱 ×3
  var specC = [MAP_TILE.CHEST, MAP_TILE.CHEST, MAP_TILE.CHEST];
  for (var k = 0; k < specC.length && deadC.length > 0; k++) {
    var c = deadC.shift(); grid[c.y][c.x] = specC[k];
  }

  // 散布敵人（分區、分難度）
  var ec = (typeof ENEMY_COUNT !== "undefined") ? ENEMY_COUNT : 15;
  var cntA = Math.floor(ec * 7 / 15);  // =7 for ec=15
  var cntB = Math.floor(ec * 4 / 15);  // =4 for ec=15
  var cntC = ec - cntA - cntB;          // =4 for ec=15

  var candA = secA.filter(function(c) {
    return grid[c.y][c.x] === MAP_TILE.EMPTY &&
           Math.abs(c.x - sx) + Math.abs(c.y - sy) > 5;
  });
  var candB = secB.filter(function(c) { return grid[c.y][c.x] === MAP_TILE.EMPTY; });
  var candC = secC.filter(function(c) { return grid[c.y][c.x] === MAP_TILE.EMPTY; });

  shuffleSeeded(candA, rng);
  shuffleSeeded(candB, rng);
  shuffleSeeded(candC, rng);

  for (var k = 0; k < cntA && k < candA.length; k++) grid[candA[k].y][candA[k].x] = MAP_TILE.ENEMY;
  for (var k = 0; k < cntB && k < candB.length; k++) grid[candB[k].y][candB[k].x] = MAP_TILE.ENEMY;
  for (var k = 0; k < cntC && k < candC.length; k++) grid[candC[k].y][candC[k].x] = MAP_TILE.ENEMY;
}

// 執行時用的洗牌（Math.random，非固定）
function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

// ── 全域遊戲狀態 ──────────────────────────────────────────────
var player = { x: playerStart.x, y: playerStart.y };

var currentPlayer = {
  name:      playerStats.name,
  hp:        playerStats.hp,
  maxHp:     playerStats.maxHp,
  atk:       playerStats.atk,
  def:       playerStats.def,
  money:     playerStats.money,
  keys:      playerStats.keys,
  skills:    (playerStats.skills || ["power_strike"]).slice(),
  inventory: [],   // 消耗品背包 [{name, effect, desc}, ...]
  tempAtk:   0,    // 本場戰鬥臨時攻擊加成
  tempDef:   0     // 本場戰鬥臨時防禦加成
};

var currentMap = generateMaze();

var visitedTiles      = [];
var currentEnemy      = null;
var activeClones      = [];   // 同時存活的分身（玻璃大砲，一起行動）
var savedBoss         = null; // 分身戰鬥期間暫存的 Boss 狀態
var pairedFightEnemy  = null; // 雙人出場戰鬥的原始資料（用於結算獎勵）
var currentAllies     = [];   // 當前招募的同伴 [{id,name,icon,hp,maxHp,atk,defense,skill,skillCooldown,knockedOut}]
var allyShieldActive  = false; // 聖騎士護盾是否生效（本回合）
var blackKnightExposed = false; // 黑騎士全力突擊後弱點暴露（玩家下一擊可全傷）
var pendingSkillId    = null;  // 等待目標選擇的技能 ID
var pendingHealTarget = null;  // 治療術的目標（null=玩家, ally obj=同伴）
var shopUnlocked      = false;
var isPlayerDefending = false;
var gameOver          = false;

var playerTokensLeft = 0;
var enemyTokensLeft  = 0;

var playerSkillCooldowns  = {};
var playerAtkDebuffTurns  = 0;  // Boss 壓制技能：玩家攻擊力減半的剩餘回合數

var dialogueQueue    = [];
var dialogueCallback = null;

// ── 工具函式 ──────────────────────────────────────────────────
function showScreen(screenId) {
  var screens = ["screen-map", "screen-combat", "screen-shop",
                 "screen-minigame", "screen-dialogue",
                 "screen-gameover", "screen-clear"];
  for (var i = 0; i < screens.length; i++) {
    var el = document.getElementById(screens[i]);
    if (el) el.style.display = (screens[i] === screenId) ? "flex" : "none";
  }
  if (screenId === "screen-combat") {
    var sc = document.getElementById("screen-combat");
    if (sc) {
      sc.classList.remove("combat-enter");
      void sc.offsetWidth;
      sc.classList.add("combat-enter");
    }
  }
}

function playSound(name) {}

// ── 狀態更新 API ──────────────────────────────────────────────
function updatePlayerHp(amount) {
  currentPlayer.hp = Math.min(currentPlayer.maxHp, Math.max(0, currentPlayer.hp + amount));
  updateHUD();
}
function updatePlayerAtk(amount)   { currentPlayer.atk   += amount; updateHUD(); }
function updatePlayerDef(amount)   { currentPlayer.def   += amount; updateHUD(); }
function updatePlayerMoney(amount) { currentPlayer.money = Math.max(0, currentPlayer.money + amount); updateHUD(); }
function updatePlayerKeys(amount)  { currentPlayer.keys  = Math.max(0, currentPlayer.keys  + amount); updateHUD(); }

function logMessage(text) {
  var log = document.getElementById("combat-log");
  if (!log) return;
  var p = document.createElement("p");
  p.textContent = "▶ " + text;
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
}

function updateHUD() {
  function set(id, val) { var e = document.getElementById(id); if (e) e.textContent = val; }
  set("hud-hp",    currentPlayer.hp + " / " + currentPlayer.maxHp);
  set("hud-atk",   currentPlayer.atk);
  set("hud-def",   currentPlayer.def);
  set("hud-money", currentPlayer.money);
  set("hud-keys",  currentPlayer.keys);
  set("hud-items", currentPlayer.inventory.length || 0);

  var bar = document.getElementById("player-hp-bar-fill");
  if (bar) bar.style.width = (currentPlayer.hp / currentPlayer.maxHp * 100) + "%";
  var pnum = document.getElementById("player-hp-num");
  if (pnum) pnum.textContent = currentPlayer.hp + " / " + currentPlayer.maxHp;
}

// ── 戰鬥按鈕啟用 / 停用 ──────────────────────────────────────
function setCombatButtonsEnabled(enabled) {
  var ids = ["btn-attack", "btn-defend", "btn-flee"];
  for (var i = 0; i < ids.length; i++) {
    var btn = document.getElementById(ids[i]);
    if (btn) btn.disabled = !enabled;
  }
  renderSkillButtons(enabled);
  renderInventoryButtons(enabled);
}

// ── 技能輔助 ─────────────────────────────────────────────────
function getSkillDef(id) {
  for (var i = 0; i < skillDefs.length; i++) {
    if (skillDefs[i].id === id) return skillDefs[i];
  }
  return null;
}

function renderSkillButtons(combatEnabled) {
  var container = document.getElementById("combat-skills");
  if (!container) return;
  container.innerHTML = "";
  var skills = currentPlayer.skills;
  for (var i = 0; i < skills.length; i++) {
    (function(skillId) {
      var def = getSkillDef(skillId);
      if (!def) return;
      var cd  = playerSkillCooldowns[skillId] || 0;
      var btn = document.createElement("button");
      btn.className = "btn btn-skill";
      btn.title     = def.desc;
      if (cd > 0) {
        btn.textContent = def.icon + " " + def.name + " (" + cd + ")";
        btn.disabled    = true;
        btn.classList.add("btn-skill--cd");
      } else {
        btn.textContent = def.icon + " " + def.name;
        btn.disabled    = (combatEnabled === false);
        btn.onclick     = function() { onSkill(skillId); };
      }
      container.appendChild(btn);
    })(skills[i]);
  }
}

function decrementSkillCooldowns() {
  for (var id in playerSkillCooldowns) {
    if (playerSkillCooldowns[id] > 0) playerSkillCooldowns[id]--;
  }
  for (var di = 0; di < currentAllies.length; di++) {
    if (currentAllies[di].skillCooldown > 0) currentAllies[di].skillCooldown--;
  }
}

function onSkill(skillId) {
  var isAoe  = (skillId === "chain_slash");
  var isHeal = (skillId === "heal_magic");

  // AoE 不需選目標
  if (isAoe) { executeCombatRound("skill_" + skillId); return; }

  // 治療術：選玩家或存活同伴
  if (isHeal) {
    var liveAllies = currentAllies.filter(function(a) { return !a.knockedOut; });
    if (liveAllies.length === 0) { executeCombatRound("skill_" + skillId); return; }
    var targets = [{ id: "player", label: "🧙 " + currentPlayer.name + "（自己）HP:" + currentPlayer.hp }];
    liveAllies.forEach(function(a, i) {
      targets.push({ id: "ally_" + i, label: a.icon + " " + a.name + " HP:" + a.hp });
    });
    showTargetSelect(skillId, targets); return;
  }

  // 傷害技能：若多個敵人才需選
  if (activeClones.length > 1) {
    var etargets = [];
    activeClones.forEach(function(c, i) {
      etargets.push({ id: "clone_" + i, label: "👺 " + c.name + " HP:" + c.hp + "/" + c.maxHp });
    });
    showTargetSelect(skillId, etargets); return;
  }

  executeCombatRound("skill_" + skillId);
}

function showTargetSelect(skillId, targets) {
  pendingSkillId = skillId;
  var panel = document.getElementById("target-select-panel");
  var btns  = document.getElementById("target-select-buttons");
  if (!panel || !btns) { executeCombatRound("skill_" + skillId); return; }

  var title = document.getElementById("target-select-title");
  if (title) title.textContent = skillId === "heal_magic" ? "💚 選擇治療目標" : "🎯 選擇攻擊目標";

  btns.innerHTML = "";
  targets.forEach(function(t) {
    var btn = document.createElement("button");
    btn.className = "btn " + (skillId === "heal_magic" ? "btn-defend" : "btn-attack");
    btn.style.flex = "none";
    btn.textContent = t.label;
    btn.onclick = (function(tid) { return function() { onTargetSelect(tid); }; })(t.id);
    btns.appendChild(btn);
  });
  panel.style.display = "flex";
}

function onTargetSelect(targetId) {
  var panel = document.getElementById("target-select-panel");
  if (panel) panel.style.display = "none";

  var skillId = pendingSkillId;
  pendingSkillId = null;
  var isHeal = (skillId === "heal_magic");

  if (isHeal) {
    if (targetId === "player") {
      pendingHealTarget = null;
    } else {
      var aidx = parseInt(targetId.replace("ally_", ""), 10);
      var liveAllies = currentAllies.filter(function(a) { return !a.knockedOut; });
      pendingHealTarget = liveAllies[aidx] || null;
    }
  } else {
    if (targetId.indexOf("clone_") === 0) {
      var cidx = parseInt(targetId.replace("clone_", ""), 10);
      if (activeClones[cidx]) currentEnemy = activeClones[cidx];
    }
  }

  executeCombatRound("skill_" + skillId);
}

function cancelTargetSelect() {
  var panel = document.getElementById("target-select-panel");
  if (panel) panel.style.display = "none";
  pendingSkillId    = null;
  pendingHealTarget = null;
  setCombatButtonsEnabled(true);
}

// ── 查看敵人資訊 ──────────────────────────────────────────────

function showEnemyInfo() {
  var panel   = document.getElementById("inspect-panel");
  var title   = document.getElementById("inspect-title");
  var content = document.getElementById("inspect-content");
  if (!panel || !content) return;

  var e = currentEnemy;
  var html = "";

  function stat(label, val) {
    html += '<div class="inspect-stat"><b>' + label + '：</b>' + val + '</div>';
  }
  function sep() { html += '<div class="inspect-sep">────────────────</div>'; }
  function skill(icon, name, desc) {
    html += '<div class="inspect-skill">' + icon + ' <b>【' + name + '】</b></div>';
    html += '<div class="inspect-desc">' + desc + '</div>';
  }

  if (title) title.textContent = "📋 " + e.name + " 資訊";

  stat("HP",  e.hp + " / " + e.maxHp);
  stat("ATK", e.atk);
  stat("DEF", e.def);
  sep();

  if (e.isMiniBarrier) {
    skill("🛡️", "鋼鐵護盾（被動）",
      "預設格擋中，你的所有攻擊只造成 1 點傷害。");
    skill("⚔️", "全力突擊（主動，60% 機率）",
      "主動衝刺攻擊，防禦破綻暴露！暴露後下一次你的攻擊可造成全額傷害。");
    skill("🛡️", "防禦姿態（主動，40% 機率）",
      "輕擊（ATK÷2）並繼續格擋，你的攻擊仍只造成 1 傷害。");
  } else if (e.isFinalBoss) {
    skill("🔱", "召喚分身（被動，25% 每回合）",
      "無分身時，召喚 1~3 個魔王分身（HP 20、ATK " + e.atk + "、每個各自攻擊）。");
    skill("👁️", "黑暗壓制（被動，25% 每回合）",
      "ATK-5 攻擊，使你的攻擊力接下來 2 回合減半（不與壓制中重疊）。");
    skill("😈", "狂暴連擊（HP < 40% 必定觸發）",
      "ATK+5 傷害，必定連擊，範圍濺射所有同伴各 10 HP。");
    skill("⚡", "普通攻擊",
      "ATK " + e.atk + " 扣除你的 DEF 造成傷害。");
  } else if (e.isClone) {
    skill("⚡", "合體衝擊",
      "所有分身同時攻擊，傷害累加（各 ATK " + e.atk + " - DEF）。");
  } else {
    skill("⚡", "普通攻擊",
      "ATK " + e.atk + " 扣除你的 DEF 造成傷害（min 1）。");
  }

  content.innerHTML = html;
  panel.style.display = "flex";
}

function hideEnemyInfo() {
  var panel = document.getElementById("inspect-panel");
  if (panel) panel.style.display = "none";
}

// ── 背包道具按鈕（戰鬥中使用消耗品） ─────────────────────────
function renderInventoryButtons(combatEnabled) {
  var container = document.getElementById("combat-items");
  if (!container) return;
  container.innerHTML = "";

  if (!currentPlayer.inventory || currentPlayer.inventory.length === 0) {
    container.style.display = "none";
    return;
  }

  container.style.display = "flex";

  var label = document.createElement("span");
  label.className = "combat-items-label";
  label.textContent = "🎒";
  container.appendChild(label);

  for (var i = 0; i < currentPlayer.inventory.length; i++) {
    (function(idx) {
      var item = currentPlayer.inventory[idx];
      var eff  = item.effect;
      var tag  = "";
      if (eff.hp      > 0) tag = "HP+" + eff.hp;
      if (eff.tempAtk > 0) tag = "ATK+" + eff.tempAtk;
      if (eff.tempDef > 0) tag = "DEF+" + eff.tempDef;

      var btn = document.createElement("button");
      btn.className   = "btn btn-item";
      btn.textContent = item.name + (tag ? " [" + tag + "]" : "");
      btn.title       = item.desc || "";
      btn.disabled    = (combatEnabled === false);
      btn.onclick     = function() { onUseItem(idx); };
      container.appendChild(btn);
    })(i);
  }
}

function onUseItem(idx) {
  var item = currentPlayer.inventory[idx];
  if (!item) return;

  setCombatButtonsEnabled(false);

  var eff  = item.effect;
  var msgs = [];

  if (eff.hp > 0) {
    updatePlayerHp(eff.hp);
    msgs.push("回復 " + eff.hp + " HP");
  }
  if (eff.selfHp) {
    updatePlayerHp(eff.selfHp);
    msgs.push(eff.selfHp + " HP");
  }
  if (eff.tempAtk) {
    currentPlayer.tempAtk = (currentPlayer.tempAtk || 0) + eff.tempAtk;
    updateHUD();
    msgs.push("ATK +" + eff.tempAtk);
  }
  if (eff.tempDef) {
    currentPlayer.tempDef = (currentPlayer.tempDef || 0) + eff.tempDef;
    updateHUD();
    msgs.push("DEF +" + eff.tempDef);
  }

  currentPlayer.inventory.splice(idx, 1);
  logMessage("🧪 使用「" + item.name + "」：" + msgs.join("、") + "！");
  renderInventoryButtons(false);

  setTimeout(function() { processAllyTurns(runEnemyPhase); }, 600);
}

function craftSkill(skillId) {
  var def = getSkillDef(skillId);
  if (!def || def.type !== "craft") return;
  for (var i = 0; i < def.recipe.length; i++) {
    if (currentPlayer.skills.indexOf(def.recipe[i]) === -1) {
      showShopMessage("缺少合成材料！需要：" +
        def.recipe.map(function(r) { var d = getSkillDef(r); return d ? d.name : r; }).join("、"));
      return;
    }
  }
  if (currentPlayer.skills.indexOf(skillId) !== -1) {
    showShopMessage("你已經擁有「" + def.name + "」了！"); return;
  }
  currentPlayer.skills.push(skillId);
  showShopMessage("✨ 合成成功！獲得技能「" + def.icon + " " + def.name + "」！");
  openShop();
}

// ── Press Turn 令牌顯示 ───────────────────────────────────────
function updateTokenDisplay() {
  var ptDisplay = document.getElementById("press-turn-display");
  if (!ptDisplay) return;
  var tokens  = (typeof PRESS_TURN_TOKENS !== "undefined") ? PRESS_TURN_TOKENS : 3;
  var playerEl = document.getElementById("pt-player-tokens");
  var enemyEl  = document.getElementById("pt-enemy-tokens");
  if (playerEl) {
    var pStr = "玩家 ";
    for (var i = 0; i < tokens; i++) pStr += (i < playerTokensLeft) ? "◆ " : "◇ ";
    playerEl.textContent = pStr.trim();
  }
  if (enemyEl) {
    var eStr = "敵人 ";
    for (var i = 0; i < tokens; i++) eStr += (i < enemyTokensLeft) ? "◆ " : "◇ ";
    enemyEl.textContent = eStr.trim();
  }
}

// ── 地圖渲染 ─────────────────────────────────────────────────
function renderMap() {
  var board = document.getElementById("game-board");
  if (!board) return;
  board.innerHTML = "";
  var tileSize = 60;
  board.style.width = (currentMap[0].length * tileSize) + "px";

  for (var y = 0; y < currentMap.length; y++) {
    for (var x = 0; x < currentMap[y].length; x++) {
      var tile = document.createElement("div");
      tile.className = "tile";

      var dist       = Math.max(Math.abs(x - player.x), Math.abs(y - player.y));
      var key        = x + "," + y;
      var isVisible  = dist <= visionRadius;
      var isExplored = visitedTiles.indexOf(key) !== -1;

      if (isVisible) {
        if (!isExplored) visitedTiles.push(key);
        if (x === player.x && y === player.y) {
          tile.classList.add("tile--player");
          var img = document.createElement("img");
          img.src = "assets/player.png"; img.alt = "玩家"; img.className = "sprite";
          tile.appendChild(img);
        } else {
          applyTileStyle(tile, currentMap[y][x]);
        }
      } else if (isExplored) {
        tile.classList.add("tile--explored");
        applyTileStyle(tile, currentMap[y][x]);
      } else {
        tile.classList.add("tile--hidden");
      }
      board.appendChild(tile);
    }
  }
  applyCameraTransform();
}

function applyCameraTransform() {
  var board = document.getElementById("game-board");
  if (!board) return;
  var tileSize = 60, viewTiles = 9;
  var mapW = currentMap[0].length, mapH = currentMap.length;
  var half = Math.floor(viewTiles / 2);
  var camX = Math.min(Math.max(player.x - half, 0), mapW - viewTiles);
  var camY = Math.min(Math.max(player.y - half, 0), mapH - viewTiles);
  board.style.transform = "translate(" + (-camX * tileSize) + "px, " + (-camY * tileSize) + "px)";
}

function applyTileStyle(tile, tileType) {
  var sm = {};
  sm[MAP_TILE.WALL]       = { cls: "tile--wall",     src: "",                 alt: "",       emoji: ""   };
  sm[MAP_TILE.EMPTY]      = { cls: "tile--empty",    src: "",                 alt: "",       emoji: ""   };
  sm[MAP_TILE.CHEST]      = { cls: "tile--chest",    src: "assets/chest.png", alt: "寶箱",   emoji: "📦" };
  sm[MAP_TILE.ENEMY]      = { cls: "tile--enemy",    src: "assets/enemy.png", alt: "敵人",   emoji: "👺" };
  sm[MAP_TILE.DOOR]       = { cls: "tile--door",     src: "assets/door.png",  alt: "門",     emoji: "🚪" };
  sm[MAP_TILE.MINI_GAME]  = { cls: "tile--minigame", src: "",                 alt: "小遊戲", emoji: "🌀" };
  sm[MAP_TILE.SHOP]       = { cls: "tile--shop",     src: "",                 alt: "商店",   emoji: "🛒" };
  sm[MAP_TILE.FINAL_BOSS] = { cls: "tile--boss",     src: "assets/boss.png",  alt: "魔王",   emoji: "👿" };

  var info = sm[tileType];
  if (!info) { tile.classList.add("tile--empty"); return; }
  tile.classList.add(info.cls);
  if (info.src) {
    var img = document.createElement("img");
    img.src = info.src; img.alt = info.alt; img.className = "sprite";
    img.onerror = function() {
      if (img.parentNode) img.parentNode.removeChild(img);
      if (info.emoji) { var sp = document.createElement("span"); sp.className = "tile-emoji"; sp.textContent = info.emoji; tile.appendChild(sp); }
    };
    tile.appendChild(img);
  } else if (info.emoji) {
    var sp = document.createElement("span");
    sp.className = "tile-emoji"; sp.textContent = info.emoji;
    tile.appendChild(sp);
  }
}

// ── 鍵盤移動 ─────────────────────────────────────────────────
document.addEventListener("keydown", function(e) {
  if (gameOver) return;
  var screen = document.getElementById("screen-map");
  if (!screen || screen.style.display === "none") return;

  var dx = 0, dy = 0;
  if (e.key === "ArrowUp"    || e.key === "w" || e.key === "W") dy = -1;
  if (e.key === "ArrowDown"  || e.key === "s" || e.key === "S") dy =  1;
  if (e.key === "ArrowLeft"  || e.key === "a" || e.key === "A") dx = -1;
  if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") dx =  1;
  if (dx === 0 && dy === 0) return;

  var newX = player.x + dx, newY = player.y + dy;
  if (newY < 0 || newY >= currentMap.length) return;
  if (newX < 0 || newX >= currentMap[newY].length) return;

  var targetTile = currentMap[newY][newX];
  if (targetTile === MAP_TILE.WALL) return;

  if (targetTile === MAP_TILE.DOOR) {
    if (currentPlayer.keys <= 0) {
      showMapMessage("門被鎖住了！你需要一把鑰匙才能通過。"); return;
    }
    updatePlayerKeys(-1);
    currentMap[newY][newX] = MAP_TILE.EMPTY;
    showMapMessage("你用鑰匙打開了門！剩餘鑰匙：" + currentPlayer.keys);
  }

  player.x = newX; player.y = newY;
  renderMap();
  checkTileEvent(newX, newY);
});

// ── 格子事件 ──────────────────────────────────────────────────
function checkTileEvent(x, y) {
  var t = currentMap[y][x];
  if      (t === MAP_TILE.CHEST)      triggerChest(x, y);
  else if (t === MAP_TILE.ENEMY)      triggerEnemy(x, y);
  else if (t === MAP_TILE.MINI_GAME)  triggerMiniGame(x, y);
  else if (t === MAP_TILE.SHOP)       triggerShop();
  else if (t === MAP_TILE.FINAL_BOSS) triggerFinalBoss(x, y);
}

function triggerChest(x, y) {
  var reward = chestRewards[Math.floor(Math.random() * chestRewards.length)];
  playSound("chest");
  if (reward.money) updatePlayerMoney(reward.money);
  if (reward.hp)    updatePlayerHp(reward.hp);
  if (reward.atk)   updatePlayerAtk(reward.atk);
  if (reward.def)   updatePlayerDef(reward.def);
  if (reward.reviveAlly) {
    var dead = currentAllies.filter(function(a) { return a.knockedOut; });
    if (dead.length > 0) {
      dead[0].hp = Math.max(1, Math.floor(dead[0].maxHp / 2));
      dead[0].knockedOut = false;
      showMapMessage("📦 " + reward.message + "「" + dead[0].name + "」已復活！");
    } else {
      showMapMessage("📦 " + reward.message + "（隊伍無人陣亡，轉換為 30 金幣）");
      updatePlayerMoney(30);
    }
    currentMap[y][x] = MAP_TILE.EMPTY;
    renderMap(); return;
  }
  currentMap[y][x] = MAP_TILE.EMPTY;
  showMapMessage("📦 " + reward.message);
  renderMap();
}

// 根據 x 座標決定敵人強度分級；同一格永遠出現同一隻怪
function triggerEnemy(x, y) {
  var tier;
  if (x > mazeDivX2 && typeof enemiesTier3 !== "undefined" && enemiesTier3.length > 0) {
    tier = enemiesTier3;
  } else if (x > mazeDivX1 && typeof enemiesTier2 !== "undefined" && enemiesTier2.length > 0) {
    tier = enemiesTier2;
  } else {
    tier = enemies;
  }
  var posRng = makeRng(MAP_SEED * 10000 + y * 1000 + x);
  var idx = Math.floor(posRng() * tier.length);
  var ed  = tier[idx];
  currentEnemy = {
    x: x, y: y,
    name: ed.name, hp: ed.hp, maxHp: ed.maxHp,
    atk: ed.atk,  def: ed.def, reward: ed.reward,
    isMiniBarrier: ed.isMiniBarrier || false
  };

  if (ed.isPaired) {
    var companion = {
      name: ed.name, hp: ed.hp, maxHp: ed.maxHp,
      atk: ed.atk,  def: ed.def, reward: { money: 0 },
      isMiniBarrier: ed.isMiniBarrier || false
    };
    pairedFightEnemy = { x: x, y: y, reward: ed.reward, maxHp: ed.hp, name: ed.name };
    activeClones = [currentEnemy, companion];
  }

  startCombat();
}

function triggerFinalBoss(x, y) {
  currentEnemy = {
    x: x, y: y,
    name: finalBoss.name, hp: finalBoss.hp, maxHp: finalBoss.maxHp,
    atk: finalBoss.atk,   def: finalBoss.def, reward: finalBoss.reward,
    isFinalBoss: true
  };
  if (typeof dialogues !== "undefined" &&
      dialogues.boss_pre && dialogues.boss_pre.length > 0) {
    showDialogue(dialogues.boss_pre, function() { startCombat(); });
  } else {
    startCombat();
  }
}

// ── 商店 ─────────────────────────────────────────────────────
function triggerShop() {
  var isFirst = !shopUnlocked;
  shopUnlocked = true;
  if (isFirst && typeof dialogues !== "undefined" &&
      dialogues.shop_first && dialogues.shop_first.length > 0) {
    showDialogue(dialogues.shop_first, function() { openShop(); });
  } else {
    openShop();
  }
}

function openShop() {
  var list = document.getElementById("shop-item-list");
  if (!list) return;
  list.innerHTML = "";

  function sec(title) {
    var h = document.createElement("div"); h.className = "shop-section-title";
    h.textContent = title; list.appendChild(h);
  }

  sec("🔧 永久道具");
  shopItems.filter(function(it) { return !it.isConsumable; })
           .forEach(function(it) { renderShopCard(it, list); });

  sec("🧪 戰鬥消耗品（加入背包，戰鬥中手動使用）");
  shopItems.filter(function(it) { return it.isConsumable; })
           .forEach(function(it) { renderShopCard(it, list); });

  sec("⚔️ 技能購買");
  var buyable = skillDefs.filter(function(s) {
    return s.type === "shop" && currentPlayer.skills.indexOf(s.id) === -1;
  });
  if (buyable.length === 0) {
    var n = document.createElement("div"); n.className = "shop-card-desc"; n.style.padding = "6px 0";
    n.textContent = "（已購買所有技能）"; list.appendChild(n);
  } else {
    buyable.forEach(function(s) { renderSkillCard(s, list); });
  }

  sec("🔮 技能合成");
  skillDefs.filter(function(s) { return s.type === "craft"; })
           .forEach(function(s) { renderCraftCard(s, list); });

  sec("👥 招募同伴（最多 2 人，參戰後每回合可手動指派行動）");
  if (typeof allyDefs !== "undefined") {
    allyDefs.forEach(function(def) { renderAllyCard(def, list); });
  }

  document.getElementById("shop-player-money").textContent = currentPlayer.money;
  showScreen("screen-shop");
}

function renderShopCard(item, container) {
  var card = document.createElement("div");
  card.className = "shop-card";
  if (item.isConsumable) card.classList.add("shop-card--consumable");

  var left = document.createElement("div"); left.className = "shop-card-left";
  var nm = document.createElement("div"); nm.className = "shop-card-name"; nm.textContent = item.name;
  var ds = document.createElement("div"); ds.className = "shop-card-desc"; ds.textContent = item.desc;
  left.appendChild(nm); left.appendChild(ds);

  var right = document.createElement("div"); right.className = "shop-card-right";
  var pr = document.createElement("div"); pr.className = "shop-card-price"; pr.textContent = "💰 " + item.price;
  var btn = document.createElement("button"); btn.className = "btn btn-shop"; btn.textContent = "購買";
  btn.onclick = function() { buyShopItem(item); };
  right.appendChild(pr); right.appendChild(btn);

  card.appendChild(left); card.appendChild(right);
  container.appendChild(card);
}

function renderSkillCard(skill, container) {
  var card = document.createElement("div"); card.className = "shop-card shop-card--skill";
  var left = document.createElement("div"); left.className = "shop-card-left";
  var nm = document.createElement("div"); nm.className = "shop-card-name"; nm.textContent = skill.icon + " " + skill.name;
  var ds = document.createElement("div"); ds.className = "shop-card-desc"; ds.textContent = skill.desc;
  left.appendChild(nm); left.appendChild(ds);
  var right = document.createElement("div"); right.className = "shop-card-right";
  var pr = document.createElement("div"); pr.className = "shop-card-price"; pr.textContent = "💰 " + skill.price;
  var btn = document.createElement("button"); btn.className = "btn btn-shop"; btn.textContent = "購買";
  btn.onclick = function() { buySkill(skill); };
  right.appendChild(pr); right.appendChild(btn);
  card.appendChild(left); card.appendChild(right);
  container.appendChild(card);
}

function renderCraftCard(skill, container) {
  var card = document.createElement("div"); card.className = "shop-card shop-card--craft";
  var owned  = currentPlayer.skills.indexOf(skill.id) !== -1;
  var hasAll = skill.recipe.every(function(r) { return currentPlayer.skills.indexOf(r) !== -1; });

  var left = document.createElement("div"); left.className = "shop-card-left";
  var nm = document.createElement("div"); nm.className = "shop-card-name";
  nm.textContent = skill.icon + " " + skill.name + (owned ? " ✅" : "");
  var ds = document.createElement("div"); ds.className = "shop-card-desc"; ds.textContent = skill.desc;
  var rc = document.createElement("div"); rc.className = "shop-card-recipe";
  rc.textContent = "需要：" + skill.recipe.map(function(r) {
    var d = getSkillDef(r); var have = currentPlayer.skills.indexOf(r) !== -1;
    return (d ? d.name : r) + (have ? "✓" : "✗");
  }).join(" + ");
  left.appendChild(nm); left.appendChild(ds); left.appendChild(rc);

  var right = document.createElement("div"); right.className = "shop-card-right";
  var btn = document.createElement("button"); btn.className = "btn btn-shop";
  if      (owned)  { btn.textContent = "已擁有"; btn.disabled = true; }
  else if (hasAll) { btn.textContent = "合成！"; btn.onclick = function() { craftSkill(skill.id); }; }
  else             { btn.textContent = "材料不足"; btn.disabled = true; }
  right.appendChild(btn);
  card.appendChild(left); card.appendChild(right);
  container.appendChild(card);
}

function buyShopItem(item) {
  if (currentPlayer.money < item.price) {
    showShopMessage("金幣不足！需要 " + item.price + " 金幣。"); return;
  }
  updatePlayerMoney(-item.price);
  if (!item.isConsumable) {
    if (item.effect.reviveAlly) {
      var deadAllies = currentAllies.filter(function(a) { return a.knockedOut; });
      if (deadAllies.length === 0) { showShopMessage("目前沒有陣亡的同伴！"); return; }
      var revived = deadAllies[0];
      revived.hp = Math.max(1, Math.floor(revived.maxHp / 2));
      revived.knockedOut = false;
      showShopMessage("✨ 「" + revived.icon + " " + revived.name + "」已復活！（HP:" + revived.hp + "）");
      document.getElementById("shop-player-money").textContent = currentPlayer.money;
      return;
    }
    if (item.effect.atk)   updatePlayerAtk(item.effect.atk);
    if (item.effect.def)   updatePlayerDef(item.effect.def);
    if (item.effect.hp)    updatePlayerHp(item.effect.hp);
    if (item.effect.maxHp) {
      currentPlayer.maxHp += item.effect.maxHp;
      currentPlayer.hp     = Math.min(currentPlayer.hp + item.effect.maxHp, currentPlayer.maxHp);
      updateHUD();
    }
    showShopMessage("購買了「" + item.name + "」！");
  } else {
    // 放入背包，戰鬥中使用
    currentPlayer.inventory.push({ name: item.name, effect: item.effect, desc: item.desc });
    updateHUD();
    showShopMessage("🎒 「" + item.name + "」已加入背包！戰鬥中可使用。");
  }
  document.getElementById("shop-player-money").textContent = currentPlayer.money;
}

function buySkill(skill) {
  if (currentPlayer.money < skill.price) {
    showShopMessage("金幣不足！需要 " + skill.price + " 金幣。"); return;
  }
  if (currentPlayer.skills.indexOf(skill.id) !== -1) {
    showShopMessage("你已經擁有「" + skill.name + "」了！"); return;
  }
  updatePlayerMoney(-skill.price);
  currentPlayer.skills.push(skill.id);
  showShopMessage("✨ 習得技能「" + skill.icon + " " + skill.name + "」！");
  document.getElementById("shop-player-money").textContent = currentPlayer.money;
  openShop();
}

function showShopMessage(msg) {
  var el = document.getElementById("shop-message");
  if (el) el.textContent = msg;
  var me = document.getElementById("shop-player-money");
  if (me) me.textContent = currentPlayer.money;
}

// ── 戰鬥開始 ─────────────────────────────────────────────────
function startCombat() {
  isPlayerDefending    = false;
  playerSkillCooldowns = {};
  playerAtkDebuffTurns = 0;
  allyShieldActive     = false;
  currentPlayer.tempAtk = 0;
  currentPlayer.tempDef = 0;

  // 同伴冷卻重置（HP 持久，陣亡狀態持久）
  for (var ai = 0; ai < currentAllies.length; ai++) {
    currentAllies[ai].skillCooldown = 0;
    // HP <= 0 → 確保 knockedOut 同步
    if (currentAllies[ai].hp <= 0) currentAllies[ai].knockedOut = true;
  }

  setCombatButtonsEnabled(true);
  hideAllyPanel();

  var log = document.getElementById("combat-log");
  if (log) log.innerHTML = "";

  var isPaired = activeClones.length > 0 && !currentEnemy.isFinalBoss;

  var ename = document.getElementById("enemy-name");
  if (ename) ename.textContent = isPaired
    ? currentEnemy.name + " ×" + activeClones.length
    : currentEnemy.name;
  updateCombatEnemyHp();

  var enemyImg = document.getElementById("battle-enemy-img");
  if (enemyImg) enemyImg.src = currentEnemy.isFinalBoss ? "assets/boss.png" : "assets/enemy.png";

  // 第二精靈（雙人出場時）
  var sprite2 = document.getElementById("combat-enemy-sprite-2");
  if (sprite2) sprite2.style.display = isPaired ? "flex" : "none";

  document.getElementById("combat-player-name").textContent = currentPlayer.name;

  var ptDisplay = document.getElementById("press-turn-display");
  if (ptDisplay) {
    if (COMBAT_MODE === "press_turn") {
      playerTokensLeft = PRESS_TURN_TOKENS; enemyTokensLeft = PRESS_TURN_TOKENS;
      ptDisplay.style.display = "flex"; updateTokenDisplay();
    } else {
      ptDisplay.style.display = "none";
    }
  }

  if (isPaired) {
    logMessage("⚔️ 兩隻「" + currentEnemy.name + "」同時出現！");
    logMessage("💡 使用「連斬」可同時攻擊兩隻！");
  } else {
    logMessage("⚔️ 遭遇了「" + currentEnemy.name + "」！");
  }
  if (currentPlayer.inventory.length > 0) {
    logMessage("🎒 背包中有 " + currentPlayer.inventory.length + " 個道具可使用。");
  }
  if (currentAllies.length > 0) {
    var allyNames = currentAllies.map(function(a) { return a.icon + a.name; }).join("、");
    logMessage("👥 同伴「" + allyNames + "」準備參戰！");
  }

  updateAllyHpArea();
  updateCombatHint();
  playSound("encounter");
  showScreen("screen-combat");
}

function updateCombatEnemyHp() {
  var pct = currentEnemy.hp / currentEnemy.maxHp * 100;
  var bar = document.getElementById("enemy-hp-bar-fill");
  if (bar) bar.style.width = pct + "%";
  var num = document.getElementById("enemy-hp-num");
  if (num) num.textContent = currentEnemy.hp + " / " + currentEnemy.maxHp;
  updateCombatHint();
}

function updateCombatHint() {
  var el = document.getElementById("combat-hint");
  if (!el) return;
  var hint = "";
  if (activeClones.length > 0) {
    hint = "💡 連斬可同時攻擊所有敵人！";
  } else if (currentEnemy && currentEnemy.isFinalBoss) {
    if (currentEnemy.hp < currentEnemy.maxHp * 0.4) {
      hint = "⚠️ 魔王狂暴中！小心必定連擊＋範圍濺射！";
    } else if (currentEnemy.hp < currentEnemy.maxHp * 0.6) {
      hint = "👁️ 魔王隨時可能召喚分身或施展壓制！";
    }
  }
  el.textContent = hint;
  el.style.display = hint ? "block" : "none";
}

// ── 戰鬥流程 ─────────────────────────────────────────────────
function onAttack() { executeCombatRound("attack");  }
function onDefend() { executeCombatRound("defend");  }
function onFlee()   { executeCombatRound("flee");    }

function executeCombatRound(action) {
  setCombatButtonsEnabled(false);
  // 關閉任何開啟中的面板
  var tsp = document.getElementById("target-select-panel");
  if (tsp) tsp.style.display = "none";
  hideEnemyInfo();

  var result = playerTurn(action, currentPlayer, currentEnemy);

  // 玩家行動後重置黑騎士弱點暴露
  blackKnightExposed = false;
  // 若治療了同伴，更新同伴 HP 顯示
  if (result.healedAlly) updateAllyHpArea();

  if (result.playerFlee) {
    logMessage("你成功逃跑了！"); playSound("flee"); endCombat(false); return;
  }

  if (COMBAT_MODE === "press_turn") {
    if (result.playerDefense) isPlayerDefending = true;
  } else {
    isPlayerDefending = result.playerDefense || false;
  }

  if (result.selfDamage > 0) updatePlayerHp(-result.selfDamage);

  if (result.skillUsed) {
    var sd = getSkillDef(result.skillUsed);
    if (sd && sd.cooldown) playerSkillCooldowns[result.skillUsed] = sd.cooldown;
  }

  // ── AoE：連斬命中所有分身 ────────────────────────────────
  if (result.isAoe && activeClones.length > 0) {
    var killed = 0;
    for (var i = activeClones.length - 1; i >= 0; i--) {
      activeClones[i].hp = Math.max(0, activeClones[i].hp - result.enemyDamage);
      if (activeClones[i].hp <= 0) { activeClones.splice(i, 1); killed++; }
    }
    logMessage(result.message);
    if (killed > 0) logMessage("💀 消滅了 " + killed + " 個分身！剩餘 " + activeClones.length + " 個。");
    if (activeClones.length > 0) {
      currentEnemy = activeClones[0];
      var en = document.getElementById("enemy-name");
      if (en) en.textContent = savedBoss
        ? ("魔王分身 ×" + activeClones.length)
        : (currentEnemy.name + " ×" + activeClones.length);
    }
    updateCombatEnemyHp();
    setTimeout(function() {
      if (activeClones.length === 0 && savedBoss) resumeBossFight();
      else if (activeClones.length === 0 && pairedFightEnemy) endPairedFight();
      else processAllyTurns(runEnemyPhase);
    }, 600);
    return;
  }

  // ── 單體攻擊 ─────────────────────────────────────────────
  if (result.enemyDamage > 0) currentEnemy.hp = Math.max(0, currentEnemy.hp - result.enemyDamage);
  logMessage(result.message || "");

  // 分身被單體擊殺
  if (activeClones.length > 0 && currentEnemy.hp <= 0) {
    var idx = activeClones.indexOf(currentEnemy);
    if (idx !== -1) activeClones.splice(idx, 1);
    logMessage("💀 分身被消滅！剩餘 " + activeClones.length + " 個。");
    if (activeClones.length > 0) {
      currentEnemy = activeClones[0];
      var en2 = document.getElementById("enemy-name");
      if (en2) en2.textContent = savedBoss
        ? ("魔王分身 ×" + activeClones.length)
        : (currentEnemy.name + " ×" + activeClones.length);
      updateCombatEnemyHp();
      setTimeout(function() { processAllyTurns(runEnemyPhase); }, 600);
    } else {
      setTimeout(function() {
        if (savedBoss) resumeBossFight();
        else if (pairedFightEnemy) endPairedFight();
      }, 600);
    }
    return;
  }

  updateCombatEnemyHp();

  // 普通敵人 / Boss 被擊敗
  if (currentEnemy.hp <= 0) {
    logMessage("✨ 「" + currentEnemy.name + "」被打倒了！");
    playSound("victory"); giveEnemyReward(); return;
  }

  if (COMBAT_MODE === "press_turn") {
    if      (result.bonusTurn) logMessage("★ 額外行動！令牌不減！");
    else if (result.loseTurn)  { playerTokensLeft = 0; logMessage("⚠ 失去剩餘行動！"); }
    else                        playerTokensLeft--;
    updateTokenDisplay();
    if (playerTokensLeft > 0) { setCombatButtonsEnabled(true); return; }
  }

  setTimeout(function() { processAllyTurns(runEnemyPhase); }, 600);
}

function runEnemyPhase() {
  // 同伴行動期間可能已擊倒敵人，先檢查
  if (currentEnemy && currentEnemy.hp <= 0) {
    if (activeClones.length === 0 && !savedBoss && !pairedFightEnemy) {
      logMessage("✨ 同伴將「" + currentEnemy.name + "」擊倒了！");
      playSound("victory"); giveEnemyReward(); return;
    }
    if (activeClones.length === 0 && savedBoss)       { resumeBossFight(); return; }
    if (activeClones.length === 0 && pairedFightEnemy) { endPairedFight();  return; }
    if (activeClones.length > 0) {
      currentEnemy = activeClones[0];
      var en = document.getElementById("enemy-name");
      if (en) en.textContent = savedBoss
        ? ("魔王分身 ×" + activeClones.length)
        : (currentEnemy.name + " ×" + activeClones.length);
      updateCombatEnemyHp();
    }
  }
  if (COMBAT_MODE === "press_turn") { enemyTokensLeft = PRESS_TURN_TOKENS; updateTokenDisplay(); }
  runNextEnemyTurn();
}

// 所有分身同時登場
function startCloneFight(clones) {
  activeClones = clones.slice();
  currentEnemy = activeClones[0];
  var ename = document.getElementById("enemy-name");
  if (ename) ename.textContent = "魔王分身 ×" + activeClones.length;
  var eimg = document.getElementById("battle-enemy-img");
  if (eimg) eimg.src = "assets/enemy.png";
  var sprite2 = document.getElementById("combat-enemy-sprite-2");
  if (sprite2) sprite2.style.display = activeClones.length > 1 ? "flex" : "none";
  updateCombatEnemyHp();
  isPlayerDefending = false;
  logMessage("💡 分身登場！使用「連斬」可一次消滅所有分身！");
  setCombatButtonsEnabled(true);
}

// 分身全滅後恢復 Boss
function resumeBossFight() {
  currentEnemy = savedBoss;
  savedBoss    = null;
  logMessage("⚠️ 分身全數消滅！黑暗魔王繼續戰鬥！");
  var eimg = document.getElementById("battle-enemy-img");
  if (eimg) eimg.src = "assets/boss.png";
  var ename = document.getElementById("enemy-name");
  if (ename) ename.textContent = currentEnemy.name;
  var sprite2 = document.getElementById("combat-enemy-sprite-2");
  if (sprite2) sprite2.style.display = "none";
  updateCombatEnemyHp();
  isPlayerDefending = false;
  setCombatButtonsEnabled(true);
}

// 雙人怪全滅後結算
function endPairedFight() {
  var info = pairedFightEnemy;
  pairedFightEnemy = null;
  currentEnemy = { x: info.x, y: info.y, reward: info.reward, maxHp: info.maxHp, name: info.name };
  var sprite2 = document.getElementById("combat-enemy-sprite-2");
  if (sprite2) sprite2.style.display = "none";
  logMessage("✨ 兩隻「" + info.name + "」都被打倒了！");
  playSound("victory");
  giveEnemyReward();
}

// ── 同伴回合系統 ──────────────────────────────────────────────

function processAllyTurns(callback) {
  var live = currentAllies.filter(function(a) { return !a.knockedOut; });
  if (live.length === 0) { callback(); return; }
  showAllyActionFor(live, 0, callback);
}

function showAllyActionFor(live, idx, callback) {
  if (idx >= live.length) {
    hideAllyPanel();
    callback();
    return;
  }
  var ally = live[idx];
  var panel = document.getElementById("ally-action-panel");
  if (!panel) {
    executeAllyAction(ally, "attack");
    setTimeout(function() { showAllyActionFor(live, idx + 1, callback); }, 300);
    return;
  }

  var title = document.getElementById("ally-action-title");
  if (title) title.textContent = ally.icon + " 「" + ally.name + "」的回合";

  var btns = document.getElementById("ally-action-buttons");
  if (!btns) { showAllyActionFor(live, idx + 1, callback); return; }
  btns.innerHTML = "";

  function onAction(action) {
    var allBtns = btns.querySelectorAll("button");
    for (var k = 0; k < allBtns.length; k++) allBtns[k].disabled = true;
    executeAllyAction(ally, action);
    setTimeout(function() { showAllyActionFor(live, idx + 1, callback); }, 400);
  }

  var btnAtk = document.createElement("button");
  btnAtk.className = "btn btn-attack"; btnAtk.style.flex = "none";
  btnAtk.textContent = "⚔️ 攻擊";
  btnAtk.onclick = function() { onAction("attack"); };
  btns.appendChild(btnAtk);

  if (ally.skill) {
    var btnSk = document.createElement("button");
    btnSk.className = "btn btn-skill"; btnSk.style.flex = "none";
    btnSk.title = ally.skill.desc;
    if (ally.skillCooldown > 0) {
      btnSk.textContent = ally.skill.icon + " " + ally.skill.name + " (" + ally.skillCooldown + ")";
      btnSk.disabled = true; btnSk.classList.add("btn-skill--cd");
    } else {
      btnSk.textContent = ally.skill.icon + " " + ally.skill.name;
      btnSk.onclick = function() { onAction("skill"); };
    }
    btns.appendChild(btnSk);
  }

  var btnSkip = document.createElement("button");
  btnSkip.className = "btn btn-flee"; btnSkip.style.flex = "none";
  btnSkip.textContent = "⏭ 待機";
  btnSkip.onclick = function() { onAction("skip"); };
  btns.appendChild(btnSkip);

  panel.style.display = "block";
}

function hideAllyPanel() {
  var panel = document.getElementById("ally-action-panel");
  if (panel) panel.style.display = "none";
}

function executeAllyAction(ally, action) {
  if (action === "skip") {
    logMessage(ally.icon + " 「" + ally.name + "」待機。"); return;
  }

  if (action === "attack") {
    var target = currentEnemy;
    if (!target || target.hp <= 0) {
      logMessage(ally.icon + " 「" + ally.name + "」沒有目標。"); return;
    }
    var dmg = Math.max(1, ally.atk - (target.def || 0));
    if (target.isMiniBarrier) { dmg = 1; }
    target.hp = Math.max(0, target.hp - dmg);
    logMessage(ally.icon + " 「" + ally.name + "」攻擊「" + target.name + "」，造成 " + dmg + " 點傷害！" + (target.isMiniBarrier ? " 🛡️（格擋中）" : ""));
    if (target.hp <= 0 && activeClones.length > 0) {
      var ki = activeClones.indexOf(target);
      if (ki !== -1) {
        activeClones.splice(ki, 1);
        logMessage("💀 分身被消滅！剩餘 " + activeClones.length + " 個。");
        if (activeClones.length > 0) {
          currentEnemy = activeClones[0];
          var en = document.getElementById("enemy-name");
          if (en) en.textContent = savedBoss
            ? ("魔王分身 ×" + activeClones.length)
            : (currentEnemy.name + " ×" + activeClones.length);
        }
      }
    }
    updateCombatEnemyHp();
    return;
  }

  if (action === "skill") {
    var skill = ally.skill;
    if (!skill || ally.skillCooldown > 0) {
      logMessage(ally.icon + " 「" + ally.name + "」技能冷卻中！"); return;
    }
    ally.skillCooldown = skill.cooldown;

    if (skill.isAoe) {
      var targets = activeClones.length > 0 ? activeClones.slice() : [currentEnemy];
      var killed = 0;
      for (var ti = targets.length - 1; ti >= 0; ti--) {
        var t = targets[ti];
        var d = Math.max(1, Math.floor(ally.atk * (skill.multiplier || 1)) - (t.def || 0));
        if (t.isMiniBarrier) { d = 1; }
        t.hp = Math.max(0, t.hp - d);
        if (t.hp <= 0 && activeClones.length > 0) {
          var ai2 = activeClones.indexOf(t);
          if (ai2 !== -1) { activeClones.splice(ai2, 1); killed++; }
        }
      }
      logMessage(ally.icon + " 「" + ally.name + "」使用「" + skill.name + "」！");
      if (killed > 0) logMessage("💀 消滅了 " + killed + " 個敵人！剩餘 " + activeClones.length + " 個。");
      if (activeClones.length > 0) {
        currentEnemy = activeClones[0];
        var en2 = document.getElementById("enemy-name");
        if (en2) en2.textContent = savedBoss
          ? ("魔王分身 ×" + activeClones.length)
          : (currentEnemy.name + " ×" + activeClones.length);
      }
      updateCombatEnemyHp();
      return;
    }

    if (skill.isShield) {
      allyShieldActive = true;
      logMessage(ally.icon + " 「" + ally.name + "」使用「" + skill.name + "」！本回合傷害減半！");
    }
  }
}

function updateAllyHpArea() {
  var area = document.getElementById("ally-hp-area");
  if (!area) return;
  if (currentAllies.length === 0) { area.style.display = "none"; return; }
  area.style.display = "flex";
  area.innerHTML = '<span class="ally-hp-label-text">同伴：</span>';
  for (var i = 0; i < currentAllies.length; i++) {
    var a = currentAllies[i];
    var pct = Math.max(0, a.hp / a.maxHp * 100);
    var card = document.createElement("div");
    card.className = "ally-hp-card" + (a.knockedOut ? " ally-knocked-out" : "");
    card.innerHTML = a.icon + " " + a.name +
      " <span class='ally-mini-bar-wrap'><span class='ally-mini-bar-fill' style='width:" + pct + "%'></span></span>" +
      " <span class='ally-hp-num-small'>" + a.hp + "/" + a.maxHp + "</span>";
    area.appendChild(card);
  }
}

// ── 同伴商店 ──────────────────────────────────────────────────

function renderAllyCard(def, container) {
  var card = document.createElement("div");
  card.className = "shop-card shop-card--ally";
  var ally = null;
  for (var ai = 0; ai < currentAllies.length; ai++) {
    if (currentAllies[ai].id === def.id) { ally = currentAllies[ai]; break; }
  }
  var owned = !!ally;

  var left = document.createElement("div"); left.className = "shop-card-left";
  var nm = document.createElement("div"); nm.className = "shop-card-name";
  nm.textContent = def.icon + " " + def.name + (owned ? " ✅" : "");
  left.appendChild(nm);

  if (owned) {
    var ds = document.createElement("div"); ds.className = "shop-card-desc";
    ds.textContent = "HP:" + ally.maxHp + "  ATK:" + ally.atk + "  DEF:" + ally.def;
    var sk = document.createElement("div"); sk.className = "shop-card-recipe";
    sk.textContent = "技能：" + def.skill.icon + " " + def.skill.name;
    left.appendChild(ds); left.appendChild(sk);

    // 升級按鈕列
    var upgRow = document.createElement("div"); upgRow.className = "ally-upgrade-row";
    var upgCfgs = [
      { stat: "atk",   label: "ATK+3",  baseCost: 30, perLevel: 20 },
      { stat: "def",   label: "DEF+2",  baseCost: 25, perLevel: 15 },
      { stat: "maxHp", label: "HP+20",  baseCost: 35, perLevel: 20 }
    ];
    var upgs = ally.upgrades || { atk: 0, def: 0, maxHp: 0 };
    upgCfgs.forEach(function(uc) {
      var level = upgs[uc.stat] || 0;
      var cost  = uc.baseCost + level * uc.perLevel;
      var maxed = level >= 3;
      var ubtn  = document.createElement("button");
      ubtn.className = "btn btn-upgrade";
      if (maxed) {
        ubtn.textContent = uc.label + " MAX";
        ubtn.disabled = true;
      } else {
        ubtn.textContent = uc.label + " 💰" + cost;
        ubtn.onclick = (function(id, stat) {
          return function() { upgradeAlly(id, stat); };
        })(def.id, uc.stat);
      }
      upgRow.appendChild(ubtn);
    });
    left.appendChild(upgRow);
  } else {
    var ds2 = document.createElement("div"); ds2.className = "shop-card-desc";
    ds2.textContent = "HP:" + def.maxHp + "  ATK:" + def.atk + "  DEF:" + def.def;
    var sk2 = document.createElement("div"); sk2.className = "shop-card-recipe";
    sk2.textContent = "技能：" + def.skill.icon + " " + def.skill.name + " — " + def.skill.desc;
    left.appendChild(ds2); left.appendChild(sk2);
  }

  var right = document.createElement("div"); right.className = "shop-card-right";
  var pr = document.createElement("div"); pr.className = "shop-card-price";
  pr.textContent = "💰 " + def.price;
  var btn = document.createElement("button"); btn.className = "btn btn-shop";
  if (owned) {
    btn.textContent = "已招募"; btn.disabled = true;
  } else if (currentAllies.length >= 2) {
    btn.textContent = "隊伍已滿"; btn.disabled = true;
  } else {
    btn.textContent = "招募";
    btn.onclick = (function(d) { return function() { buyAlly(d); }; })(def);
  }
  right.appendChild(pr); right.appendChild(btn);
  card.appendChild(left); card.appendChild(right);
  container.appendChild(card);
}

function upgradeAlly(allyId, stat) {
  var ally = null;
  for (var i = 0; i < currentAllies.length; i++) {
    if (currentAllies[i].id === allyId) { ally = currentAllies[i]; break; }
  }
  if (!ally) return;
  if (!ally.upgrades) ally.upgrades = { atk: 0, def: 0, maxHp: 0 };

  var level = ally.upgrades[stat] || 0;
  if (level >= 3) { showShopMessage("已達最大升級次數！"); return; }

  var baseCosts  = { atk: 30, def: 25, maxHp: 35 };
  var perLevels  = { atk: 20, def: 15, maxHp: 20 };
  var gains      = { atk: 3,  def: 2,  maxHp: 20 };
  var statNames  = { atk: "ATK", def: "DEF", maxHp: "最大HP" };

  var cost = baseCosts[stat] + level * perLevels[stat];
  if (currentPlayer.money < cost) {
    showShopMessage("金幣不足！需要 " + cost + " 金幣。"); return;
  }

  updatePlayerMoney(-cost);
  ally.upgrades[stat] = level + 1;
  var gain = gains[stat];

  if      (stat === "atk")   ally.atk += gain;
  else if (stat === "def")   ally.def += gain;
  else if (stat === "maxHp") {
    ally.maxHp += gain;
    if (!ally.knockedOut) ally.hp = Math.min(ally.hp + gain, ally.maxHp);
  }

  showShopMessage("✨ 「" + ally.icon + " " + ally.name + "」" + statNames[stat] + " +" + gain +
    "！（第 " + ally.upgrades[stat] + " 次強化）");
  document.getElementById("shop-player-money").textContent = currentPlayer.money;
  openShop();
}

function buyAlly(def) {
  if (currentPlayer.money < def.price) {
    showShopMessage("金幣不足！需要 " + def.price + " 金幣。"); return;
  }
  if (currentAllies.length >= 2) {
    showShopMessage("隊伍最多容納 2 名同伴！"); return;
  }
  if (currentAllies.some(function(a) { return a.id === def.id; })) {
    showShopMessage("「" + def.name + "」已在隊伍中！"); return;
  }
  updatePlayerMoney(-def.price);
  currentAllies.push({
    id: def.id, name: def.name, icon: def.icon,
    hp: def.maxHp, maxHp: def.maxHp,
    atk: def.atk, def: def.def,
    skill: def.skill, skillCooldown: 0, knockedOut: false,
    upgrades: { atk: 0, def: 0, maxHp: 0 }
  });
  showShopMessage("✨ 「" + def.icon + " " + def.name + "」加入了隊伍！");
  document.getElementById("shop-player-money").textContent = currentPlayer.money;
  openShop();
}

// ─────────────────────────────────────────────────────────────

function runNextEnemyTurn() {
  // ── 分身同時攻擊 ──────────────────────────────────────────
  if (activeClones.length > 0) {
    var effectiveDef = currentPlayer.def + (currentPlayer.tempDef || 0);
    var totalDmg = 0;
    for (var i = 0; i < activeClones.length; i++) {
      totalDmg += Math.max(1, activeClones[i].atk - effectiveDef);
    }
    var cloneLabel = savedBoss ? "分身" : currentEnemy.name;
    var shielded = isPlayerDefending || allyShieldActive;
    isPlayerDefending = false;
    allyShieldActive  = false;
    if (shielded) {
      totalDmg = Math.floor(totalDmg / 2);
      logMessage("🛡️ 防禦/護盾！" + cloneLabel + "合擊削半，共受 " + totalDmg + " 點傷害！");
    } else {
      logMessage("🌑 " + activeClones.length + " 個「" + cloneLabel + "」同時攻擊！共造成 " + totalDmg + " 點傷害！");
    }
    if (totalDmg > 0) updatePlayerHp(-totalDmg);
    if (currentPlayer.hp <= 0) {
      logMessage("💀 你被打倒了..."); playSound("defeat");
      setTimeout(function() { triggerGameOver(); }, 1500); return;
    }
    decrementSkillCooldowns();
    setCombatButtonsEnabled(true);
    return;
  }

  // ── 普通敵人 / Boss 回合 ──────────────────────────────────
  // 25% 機率敵人轉向攻擊存活同伴
  var liveForEnemy = currentAllies.filter(function(a) { return !a.knockedOut; });
  if (liveForEnemy.length > 0 && Math.random() < 0.25) {
    var atarget = liveForEnemy[Math.floor(Math.random() * liveForEnemy.length)];
    var admg    = Math.max(1, currentEnemy.atk - (atarget.def || 0));
    if (isPlayerDefending || allyShieldActive) { admg = Math.floor(admg / 2); }
    isPlayerDefending = false; allyShieldActive = false;
    atarget.hp = Math.max(0, atarget.hp - admg);
    logMessage("「" + currentEnemy.name + "」轉向攻擊「" + atarget.name + "」！造成 " + admg + " 點傷害！");
    if (atarget.hp <= 0) {
      atarget.knockedOut = true;
      logMessage("💔 「" + atarget.name + "」陣亡了！前往商店購買或寶箱尋找復活藥水。");
    }
    updateAllyHpArea();
    decrementSkillCooldowns();
    if (playerAtkDebuffTurns > 0) playerAtkDebuffTurns--;
    setCombatButtonsEnabled(true);
    return;
  }

  var res = enemyTurn(currentPlayer, currentEnemy);

  if (res.summonClones && res.summonClones.length > 0) {
    logMessage(res.message);
    savedBoss = currentEnemy;
    decrementSkillCooldowns();
    setTimeout(function() { startCloneFight(res.summonClones); }, 1000);
    return;
  }

  var dmg = res.playerDamage || 0;
  var shielded2 = isPlayerDefending || allyShieldActive;
  isPlayerDefending = false;
  allyShieldActive  = false;
  if (shielded2) {
    dmg = Math.floor(dmg / 2);
    logMessage(currentEnemy.name + " 攻擊，但防禦/護盾減少了傷害！");
  }
  if (dmg > 0) updatePlayerHp(-dmg);
  logMessage(res.message || "");

  // 壓制技能：玩家攻擊力減半 2 回合
  if (res.suppressPlayer) {
    playerAtkDebuffTurns = 2;
    logMessage("⚠️ 你的攻擊力被壓制！接下來 2 回合僅有一半！");
  }

  // 黑騎士全力突擊：下一擊弱點暴露
  if (res.knightExposed) {
    blackKnightExposed = true;
  }

  if (currentPlayer.hp <= 0) {
    logMessage("💀 你被打倒了..."); playSound("defeat");
    setTimeout(function() { triggerGameOver(); }, 1500); return;
  }

  if (COMBAT_MODE === "press_turn") {
    if      (res.bonusTurn) logMessage("★ 敵人獲得額外行動！");
    else if (res.loseTurn)  enemyTokensLeft = 0;
    else                    enemyTokensLeft--;
    updateTokenDisplay();
    if (enemyTokensLeft > 0) { setTimeout(function() { runNextEnemyTurn(); }, 800); return; }
    startNewCombatRound();
  } else {
    decrementSkillCooldowns();
    // 狂暴連擊（傳統模式也生效）+ 範圍濺射同伴
    if (res.bonusTurn) {
      logMessage("💢 狂暴連擊！");
      if (currentAllies.length > 0) {
        for (var bai = 0; bai < currentAllies.length; bai++) {
          if (!currentAllies[bai].knockedOut) {
            currentAllies[bai].hp = Math.max(0, currentAllies[bai].hp - 10);
            if (currentAllies[bai].hp <= 0) {
              currentAllies[bai].knockedOut = true;
              logMessage("💔 「" + currentAllies[bai].name + "」被魔王狂暴擊倒！");
            }
          }
        }
        updateAllyHpArea();
      }
      setTimeout(function() { runNextEnemyTurn(); }, 800);
    } else {
      if (playerAtkDebuffTurns > 0) { playerAtkDebuffTurns--; }
      setCombatButtonsEnabled(true);
    }
  }
}

function startNewCombatRound() {
  isPlayerDefending = false;
  decrementSkillCooldowns();
  if (COMBAT_MODE === "press_turn") {
    playerTokensLeft = PRESS_TURN_TOKENS; enemyTokensLeft = PRESS_TURN_TOKENS;
    updateTokenDisplay();
  }
  setCombatButtonsEnabled(true);
}

function giveEnemyReward() {
  var reward = currentEnemy.reward;
  if (reward && reward.money) { updatePlayerMoney(reward.money); showCoinDrop(reward.money); }

  var hpGain = Math.min(28, 10 + Math.floor(currentEnemy.maxHp / 10));
  if (hpGain > 0) { updatePlayerHp(hpGain); logMessage("💚 戰鬥後恢復了 " + hpGain + " 點 HP！"); }

  var allyHeal = Math.max(5, Math.floor(hpGain / 3));
  for (var ai = 0; ai < currentAllies.length; ai++) {
    var a = currentAllies[ai];
    if (!a.knockedOut && a.hp < a.maxHp) {
      a.hp = Math.min(a.maxHp, a.hp + allyHeal);
    }
  }
  if (currentAllies.some(function(a) { return !a.knockedOut; })) {
    logMessage("💚 同伴也恢復了 " + allyHeal + " 點 HP！");
  }

  setTimeout(function() {
    if (currentEnemy.isFinalBoss) {
      triggerGameClear();
    } else {
      currentMap[currentEnemy.y][currentEnemy.x] = MAP_TILE.EMPTY;
      endCombat(true);
    }
  }, 1500);
}

function showCoinDrop(amount) {
  var field = document.getElementById("combat-field");
  if (!field) return;
  for (var k = 0; k < 3; k++) {
    (function(delay, kk) {
      setTimeout(function() {
        var coin = document.createElement("div");
        coin.className = "coin-drop";
        coin.textContent = kk === 0 ? "💰+" + amount : "✨";
        coin.style.left = (20 + Math.random() * 60) + "%";
        coin.style.top  = (30 + Math.random() * 30) + "%";
        field.appendChild(coin);
        setTimeout(function() { if (coin.parentNode) coin.parentNode.removeChild(coin); }, 1100);
      }, delay);
    })(k * 200, k);
  }
}

function endCombat(won) {
  currentPlayer.tempAtk = 0; currentPlayer.tempDef = 0;
  updateHUD();
  currentEnemy = null; isPlayerDefending = false;
  allyShieldActive = false;
  activeClones = []; savedBoss = null; pairedFightEnemy = null;
  hideAllyPanel();
  renderMap(); showScreen("screen-map");
}

// ── 通關與失敗 ────────────────────────────────────────────────
function triggerGameOver() { gameOver = true; showScreen("screen-gameover"); }
function triggerGameClear() { gameOver = true; showScreen("screen-clear"); }

function restartGame() {
  gameOver = false;
  player.x = playerStart.x; player.y = playerStart.y;
  currentPlayer.hp        = playerStats.hp;
  currentPlayer.maxHp     = playerStats.maxHp;
  currentPlayer.atk       = playerStats.atk;
  currentPlayer.def       = playerStats.def;
  currentPlayer.money     = playerStats.money;
  currentPlayer.keys      = playerStats.keys;
  currentPlayer.skills    = (playerStats.skills || ["power_strike"]).slice();
  currentPlayer.inventory = [];
  currentPlayer.tempAtk   = 0;
  currentPlayer.tempDef   = 0;

  currentMap            = generateMaze();
  visitedTiles          = [];
  currentEnemy          = null;
  activeClones          = [];
  savedBoss             = null;
  pairedFightEnemy      = null;
  currentAllies         = [];
  allyShieldActive      = false;
  blackKnightExposed    = false;
  pendingSkillId        = null;
  pendingHealTarget     = null;
  shopUnlocked          = false;
  isPlayerDefending     = false;
  playerSkillCooldowns  = {};
  playerAtkDebuffTurns  = 0;

  updateHUD(); renderMap(); showScreen("screen-map");
}

// ── 地圖訊息 ──────────────────────────────────────────────────
function showMapMessage(msg) {
  var el = document.getElementById("map-message");
  if (!el) return;
  el.textContent = msg; el.style.opacity = "1";
  clearTimeout(showMapMessage._timer);
  showMapMessage._timer = setTimeout(function() { el.style.opacity = "0"; }, 2500);
}

// ── 小遊戲 ────────────────────────────────────────────────────
function onMiniGameEnd(result) {
  stopMiniGame(); showScreen("screen-map");
  if (result) {
    updatePlayerKeys(1); showMapMessage("🎉 小遊戲通關！你獲得了一把鑰匙！"); playSound("key");
    if (currentMiniGameTile) {
      currentMap[currentMiniGameTile.y][currentMiniGameTile.x] = MAP_TILE.EMPTY;
    }
  } else {
    showMapMessage("小遊戲失敗，再接再厲！");
  }
  currentMiniGameTile = null; renderMap();
}

var currentMiniGameTile = null;
function triggerMiniGame(x, y) {
  currentMiniGameTile = { x: x, y: y };
  showScreen("screen-minigame"); startMiniGame();
}

// ── 對話系統 ─────────────────────────────────────────────────
function showDialogue(lines, callback) {
  dialogueQueue = lines.slice(); dialogueCallback = callback || null;
  advanceDialogue();
}

function advanceDialogue() {
  if (dialogueQueue.length === 0) {
    if (dialogueCallback) { var cb = dialogueCallback; dialogueCallback = null; cb(); }
    else showScreen("screen-map");
    return;
  }
  var line = dialogueQueue.shift();
  var se = document.getElementById("dialogue-speaker-name");
  var te = document.getElementById("dialogue-text-content");
  if (se) se.textContent = line.speaker || "";
  if (te) te.textContent = line.text    || "";
  showScreen("screen-dialogue");
}

// ── 初始化 ────────────────────────────────────────────────────
window.onload = function() {
  updateHUD(); renderMap();
  if (typeof dialogues !== "undefined" &&
      dialogues.intro && dialogues.intro.length > 0) {
    showDialogue(dialogues.intro, function() { showScreen("screen-map"); });
  } else {
    showScreen("screen-map");
  }
};
