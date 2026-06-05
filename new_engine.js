// ============================================================
//  new_engine.js  ── 遊戲引擎（邏輯 + 戰鬥 + 小遊戲）
//  來源：engine.js + student.js
//  數值設定請見 new_data.js
// ============================================================


// ── 偽隨機數（固定種子） ────────────────────────────────────────
function makeRng(seed) {
  var s = (seed >>> 0) || 1;
  return function() {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
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
  inventory: [],
  tempAtk:   0,
  tempDef:   0
};

var currentMap = mapGrid.map(function(row) { return row.slice(); });

var mazeDivX1 = -1, mazeDivX2 = -1;
var _doorXs = [];
for (var _dy = 0; _dy < currentMap.length; _dy++) {
  for (var _dx = 0; _dx < currentMap[_dy].length; _dx++) {
    if (currentMap[_dy][_dx] === MAP_TILE.DOOR && _doorXs.indexOf(_dx) === -1)
      _doorXs.push(_dx);
  }
}
_doorXs.sort(function(a, b) { return a - b; });
if (_doorXs.length >= 1) mazeDivX1 = _doorXs[0];
if (_doorXs.length >= 2) mazeDivX2 = _doorXs[_doorXs.length - 1];

var visitedTiles      = [];
var currentEnemy      = null;
var activeClones      = [];
var savedBoss         = null;
var pairedFightEnemy  = null;
var _pairedAttackCursor = 0;
var currentAllies     = [];
var allyShieldActive  = false;
var allyDefendList    = [];     // 本回合選擇防禦的同伴
var knightTauntActive = false;
var blackKnightExposed = false;
var pendingSkillId    = null;
var pendingHealTarget = null;
var pendingItemIdx    = -1;
var pendingItemIndex  = null;
var shopUnlocked      = false;
// 我方/敵方全體 buff/debuff（-3 ~ +3 段，共享回合數）
var partyBuff = {
  atk: { stages: 0, turnsLeft: 0 },
  def: { stages: 0, turnsLeft: 0 },
  spd: { stages: 0, turnsLeft: 0 }
};
var enemyBuff = {
  atk: { stages: 0, turnsLeft: 0 },
  def: { stages: 0, turnsLeft: 0 },
  spd: { stages: 0, turnsLeft: 0 }
};
var shopPurchaseCounts = {};
var isPlayerDefending = false;
var gameOver          = false;

var _playerSideQueueCursor = 0;
var playerFullTokens  = 0;
var playerFlashTokens = 0;
var enemyFullTokens   = 0;
var enemyFlashTokens  = 0;

var bossClonePhase = { active: false, boss: null, clones: [] };
var enemyCloneTurnCursor = 0;
var clonePhaseEndedThisAction = false;

var playerSkillCooldowns  = {};
var playerAtkDebuffTurns  = 0;

var dialogueQueue    = [];
var dialogueCallback = null;


// ── 小遊戲狀態 ────────────────────────────────────────────────
var mgScore        = 0;
var mgTimeLeft     = MG_TIME;
var mgTimer        = null;
var mgSpawnTimer   = null;
var mgCurrentEnemy = null;
var mgEnemyTimer   = null;
var mgRunning      = false;


// ── 工具函式 ──────────────────────────────────────────────────
function showScreen(screenId) {
  var screens = ["screen-map", "screen-combat", "screen-shop",
                 "screen-minigame", "screen-dialogue",
                 "screen-gameover", "screen-clear"];
  for (var i = 0; i < screens.length; i++) {
    var el = document.getElementById(screens[i]);
    if (el) el.style.display = (screens[i] === screenId) ? "flex" : "none";
  }
  // pending 教學：回到目標場景時觸發
  if (screenId === "screen-map"    && _tut && _tut.mazePending)   { setTimeout(tryShowMazeTutorial,        150); }
  if (screenId === "screen-combat" && _tut && _tut.combatPending) { setTimeout(tryShowCombatIntroTutorial, 150); }
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

// ── 命中率計算 ────────────────────────────────────────────────
// ── 速度 Buff 計算 ────────────────────────────────────────────
function getEffectiveSpd(char) {
  var base = char.spd || 0;
  var isPartyMember = (char === currentPlayer || currentAllies.indexOf(char) !== -1);
  if (isPartyMember) base += partyBuff.spd.stages * SPD_STAGE_BONUS;
  else base += enemyBuff.spd.stages * SPD_STAGE_BONUS;
  return base;
}

function getEffectiveAtk(char) {
  var base = (char.atk || 0) + (char.tempAtk || 0);
  var isPartyMember = (char === currentPlayer || currentAllies.indexOf(char) !== -1);
  base += (isPartyMember ? partyBuff : enemyBuff).atk.stages * ATK_STAGE_BONUS;
  return Math.max(0, base);
}
function getEffectiveDef(char) {
  var base = (char.def || 0) + (char.tempDef || 0);
  var isPartyMember = (char === currentPlayer || currentAllies.indexOf(char) !== -1);
  base += (isPartyMember ? partyBuff : enemyBuff).def.stages * DEF_STAGE_BONUS;
  return Math.max(0, base);
}

function calcHitRate(attacker, defender, baseHit) {
  var atkSpd = getEffectiveSpd(attacker);
  var defSpd = getEffectiveSpd(defender);
  var rate = baseHit + (atkSpd - defSpd) / SPD_HIT_SCALE;
  return Math.max(30, Math.min(95, rate));
}
function rollHit(attacker, defender, baseHit) {
  return Math.random() * 100 < calcHitRate(attacker, defender, baseHit);
}

function calcCritRate(attacker, defender) {
  var atkSpd = getEffectiveSpd(attacker);
  var defSpd = getEffectiveSpd(defender);
  return Math.max(BASE_CRIT_RATE, Math.min(0.9, (atkSpd - defSpd) / SPD_HIT_SCALE));
}
function calcSkillCritRate(attacker, defender) {
  return Math.min(0.9, calcCritRate(attacker, defender) + SKILL_CRIT_BONUS);
}

function shakeElement(el) {
  if (!el) return;
  el.classList.remove("hit-shake");
  void el.offsetWidth;
  el.classList.add("hit-shake");
  setTimeout(function() { el.classList.remove("hit-shake"); }, 520);
}

function shakePlayer() {
  shakeElement(document.querySelector("#combat-party-area .party-unit[data-party-idx='0']"));
}

function shakeAlly(allyObj) {
  var idx = currentAllies.indexOf(allyObj);
  if (idx === -1) return;
  shakeElement(document.querySelector("#combat-party-area .party-unit[data-party-idx='" + (idx + 1) + "']"));
}

function shakeEnemy(target) {
  var area = document.getElementById("combat-enemies-area");
  if (!area) return;
  var units = activeClones.length > 0 ? activeClones : (currentEnemy ? [currentEnemy] : []);
  var idx = units.indexOf(target);
  if (idx === -1) idx = 0;
  var divs = area.querySelectorAll(".enemy-unit");
  if (divs[idx]) shakeElement(divs[idx]);
}

function updatePlayerHp(amount) {
  currentPlayer.hp = Math.min(currentPlayer.maxHp, Math.max(0, currentPlayer.hp + amount));
  if (amount < 0) shakePlayer();
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
  updatePartyHpArea();
  renderSideParty();
}

function renderSideParty() {
  var area = document.getElementById("side-party-list");
  if (!area) return;
  area.innerHTML = "";

  function makeCard(icon, name, hp, maxHp, atk, def, isPlayer, isKO) {
    var pct = maxHp > 0 ? Math.max(0, hp / maxHp * 100) : 0;
    var barClass = isKO ? "bar--low" : (isPlayer ? "bar--player" : (pct < 30 ? "bar--low" : "bar--ally"));
    var card = document.createElement("div");
    card.className = "side-member-card" + (isKO ? " side-member-ko" : "");
    card.innerHTML =
      '<div class="side-member-name">' + icon + " " + name + (isKO ? " 💀" : "") + '</div>' +
      '<div class="side-member-bar-wrap">' +
        '<div class="side-member-bar-fill ' + barClass + '" style="width:' + pct + '%"></div>' +
      '</div>' +
      '<div class="side-member-stats">' +
        '❤️ ' + hp + '/' + maxHp +
        ' &nbsp;⚔️ ' + atk +
        ' &nbsp;🛡️ ' + def +
      '</div>';
    area.appendChild(card);
  }

  makeCard("🧙", currentPlayer.name,
    currentPlayer.hp, currentPlayer.maxHp,
    currentPlayer.atk + (currentPlayer.tempAtk || 0),
    currentPlayer.def + (currentPlayer.tempDef || 0),
    true, false);

  for (var i = 0; i < currentAllies.length; i++) {
    var a = currentAllies[i];
    makeCard(a.icon, a.name, a.hp, a.maxHp, a.atk, a.def, false, a.knockedOut);
  }
}

// ── 小地圖渲染 ────────────────────────────────────────────────
function renderMiniMap() {
  var canvas = document.getElementById("minimap-canvas");
  if (!canvas || !canvas.getContext) return;
  var ctx  = canvas.getContext("2d");
  var rows = currentMap.length;
  var cols = currentMap[0] ? currentMap[0].length : 0;
  if (!rows || !cols) return;

  var RADIUS = 5;
  var VIEW   = RADIUS * 2 + 1;
  var CELL   = 9;
  canvas.width  = VIEW * CELL;
  canvas.height = VIEW * CELL;

  var TC = {};
  TC[MAP_TILE.EMPTY]      = "#2d4a7a";
  TC[MAP_TILE.WALL]       = "#080d1a";
  TC[MAP_TILE.CHEST]      = "#c89010";
  TC[MAP_TILE.ENEMY]      = "#b83030";
  TC[MAP_TILE.DOOR]       = "#604898";
  TC[MAP_TILE.MINI_GAME]  = "#1878b0";
  TC[MAP_TILE.SHOP]       = "#287840";
  TC[MAP_TILE.PORTAL]     = "#c05010";
  TC[MAP_TILE.FINAL_BOSS] = "#880010";

  for (var dy = -RADIUS; dy <= RADIUS; dy++) {
    for (var dx = -RADIUS; dx <= RADIUS; dx++) {
      var mx = player.x + dx;
      var my = player.y + dy;
      var cx = (dx + RADIUS) * CELL;
      var cy = (dy + RADIUS) * CELL;

      var color;
      if (dx === 0 && dy === 0) {
        color = "#22e060";
      } else if (mx < 0 || my < 0 || mx >= cols || my >= rows) {
        color = "#050810";
      } else {
        var dist       = Math.max(Math.abs(dx), Math.abs(dy));
        var isVisible  = dist <= visionRadius;
        var isExplored = visitedTiles.indexOf(mx + "," + my) !== -1;
        if (isVisible || isExplored) {
          color = TC[currentMap[my][mx]] || "#2d4a7a";
        } else {
          color = "#050810";
        }
      }

      ctx.fillStyle = color;
      ctx.fillRect(cx, cy, CELL, CELL);
    }
  }

  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth   = 1;
  ctx.strokeRect(RADIUS * CELL + 0.5, RADIUS * CELL + 0.5, CELL - 1, CELL - 1);
}

function renderMiniMapLarge() {
  var canvas = document.getElementById("minimap-canvas-large");
  if (!canvas || !canvas.getContext) return;
  var ctx  = canvas.getContext("2d");
  var rows = currentMap.length;
  var cols = currentMap[0] ? currentMap[0].length : 0;
  if (!rows || !cols) return;

  var CELL = 30;
  canvas.width  = cols * CELL;
  canvas.height = rows * CELL;

  var TC = {};
  TC[MAP_TILE.EMPTY]      = "#2d4a7a";
  TC[MAP_TILE.WALL]       = "#080d1a";
  TC[MAP_TILE.CHEST]      = "#c89010";
  TC[MAP_TILE.ENEMY]      = "#b83030";
  TC[MAP_TILE.DOOR]       = "#604898";
  TC[MAP_TILE.MINI_GAME]  = "#1878b0";
  TC[MAP_TILE.SHOP]       = "#287840";
  TC[MAP_TILE.PORTAL]     = "#c05010";
  TC[MAP_TILE.FINAL_BOSS] = "#880010";

  for (var y = 0; y < rows; y++) {
    for (var x = 0; x < cols; x++) {
      var isPlayer   = (x === player.x && y === player.y);
      var dist       = Math.max(Math.abs(x - player.x), Math.abs(y - player.y));
      var isVisible  = dist <= visionRadius;
      var isExplored = visitedTiles.indexOf(x + "," + y) !== -1;

      var color;
      if (isPlayer) {
        color = "#22e060";
      } else if (isVisible || isExplored) {
        color = TC[currentMap[y][x]] || "#2d4a7a";
      } else {
        color = "#050810";
      }

      ctx.fillStyle = color;
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }

  ctx.strokeStyle = "#00ff88";
  ctx.lineWidth   = 2;
  ctx.strokeRect(player.x * CELL + 1, player.y * CELL + 1, CELL - 2, CELL - 2);
}

// ── 大地圖平移狀態 ────────────────────────────────────────────
var _largeMapPanX = 0;
var _largeMapPanY = 0;
var _LARGE_MAP_CELL = 30;  // 與 renderMiniMapLarge 保持一致

function _applyLargeMapPan() {
  var canvas = document.getElementById("minimap-canvas-large");
  var vp     = document.getElementById("minimap-viewport");
  if (!canvas || !vp) return;
  var vpW = vp.clientWidth  || vp.offsetWidth;
  var vpH = vp.clientHeight || vp.offsetHeight;
  var maxX = 0;
  var minX = Math.min(0, vpW - canvas.width);
  var maxY = 0;
  var minY = Math.min(0, vpH - canvas.height);
  _largeMapPanX = Math.max(minX, Math.min(maxX, _largeMapPanX));
  _largeMapPanY = Math.max(minY, Math.min(maxY, _largeMapPanY));
  canvas.style.left = _largeMapPanX + "px";
  canvas.style.top  = _largeMapPanY + "px";
}

function _largeMapKeyHandler(e) {
  var keys = { ArrowUp: true, ArrowDown: true, ArrowLeft: true, ArrowRight: true };
  if (!keys[e.key]) return;
  e.preventDefault();
  e.stopPropagation();
  var step = _LARGE_MAP_CELL * 3;  // 每次移動 3 格
  if (e.key === "ArrowLeft")  _largeMapPanX += step;
  if (e.key === "ArrowRight") _largeMapPanX -= step;
  if (e.key === "ArrowUp")    _largeMapPanY += step;
  if (e.key === "ArrowDown")  _largeMapPanY -= step;
  _applyLargeMapPan();
}

function openMiniMapOverlay() {
  var overlay = document.getElementById("minimap-overlay");
  if (!overlay) return;
  overlay.style.display = "flex";
  renderMiniMapLarge();

  // 開啟後將視角對準玩家，再套用平移
  setTimeout(function() {
    var vp = document.getElementById("minimap-viewport");
    if (!vp) return;
    var vpW = vp.clientWidth  || vp.offsetWidth;
    var vpH = vp.clientHeight || vp.offsetHeight;
    var rows = currentMap.length;
    var cols = currentMap[0] ? currentMap[0].length : 0;
    var canvasW = cols * _LARGE_MAP_CELL;
    var canvasH = rows * _LARGE_MAP_CELL;
    // 玩家置中
    _largeMapPanX = vpW / 2 - (player.x + 0.5) * _LARGE_MAP_CELL;
    _largeMapPanY = vpH / 2 - (player.y + 0.5) * _LARGE_MAP_CELL;
    _applyLargeMapPan();
  }, 0);

  document.addEventListener("keydown", _largeMapKeyHandler, true);
}

function closeMiniMapOverlay() {
  var overlay = document.getElementById("minimap-overlay");
  if (overlay) overlay.style.display = "none";
  document.removeEventListener("keydown", _largeMapKeyHandler, true);
}

// ── 背包 Overlay ──────────────────────────────────────────────
function openInventory() {
  var overlay = document.getElementById("inventory-overlay");
  if (!overlay) return;
  var list = document.getElementById("inventory-overlay-list");
  if (list) {
    list.innerHTML = "";
    var inv = currentPlayer.inventory;
    if (!inv || inv.length === 0) {
      var empty = document.createElement("div");
      empty.className = "inventory-overlay-empty";
      empty.textContent = "（背包是空的）";
      list.appendChild(empty);
    } else {
      var counts = {};
      for (var i = 0; i < inv.length; i++) {
        var n = inv[i].name;
        if (!counts[n]) counts[n] = { item: inv[i], qty: 0 };
        counts[n].qty++;
      }
      Object.keys(counts).forEach(function(name) {
        var row = document.createElement("div");
        row.className = "inventory-overlay-row";
        var c = counts[name];
        row.innerHTML = "<span class='inv-row-name'>" + c.item.name + "</span>" +
                        "<span class='inv-row-desc'>" + (c.item.desc || "") + "</span>" +
                        "<span class='inv-row-qty'>× " + c.qty + "</span>";
        list.appendChild(row);
      });
    }
  }
  overlay.style.display = "flex";
  _updateTutorialToggles();
}

function closeInventory() {
  var overlay = document.getElementById("inventory-overlay");
  if (overlay) overlay.style.display = "none";
}

// ── 設定 Overlay ──────────────────────────────────────────────
var _settingsInitialized = false;

function openSettings() {
  var overlay = document.getElementById("settings-overlay");
  if (!overlay) return;
  if (!_settingsInitialized) {
    _settingsInitialized = true;
    var bgmVol = 1.0;
    var sfxVol = 1.0;
    _initVolumeSlider({
      trackId:  "bgm-track",
      fillId:   "bgm-fill",
      thumbId:  "bgm-thumb",
      iconId:   "bgm-icon",
      initialVol: bgmVol,
      onChange: function(v) {
        if (typeof AudioSystem !== "undefined") AudioSystem.setBgmVolume(v);
      }
    });
    _initVolumeSlider({
      trackId:  "sfx-track",
      fillId:   "sfx-fill",
      thumbId:  "sfx-thumb",
      iconId:   "sfx-icon",
      initialVol: sfxVol,
      onChange: function(v) {
        if (typeof AudioSystem !== "undefined") AudioSystem.setSfxVolume(v);
      }
    });
  }
  overlay.style.display = "flex";
}

function openPartyOverlay() {
  var ov = document.getElementById("party-overlay");
  if (ov) { renderSideParty(); ov.style.display = "flex"; }
}

function closePartyOverlay() {
  var ov = document.getElementById("party-overlay");
  if (ov) ov.style.display = "none";
}

function closeSettings() {
  var overlay = document.getElementById("settings-overlay");
  if (overlay) overlay.style.display = "none";
  var onMap    = document.getElementById("screen-map")    && document.getElementById("screen-map").style.display    !== "none";
  var onCombat = document.getElementById("screen-combat") && document.getElementById("screen-combat").style.display !== "none";
  if (_tut.mazeEnabled && !_tut.mazeDone) {
    if (onMap) { setTimeout(tryShowMazeTutorial, 100); }
    else       { _tut.mazePending = true; }
  }
  if (_tut.combatEnabled && !_tut.combatIntroDone) {
    if (onCombat) { setTimeout(tryShowCombatIntroTutorial, 100); }
    else          { _tut.combatPending = true; }
  }
}

function _initVolumeSlider(opts) {
  var track = document.getElementById(opts.trackId);
  var fill  = document.getElementById(opts.fillId);
  var thumb = document.getElementById(opts.thumbId);
  var icon  = document.getElementById(opts.iconId);
  if (!track || !fill || !thumb) return;

  var vol        = Math.max(0, Math.min(1, opts.initialVol));
  var lastNonZero = vol > 0 ? vol : 1.0;

  function applyVol(v) {
    vol = Math.max(0, Math.min(1, v));
    if (vol > 0) lastNonZero = vol;
    var pct = (vol * 100).toFixed(2) + "%";
    fill.style.width  = pct;
    thumb.style.left  = pct;
    if (vol === 0) {
      thumb.classList.add("muted");
      if (icon && icon.dataset.off) icon.src = icon.dataset.off;
    } else {
      thumb.classList.remove("muted");
      if (icon && icon.dataset.on) icon.src = icon.dataset.on;
    }
    if (opts.onChange) opts.onChange(vol);
  }

  applyVol(vol);

  if (icon) {
    icon.style.cursor = "pointer";
    icon.addEventListener("click", function() {
      applyVol(vol === 0 ? lastNonZero : 0);
    });
  }

  function volFromEvent(e) {
    var rect = track.getBoundingClientRect();
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return (clientX - rect.left) / rect.width;
  }

  var dragging = false;

  track.addEventListener("mousedown", function(e) {
    dragging = true;
    applyVol(volFromEvent(e));
    e.preventDefault();
  });
  thumb.addEventListener("mousedown", function(e) {
    dragging = true;
    e.stopPropagation();
    e.preventDefault();
  });
  document.addEventListener("mousemove", function(e) {
    if (!dragging) return;
    applyVol(volFromEvent(e));
  });
  document.addEventListener("mouseup", function() {
    dragging = false;
  });

  track.addEventListener("touchstart", function(e) {
    dragging = true;
    applyVol(volFromEvent(e));
    e.preventDefault();
  }, { passive: false });
  thumb.addEventListener("touchstart", function(e) {
    dragging = true;
    e.stopPropagation();
    e.preventDefault();
  }, { passive: false });
  document.addEventListener("touchmove", function(e) {
    if (!dragging) return;
    applyVol(volFromEvent(e));
  });
  document.addEventListener("touchend", function() {
    dragging = false;
  });
}

// ── 戰鬥按鈕啟用 / 停用 ──────────────────────────────────────
function setCombatButtonsEnabled(enabled) {
  var pZone = document.getElementById("player-action-zone");
  var aZone = document.getElementById("ally-action-zone");
  if (pZone) pZone.style.display = enabled ? "flex" : "none";
  if (enabled && aZone) aZone.style.display = "none";

  var ids = ["btn-attack", "btn-defend", "btn-flee"];
  for (var i = 0; i < ids.length; i++) {
    var btn = document.getElementById(ids[i]);
    if (btn) btn.disabled = !enabled;
  }
  var passBtn = document.getElementById("btn-pass");
  if (passBtn) {
    if (COMBAT_MODE === "press_turn") {
      passBtn.style.display = "";
      passBtn.disabled = !enabled || (playerFullTokens + playerFlashTokens) <= 0;
    } else {
      passBtn.style.display = "none";
    }
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

function computeSkillDesc(def, atk) {
  var a = atk || 0;
  var cd = def.cooldown > 0 ? "冷卻 " + def.cooldown + " 回合" : "無冷卻";
  switch (def.id) {
    case "power_strike":
      return "造成 " + (a * 2) + " 傷害（ATK×2，" + cd + "）";
    case "heal_magic":
      return "戰鬥中恢復 25 HP（" + cd + "）";
    case "shield_bash":
      return "防禦並造成 " + Math.max(1, Math.floor(a * 0.5)) + " 傷害（ATK×0.5，" + cd + "）";
    case "berserk":
      return "造成 " + (a * 3) + " 傷害，自損 15 HP（ATK×3，" + cd + "）";
    case "chain_slash":
      return "攻擊所有目標，各造成 " + Math.min(PLAYER_DMG_CAP, a) + " 傷害（上限 " + PLAYER_DMG_CAP + "，" + cd + "）";
    default:
      return def.desc;
  }
}

function computeAllySkillDesc(skill, atk) {
  var a = atk || 0;
  var cd = "冷卻 " + skill.cooldown + " 回合";
  if (skill.isAoe && skill.multiplier) {
    var dmg = Math.max(1, Math.floor(a * skill.multiplier));
    return "攻擊全體敵人各造成 " + dmg + " 傷害（ATK×" + skill.multiplier + "，" + cd + "）";
  }
  if (skill.multiplier && !skill.isTaunt && !skill.isShield) {
    var dmg = Math.max(1, Math.floor(a * skill.multiplier));
    return "對單體造成 " + dmg + " 傷害（ATK×" + skill.multiplier + "，" + cd + "）";
  }
  return skill.desc;
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
      btn.title     = computeSkillDesc(def, currentPlayer.atk + (currentPlayer.tempAtk || 0));
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

  if (isAoe) { executeCombatRound("skill_" + skillId); return; }

  if (isHeal) {
    var liveAllies = currentAllies.filter(function(a) { return !a.knockedOut; });
    if (liveAllies.length === 0) { executeCombatRound("skill_" + skillId); return; }
    var targets = [{ id: "player", label: "🧙 " + currentPlayer.name + "（自己）HP:" + currentPlayer.hp }];
    liveAllies.forEach(function(a, i) {
      targets.push({ id: "ally_" + i, label: a.icon + " " + a.name + " HP:" + a.hp });
    });
    showTargetSelect(skillId, targets); return;
  }

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
  if (title) title.textContent = skillId === "heal_magic" ? "💚 選擇治療目標" : "⚔️ 選擇攻擊目標";

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

  if (skillId === "attack") {
    executeCombatRound("attack");
  } else {
    executeCombatRound("skill_" + skillId);
  }
}

function cancelTargetSelect() {
  var panel = document.getElementById("target-select-panel");
  if (panel) panel.style.display = "none";
  pendingSkillId    = null;
  pendingHealTarget = null;
  pendingItemIdx    = -1;
  setCombatButtonsEnabled(true);
}

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
    skill("🛡️", "防禦姿態（技能，40% 機率）",
      "輕擊（ATK÷2），傷害較低。");
    skill("⚔️", "普通攻擊（60% 機率）",
      "標準攻擊，造成 ATK 扣除你的 DEF 的傷害。");
  } else if (e.isFinalBoss) {
    skill("🔱", "召喚分身（被動，25% 每回合）",
      "無分身時，召喚 1~3 個魔王分身（HP 20、ATK " + e.atk + "、每個各自攻擊）。");
    skill("👁️", "黑暗壓制（被動，25% 每回合）",
      "ATK-5 攻擊，使你的攻擊力接下來 2 回合減半（不與壓制中重疊）。");
    skill("😈", "狂暴（HP < 40% 必定觸發）",
      "ATK+5 傷害，並範圍濺射所有同伴各 10 HP。");
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

  // 按道具名稱分組，每種顯示一個「??? *(數量)」按鈕
  var groups = [];
  var groupMap = {};
  for (var i = 0; i < currentPlayer.inventory.length; i++) {
    var itemName = currentPlayer.inventory[i].name;
    if (groupMap[itemName] === undefined) {
      groupMap[itemName] = groups.length;
      groups.push({ name: itemName, count: 1, firstIdx: i, item: currentPlayer.inventory[i] });
    } else {
      groups[groupMap[itemName]].count++;
    }
  }

  for (var g = 0; g < groups.length; g++) {
    (function(grp) {
      var btn = document.createElement("button");
      btn.className   = "btn btn-item";
      btn.textContent = grp.name + " *" + grp.count;
      btn.title       = grp.item.desc || grp.name;
      btn.disabled    = (combatEnabled === false);
      btn.onclick     = function() { onUseItem(grp.firstIdx); };
      container.appendChild(btn);
    })(groups[g]);
  }
}

function getTargetableEnemies() {
  if (bossClonePhase.active) return activeClones.filter(function(c) { return !c.untargetable && c.hp > 0; });
  if (currentEnemy && !currentEnemy.untargetable) return [currentEnemy];
  return [];
}

function getValidItemTargets(item) {
  var side = item.targetSide || "ally";
  if (side === "enemy") return getTargetableEnemies();
  // "ally" — includes player + living allies
  var targets = [currentPlayer];
  for (var ai = 0; ai < currentAllies.length; ai++) {
    if (!currentAllies[ai].knockedOut) targets.push(currentAllies[ai]);
  }
  return targets;
}

function onUseItem(idx) {
  var item = currentPlayer.inventory[idx];
  if (!item) return;

  var targets = getValidItemTargets(item);

  // If only one valid target, skip selection UI and apply immediately
  if (targets.length <= 1) {
    applyItemToTarget(idx, targets[0] || currentPlayer);
    return;
  }

  // Multiple targets — show selection panel
  // Disable action buttons first, then re-show player-action-zone so
  // target-select-panel (which lives inside it) stays accessible.
  setCombatButtonsEnabled(false);
  var pZone = document.getElementById("player-action-zone");
  if (pZone) pZone.style.display = "flex";

  pendingItemIdx = idx;

  var panel = document.getElementById("target-select-panel");
  var btns  = document.getElementById("target-select-buttons");
  if (!panel || !btns) { applyItemToTarget(idx, currentPlayer); return; }

  var title = document.getElementById("target-select-title");
  if (title) title.textContent = "🎒 選擇使用對象：" + item.name;

  btns.innerHTML = "";
  targets.forEach(function(t, ti) {
    var btn = document.createElement("button");
    btn.className = "btn btn-defend";
    btn.style.flex = "none";

    // Build label
    var isPlayer = (t === currentPlayer);
    var hpStr = t.hp + "/" + (t.maxHp || t.hp);
    btn.textContent = (isPlayer ? "🧙 " : (t.icon || "👥 ")) +
                      (t.name || "玩家") + " (" + hpStr + ")";

    btn.onclick = (function(target) {
      return function() {
        panel.style.display = "none";
        applyItemToTarget(pendingItemIdx, target);
        pendingItemIdx = -1;
      };
    })(t);
    btns.appendChild(btn);
  });
  panel.style.display = "flex";
}

function applyItemToTarget(idx, target) {
  var item = currentPlayer.inventory[idx];
  if (!item) return;

  setCombatButtonsEnabled(false);

  var eff  = item.effect;
  var msgs = [];
  var isPlayer = (target === currentPlayer);

  // HP heal — works on player or ally
  var healAmt = eff.hp || eff.allyHeal || 0;
  if (healAmt > 0) {
    if (isPlayer) {
      updatePlayerHp(healAmt);
      msgs.push("回復 " + healAmt + " HP");
    } else {
      target.hp = Math.min(target.maxHp, target.hp + healAmt);
      updateAllyHpArea();
      msgs.push((target.icon || "") + "「" + target.name + "」回復 " + healAmt + " HP");
    }
  }

  // Self-damage (e.g. 狂暴藥水) — always hits player regardless of target
  if (eff.selfHp) {
    updatePlayerHp(eff.selfHp);
    msgs.push(eff.selfHp + " HP（玩家自身）");
  }

  // ATK buff — applies to selected target
  if (eff.tempAtk) {
    target.tempAtk = (target.tempAtk || 0) + eff.tempAtk;
    if (isPlayer) updateHUD();
    else updateAllyHpArea();
    msgs.push((isPlayer ? "" : (target.icon || "") + "「" + target.name + "」") + "ATK +" + eff.tempAtk);
  }

  // DEF buff — applies to selected target
  if (eff.tempDef) {
    target.tempDef = (target.tempDef || 0) + eff.tempDef;
    if (isPlayer) updateHUD();
    else updateAllyHpArea();
    msgs.push((isPlayer ? "" : (target.icon || "") + "「" + target.name + "」") + "DEF +" + eff.tempDef);
  }

  currentPlayer.inventory.splice(idx, 1);
  pendingItemIdx = -1;
  logMessage("🧪 使用「" + item.name + "」：" + msgs.join("、") + "！");
  renderInventoryButtons(false);

  // 道具視為一次行動：消耗圖示並推進到下一個行動者（同伴 → 敵人）
  _playerSideQueueCursor++;
  if (COMBAT_MODE === "press_turn") {
    animatePlayerTokenConsume(false, false);
  }
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

// ── Press Turn 圖示數量計算 ───────────────────────────────────
function calcPlayerTokenCount() {
  var n = 1;
  for (var i = 0; i < currentAllies.length; i++) {
    if (!currentAllies[i].knockedOut) n++;
  }
  return n;
}

function calcEnemyTokenCount() {
  if (bossClonePhase.active) return activeClones.length;
  if (currentEnemy && currentEnemy.isFinalBoss) return 2;
  return (typeof ENEMY_BASE_TOKENS !== "undefined") ? ENEMY_BASE_TOKENS : 1;
}

function consumePlayerToken(bonusTurn, loseTurn) {
  if (bonusTurn) { tryShowHalfTokenTutorial(); playSound("flash_token");
    if (playerFullTokens > 0) { playerFullTokens--; playerFlashTokens++; }
    else if (playerFlashTokens > 0) { playerFlashTokens--; }
  } else if (loseTurn) {
    if (playerFlashTokens > 0) { playerFlashTokens--; }
    else if (playerFullTokens > 0) { playerFullTokens--; }
    if (playerFlashTokens > 0) { playerFlashTokens--; }
    else if (playerFullTokens > 0) { playerFullTokens--; }
  } else {
    if (playerFlashTokens > 0) { playerFlashTokens--; }
    else if (playerFullTokens > 0) { playerFullTokens--; }
  }
}

function consumeEnemyToken(bonusTurn, loseTurn) {
  if (bonusTurn) { tryShowHalfTokenTutorial(); playSound("flash_token");
    if (enemyFullTokens > 0) { enemyFullTokens--; enemyFlashTokens++; }
    else if (enemyFlashTokens > 0) { enemyFlashTokens--; }
  } else if (loseTurn) {
    if (enemyFlashTokens > 0) { enemyFlashTokens--; }
    else if (enemyFullTokens > 0) { enemyFullTokens--; }
    if (enemyFlashTokens > 0) { enemyFlashTokens--; }
    else if (enemyFullTokens > 0) { enemyFullTokens--; }
  } else {
    if (enemyFlashTokens > 0) { enemyFlashTokens--; }
    else if (enemyFullTokens > 0) { enemyFullTokens--; }
  }
}

function updateTokenDisplay() {
  var ptDisplay = document.getElementById("press-turn-display");
  if (!ptDisplay) return;
  var playerEl = document.getElementById("pt-player-tokens");
  var enemyEl  = document.getElementById("pt-enemy-tokens");

  function makeTokens(full, flash, capacity) {
    var el = document.createElement("span");
    for (var i = 0; i < capacity; i++) {
      var sp = document.createElement("span");
      sp.className = "pt-token";
      if (i < full) {
        sp.classList.add("pt-token--full");
        sp.textContent = "◆";
      } else if (i < full + flash) {
        sp.classList.add("pt-token--flash");
        sp.textContent = "◈";
      } else {
        sp.classList.add("pt-token--empty");
        sp.textContent = "◇";
      }
      el.appendChild(sp);
    }
    return el;
  }

  if (playerEl) {
    playerEl.innerHTML = "玩家 ";
    playerEl.appendChild(makeTokens(playerFullTokens, playerFlashTokens, calcPlayerTokenCount()));
  }
  if (enemyEl) {
    enemyEl.innerHTML = "敵人 ";
    enemyEl.appendChild(makeTokens(enemyFullTokens, enemyFlashTokens, calcEnemyTokenCount()));
  }
}

function _animateTokenConsume(elId, isFlashFirst, consumeFn) {
  var container = document.getElementById(elId);
  if (!container) { consumeFn(); updateTokenDisplay(); return; }
  var target = isFlashFirst
    ? (container.querySelector(".pt-token--flash") || container.querySelector(".pt-token--full"))
    : (container.querySelector(".pt-token--full")  || container.querySelector(".pt-token--flash"));
  if (target) {
    target.classList.remove("pt-token--flash");
    target.classList.add("pt-token--consumed");
    setTimeout(function() { consumeFn(); updateTokenDisplay(); }, 300);
  } else {
    consumeFn(); updateTokenDisplay();
  }
}

function animatePlayerTokenConsume(bonusTurn, loseTurn) {
  _animateTokenConsume("pt-player-tokens", true, function() {
    consumePlayerToken(bonusTurn, loseTurn);
  });
}

function animateEnemyTokenConsume(bonusTurn, loseTurn) {
  bonusTurn = bonusTurn || false; loseTurn = loseTurn || false;
  var container = document.getElementById("pt-enemy-tokens");
  if (!container) { consumeEnemyToken(bonusTurn, loseTurn); updateTokenDisplay(); return; }

  if (bonusTurn) {
    var target = container.querySelector(".pt-token--full") || container.querySelector(".pt-token--flash");
    if (target) {
      target.classList.add("pt-token--convert");
      setTimeout(function() { consumeEnemyToken(true, false); updateTokenDisplay(); }, 260);
    } else {
      consumeEnemyToken(true, false); updateTokenDisplay();
    }
  } else {
    var first = container.querySelector(".pt-token--flash") || container.querySelector(".pt-token--full");
    if (first) {
      first.classList.remove("pt-token--flash");
      first.classList.add("pt-token--consumed");
      setTimeout(function() { consumeEnemyToken(false, loseTurn); updateTokenDisplay(); }, 300);
    } else {
      consumeEnemyToken(false, loseTurn); updateTokenDisplay();
    }
  }
}

function animatePlayerTokenPass(isFlashConsume) {
  var container = document.getElementById("pt-player-tokens");
  if (!container) {
    if (isFlashConsume) { playerFlashTokens--; } else { playerFullTokens--; playerFlashTokens++; }
    updateTokenDisplay(); return;
  }
  var target = isFlashConsume
    ? container.querySelector(".pt-token--flash")
    : container.querySelector(".pt-token--full");
  if (target) {
    target.classList.add(isFlashConsume ? "pt-token--consumed" : "pt-token--convert");
    setTimeout(function() {
      if (isFlashConsume) { playerFlashTokens--; } else { playerFullTokens--; playerFlashTokens++; }
      updateTokenDisplay();
    }, isFlashConsume ? 300 : 260);
  } else {
    if (isFlashConsume) { playerFlashTokens--; } else { playerFullTokens--; playerFlashTokens++; }
    updateTokenDisplay();
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
          img.src = "assets/picture/player.png"; img.alt = "玩家"; img.className = "sprite";
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
  renderMiniMap();
}

function applyCameraTransform() {
  var board = document.getElementById("game-board");
  if (!board) return;
  var viewTiles = Math.floor(VIEW_PX / (TILE_SIZE * CAM_ZOOM));
  var mapW = currentMap[0].length, mapH = currentMap.length;
  var half = (viewTiles - 1) / 2;
  var camX = Math.min(Math.max(player.x - half, 0), mapW - viewTiles);
  var camY = Math.min(Math.max(player.y - half, 0), mapH - viewTiles);
  board.style.transform =
    "scale(" + CAM_ZOOM + ") translate(" + (-camX * TILE_SIZE) + "px, " + (-camY * TILE_SIZE) + "px)";
  visionRadius = Math.ceil(half);
}

function applyTileStyle(tile, tileType) {
  var sm = {};
  sm[MAP_TILE.WALL]       = { cls: "tile--wall",     src: "",                          alt: "",       emoji: ""   };
  sm[MAP_TILE.EMPTY]      = { cls: "tile--empty",    src: "",                          alt: "",       emoji: ""   };
  sm[MAP_TILE.CHEST]      = { cls: "tile--chest",    src: "assets/picture/chest.png",  alt: "寶箱",   emoji: "📦" };
  sm[MAP_TILE.ENEMY]      = { cls: "tile--enemy",    src: "assets/picture/enemy.png",  alt: "敵人",   emoji: "👺" };
  sm[MAP_TILE.DOOR]       = { cls: "tile--door",     src: "assets/picture/door.png",   alt: "門",     emoji: "🚪" };
  sm[MAP_TILE.MINI_GAME]  = { cls: "tile--minigame", src: "",                          alt: "小遊戲", emoji: "🌀" };
  sm[MAP_TILE.SHOP]       = { cls: "tile--shop",     src: "",                          alt: "商店",   emoji: "🛒" };
  sm[MAP_TILE.FINAL_BOSS] = { cls: "tile--boss",     src: "assets/picture/boss.png",   alt: "魔王",   emoji: "👿" };
  sm[MAP_TILE.PORTAL]     = { cls: "tile--portal",   src: "",                          alt: "傳送門", emoji: "⚡" };

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
function closeAnyOverlay() {
  var minimapOverlay   = document.getElementById("minimap-overlay");
  var inventoryOverlay = document.getElementById("inventory-overlay");
  var inspectPanel     = document.getElementById("inspect-panel");
  var shopScreen       = document.getElementById("screen-shop");
  var settingsOverlay  = document.getElementById("settings-overlay");

  var partyOverlay     = document.getElementById("party-overlay");
  if (settingsOverlay  && settingsOverlay.style.display  !== "none") { closeSettings();       return true; }
  if (partyOverlay     && partyOverlay.style.display     !== "none") { closePartyOverlay();   return true; }
  if (minimapOverlay   && minimapOverlay.style.display   !== "none") { closeMiniMapOverlay(); return true; }
  if (inventoryOverlay && inventoryOverlay.style.display !== "none") { closeInventory();      return true; }
  if (inspectPanel     && inspectPanel.style.display     !== "none") { hideEnemyInfo();       return true; }
  if (shopScreen       && shopScreen.style.display       !== "none") { closeShop();           return true; }
  return false;
}

function updateControlsHint() {
  var el = document.getElementById("controls-hint");
  if (!el) return;
  el.textContent = "WASD / ↑↓←→ 移動　M 地圖　B 背包" +
                   (shopUnlocked ? "　F 商店" : "") +
                   "　ESC 設定　C 關閉";
}

document.addEventListener("keydown", function(e) {
  if (gameOver) return;

  if (e.key === "Escape") {
    e.preventDefault();
    if (!closeAnyOverlay()) { openSettings(); }
    return;
  }

  if (e.key === "c" || e.key === "C") {
    if (closeAnyOverlay()) { e.preventDefault(); return; }
  }

  var dlgScreen = document.getElementById("screen-dialogue");
  if (dlgScreen && dlgScreen.style.display !== "none") {
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      advanceDialogue();
    }
    return;
  }

  var screen = document.getElementById("screen-map");
  if (!screen || screen.style.display === "none") return;

  if (e.key === "m" || e.key === "M") { openMiniMapOverlay(); return; }
  if (e.key === "b" || e.key === "B") { openInventory();      return; }
  if ((e.key === "f" || e.key === "F") && shopUnlocked) { openShop(); return; }

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
      playSound("locked_door"); showMapMessage("門被鎖住了！你需要一把鑰匙才能通過。"); return;
    }
    updatePlayerKeys(-1);
    currentMap[newY][newX] = MAP_TILE.EMPTY;
    playSound("unlock_door"); showMapMessage("你用鑰匙打開了門！剩餘鑰匙：" + currentPlayer.keys);
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
  else if (t === MAP_TILE.PORTAL)     triggerPortal(x, y);
}

function _findPortalDestination(x, y) {
  for (var pid in portals) {
    var pair = portals[pid];
    if (pair.length === 2) {
      if (pair[0][0] === y && pair[0][1] === x) return { x: pair[1][1], y: pair[1][0] };
      if (pair[1][0] === y && pair[1][1] === x) return { x: pair[0][1], y: pair[0][0] };
    }
  }
  return null;
}

function triggerPortal(x, y) {
  var dest = _findPortalDestination(x, y);
  if (dest) {
    player.x = dest.x;
    player.y = dest.y;
    renderMap();
    playSound("teleport");
    logMessage("你踏入了傳送門，瞬間移動到另一個地點！");
  } else {
    showMapMessage("傳送門似乎尚未連接任何地點...");
  }
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

function _pickEnemy(x, y) {
  var key = y + "," + x;
  if (tileEnemyMap && tileEnemyMap[key]) {
    var name = tileEnemyMap[key];
    for (var ei = 0; ei < enemies.length; ei++) {
      if (enemies[ei].name === name) return enemies[ei];
    }
    console.warn("tileEnemyMap 指定的怪物「" + name + "」在 enemies 中找不到，改用隨機。");
  }
  var zoneLetter;
  if (x > mazeDivX2) {
    zoneLetter = "C";
  } else if (x > mazeDivX1) {
    zoneLetter = "B";
  } else {
    zoneLetter = "A";
  }
  var tier = enemies.filter(function(e) { return e.tier === zoneLetter; });
  if (zoneEnemies[zoneLetter] && zoneEnemies[zoneLetter].length > 0) {
    var _allowed = zoneEnemies[zoneLetter];
    var _filtered = [];
    for (var _fi = 0; _fi < tier.length; _fi++) {
      if (_allowed.indexOf(tier[_fi].name) !== -1) _filtered.push(tier[_fi]);
    }
    if (_filtered.length > 0) tier = _filtered;
  }
  var _seed = (typeof MAP_SEED !== "undefined") ? MAP_SEED : 0;
  var posRng = makeRng(_seed * 10000 + y * 1000 + x);
  return tier[Math.floor(posRng() * tier.length)];
}

function triggerEnemy(x, y) {
  var ed = _pickEnemy(x, y);
  if (!ed) {
    currentMap[y][x] = MAP_TILE.EMPTY;
    renderMap();
    return;
  }
  activeClones = []; savedBoss = null; pairedFightEnemy = null;
  bossClonePhase = { active: false, boss: null, clones: [] }; enemyCloneTurnCursor = 0;
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
  activeClones = []; savedBoss = null; pairedFightEnemy = null;
  bossClonePhase = { active: false, boss: null, clones: [] }; enemyCloneTurnCursor = 0;
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
  updateControlsHint();
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
  renderShopSidebar();
  showScreen("screen-shop");
}

function renderShopSidebar() {
  var area = document.getElementById("shop-party-list");
  if (!area) return;
  area.innerHTML = "";

  function makeCard(icon, name, hp, maxHp, atk, def, isKO) {
    var pct = maxHp > 0 ? Math.max(0, hp / maxHp * 100) : 0;
    var barColor = isKO ? "#b71c1c" : (pct < 30 ? "#ef5350" : "#4caf50");
    var card = document.createElement("div");
    card.className = "shop-party-card" + (isKO ? " shop-party-ko" : "");
    card.innerHTML =
      '<div class="shop-party-name">' + icon + " " + name + (isKO ? " 💀" : "") + '</div>' +
      '<div class="shop-party-bar-wrap"><div class="shop-party-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>' +
      '<div class="shop-party-stats">❤️ ' + hp + '/' + maxHp + '</div>' +
      '<div class="shop-party-stats">⚔️ ' + atk + '　🛡️ ' + def + '</div>';
    area.appendChild(card);
  }

  makeCard("🧙", currentPlayer.name,
    currentPlayer.hp, currentPlayer.maxHp,
    currentPlayer.atk + (currentPlayer.tempAtk || 0),
    currentPlayer.def + (currentPlayer.tempDef || 0), false);

  for (var i = 0; i < currentAllies.length; i++) {
    var a = currentAllies[i];
    makeCard(a.icon, a.name, a.hp, a.maxHp, a.atk, a.def, a.knockedOut);
  }

  var invArea = document.getElementById("shop-inventory-list");
  if (!invArea) return;
  invArea.innerHTML = "";

  var inv = currentPlayer.inventory;
  if (!inv || inv.length === 0) {
    var empty = document.createElement("div");
    empty.className = "shop-inv-empty";
    empty.textContent = "（背包是空的）";
    invArea.appendChild(empty);
    return;
  }

  var counts = {};
  var order  = [];
  for (var j = 0; j < inv.length; j++) {
    var n = inv[j].name;
    if (!counts[n]) { counts[n] = { item: inv[j], qty: 0 }; order.push(n); }
    counts[n].qty++;
  }
  for (var k = 0; k < order.length; k++) {
    var entry = counts[order[k]];
    var row = document.createElement("div");
    row.className = "shop-inv-row";
    row.innerHTML =
      '<span class="shop-inv-name">' + entry.item.name + '</span>' +
      '<span class="shop-inv-qty">×' + entry.qty + '</span>';
    invArea.appendChild(row);
  }
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
  var capped = isStatCapped(item);
  var scaledPrice = getScaledPrice(item);
  var pr = document.createElement("div"); pr.className = "shop-card-price";
  pr.textContent = capped ? "🚫 已達上限" : ("💰 " + scaledPrice + (shopPurchaseCounts[item.name] ? " (×" + (shopPurchaseCounts[item.name] + 1) + ")" : ""));
  var btn = document.createElement("button"); btn.className = "btn btn-shop"; btn.textContent = "購買";
  btn.disabled = capped;
  btn.onclick = function() { buyShopItem(item); openShop(); };
  right.appendChild(pr); right.appendChild(btn);

  card.appendChild(left); card.appendChild(right);
  container.appendChild(card);
}

function renderSkillCard(skill, container) {
  var card = document.createElement("div"); card.className = "shop-card shop-card--skill";
  var left = document.createElement("div"); left.className = "shop-card-left";
  var nm = document.createElement("div"); nm.className = "shop-card-name"; nm.textContent = skill.icon + " " + skill.name;
  var ds = document.createElement("div"); ds.className = "shop-card-desc"; ds.textContent = computeSkillDesc(skill, currentPlayer.atk);
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
  var ds = document.createElement("div"); ds.className = "shop-card-desc"; ds.textContent = computeSkillDesc(skill, currentPlayer.atk);
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

function isStatCapped(item) {
  if (item.effect.atk   && currentPlayer.atk   >= STAT_CAP.atk) return true;
  if (item.effect.def   && currentPlayer.def   >= STAT_CAP.def) return true;
  if (item.effect.maxHp && currentPlayer.maxHp >= STAT_CAP.hp)  return true;
  return false;
}

function getScaledPrice(item) {
  var n = shopPurchaseCounts[item.name] || 0;
  return Math.round(item.price * Math.pow(1.15, n));
}

function buyShopItem(item) {
  if (isStatCapped(item)) {
    showShopMessage("❌ 已達上限，無法繼續升級！"); return;
  }
  var price = getScaledPrice(item);
  if (currentPlayer.money < price) {
    showShopMessage("金幣不足！需要 " + price + " 金幣。"); return;
  }
  updatePlayerMoney(-price);
  shopPurchaseCounts[item.name] = (shopPurchaseCounts[item.name] || 0) + 1;
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
    if (item.effect.allAllyAtk) {
      if (currentAllies.length === 0) { showShopMessage("目前沒有同伴！"); return; }
      for (var ai = 0; ai < currentAllies.length; ai++) currentAllies[ai].atk += item.effect.allAllyAtk;
      showShopMessage("💪 所有同伴 ATK +" + item.effect.allAllyAtk + "！");
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
    playSound("buy");
    showShopMessage("購買了「" + item.name + "」！");
  } else {
    currentPlayer.inventory.push({ name: item.name, effect: item.effect, desc: item.desc, targetSide: item.targetSide, targetType: item.targetType });
    updateHUD();
    playSound("buy");
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
  playSound("buy");
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
  knightTauntActive    = false;
  currentPlayer.tempAtk = 0;
  currentPlayer.tempDef = 0;

  for (var ai = 0; ai < currentAllies.length; ai++) {
    currentAllies[ai].skillCooldown = 0;
    if (currentAllies[ai].hp <= 0) currentAllies[ai].knockedOut = true;
  }

  hideAllyPanel();

  var log = document.getElementById("combat-log");
  if (log) log.innerHTML = "";

  var isPaired = activeClones.length > 0 && !currentEnemy.isFinalBoss;

  renderEnemyUnits();
  renderPartyUnits();

  var ptDisplay = document.getElementById("press-turn-display");
  if (ptDisplay) {
    if (COMBAT_MODE === "press_turn") {
      playerFullTokens  = calcPlayerTokenCount(); playerFlashTokens = 0;
      enemyFullTokens   = calcEnemyTokenCount();  enemyFlashTokens  = 0;
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

  updateCombatHint();
  playSound("encounter");
  showScreen("screen-combat");
  _playerSideQueueCursor = 0;
  if (COMBAT_MODE === "press_turn") {
    playerFullTokens  = calcPlayerTokenCount(); playerFlashTokens = 0;
    enemyFullTokens   = calcEnemyTokenCount();  enemyFlashTokens  = 0;
    updateTokenDisplay();
  }
  processAllyTurns(runEnemyPhase);
  tryShowCombatIntroTutorial();
}

function dealDmgToEnemy(target, dmg) {
  if (target.isMiniBarrier) {
    target.hp = Math.max(0, target.hp - 1);
  } else {
    target.hp = Math.max(0, target.hp - dmg);
  }
  if (dmg > 0) shakeEnemy(target);
}

function renderEnemyUnits() {
  var area = document.getElementById("combat-enemies-area");
  if (!area) return;

  var units = activeClones.length > 0 ? activeClones : (currentEnemy ? [currentEnemy] : []);
  var count = units.length;
  var size = count === 1 ? 120 : count === 2 ? 100 : count <= 4 ? 82 : 65;

  area.innerHTML = "";

  for (var i = 0; i < units.length; i++) {
    (function(unit, idx) {
      var div = document.createElement("div");
      div.className = "enemy-unit";
      div.setAttribute("data-unit-idx", idx);

      var imgWrap = document.createElement("div");
      imgWrap.className = "enemy-unit-sprite";
      imgWrap.style.width  = size + "px";
      imgWrap.style.height = size + "px";

      var img = document.createElement("img");
      var isBoss = unit.isFinalBoss || (savedBoss !== null && activeClones.indexOf(unit) !== -1);
      img.src = isBoss ? "assets/picture/boss.png" : "assets/picture/enemy.png";
      img.className = "battle-sprite enemy-sprite-img";
      img.onerror   = function() { this.style.display = "none"; };
      imgWrap.appendChild(img);
      div.appendChild(imgWrap);

      var hpDiv = document.createElement("div");
      hpDiv.className = "enemy-unit-hpbar";
      hpDiv.style.width = size + "px";

      var barWrap = document.createElement("div");
      barWrap.className = "enemy-unit-bar-wrap";
      var fill = document.createElement("div");
      fill.className = "enemy-unit-bar-fill";
      fill.setAttribute("data-hp-idx", idx);
      fill.style.width = (unit.hp / unit.maxHp * 100) + "%";
      barWrap.appendChild(fill);

      var num = document.createElement("div");
      num.className = "enemy-unit-hp-num";
      num.setAttribute("data-hp-idx", idx);
      num.textContent = unit.hp + " / " + unit.maxHp;

      hpDiv.appendChild(barWrap);
      hpDiv.appendChild(num);
      div.appendChild(hpDiv);

      area.appendChild(div);
    })(units[i], i);
  }

  var nameEl = document.getElementById("enemy-name");
  if (nameEl) {
    if (activeClones.length > 0) {
      nameEl.textContent = (savedBoss ? "魔王分身" : (currentEnemy ? currentEnemy.name : "")) + " ×" + activeClones.length;
    } else if (currentEnemy) {
      nameEl.textContent = currentEnemy.name;
    }
  }

  updateCombatHint();
  updateBossStatusCard();
}

function renderPartyUnits() {
  var area = document.getElementById("combat-party-area");
  if (!area) return;
  area.innerHTML = "";

  function makeUnit(partyIdx, type, imgSrc, fallbackText, name, knockedOut) {
    var div = document.createElement("div");
    div.className = "party-unit" + (knockedOut ? " party-unit--knocked-out" : "");
    div.setAttribute("data-party-idx", partyIdx);
    div.setAttribute("data-party-type", type);

    var spriteDiv = document.createElement("div");
    spriteDiv.className = "party-unit-sprite";

    var img = document.createElement("img");
    img.src = imgSrc;
    img.className = "battle-sprite party-sprite-img";
    var fallback = document.createElement("span");
    fallback.className = "battle-fallback-emoji";
    fallback.style.display = "none";
    fallback.textContent = fallbackText;
    img.onerror = function() { this.style.display = "none"; fallback.style.display = "block"; };
    spriteDiv.appendChild(img);
    spriteDiv.appendChild(fallback);
    div.appendChild(spriteDiv);

    var nameDiv = document.createElement("div");
    nameDiv.className = "party-unit-name";
    nameDiv.textContent = name;
    div.appendChild(nameDiv);

    return div;
  }

  area.appendChild(makeUnit(0, "player", "assets/picture/player.png", "🧙",
                             currentPlayer.name, false));

  for (var i = 0; i < currentAllies.length; i++) {
    var ally = currentAllies[i];
    area.appendChild(makeUnit(i + 1, "ally", "assets/picture/player.png",
                              ally.icon || "🧑", ally.name, ally.knockedOut));
  }
}

function renderAllyUnits() { renderPartyUnits(); }

function updateCombatEnemyHp() {
  var units = activeClones.length > 0 ? activeClones : (currentEnemy ? [currentEnemy] : []);

  for (var i = 0; i < units.length; i++) {
    var unit = units[i];
    var fill = document.querySelector("[data-hp-idx='" + i + "'].enemy-unit-bar-fill");
    var num  = document.querySelector("[data-hp-idx='" + i + "'].enemy-unit-hp-num");
    if (fill) fill.style.width = (unit.hp / unit.maxHp * 100) + "%";
    if (num)  num.textContent  = unit.hp + " / " + unit.maxHp;
  }

  updateCombatHint();
  updateBossStatusCard();
}

function animateEnemyDeath(enemyObj, callback) {
  var units = activeClones.length > 0 ? activeClones : (currentEnemy ? [currentEnemy] : []);
  var idx   = units.indexOf(enemyObj);
  var area  = document.getElementById("combat-enemies-area");

  if (!area || idx === -1) { if (callback) setTimeout(callback, 0); return; }

  var divs = area.querySelectorAll(".enemy-unit");
  var div  = divs[idx] || null;

  if (div) {
    var fill = div.querySelector(".enemy-unit-bar-fill");
    var num  = div.querySelector(".enemy-unit-hp-num");
    if (fill) fill.style.width = "0%";
    if (num)  num.textContent  = "0 / " + (enemyObj.maxHp || "?");
    setTimeout(function() {
      div.classList.add("dying");
      setTimeout(function() { if (callback) callback(); }, 580);
    }, 80);
  } else {
    if (callback) setTimeout(callback, 0);
  }
}

function updateBossStatusCard() {
  var card = document.getElementById("combat-boss-status-card");
  if (!card) return;
  if (savedBoss) {
    card.style.display = "block";
    var nameEl = document.getElementById("boss-status-name");
    var fillEl = document.getElementById("boss-status-hp-fill");
    var numEl  = document.getElementById("boss-status-hp-num");
    if (nameEl) nameEl.textContent = savedBoss.name + "（等待中）";
    if (fillEl) fillEl.style.width = (savedBoss.hp / savedBoss.maxHp * 100) + "%";
    if (numEl)  numEl.textContent  = savedBoss.hp + " / " + savedBoss.maxHp;
  } else {
    card.style.display = "none";
  }
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
function onAttack() {
  if (activeClones.length > 1) {
    var etargets = [];
    activeClones.forEach(function(c, i) {
      etargets.push({ id: "clone_" + i, label: "👺 " + c.name + " HP:" + c.hp + "/" + c.maxHp });
    });
    showTargetSelect("attack", etargets);
    return;
  }
  executeCombatRound("attack");
}
function onDefend() { executeCombatRound("defend"); }
function onFlee()   { executeCombatRound("flee");   }
function onPass()   { executeCombatRound("pass");   }

function executeCombatRound(action) {
  _playerSideQueueCursor++;
  setCombatButtonsEnabled(false);
  var tsp = document.getElementById("target-select-panel");
  if (tsp) tsp.style.display = "none";
  hideEnemyInfo();

  // 玩家再次行動（非防禦/待機）→ 清除防禦狀態
  if (action !== "pass" && action !== "defend") {
    isPlayerDefending = false;
  }

  if (action === "pass" && COMBAT_MODE === "press_turn") {
    if (playerFullTokens <= 0 && playerFlashTokens <= 0) {
      _playerSideQueueCursor--;
      setCombatButtonsEnabled(true);
      return;
    }
    if (playerFullTokens > 0) {
      logMessage("⏸️ 「" + currentPlayer.name + "」待機（◆→◈）");
      animatePlayerTokenPass(false);
    } else {
      logMessage("⏸️ 「" + currentPlayer.name + "」待機（◈ 消耗）");
      animatePlayerTokenPass(true);
    }
    setTimeout(function() { processAllyTurns(runEnemyPhase); }, 400);
    return;
  }

  var result = playerTurn(action, currentPlayer, currentEnemy);

  // ── 未命中（閃避）處理 ──
  if (result.miss) {
    playSound("dodge");
    logMessage(result.message || "攻擊未命中！");
    tryShowMissTutorial();
    if (result.selfDamage > 0) updatePlayerHp(-result.selfDamage);
    if (result.skillUsed) {
      var sd0 = getSkillDef(result.skillUsed);
      if (sd0 && sd0.cooldown) playerSkillCooldowns[result.skillUsed] = sd0.cooldown;
    }
    if (result.playerDefense) isPlayerDefending = true;
    if (COMBAT_MODE === "press_turn") {
      if (!result.playerDefense) logMessage("⚠ 未命中！額外失去一個圖示！");
      animatePlayerTokenConsume(false, !result.playerDefense);
    }
    setTimeout(function() { processAllyTurns(runEnemyPhase); }, 600);
    return;
  }

  blackKnightExposed = false;
  if (result.healedAlly) updateAllyHpArea();

  if (result.playerFlee) {
    logMessage("✅ 逃跑成功！");
    playSound("flee");
    setCombatButtonsEnabled(false);
    setTimeout(function() { fadeToMap(function() { endCombat(false); }); }, 1000);
    return;
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

  if (result.isAoe && activeClones.length > 0) {
    var toKill = [];
    for (var i = 0; i < activeClones.length; i++) {
      dealDmgToEnemy(activeClones[i], result.enemyDamage);
      if (activeClones[i].hp <= 0) toKill.push(activeClones[i]);
    }
    if (result.enemyDamage > 0) showDamagePopup(currentPlayer.name, result.enemyDamage, false);
    logMessage(result.message);
    updateCombatEnemyHp();
    if (toKill.length > 0) {
      logMessage("💀 消滅了 " + toKill.length + " 個分身！");
      var area = document.getElementById("combat-enemies-area");
      for (var k = 0; k < toKill.length; k++) {
        (function(dead) {
          var idx = activeClones.indexOf(dead);
          if (area && idx !== -1) {
            var divs = area.querySelectorAll(".enemy-unit");
            if (divs[idx]) { divs[idx].classList.add("dying"); }
          }
        })(toKill[k]);
      }
    }
    setTimeout(function() {
      var dead = [];
      for (var i = activeClones.length - 1; i >= 0; i--) {
        if (activeClones[i].hp <= 0) dead.push(activeClones[i]);
      }
      if (dead.length > 0) {
        // Use unified handler for each dead clone (last one triggers phase end if needed)
        for (var di = 0; di < dead.length; di++) {
          if (bossClonePhase.active || savedBoss) {
            removeCloneAndCheckPhaseEnd(dead[di]);
          } else if (pairedFightEnemy) {
            var pidx = activeClones.indexOf(dead[di]);
            if (pidx !== -1) activeClones.splice(pidx, 1);
            if (activeClones.length === 0) { endPairedFight(); return; }
          } else {
            var aidx = activeClones.indexOf(dead[di]);
            if (aidx !== -1) activeClones.splice(aidx, 1);
          }
        }
        if (activeClones.length > 0) {
          currentEnemy = activeClones[0];
          logMessage("剩餘 " + activeClones.length + " 個。");
          renderEnemyUnits();
          processAllyTurns(runEnemyPhase);
        }
      } else {
        processAllyTurns(runEnemyPhase);
      }
    }, 620);
    return;
  }

  if (result.enemyDamage > 0) {
    dealDmgToEnemy(currentEnemy, result.enemyDamage);
    showDamagePopup(currentPlayer.name, result.enemyDamage, false);
  }
  logMessage(result.message || "");
  updateCombatEnemyHp();

  if ((bossClonePhase.active || activeClones.length > 0) && currentEnemy.hp <= 0) {
    var deadClone = currentEnemy;
    logMessage("💀 分身被消滅！");

    // Consume player token now (before death animation)
    if (COMBAT_MODE === "press_turn") {
      if      (result.bonusTurn) logMessage("★ 圖示轉為閃爍，獲得額外行動！");
      else if (result.loseTurn)  logMessage("⚠ 攻擊被閃開！額外失去一個圖示！");
      animatePlayerTokenConsume(result.bonusTurn, result.loseTurn);
    }

    animateEnemyDeath(deadClone, function() {
      if (bossClonePhase.active || savedBoss) {
        removeCloneAndCheckPhaseEnd(deadClone);
        // If clones remain, endBossClonePhase was NOT called → continue the turn flow
        if (activeClones.length > 0) {
          setTimeout(function() { processAllyTurns(runEnemyPhase); }, 400);
        }
        // If activeClones.length === 0, endBossClonePhase handled it (buttons re-enabled)
      } else if (pairedFightEnemy) {
        var pidx = activeClones.indexOf(deadClone);
        if (pidx !== -1) activeClones.splice(pidx, 1);
        if (activeClones.length === 0) { endPairedFight(); }
        else { setTimeout(function() { processAllyTurns(runEnemyPhase); }, 400); }
      } else {
        setTimeout(function() { processAllyTurns(runEnemyPhase); }, 400);
      }
    });
    return;
  }

  if (currentEnemy.hp <= 0) {
    logMessage("✨ 「" + currentEnemy.name + "」被打倒了！");
    playSound("victory");
    animateEnemyDeath(currentEnemy, function() { giveEnemyReward(); });
    return;
  }

  if (COMBAT_MODE === "press_turn") {
    if      (result.bonusTurn) logMessage("★ 圖示轉為閃爍，獲得額外行動！");
    else if (result.loseTurn)  logMessage("⚠ 攻擊被閃開！額外失去一個圖示！");
    animatePlayerTokenConsume(result.bonusTurn, result.loseTurn);
    setTimeout(function() { processAllyTurns(runEnemyPhase); }, 600);
    return;
  }

  setTimeout(function() { processAllyTurns(runEnemyPhase); }, 600);
}

function runEnemyPhase() {
  hideAllActionZones();
  // If clone phase already ended (e.g. ally killed last clone in executeAllyAction),
  // player turn was already started — do not proceed.
  if (!bossClonePhase.active && activeClones.length === 0 && currentEnemy === null && !pairedFightEnemy) return;
  if (currentEnemy && currentEnemy.hp <= 0) {
    updateCombatEnemyHp();
    if (activeClones.length === 0 && !savedBoss && !pairedFightEnemy && !bossClonePhase.active) {
      logMessage("✨ 同伴將「" + currentEnemy.name + "」擊倒了！");
      playSound("victory");
      animateEnemyDeath(currentEnemy, function() { giveEnemyReward(); });
      return;
    }
    if (activeClones.length === 0 && pairedFightEnemy) { endPairedFight(); return; }
    if (activeClones.length > 0 || bossClonePhase.active) {
      var deadInPhase = currentEnemy;
      animateEnemyDeath(deadInPhase, function() {
        removeCloneAndCheckPhaseEnd(deadInPhase);
      });
      return;
    }
  }
  if (bossClonePhase.active) {
    enemyCloneTurnCursor = 0;
    if (COMBAT_MODE === "press_turn") {
      enemyFullTokens  = calcEnemyTokenCount(); enemyFlashTokens = 0;
      updateTokenDisplay();
    }
  } else if (COMBAT_MODE === "press_turn") {
    enemyFullTokens  = calcEnemyTokenCount(); enemyFlashTokens = 0;
    updateTokenDisplay();
  }
  runNextEnemyTurn();
}

function startCloneFight(boss, clones) {
  bossClonePhase.active = true;
  bossClonePhase.boss   = boss || savedBoss;
  bossClonePhase.clones = clones.slice();
  enemyCloneTurnCursor  = 0;

  if (boss) {
    savedBoss = boss;
    boss.untargetable = true;
    boss.canAct = false;
  }

  activeClones = clones.slice();
  currentEnemy = activeClones[0];
  renderEnemyUnits();
  isPlayerDefending = false;
  logMessage("💡 分身登場！使用「連斬」可一次消滅所有分身！");
  _playerSideQueueCursor = 0;
  if (COMBAT_MODE === "press_turn") {
    playerFullTokens  = calcPlayerTokenCount(); playerFlashTokens = 0;
    enemyFullTokens   = calcEnemyTokenCount();  enemyFlashTokens  = 0;
    updateTokenDisplay();
  }
  processAllyTurns(runEnemyPhase);
}

function removeCloneAndCheckPhaseEnd(clone) {
  var idx = activeClones.indexOf(clone);
  if (idx === -1) return;
  activeClones.splice(idx, 1);

  if (activeClones.length > 0) {
    currentEnemy = activeClones[0];
    renderEnemyUnits();
    updateCombatEnemyHp();
    return;
  }

  endBossClonePhase();
}

function endBossClonePhase() {
  clonePhaseEndedThisAction = true;
  enemyFullTokens  = 0;
  enemyFlashTokens = 0;

  bossClonePhase.active = false;

  var boss = bossClonePhase.boss;
  if (boss) {
    boss.untargetable = false;
    boss.canAct = true;
  }

  activeClones  = [];
  savedBoss     = null;
  currentEnemy  = boss || currentEnemy;
  bossClonePhase.boss   = null;
  bossClonePhase.clones = [];

  if (COMBAT_MODE === "press_turn") updateTokenDisplay();
  renderEnemyUnits();
  logMessage("✅ 分身全數消滅！");

  isPlayerDefending = false;
  _playerSideQueueCursor = 0;
  decrementSkillCooldowns();
  if (COMBAT_MODE === "press_turn") {
    playerFullTokens  = calcPlayerTokenCount(); playerFlashTokens = 0;
    enemyFullTokens   = 0; enemyFlashTokens = 0;
    updateTokenDisplay();
  }
  setCombatButtonsEnabled(true);
}

function resumeBossFight() {
  // Legacy alias — redirects to endBossClonePhase
  endBossClonePhase();
}

function endPairedFight() {
  var info = pairedFightEnemy;
  pairedFightEnemy = null;
  currentEnemy = { x: info.x, y: info.y, reward: info.reward, maxHp: info.maxHp, name: info.name };
  logMessage("✨ 兩隻「" + info.name + "」都被打倒了！");
  playSound("victory");
  giveEnemyReward();
}

function processAllyTurns(callback) {
  var totalTokens = (COMBAT_MODE === "press_turn") ? (playerFullTokens + playerFlashTokens) : 1;

  if (totalTokens <= 0 || !currentEnemy || currentEnemy.hp <= 0) {
    _playerSideQueueCursor = 0;
    hideAllyPanel();
    callback();
    return;
  }

  var queue = [{ id: "player", name: currentPlayer.name, icon: "🧙", type: "player" }];
  var liveAllies = currentAllies.filter(function(a) { return !a.knockedOut; });
  liveAllies.forEach(function(ally, idx) {
    queue.push({ id: "ally_" + idx, name: ally.name, icon: ally.icon, type: "ally", obj: ally });
  });

  if (queue.length === 0) { callback(); return; }

  var activeChar = queue[_playerSideQueueCursor % queue.length];

  if (activeChar.type === "player") {
    hideAllyPanel();
    if (COMBAT_MODE === "press_turn" && playerFullTokens + playerFlashTokens <= 0) {
      _playerSideQueueCursor = 0;
      callback();
      return;
    }
    markActivePartyCard("player");
    setCombatButtonsEnabled(true);
    return;
  }

  renderStrictQueueAllyPanel(activeChar, queue.length, callback);
}

function renderStrictQueueAllyPanel(char, queueLength, callback) {
  var pZone = document.getElementById("player-action-zone");
  if (pZone) pZone.style.display = "none";

  var panel = document.getElementById("ally-action-zone");
  if (!panel) {
    _playerSideQueueCursor++;
    processAllyTurns(callback);
    return;
  }

  var title = document.getElementById("ally-action-title");
  if (title) title.textContent = char.icon + " 「" + char.name + "」的行動回合";

  var btns = document.getElementById("ally-action-buttons");
  if (!btns) return;
  btns.innerHTML = "";

  var ally = char.obj;

  // ── 第一列：攻擊 / 防禦 / 待機 ──
  var row1 = document.createElement("div");
  row1.className = "ally-btn-row";

  var btnAtk = document.createElement("button");
  btnAtk.className = "btn btn-attack";
  btnAtk.textContent = "⚔️ 攻擊";
  btnAtk.onclick = function() {
    var _di = allyDefendList.indexOf(ally); if (_di !== -1) allyDefendList.splice(_di, 1);
    clonePhaseEndedThisAction = false;
    var _ar = executeAllyAction(ally, "attack");
    if (clonePhaseEndedThisAction) { clonePhaseEndedThisAction = false; return; }
    _playerSideQueueCursor++;
    handleStrictQueueToken(false, callback, _ar.bonusTurn);
  };
  row1.appendChild(btnAtk);

  var btnDef = document.createElement("button");
  btnDef.className = "btn btn-defend";
  btnDef.textContent = "🛡️ 防禦";
  btnDef.onclick = function() {
    if (allyDefendList.indexOf(ally) === -1) allyDefendList.push(ally);
    logMessage("🛡️ " + char.icon + "「" + char.name + "」擺出防禦姿態！下次受到的傷害減半。");
    _playerSideQueueCursor++;
    if (COMBAT_MODE === "press_turn") animatePlayerTokenConsume(false, false);
    setTimeout(function() { processAllyTurns(callback); }, 320);
  };
  row1.appendChild(btnDef);

  var btnSkip = document.createElement("button");
  btnSkip.className = "btn btn-pass";
  btnSkip.textContent = "⏸️ 待機";
  btnSkip.onclick = function() {
    var _di = allyDefendList.indexOf(ally); if (_di !== -1) allyDefendList.splice(_di, 1);
    if (COMBAT_MODE === "press_turn") {
      if (playerFullTokens > 0) {
        playerFullTokens--;
        playerFlashTokens++;
        logMessage("⏸️ " + char.icon + "「" + char.name + "」待機（◆→◈）");
      } else {
        playerFlashTokens = Math.max(0, playerFlashTokens - 1);
        logMessage("⏸️ " + char.icon + "「" + char.name + "」待機（◈ 消耗）");
      }
      updateTokenDisplay();
    }
    _playerSideQueueCursor++;
    handleStrictQueueToken(true, callback);
  };
  row1.appendChild(btnSkip);
  btns.appendChild(row1);

  // ── 第二列：技能 ──
  if (ally.skill) {
    var row2 = document.createElement("div");
    row2.className = "ally-btn-row";
    var btnSk = document.createElement("button");
    btnSk.className = "btn btn-skill";
    btnSk.title = computeAllySkillDesc(ally.skill, ally.atk);
    if (ally.skillCooldown > 0) {
      btnSk.textContent = ally.skill.icon + " " + ally.skill.name + " (" + ally.skillCooldown + ")";
      btnSk.disabled = true;
      btnSk.classList.add("btn-skill--cd");
    } else {
      btnSk.textContent = ally.skill.icon + " " + ally.skill.name;
      btnSk.onclick = function() {
        var _di = allyDefendList.indexOf(ally); if (_di !== -1) allyDefendList.splice(_di, 1);
        clonePhaseEndedThisAction = false;
        var _sr = executeAllyAction(ally, "skill");
        if (clonePhaseEndedThisAction) { clonePhaseEndedThisAction = false; return; }
        _playerSideQueueCursor++;
        handleStrictQueueToken(false, callback, _sr.bonusTurn);
      };
    }
    row2.appendChild(btnSk);
    btns.appendChild(row2);
  }

  markActivePartyCard("ally", ally);
  panel.style.display = "flex";
}

function handleStrictQueueToken(isPass, callback, bonusTurn) {
  if (COMBAT_MODE === "press_turn") {
    if (!isPass) {
      animatePlayerTokenConsume(bonusTurn || false, false);
      setTimeout(function() { processAllyTurns(callback); }, 320);
    } else {
      processAllyTurns(callback);
    }
  } else {
    hideAllyPanel();
    callback();
  }
}

function markActivePartyCard(type, allyObj) {
  var cards = document.querySelectorAll(".party-hp-card");
  cards.forEach(function(c) {
    c.classList.remove("party-hp-card--active-player", "party-hp-card--active-ally");
  });
  document.querySelectorAll("#combat-party-area .party-unit").forEach(function(u) {
    u.classList.remove("active-turn");
  });
  var area = document.getElementById("party-action-area");
  if (area) area.classList.remove("active--player", "active--ally");

  if (!type) return;

  if (type === "player") {
    if (cards.length > 0) cards[0].classList.add("party-hp-card--active-player");
    var pu = document.querySelector("#combat-party-area .party-unit[data-party-idx='0']");
    if (pu) pu.classList.add("active-turn");
    if (area) area.classList.add("active--player");
  } else if (type === "ally" && allyObj) {
    var liveAllies = currentAllies.filter(function(a) { return !a.knockedOut; });
    var cardIdx = liveAllies.indexOf(allyObj);
    if (cardIdx >= 0 && cards.length > cardIdx + 1)
      cards[cardIdx + 1].classList.add("party-hp-card--active-ally");
    var allyIdx = currentAllies.indexOf(allyObj);
    if (allyIdx >= 0) {
      var pu2 = document.querySelector("#combat-party-area .party-unit[data-party-idx='" + (allyIdx + 1) + "']");
      if (pu2) pu2.classList.add("active-turn");
    }
    if (area) area.classList.add("active--ally");
  }
}

function hideAllActionZones() {
  var pZone = document.getElementById("player-action-zone");
  var aZone = document.getElementById("ally-action-zone");
  if (pZone) pZone.style.display = "none";
  if (aZone) aZone.style.display = "none";
  markActivePartyCard(null);
}

function hideAllyPanel() {
  var zone = document.getElementById("ally-action-zone");
  if (zone) zone.style.display = "none";
}

function executeAllyAction(ally, action) {
  var allyResult = { bonusTurn: false, loseTurn: false };
  if (action === "skip") {
    logMessage(ally.icon + " 「" + ally.name + "」待機。"); return allyResult;
  }

  if (action === "attack") {
    var target = currentEnemy;
    if (!target || target.hp <= 0) {
      logMessage(ally.icon + " 「" + ally.name + "」沒有目標。"); return allyResult;
    }
    if (!rollHit(ally, target, BASE_ATTACK_HIT)) {
      playSound("dodge");
      logMessage(ally.icon + " 「" + ally.name + "」的攻擊未命中！「" + target.name + "」閃開了！");
      return allyResult;
    }
    playSound("attack");
    var allyEffAtk = getEffectiveAtk(ally);
    var dmg = Math.max(1, allyEffAtk - getEffectiveDef(target));
    var critMsg = "";
    if (Math.random() < calcSkillCritRate(ally, target)) {
      dmg *= 2; critMsg = " 💥爆擊！"; allyResult.bonusTurn = true;
    }
    dealDmgToEnemy(target, dmg);
    showDamagePopup(ally.icon + ally.name, dmg, false);
    logMessage(ally.icon + " 「" + ally.name + "」攻擊「" + target.name + "」，造成 " + dmg + " 點傷害！" + critMsg + (target.isMiniBarrier ? " 🛡️（格擋中）" : ""));
    if (target.hp <= 0 && activeClones.length > 0) {
      var ki = activeClones.indexOf(target);
      if (ki !== -1) {
        var _darea = document.getElementById("combat-enemies-area");
        if (_darea) {
          var _ddivs = _darea.querySelectorAll(".enemy-unit");
          if (_ddivs[ki]) {
            var _df = _ddivs[ki].querySelector(".enemy-unit-bar-fill");
            var _dn = _ddivs[ki].querySelector(".enemy-unit-hp-num");
            if (_df) _df.style.width = "0%";
            if (_dn) _dn.textContent  = "0 / " + target.maxHp;
            (function(el) { setTimeout(function() { el.classList.add("dying"); }, 80); })(_ddivs[ki]);
          }
        }
        removeCloneAndCheckPhaseEnd(target);
        logMessage("💀 分身被消滅！" + (activeClones.length > 0 ? "剩餘 " + activeClones.length + " 個。" : ""));
        if (activeClones.length > 0) {
          var en = document.getElementById("enemy-name");
          if (en) en.textContent = (bossClonePhase.active || savedBoss)
            ? ("魔王分身 ×" + activeClones.length)
            : (currentEnemy.name + " ×" + activeClones.length);
        }
      }
    }
    updateCombatEnemyHp();
    return allyResult;
  }

  if (action === "skill") {
    var skill = ally.skill;
    if (!skill || ally.skillCooldown > 0) {
      logMessage(ally.icon + " 「" + ally.name + "」技能冷卻中！"); return allyResult;
    }
    ally.skillCooldown = skill.cooldown;

    if (skill.isAoe) {
      var aoeTargets = activeClones.length > 0 ? activeClones.slice() : [currentEnemy];
      var killed = 0;
      var deadClones = [];
      for (var ti = 0; ti < aoeTargets.length; ti++) {
        var t = aoeTargets[ti];
        if (!rollHit(ally, t, skill.baseHit || 80)) {
          playSound("dodge");
          logMessage(ally.icon + " 「" + ally.name + "」技能未命中「" + t.name + "」！");
          continue;
        }
        var d = Math.max(1, Math.floor((ally.atk + (ally.tempAtk || 0)) * (skill.multiplier || 1)) - getEffectiveDef(t));
        dealDmgToEnemy(t, d);
        if (t.hp <= 0) {
          killed++;
          deadClones.push(t);
          // Animate death
          var _aoeArea = document.getElementById("combat-enemies-area");
          if (_aoeArea) {
            var _aoeDivs = _aoeArea.querySelectorAll(".enemy-unit");
            var _ai2 = activeClones.indexOf(t);
            if (_ai2 !== -1 && _aoeDivs[_ai2]) {
              var _af = _aoeDivs[_ai2].querySelector(".enemy-unit-bar-fill");
              var _an = _aoeDivs[_ai2].querySelector(".enemy-unit-hp-num");
              if (_af) _af.style.width = "0%";
              if (_an) _an.textContent  = "0 / " + t.maxHp;
              (function(el) { setTimeout(function() { el.classList.add("dying"); }, 80); })(_aoeDivs[_ai2]);
            }
          }
        }
      }
      logMessage(ally.icon + " 「" + ally.name + "」使用「" + skill.name + "」！");
      if (killed > 0) logMessage("💀 消滅了 " + killed + " 個敵人！");
      // Use unified handler for each dead clone
      for (var dci = 0; dci < deadClones.length; dci++) {
        removeCloneAndCheckPhaseEnd(deadClones[dci]);
      }
      if (activeClones.length > 0) {
        var en2 = document.getElementById("enemy-name");
        if (en2) en2.textContent = (bossClonePhase.active || savedBoss)
          ? ("魔王分身 ×" + activeClones.length)
          : (currentEnemy.name + " ×" + activeClones.length);
      }
      updateCombatEnemyHp();
      return allyResult;
    }

    if (skill.isShield) {
      allyShieldActive = true;
      logMessage(ally.icon + " 「" + ally.name + "」使用「" + skill.name + "」！本回合傷害減半！");
      return allyResult;
    }
    if (skill.isTaunt) {
      knightTauntActive = true;
      logMessage(ally.icon + " 「" + ally.name + "」使用「" + skill.name + "」！本回合替玩家承受攻擊！");
      return allyResult;
    }
    if (skill.multiplier && skill.multiplier > 0) {
      var target = activeClones.length > 0 ? activeClones[0] : currentEnemy;
      if (!rollHit(ally, target, skill.baseHit || 80)) {
        playSound("dodge");
        logMessage(ally.icon + " 「" + ally.name + "」的「" + skill.name + "」未命中！「" + target.name + "」閃開了！");
        return allyResult;
      }
      var dmg = Math.max(1, Math.floor((ally.atk + (ally.tempAtk || 0)) * skill.multiplier) - getEffectiveDef(target));
      dealDmgToEnemy(target, dmg);
      showDamagePopup(ally.icon + ally.name, dmg, false);
      logMessage(ally.icon + " 「" + ally.name + "」使用「" + skill.name + "」！對「" + target.name + "」造成 " + dmg + " 點傷害！");
      if (target.hp <= 0) {
        if (bossClonePhase.active || activeClones.length > 0) {
          removeCloneAndCheckPhaseEnd(target);
        }
      }
      updateCombatEnemyHp();
    }
  }
  return allyResult;
}

// ── 取得角色目前的效果列表 ─────────────────────────────────
function _getCharEffects(char) {
  var effects = [];
  var isParty = (char === currentPlayer || currentAllies.indexOf(char) !== -1);

  function _addBuff(stat, cls, label) {
    var b = isParty ? partyBuff[stat] : enemyBuff[stat];
    if (b.stages > 0) effects.push({ cls: cls+"-up", text: label+" "+"▲".repeat(b.stages)+" ("+b.turnsLeft+")" });
    if (b.stages < 0) effects.push({ cls: cls+"-dn", text: label+" "+"▼".repeat(-b.stages)+" ("+b.turnsLeft+")" });
  }
  _addBuff("atk", "phc-effect--atk", "ATK");
  _addBuff("def", "phc-effect--def", "DEF");
  _addBuff("spd", "phc-effect--spd", "SPD");
  // 道具臨時加成（不計入段數）
  if ((char.tempAtk || 0) > 0) effects.push({ cls: "phc-effect--atk-up", text: "ATK+ (∞)" });
  if ((char.tempDef || 0) > 0) effects.push({ cls: "phc-effect--def-up", text: "DEF+ (∞)" });
  if (char === currentPlayer && typeof playerAtkDebuffTurns !== "undefined" && playerAtkDebuffTurns > 0)
    effects.push({ cls: "phc-effect--atk-dn", text: "ATK▼ ("+playerAtkDebuffTurns+")" });

  return effects;
}

function _buildPartyCard(icon, name, hp, maxHp, isPlayer, isKO, char) {
  var pct = Math.max(0, hp / maxHp * 100);
  var card = document.createElement("div");
  card.className = "party-hp-card" +
    (isPlayer ? " party-hp-card--player" : "") +
    (isKO     ? " party-knocked-out"     : "");

  // 1. 名字
  var nameDiv = document.createElement("div");
  nameDiv.className = "phc-name";
  nameDiv.textContent = icon + " " + name + (isKO ? " 💀" : "");
  card.appendChild(nameDiv);

  // 2. 血量
  var hpRow = document.createElement("div");
  hpRow.className = "phc-hp-row";
  hpRow.innerHTML =
    "<span class='party-mini-bar-wrap'>" +
      "<span class='party-mini-bar-fill" + (isPlayer ? " player-mini-bar" : "") + "' style='width:" + pct + "%'></span>" +
    "</span>" +
    "<span class='party-hp-num-small'>" + hp + "/" + maxHp + "</span>";
  card.appendChild(hpRow);

  // 3. 效果
  if (char) {
    var effs = _getCharEffects(char);
    if (effs.length > 0) {
      var effDiv = document.createElement("div");
      effDiv.className = "phc-effects";
      effs.forEach(function(e) {
        var chip = document.createElement("span");
        chip.className = "phc-effect " + e.cls;
        chip.textContent = e.text;
        effDiv.appendChild(chip);
      });
      card.appendChild(effDiv);
    }
  }
  return card;
}

function updatePartyHpArea() {
  var area = document.getElementById("party-hp-area");
  if (!area) return;
  area.innerHTML = "";

  area.appendChild(_buildPartyCard("🧙", currentPlayer.name,
    currentPlayer.hp, currentPlayer.maxHp, true, false, currentPlayer));

  for (var i = 0; i < currentAllies.length; i++) {
    var a = currentAllies[i];
    area.appendChild(_buildPartyCard(a.icon || "🧑", a.name,
      a.hp, a.maxHp, false, a.knockedOut, a));
  }

  for (var j = 0; j < currentAllies.length; j++) {
    var unitDiv = document.querySelector("#combat-party-area .party-unit[data-party-idx='" + (j + 1) + "']");
    if (unitDiv) {
      if (currentAllies[j].knockedOut) unitDiv.classList.add("party-unit--knocked-out");
      else                              unitDiv.classList.remove("party-unit--knocked-out");
    }
  }
}

function updateAllyHpArea() { updatePartyHpArea(); }

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
    sk.textContent = "技能：" + def.skill.icon + " " + def.skill.name + " — " + computeAllySkillDesc(def.skill, ally.atk);
    left.appendChild(ds); left.appendChild(sk);

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
    sk2.textContent = "技能：" + def.skill.icon + " " + def.skill.name + " — " + computeAllySkillDesc(def.skill, def.atk);
    left.appendChild(ds2); left.appendChild(sk2);
  }

  var right = document.createElement("div"); right.className = "shop-card-right";
  var pr = document.createElement("div"); pr.className = "shop-card-price";
  pr.textContent = "💰 " + def.price;
  var btn = document.createElement("button"); btn.className = "btn btn-shop";
  if (owned) {
    btn.textContent = "遣返"; btn.className = "btn btn-flee";
    btn.onclick = (function(id) { return function() { dismissAlly(id); }; })(def.id);
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
  var gains      = { atk: 5,  def: 3,  maxHp: 20 };
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
  currentAllies.push({
    id: def.id, name: def.name, icon: def.icon,
    hp: def.maxHp, maxHp: def.maxHp,
    atk: def.atk, def: def.def,
    critChance: def.critChance || 0,
    skill: def.skill, skillCooldown: 0, knockedOut: false,
    upgrades: { atk: 0, def: 0, maxHp: 0 }
  });
  updatePlayerMoney(-def.price);
  playSound("buy");
  showShopMessage("✨ 「" + def.icon + " " + def.name + "」加入了隊伍！");
  document.getElementById("shop-player-money").textContent = currentPlayer.money;
  openShop();
}

function dismissAlly(allyId) {
  var idx = -1;
  for (var i = 0; i < currentAllies.length; i++) {
    if (currentAllies[i].id === allyId) { idx = i; break; }
  }
  if (idx === -1) return;
  var ally = currentAllies[idx];
  var name = ally.icon + " " + ally.name;
  var refund = 0;
  for (var j = 0; j < allyDefs.length; j++) {
    if (allyDefs[j].id === allyId) { refund = allyDefs[j].price; break; }
  }
  currentAllies.splice(idx, 1);
  if (refund > 0) updatePlayerMoney(refund);
  showShopMessage("👋 「" + name + "」已離隊，退還 " + refund + " 金幣。");
  openShop();
}

// ─────────────────────────────────────────────────────────────
function runNextEnemyTurn() {
  function _seq(applyFn, continueFn) {
    setTimeout(function() {
      applyFn();
      setTimeout(continueFn, 420);
    }, 480);
  }

  function _afterEnemyAction() {
    if (COMBAT_MODE === "press_turn") {
      if (enemyFullTokens + enemyFlashTokens > 0) {
        setTimeout(function() { runNextEnemyTurn(); }, 400);
        return;
      }
      startNewCombatRound();
    } else {
      decrementSkillCooldowns();
      if (playerAtkDebuffTurns > 0) playerAtkDebuffTurns--;
      setCombatButtonsEnabled(true);
    }
  }

  // ── 情況一：配對怪物，嚴格輪流攻擊 ──
  if (activeClones.length > 0 && pairedFightEnemy !== null) {
    var attacker = activeClones[_pairedAttackCursor % activeClones.length];
    _pairedAttackCursor++;

    var res = enemyTurn(currentPlayer, attacker);
    var dmg = res.playerDamage || 0;
    var shielded = isPlayerDefending || allyShieldActive;
    isPlayerDefending = false; allyShieldActive = false;

    if (res.miss) {
      playSound("dodge");
      logMessage(res.message || "💨 攻擊未命中！");
      if (COMBAT_MODE === "press_turn") animateEnemyTokenConsume(false, true);
      setTimeout(function() { _afterEnemyAction(); }, 500);
      return;
    }

    if (shielded) {
      dmg = Math.floor(dmg / 2);
      logMessage("🛡️ 防禦！「" + attacker.name + "」攻擊削半，實際受到 " + dmg + " 點傷害！");
    } else {
      logMessage(res.message || "");
    }

    var taunt1 = knightTauntActive; knightTauntActive = false;
    if (COMBAT_MODE === "press_turn") { animateEnemyTokenConsume(res.bonusTurn, res.loseTurn); }

    (function(_attacker, _dmg, _taunt) {
      _seq(function() {
        var fd = _dmg;
        if (_taunt && fd > 0) {
          var ka = null;
          for (var i = 0; i < currentAllies.length; i++) {
            if (currentAllies[i].id === "knight" && !currentAllies[i].knockedOut) { ka = currentAllies[i]; break; }
          }
          if (ka) {
            var ktd = Math.max(1, fd - getEffectiveDef(ka));
            ka.hp = Math.max(0, ka.hp - ktd);
            shakeAlly(ka);
            logMessage("🔰 「" + ka.name + "」護衛承受 " + ktd + " 點傷害！");
            if (ka.hp <= 0) { ka.knockedOut = true; logMessage("💔 「" + ka.name + "」力竭倒下！"); }
            updateAllyHpArea(); fd = 0;
          }
        }
        if (fd > 0) { updatePlayerHp(-fd); showDamagePopup(_attacker.name, fd, true); }
      }, function() {
        if (currentPlayer.hp <= 0) {
          logMessage("💀 你被打倒了..."); playSound("defeat");
          setTimeout(function() { triggerGameOver(); }, 1500); return;
        }
        _afterEnemyAction();
      });
    })(attacker, dmg, taunt1);
    return;
  }

  // ── 情況二：Boss 分身逐一行動 ──
  if (bossClonePhase.active && activeClones.length > 0) {
    if (COMBAT_MODE === "press_turn" && enemyFullTokens + enemyFlashTokens <= 0) {
      startNewCombatRound();
      return;
    }

    // 找到下一個存活分身
    var actingClone = null;
    for (var ci = 0; ci < activeClones.length; ci++) {
      var cidx = (enemyCloneTurnCursor + ci) % activeClones.length;
      if (!activeClones[cidx].knockedOut && activeClones[cidx].hp > 0) {
        actingClone = activeClones[cidx];
        enemyCloneTurnCursor = (cidx + 1) % Math.max(1, activeClones.length);
        break;
      }
    }
    if (!actingClone) { endBossClonePhase(); return; }

    var res2 = enemyTurn(currentPlayer, actingClone);
    var cloneLabel = "分身";
    var dmg2 = res2.playerDamage || 0;
    var shielded2 = isPlayerDefending || allyShieldActive;
    isPlayerDefending = false; allyShieldActive = false;

    if (res2.miss) {
      playSound("dodge");
      logMessage(res2.message || "💨 攻擊未命中！");
      if (COMBAT_MODE === "press_turn") animateEnemyTokenConsume(false, true);
      setTimeout(function() { _afterEnemyAction(); }, 500);
      return;
    }

    if (shielded2) {
      dmg2 = Math.floor(dmg2 / 2);
      logMessage("🛡️ 防禦/護盾！「" + cloneLabel + "」攻擊削半，實際受到 " + dmg2 + " 點傷害！");
    } else {
      logMessage(res2.message || ("🌑 「" + cloneLabel + "」攻擊！造成 " + dmg2 + " 點傷害！"));
    }
    var taunt2 = knightTauntActive; knightTauntActive = false;
    if (COMBAT_MODE === "press_turn") { animateEnemyTokenConsume(res2.bonusTurn, res2.loseTurn); }

    (function(_dmg, _taunt, _res) {
      _seq(function() {
        var fd = _dmg;
        if (_taunt && fd > 0) {
          var ka = null;
          for (var ki = 0; ki < currentAllies.length; ki++) {
            if (currentAllies[ki].id === "knight" && !currentAllies[ki].knockedOut) { ka = currentAllies[ki]; break; }
          }
          if (ka) {
            var ktd = Math.max(1, fd - getEffectiveDef(ka));
            ka.hp = Math.max(0, ka.hp - ktd);
            shakeAlly(ka);
            logMessage("🔰 「" + ka.name + "」挺身護衛，承受了 " + ktd + " 點傷害！");
            if (ka.hp <= 0) { ka.knockedOut = true; logMessage("💔 「" + ka.name + "」力竭倒下！"); }
            updateAllyHpArea(); fd = 0;
          }
        }
        if (fd > 0) { updatePlayerHp(-fd); showDamagePopup(cloneLabel, fd, true); }
      }, function() {
        if (currentPlayer.hp <= 0) {
          logMessage("💀 你被打倒了..."); playSound("defeat");
          setTimeout(function() { triggerGameOver(); }, 1500); return;
        }
        _afterEnemyAction();
      });
    })(dmg2, taunt2, res2);
    return;
  }

  // ── 情況三：普通單一敵人 / Boss ──
  var liveForEnemy = currentAllies.filter(function(a) { return !a.knockedOut; });
  if (liveForEnemy.length > 0 && Math.random() < 0.25) {
    var atarget = liveForEnemy[Math.floor(Math.random() * liveForEnemy.length)];
    var admg    = Math.max(1, getEffectiveAtk(currentEnemy) - getEffectiveDef(atarget));
    var _adi = allyDefendList.indexOf(atarget);
    if (_adi !== -1) { admg = Math.floor(admg / 2); allyDefendList.splice(_adi, 1); }
    if (isPlayerDefending || allyShieldActive) { admg = Math.floor(admg / 2); }
    isPlayerDefending = false; allyShieldActive = false;
    logMessage("「" + currentEnemy.name + "」轉向攻擊「" + atarget.name + "」！造成 " + admg + " 點傷害！");
    if (COMBAT_MODE === "press_turn") { animateEnemyTokenConsume(); }

    (function(_target, _admg) {
      _seq(function() {
        _target.hp = Math.max(0, _target.hp - _admg);
        shakeAlly(_target);
        if (_target.hp <= 0) {
          _target.knockedOut = true;
          logMessage("💔 「" + _target.name + "」陣亡了！前往商店購買或寶箱尋找復活藥水。");
        }
        updateAllyHpArea();
      }, function() {
        _afterEnemyAction();
      });
    })(atarget, admg);
    return;
  }

  var res = enemyTurn(currentPlayer, currentEnemy);

  if (res.summonClones && res.summonClones.length > 0) {
    if (COMBAT_MODE === "press_turn") animateEnemyTokenConsume(false, false);
    logMessage(res.message);
    decrementSkillCooldowns();
    setTimeout(function() { startCloneFight(currentEnemy, res.summonClones); }, 1000);
    return;
  }

  if (res.miss) {
    playSound("dodge");
    logMessage(res.message || "💨 攻擊未命中！");
    if (COMBAT_MODE === "press_turn") animateEnemyTokenConsume(false, true);
    setTimeout(function() { _afterEnemyAction(); }, 500);
    return;
  }

  if (COMBAT_MODE === "press_turn") { animateEnemyTokenConsume(res.bonusTurn, res.loseTurn); }

  var dmg = res.playerDamage || 0;
  var shielded3 = isPlayerDefending || allyShieldActive;
  isPlayerDefending = false; allyShieldActive = false;
  if (shielded3) {
    dmg = Math.floor(dmg / 2);
    logMessage("🛡️ " + currentEnemy.name + " 攻擊，防禦/護盾削半！實際受到 " + dmg + " 點傷害！");
  } else {
    logMessage(res.message || "");
  }

  var taunt3 = knightTauntActive; knightTauntActive = false;

  (function(_dmg, _taunt, _res) {
    _seq(function() {
      var fd = _dmg;
      if (_taunt && fd > 0) {
        var ka = null;
        for (var ki = 0; ki < currentAllies.length; ki++) {
          if (currentAllies[ki].id === "knight" && !currentAllies[ki].knockedOut) { ka = currentAllies[ki]; break; }
        }
        if (ka) {
          var ktd = Math.max(1, fd - (ka.def || 0));
          ka.hp = Math.max(0, ka.hp - ktd);
          shakeAlly(ka);
          logMessage("🔰 「" + ka.name + "」挺身護衛，承受了 " + ktd + " 點傷害！");
          if (ka.hp <= 0) { ka.knockedOut = true; logMessage("💔 「" + ka.name + "」力竭倒下！"); }
          updateAllyHpArea(); fd = 0;
        }
      }
      if (fd > 0) { updatePlayerHp(-fd); showDamagePopup(currentEnemy.name, fd, true); }

      if (_res.aoeSplash && currentAllies.length > 0) {
        for (var bai = 0; bai < currentAllies.length; bai++) {
          if (!currentAllies[bai].knockedOut) {
            currentAllies[bai].hp = Math.max(0, currentAllies[bai].hp - 10);
            shakeAlly(currentAllies[bai]);
            if (currentAllies[bai].hp <= 0) {
              currentAllies[bai].knockedOut = true;
              logMessage("💔 「" + currentAllies[bai].name + "」被魔王狂暴波及擊倒！");
            }
          }
        }
        updateAllyHpArea();
      }
      if (_res.suppressPlayer) {
        playerAtkDebuffTurns = 2;
        logMessage("⚠️ 你的攻擊力被壓制！接下來 2 回合僅有一半！");
      }
    }, function() {
      if (currentPlayer.hp <= 0) {
        logMessage("💀 你被打倒了..."); playSound("defeat");
        setTimeout(function() { triggerGameOver(); }, 1500); return;
      }
      _afterEnemyAction();
    });
  })(dmg, taunt3, res);
}

function startNewCombatRound() {
  isPlayerDefending = false;
  allyDefendList = [];
  decrementSkillCooldowns();
  if (COMBAT_MODE === "press_turn") {
    playerFullTokens  = calcPlayerTokenCount(); playerFlashTokens = 0;
    enemyFullTokens   = calcEnemyTokenCount();  enemyFlashTokens  = 0;
    updateTokenDisplay();
  }
  if (playerAtkDebuffTurns > 0) { playerAtkDebuffTurns--; }
  // 速度 buff 回合倒數
  // 倒數所有 buff/debuff
  (function() {
    var NAMES = { atk: "攻擊", def: "防禦", spd: "速度" };
    ["atk","def","spd"].forEach(function(stat) {
      var b = partyBuff[stat];
      if (b.turnsLeft > 0) {
        b.turnsLeft--;
        if (b.turnsLeft <= 0) { var dir = b.stages > 0 ? "提升" : "下降"; b.stages = 0; logMessage("⬇️ " + NAMES[stat] + dir + "效果消失了！"); }
      }
      var e = enemyBuff[stat];
      if (e.turnsLeft > 0) {
        e.turnsLeft--;
        if (e.turnsLeft <= 0) { e.stages = 0; }
      }
    });
    updatePartyHpArea();
  })();
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

function showDamagePopup(attackerName, damage, targetIsPlayer) {
  var field = document.getElementById("combat-field");
  if (!field || damage <= 0) return;
  var el = document.createElement("div");
  el.className = "damage-popup " + (targetIsPlayer ? "damage-popup--player" : "damage-popup--enemy");
  el.textContent = attackerName + " ▶ " + damage;
  var rnd = Math.random();
  if (targetIsPlayer) {
    el.style.left = (60 + Math.floor(rnd * 90)) + "px";
    el.style.top  = (180 + Math.floor(rnd * 80)) + "px";
  } else {
    el.style.right = (50 + Math.floor(rnd * 80)) + "px";
    el.style.top   = (10 + Math.floor(rnd * 80)) + "px";
  }
  field.appendChild(el);
  setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 1400);
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


// ── 黑幕淡入淡出轉場至地圖 ─────────────────────────────────
function fadeToMap(onDone) {
  var ov = document.getElementById("_fade_overlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "_fade_overlay";
    ov.style.cssText = "position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:9999;transition:opacity 0.3s ease";
    document.body.appendChild(ov);
  }
  // fade in black (0.3s)
  ov.style.opacity = "1";
  setTimeout(function() {
    if (onDone) onDone();   // endCombat → showScreen inside
    // fade out black (0.3s)
    setTimeout(function() { ov.style.opacity = "0"; }, 30);
  }, 200);
}


function endCombat(won) {
  partyBuff = { atk:{stages:0,turnsLeft:0}, def:{stages:0,turnsLeft:0}, spd:{stages:0,turnsLeft:0} };
  enemyBuff  = { atk:{stages:0,turnsLeft:0}, def:{stages:0,turnsLeft:0}, spd:{stages:0,turnsLeft:0} };
  if (!_tut.combatDone) {
    _tut.combatDone = true;
    _tut.combatEnabled = false;
    _updateTutorialToggles();
  }
  currentPlayer.tempAtk = 0; currentPlayer.tempDef = 0;
  updateHUD();
  currentEnemy = null; isPlayerDefending = false;
  allyShieldActive = false;
  allyDefendList = [];
  activeClones = []; savedBoss = null; pairedFightEnemy = null;
  bossClonePhase = { active: false, boss: null, clones: [] }; enemyCloneTurnCursor = 0;
  hideAllyPanel();
  renderMap(); showScreen("screen-map");
}

function triggerGameOver()  { gameOver = true; showScreen("screen-gameover"); }
function triggerGameClear() { gameOver = true; showScreen("screen-clear"); }

function restartGame() {
  // 重置教學狀態（保留開關設定）
  if (_tut.mazeEnabled)   { _tut.mazeDone = false; }
  if (_tut.combatEnabled) { _tut.combatIntroDone = false; _tut.halfTokenDone = false; _tut.missDone = false; _tut.combatDone = false; }
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

  currentMap            = mapGrid.map(function(row) { return row.slice(); });
  visitedTiles          = [];
  currentEnemy          = null;
  activeClones          = [];
  savedBoss             = null;
  pairedFightEnemy      = null;
  bossClonePhase        = { active: false, boss: null, clones: [] };
  enemyCloneTurnCursor  = 0;
  currentAllies         = [];
  allyShieldActive      = false;
  knightTauntActive     = false;
  blackKnightExposed    = false;
  pendingSkillId        = null;
  pendingHealTarget     = null;
  pendingItemIdx        = -1;
  shopUnlocked          = false;
  isPlayerDefending     = false;
  playerSkillCooldowns  = {};
  playerAtkDebuffTurns  = 0;
  shopPurchaseCounts    = {};

  updateHUD(); renderMap(); showScreen("screen-map");
  updateControlsHint();
}

function showMapMessage(msg) {
  var el = document.getElementById("map-message");
  if (!el) return;
  el.textContent = msg; el.style.opacity = "1";
  clearTimeout(showMapMessage._timer);
  showMapMessage._timer = setTimeout(function() { el.style.opacity = "0"; }, 2500);
}

// ── 小遊戲橋接 ────────────────────────────────────────────────
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


// ============================================================
//  教學系統
// ============================================================
var TUTORIAL_PAGES = [
  { text: "探索迷宮並打敗最終魔王吧！",                         img: "assets/picture/boss.png" },
  { text: "擊敗擋路的怪物，順便獲得金幣吧！",                   img: "assets/picture/enemy.png" },
  { text: "地圖上偶爾也會散落寶箱\n\n經過商店時順便進去看看吧", img: "assets/picture/chest.png" },
  { text: "透過玩完小遊戲獲得鑰匙以抵達更深處",                  img: "assets/picture/minigame.svg" },
  { text: "有時也會出現雙向傳送門\n靠著它去往隱藏地區吧",        img: null }
];

var TUTORIAL_SHOP_PAGE = {
  text: "可以透過快捷鍵 F 或點擊\n右側商店按鈕隨時開啟商店！",
  img: "assets/picture/shop.svg"
};

var _tutorialPages   = [];
var _tutorialCursor  = 0;
var _tutorialOnClose = null;
var _shopTutorialShown = false;

function showTutorial(pages, onClose) {
  _tutorialPages   = pages;
  _tutorialCursor  = 0;
  _tutorialOnClose = onClose || null;
  var ov = document.getElementById("tutorial-overlay");
  if (!ov) return;
  ov.style.display = "flex";
  _renderTutorialPage();
  document.removeEventListener("keydown", _tutorialKeyHandler, true);
  document.addEventListener("keydown", _tutorialKeyHandler, true);
}

function _renderTutorialPage() {
  var page = _tutorialPages[_tutorialCursor];
  if (!page) { skipTutorial(); return; }
  var isLast = (_tutorialCursor === _tutorialPages.length - 1);

  // text
  document.getElementById("tutorial-text").textContent = page.text;

  // image
  var imgEl = document.getElementById("tutorial-img");
  if (page.img) {
    imgEl.src = page.img; imgEl.style.display = "block";
  } else {
    imgEl.style.display = "none";
  }

  // dots
  var dotsEl = document.getElementById("tutorial-dots");
  dotsEl.innerHTML = "";
  for (var i = 0; i < _tutorialPages.length; i++) {
    var d = document.createElement("span");
    d.className = "tutorial-dot" + (i === _tutorialCursor ? " active" : "");
    dotsEl.appendChild(d);
  }

  // next button label
  var isShopTutorial = (_tutorialPages.length === 1 && _tutorialPages[0] === TUTORIAL_SHOP_PAGE);
  document.getElementById("tutorial-next-btn").textContent = isLast ? (isShopTutorial ? "繼續遊戲 ▶" : "開始遊戲 ▶") : "下一頁 ▶";

  // hide skip on single-page tutorials
  document.getElementById("tutorial-skip-btn").style.display =
    _tutorialPages.length > 1 ? "block" : "none";
}

function nextTutorialPage() {
  _tutorialCursor++;
  if (_tutorialCursor >= _tutorialPages.length) {
    skipTutorial();
  } else {
    _renderTutorialPage();
  }
}

function skipTutorial() {
  var ov = document.getElementById("tutorial-overlay");
  if (ov) ov.style.display = "none";
  document.removeEventListener("keydown", _tutorialKeyHandler, true);
  if (_tutorialOnClose) { var cb = _tutorialOnClose; _tutorialOnClose = null; cb(); }
}

function prevTutorialPage() {
  if (_tutorialCursor > 0) { _tutorialCursor--; _renderTutorialPage(); }
}

function _tutorialKeyHandler(e) {
  var ov = document.getElementById("tutorial-overlay");
  if (!ov || ov.style.display === "none") return;
  if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
    e.preventDefault(); e.stopPropagation();
    nextTutorialPage();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault(); e.stopPropagation();
    prevTutorialPage();
  } else if (e.key === "Escape") {
    e.preventDefault(); e.stopPropagation();
    skipTutorial();
  }
}



// ── 教學狀態 ──────────────────────────────────────────────
var _tut = {
  mazeEnabled   : true,   // 迷宮教學開關
  combatEnabled : true,   // 戰鬥教學開關
  mazeDone      : false,  // 已顯示過一次迷宮教學
  mazePending   : false,  // 等待下次進入迷宮時觸發
  combatIntroDone : false,  // 已顯示過戰鬥入場教學
  combatPending   : false,  // 等待下次進入戰鬥時觸發
  halfTokenDone   : false,  // 已顯示過半行動點教學
  missDone        : false,  // 已顯示過 miss 教學
  combatDone      : false,  // 已完成一次戰鬥（用於自動關閉戰鬥教學）
};

// ── 教學頁面定義 ─────────────────────────────────────────
var TUTORIAL_COMBAT_INTRO = { text: "選擇行動，設法戰勝眼前的敵人吧！", img: null };
var TUTORIAL_HALF_TOKEN   = { text: "當觸發爆擊時\n可獲得額外一次行動機會！", img: null };
var TUTORIAL_MISS         = { text: "若失手 Miss 了\n將額外喪失一次行動機會！", img: null };

// ── 設定 toggle 更新 UI ───────────────────────────────────
function _updateTutorialToggles() {
  var mb = document.getElementById("toggle-maze-tutorial");
  var cb = document.getElementById("toggle-combat-tutorial");
  if (mb) { mb.textContent = _tut.mazeEnabled ? "開" : "關"; mb.classList.toggle("off", !_tut.mazeEnabled); }
  if (cb) { cb.textContent = _tut.combatEnabled ? "開" : "關"; cb.classList.toggle("off", !_tut.combatEnabled); }
}

function toggleMazeTutorialSetting() {
  _tut.mazeEnabled = !_tut.mazeEnabled;
  if (_tut.mazeEnabled) _tut.mazeDone = false;  // 重新開啟時重置
  _updateTutorialToggles();
}

function toggleCombatTutorialSetting() {
  _tut.combatEnabled = !_tut.combatEnabled;
  if (_tut.combatEnabled) {
    // 重新開啟時重置所有戰鬥教學
    _tut.combatIntroDone = false;
    _tut.halfTokenDone   = false;
    _tut.missDone        = false;
    _tut.combatDone      = false;
  }
  _updateTutorialToggles();
}

// ── 迷宮教學觸發 ─────────────────────────────────────────
function tryShowMazeTutorial() {
  _tut.mazePending = false;
  if (!_tut.mazeEnabled || _tut.mazeDone) return;
  _tut.mazeDone = true;
  _tut.mazeEnabled = false;
  _updateTutorialToggles();
  showTutorial(TUTORIAL_PAGES);
}

// ── 戰鬥教學觸發 ─────────────────────────────────────────
function tryShowCombatIntroTutorial() {
  _tut.combatPending = false;
  if (!_tut.combatEnabled || _tut.combatIntroDone) return;
  _tut.combatIntroDone = true;
  setTimeout(function() { showTutorial([TUTORIAL_COMBAT_INTRO]); }, 200);
}

function tryShowHalfTokenTutorial() {
  if (!_tut.combatEnabled || _tut.halfTokenDone) return;
  _tut.halfTokenDone = true;
  showTutorial([TUTORIAL_HALF_TOKEN]);
}

function tryShowMissTutorial() {
  if (!_tut.combatEnabled || _tut.missDone) return;
  if (currentAllies.filter(function(a){ return !a.isDead; }).length === 0) return; // 隊伍 <2
  _tut.missDone = true;
  showTutorial([TUTORIAL_MISS]);
}

function notifyShopClosed() {
  if (!_shopTutorialShown) {
    _shopTutorialShown = true;
    setTimeout(function() {
      showTutorial([TUTORIAL_SHOP_PAGE]);
    }, 400);
  }
}

// ── 初始化 ────────────────────────────────────────────────────
window.onload = function() {
  updateHUD(); renderMap();
  // 先顯示地圖畫面再疊上教學
  if (typeof dialogues !== "undefined" &&
      dialogues.intro && dialogues.intro.length > 0) {
    showDialogue(dialogues.intro, function() {
      showScreen("screen-map");
      tryShowMazeTutorial();
    });
  } else {
    showScreen("screen-map");
    tryShowMazeTutorial();
  }
};


// ============================================================
//  戰鬥邏輯
// ============================================================

function playerTurn(action, player, enemy) {

  var result = {
    enemyDamage:   0,
    playerDefense: false,
    playerFlee:    false,
    bonusTurn:     false,
    loseTurn:      false,
    selfDamage:    0,
    skillUsed:     null,
    isAoe:         false,
    miss:          false,
    message:       ""
  };

  var effectiveAtk = getEffectiveAtk(player);
  if (typeof playerAtkDebuffTurns !== "undefined" && playerAtkDebuffTurns > 0) {
    effectiveAtk = Math.floor(effectiveAtk / 2);
    result.message += "[壓制中] ";
  }

  if (action === "attack") {
    if (!rollHit(player, enemy, BASE_ATTACK_HIT)) {
      result.miss = true; result.loseTurn = true;
      result.message = "💨 「" + enemy.name + "」閃避了你的攻擊！";
      return result;
    }
    playSound("attack");
    var damage = effectiveAtk - getEffectiveDef(enemy);
    if (damage < 1) damage = 1;

    var isCritical = Math.random() < calcCritRate(player, enemy);
    if (isCritical) {
      damage = Math.floor(damage * 1.5);
      result.bonusTurn = true;
    }

    result.enemyDamage = damage;
    result.message = "你對「" + enemy.name + "」發動攻擊，造成了 " + damage + " 點傷害！";
    if (isCritical) result.message += " 💥 暴擊！";
    if (player.tempAtk > 0) result.message += " ⚡";
  }

  if (action === "defend") {
    result.playerDefense = true;
    result.message = "你擺出防禦姿態！下次受到的傷害減半。";
  }

  if (action === "flee") {
    if (Math.random() < 0.7) {
      result.playerFlee = true;
      result.message = "你成功逃跑了！";
    } else {
      result.message = "逃跑失敗！";
    }
  }

  if (action === "skill_power_strike") {
    result.skillUsed = "power_strike";
    var psHit = (getSkillDef("power_strike") || {}).baseHit || 80;
    if (!rollHit(player, enemy, psHit)) {
      result.miss = true; result.loseTurn = true;
      result.message = "💥 強力打擊未命中！「" + enemy.name + "」閃開了！";
      return result;
    }
    playSound("attack");
    var damage = Math.floor(effectiveAtk * 2) - getEffectiveDef(enemy);
    if (damage < 1) damage = 1;
    var psCrit = Math.random() < calcSkillCritRate(player, enemy);
    if (psCrit) { damage = Math.floor(damage * 1.5); result.bonusTurn = true; }
    result.enemyDamage = damage;
    result.message = "💥 強力打擊！對「" + enemy.name + "」造成了 " + damage + " 點傷害！" + (psCrit ? " 💥 暴擊！" : "");
  }

  if (action === "skill_heal_magic") {
    result.skillUsed = "heal_magic";
    if (typeof pendingHealTarget !== "undefined" && pendingHealTarget !== null) {
      var ta = pendingHealTarget;
      ta.hp = Math.min(ta.maxHp, ta.hp + 25);
      result.healedAlly = true;
      result.message = "💚 治療術！「" + ta.name + "」恢復了 25 HP！";
      pendingHealTarget = null;
    } else {
      updatePlayerHp(25);
      result.message = "💚 治療術！恢復了 25 HP！";
    }
  }

  if (action === "skill_shield_bash") {
    result.skillUsed     = "shield_bash";
    result.playerDefense = true;  // 防禦效果無論命中與否都生效
    var sbHit = (getSkillDef("shield_bash") || {}).baseHit || 90;
    if (!rollHit(player, enemy, sbHit)) {
      result.miss = true;
      result.message = "🛡️ 盾擊！防禦成功，但攻擊未命中！";
      return result;
    }
    playSound("attack");
    var damage = Math.floor(effectiveAtk * 0.5);
    if (damage < 1) damage = 1;
    var sbCrit = Math.random() < calcSkillCritRate(player, enemy);
    if (sbCrit) { damage = Math.floor(damage * 1.5); result.bonusTurn = true; }
    result.enemyDamage = damage;
    result.message = "🛡️ 盾擊！防禦並對「" + enemy.name + "」造成了 " + damage + " 點傷害！" + (sbCrit ? " 💥 暴擊！" : "");
  }

  if (action === "skill_berserk") {
    result.skillUsed  = "berserk";
    result.selfDamage = 15;  // 自損無論命中與否都扣
    var bkHit = (getSkillDef("berserk") || {}).baseHit || 75;
    if (!rollHit(player, enemy, bkHit)) {
      result.miss = true; result.loseTurn = true;
      result.message = "😤 狂戰士未命中！攻擊落空，自損 15 HP！";
      return result;
    }
    playSound("attack");
    var damage = Math.floor(effectiveAtk * 3) - getEffectiveDef(enemy);
    if (damage < 1) damage = 1;
    var bkCrit = Math.random() < calcSkillCritRate(player, enemy);
    if (bkCrit) { damage = Math.floor(damage * 1.5); result.bonusTurn = true; }
    result.enemyDamage = damage;
    result.message = "😤 狂戰士！造成了 " + damage + " 點傷害，但自身損失了 15 HP！" + (bkCrit ? " 💥 暴擊！" : "");
  }

  if (action === "skill_skukaja") {
    result.skillUsed = "skukaja";
    if (partyBuff.spd.stages >= 3) {
      result.message = "⬆️ 斯庫卡加：效果已達上限！";
    } else {
      partyBuff.spd.stages++;
      partyBuff.spd.turnsLeft = 3;
      result.message = "⬆️ 斯庫卡加！我方全體速度提升（" + partyBuff.spd.stages + " 段，剩餘 3 回合）";
    }
    updatePartyHpArea();
  }

  if (action === "skill_chain_slash") {
    result.skillUsed = "chain_slash";
    var csHit = (getSkillDef("chain_slash") || {}).baseHit || 80;
    if (!rollHit(player, enemy, csHit)) {
      result.miss = true; result.loseTurn = true; result.isAoe = true;
      result.message = "🌀 連斬未命中！所有目標閃開了！";
      return result;
    }
    playSound("attack");
    var damage = Math.min(PLAYER_DMG_CAP, effectiveAtk - getEffectiveDef(enemy));
    if (damage < 1) damage = 1;
    var csCrit = Math.random() < calcSkillCritRate(player, enemy);
    if (csCrit) { damage = Math.floor(damage * 1.5); result.bonusTurn = true; }
    result.enemyDamage = damage;
    result.isAoe       = true;
    result.message = "🌀 連斬！向所有目標各造成 " + damage + " 點傷害！" + (csCrit ? " 💥 暴擊！" : "");
  }

  return result;
}


function enemyTurn(player, enemy) {
  var result = {
    playerDamage: 0,
    bonusTurn:    false,
    loseTurn:     false,
    summonClones: null,
    miss:         false,
    message:      ""
  };

  var damage = Math.max(1, getEffectiveAtk(enemy) - getEffectiveDef(player));

  // 先決定是否命中（召喚分身/特殊技能不受命中率影響）
  var enemyWillMiss = !rollHit(enemy, player, BASE_ATTACK_HIT);

  if (enemy.isFinalBoss) {
    var hasClones = typeof activeClones !== "undefined" && activeClones.length > 0;
    var hasDebuff = typeof playerAtkDebuffTurns !== "undefined" && playerAtkDebuffTurns > 0;

    if (!hasClones && Math.random() < 0.25) {
      var count = Math.floor(Math.random() * 3) + 1;
      var clones = [];
      for (var i = 0; i < count; i++) {
        clones.push({ name: "魔王分身", hp: 20, maxHp: 20, atk: 35, def: 0, spd: 8,
                      reward: { money: 0 }, isClone: true });
      }
      result.summonClones = clones;
      result.message = "🔱 魔王揮動魔杖，召喚了 " + count + " 個黑暗分身！";
      return result;
    }

    if (!hasDebuff && Math.random() < 0.25) {
      result.playerDamage  = Math.max(1, damage - 5);
      result.suppressPlayer = true;
      result.message = "👁️ 魔王施展黑暗壓制！造成 " + result.playerDamage + " 點傷害，你的攻擊力接下來 2 回合減半！";
      return result;
    }

    if (enemyWillMiss) {
      result.miss = true; result.loseTurn = true;
      result.message = "💨 你閃開了魔王的攻擊！";
      return result;
    }

    playSound("attack");
    var bossCrit = Math.random() < calcCritRate(enemy, player);
    result.playerDamage = bossCrit ? Math.floor(damage * 1.5) : damage;
    result.bonusTurn    = bossCrit;
    result.message = bossCrit
      ? "💥 魔王暴擊！造成了 " + result.playerDamage + " 點傷害！"
      : "「" + enemy.name + "」對你發動攻擊，造成了 " + damage + " 點傷害！";

    if (enemy.hp < enemy.maxHp * 0.4) {
      var berserkDmg = result.playerDamage + 5;
      result.playerDamage = berserkDmg;
      result.bonusTurn    = false;
      result.aoeSplash    = true;
      result.message = "😈 魔王狂暴！造成了 " + berserkDmg + " 點傷害，範圍攻擊波及同伴！";
    }

    return result;
  }

  if (enemy.isMiniBarrier) {
    if (enemyWillMiss) {
      result.miss = true; result.loseTurn = true;
      result.message = "💨 你閃開了黑騎士★的攻擊！";
      return result;
    }
    if (Math.random() < 0.4) {
      var lightDmg = Math.max(1, Math.floor(getEffectiveAtk(enemy) * 0.5) - getEffectiveDef(player));
      result.playerDamage = lightDmg;
      result.message = "🛡️ 黑騎士★堅守防線！輕擊造成 " + lightDmg + " 點傷害。";
    } else {
      var knightCrit = Math.random() < calcCritRate(enemy, player);
      result.playerDamage = knightCrit ? Math.floor(damage * 1.5) : damage;
      result.bonusTurn    = knightCrit;
      result.message = knightCrit
        ? "💥 黑騎士★暴擊！造成 " + result.playerDamage + " 點傷害！"
        : "⚔️ 黑騎士★發動攻擊！造成 " + damage + " 點傷害！";
    }
    return result;
  }

  if (enemyWillMiss) {
    result.miss = true; result.loseTurn = true;
    result.message = "💨 你閃開了「" + enemy.name + "」的攻擊！";
    return result;
  }

  playSound("attack");
  var isCrit = Math.random() < calcCritRate(enemy, player);
  result.playerDamage = isCrit ? Math.floor(damage * 1.5) : damage;
  result.bonusTurn    = isCrit;
  result.message = isCrit
    ? "💥 「" + enemy.name + "」暴擊！造成了 " + result.playerDamage + " 點傷害！"
    : "「" + enemy.name + "」對你發動攻擊，造成了 " + damage + " 點傷害！";
  return result;
}


function startMiniGame() {
  mgScore    = 0;
  mgTimeLeft = MG_TIME;
  mgRunning  = true;

  updateMiniGameHUD();

  // 只移除殘留敵人，保留 #mg-crosshair
  var area = document.getElementById("mg-area");
  if (area) {
    var oldEnemies = area.querySelectorAll(".mg-enemy");
    for (var i = 0; i < oldEnemies.length; i++) area.removeChild(oldEnemies[i]);
    area.addEventListener("click", onMgClick);
  }
  mgCurrentEnemy = null;

  // 顯示準心，設定初始位置在中央
  var crosshair = document.getElementById("mg-crosshair");
  var mgAreaEl  = document.getElementById("mg-area");
  if (crosshair && mgAreaEl) {
    crosshair.style.display = "block";
    crosshair.style.left = ((mgAreaEl.offsetWidth  || 600) / 2) + "px";
    crosshair.style.top  = ((mgAreaEl.offsetHeight || 380) / 2) + "px";
  }

  document.addEventListener("mousemove", onMgMouseMove);

  mgTimer = setInterval(function() {
    mgTimeLeft--;
    updateMiniGameHUD();
    if (mgTimeLeft <= 0) onMiniGameEnd(mgScore >= MG_TARGET);
  }, 1000);

  spawnMgEnemy();
  mgSpawnTimer = setInterval(function() {
    if (mgRunning) spawnMgEnemy();
  }, MG_SPAWN_INTERVAL);
}

function stopMiniGame() {
  mgRunning = false;
  clearInterval(mgTimer);
  clearInterval(mgSpawnTimer);
  clearTimeout(mgEnemyTimer);

  document.removeEventListener("mousemove", onMgMouseMove);

  var area = document.getElementById("mg-area");
  if (area) {
    area.removeEventListener("click", onMgClick);
    var oldEnemies = area.querySelectorAll(".mg-enemy");
    for (var i = 0; i < oldEnemies.length; i++) area.removeChild(oldEnemies[i]);
  }
  mgCurrentEnemy = null;

  var crosshair = document.getElementById("mg-crosshair");
  if (crosshair) crosshair.style.display = "none";
}

function spawnMgEnemy() {
  if (!mgRunning) return;
  if (mgCurrentEnemy && mgCurrentEnemy.parentNode) {
    mgCurrentEnemy.parentNode.removeChild(mgCurrentEnemy);
  }
  clearTimeout(mgEnemyTimer);

  var area = document.getElementById("mg-area");
  if (!area) return;

  var areaW = area.offsetWidth  || 600;
  var areaH = area.offsetHeight || 400;
  var size  = 50;

  var rx = Math.floor(Math.random() * (areaW - size));
  var ry = Math.floor(Math.random() * (areaH - size));

  var enemyEl       = document.createElement("img");
  enemyEl.src       = "assets/picture/enemy.png";
  enemyEl.className = "mg-enemy";
  enemyEl.style.left = rx + "px";
  enemyEl.style.top  = ry + "px";

  area.appendChild(enemyEl);
  mgCurrentEnemy = enemyEl;

  mgEnemyTimer = setTimeout(function() {
    if (mgCurrentEnemy && mgCurrentEnemy.parentNode) {
      mgCurrentEnemy.parentNode.removeChild(mgCurrentEnemy);
      mgCurrentEnemy = null;
    }
  }, MG_ENEMY_DURATION);
}

function onMgMouseMove(e) {
  var crosshair = document.getElementById("mg-crosshair");
  if (!crosshair) return;
  var area = document.getElementById("mg-area");
  var rect = area.getBoundingClientRect();
  crosshair.style.left = (e.clientX - rect.left - crosshair.offsetWidth  / 2) + "px";
  crosshair.style.top  = (e.clientY - rect.top  - crosshair.offsetHeight / 2) + "px";
}

function onMgClick(e) {
  if (!mgRunning || !mgCurrentEnemy) return;
  var area = document.getElementById("mg-area");
  var rect = area.getBoundingClientRect();
  var cx   = e.clientX - rect.left;
  var cy   = e.clientY - rect.top;

  var ex = parseInt(mgCurrentEnemy.style.left, 10);
  var ey = parseInt(mgCurrentEnemy.style.top,  10);
  var ew = mgCurrentEnemy.offsetWidth  || 50;
  var eh = mgCurrentEnemy.offsetHeight || 50;

  if (cx >= ex && cx <= ex + ew && cy >= ey && cy <= ey + eh) {
    mgScore++;
    updateMiniGameHUD();
    playSound("shot");
    if (mgCurrentEnemy.parentNode) mgCurrentEnemy.parentNode.removeChild(mgCurrentEnemy);
    mgCurrentEnemy = null;
    clearTimeout(mgEnemyTimer);
    spawnMgEnemy();
    if (mgScore >= MG_TARGET) onMiniGameEnd(true);
  }
}

function updateMiniGameHUD() {
  var scoreEl  = document.getElementById("mg-score");
  var timeEl   = document.getElementById("mg-time");
  var targetEl = document.getElementById("mg-target");
  if (scoreEl)  scoreEl.textContent  = mgScore;
  if (targetEl) targetEl.textContent = MG_TARGET;
  if (timeEl)   timeEl.textContent   = mgTimeLeft;
}
