// ============================================================
//  student.js  ── 學員主要工作區！
// ============================================================


// ============================================================
//  ★ 第一部分：戰鬥邏輯
// ============================================================

// 連斬的單目標傷害上限（其他技能無上限）
var PLAYER_DMG_CAP = 20;

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
    message:       ""
  };

  var effectiveAtk = player.atk + (player.tempAtk || 0);
  // 被壓制時攻擊力減半
  if (typeof playerAtkDebuffTurns !== "undefined" && playerAtkDebuffTurns > 0) {
    effectiveAtk = Math.floor(effectiveAtk / 2);
    result.message += "[壓制中] ";
  }

  // ── 普通攻擊 ──
  if (action === "attack") {
    var damage = effectiveAtk - enemy.def;
    if (damage < 1) damage = 1;
    result.enemyDamage = damage;
    result.message = "你對「" + enemy.name + "」發動攻擊，造成了 " + damage + " 點傷害！";
    if (player.tempAtk > 0) result.message += " ⚡";
  }

  // ── 防禦 ──
  if (action === "defend") {
    result.playerDefense = true;
    result.message = "你擺出防禦姿態！下次受到的傷害減半。";
  }

  // ── 逃跑 ──
  if (action === "flee") {
    if (Math.random() < 0.5) {
      result.playerFlee = true;
      result.message = "你成功逃跑了！";
    } else {
      result.message = "逃跑失敗！";
    }
  }

  // ── 技能：強力打擊（2× ATK）──
  if (action === "skill_power_strike") {
    var damage = Math.floor(effectiveAtk * 2) - enemy.def;
    if (damage < 1) damage = 1;
    result.enemyDamage = damage;
    result.skillUsed   = "power_strike";
    result.message = "💥 強力打擊！對「" + enemy.name + "」造成了 " + damage + " 點傷害！";
  }

  // ── 技能：治療術（回復 25 HP，可選目標） ──
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

  // ── 技能：盾擊（防禦 + 0.5× ATK）──
  if (action === "skill_shield_bash") {
    var damage = Math.floor(effectiveAtk * 0.5);
    if (damage < 1) damage = 1;
    result.enemyDamage   = damage;
    result.playerDefense = true;
    result.skillUsed     = "shield_bash";
    result.message = "🛡️ 盾擊！防禦並對「" + enemy.name + "」造成了 " + damage + " 點傷害！";
  }

  // ── 技能：狂戰士（3× ATK，自損 15 HP）──
  if (action === "skill_berserk") {
    var damage = Math.floor(effectiveAtk * 3) - enemy.def;
    if (damage < 1) damage = 1;
    result.enemyDamage = damage;
    result.selfDamage  = 15;
    result.skillUsed   = "berserk";
    result.message = "😤 狂戰士！造成了 " + damage + " 點傷害，但自身損失了 15 HP！";
  }

  // ── 技能：連斬（攻擊所有分身，各造成 ATK 傷害，上限 20）──
  if (action === "skill_chain_slash") {
    var damage = Math.min(PLAYER_DMG_CAP, effectiveAtk - (enemy.def || 0));
    if (damage < 1) damage = 1;
    result.enemyDamage = damage;
    result.isAoe       = true;
    result.skillUsed   = "chain_slash";
    result.message = "🌀 連斬！向所有目標各造成 " + damage + " 點傷害！";
  }

  // ── 黑騎士護甲（主動突擊時弱點暴露才受全傷，否則永遠只受 1）──
  if (enemy.isMiniBarrier && result.enemyDamage > 0) {
    if (typeof blackKnightExposed !== "undefined" && blackKnightExposed) {
      result.message += " ⚡ 弱點暴露！受到全額傷害！";
    } else {
      result.enemyDamage = 1;
      result.message += " 🛡️（格擋中，只造成 1 傷害）";
    }
  }

  return result;
}


// ── enemyTurn ─────────────────────────────────────────────────
function enemyTurn(player, enemy) {
  var result = {
    playerDamage: 0,
    bonusTurn:    false,
    loseTurn:     false,
    summonClones: null,
    message:      ""
  };

  var damage = Math.max(1, enemy.atk - player.def);

  if (enemy.isFinalBoss) {
    var hasClones = typeof activeClones !== "undefined" && activeClones.length > 0;
    var hasDebuff = typeof playerAtkDebuffTurns !== "undefined" && playerAtkDebuffTurns > 0;

    // ── 被動技能①：25% 召喚分身（無分身時可觸發，每回合獨立擲骰）──
    if (!hasClones && Math.random() < 0.25) {
      var count = Math.floor(Math.random() * 3) + 1;  // 1、2 或 3 個
      var clones = [];
      for (var i = 0; i < count; i++) {
        clones.push({ name: "魔王分身", hp: 20, maxHp: 20, atk: 35, def: 0,
                      reward: { money: 0 }, isClone: true });
      }
      result.summonClones = clones;
      result.message = "🔱 魔王揮動魔杖，召喚了 " + count + " 個黑暗分身！";
      return result;
    }

    // ── 被動技能②：25% 壓制（無壓制效果時，獨立擲骰）──
    if (!hasDebuff && Math.random() < 0.25) {
      result.playerDamage  = Math.max(1, damage - 5);
      result.suppressPlayer = true;
      result.message = "👁️ 魔王施展黑暗壓制！造成 " + result.playerDamage + " 點傷害，你的攻擊力接下來 2 回合減半！";
      return result;
    }

    // ── 普通攻擊 ──
    result.playerDamage = damage;
    result.message = "「" + enemy.name + "」對你發動攻擊，造成了 " + damage + " 點傷害！";

    // ── 狂暴（HP < 40%，必定觸發，+5 傷害，連擊＋範圍濺射）──
    if (enemy.hp < enemy.maxHp * 0.4) {
      damage += 5;
      result.playerDamage = damage;
      result.bonusTurn    = true;
      result.message = "😈 魔王狂暴！造成了 " + damage + " 點傷害，範圍攻擊！（必定連擊）";
    }

    return result;
  }

  // ── 黑騎士：40% 防禦姿態 / 60% 全力突擊（暴露弱點）──
  if (enemy.isMiniBarrier) {
    if (Math.random() < 0.4) {
      var lightDmg = Math.max(1, Math.floor(enemy.atk * 0.5) - player.def);
      result.playerDamage = lightDmg;
      result.message = "🛡️ 黑騎士堅守防線！輕擊造成 " + lightDmg + " 點傷害（格擋中，你的攻擊只造成 1）。";
    } else {
      result.playerDamage = damage;
      result.knightExposed = true;
      result.message = "⚔️ 黑騎士全力突擊！造成 " + damage + " 點傷害，防禦破綻暴露！（下一擊可造成全額傷害）";
    }
    return result;
  }

  // ── 普通敵人 ──
  result.playerDamage = damage;
  result.message = "「" + enemy.name + "」對你發動攻擊，造成了 " + damage + " 點傷害！";
  return result;
}


// ============================================================
//  ★ 第二部分：射擊小遊戲
// ============================================================

var mgScore        = 0;
var mgTimeLeft     = MG_TIME;
var mgTimer        = null;
var mgSpawnTimer   = null;
var mgCurrentEnemy = null;
var mgEnemyTimer   = null;
var mgRunning      = false;


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

  var enemyEl    = document.createElement("img");
  enemyEl.src    = "assets/enemy.png";
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
    playSound("attack");
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
