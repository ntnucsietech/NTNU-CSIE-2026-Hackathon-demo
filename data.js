// ============================================================
//  data.js  ── 遊戲資料設定檔
// ============================================================

var MAP_TILE = {
  EMPTY:      0,
  WALL:       1,
  CHEST:      2,
  ENEMY:      3,
  DOOR:       4,
  MINI_GAME:  5,
  SHOP:       6,
  FINAL_BOSS: 9
};

// ── 地圖設定 ──────────────────────────────────────────────────
// 地圖分三區：A（主區）→ 門1 → B（中區）→ 門2 → C（鎖定區）
// 必須為奇數；MAP_SEED 固定使地圖每次相同
var MAP_WIDTH  = 33;
var MAP_HEIGHT = 27;
var MAP_SEED   = 42;   // 改這個數字可以換一張固定地圖

// ── 敵人數量 ─────────────────────────────────────────────────
var ENEMY_COUNT = 18;    // 三區合計（A:2, B:2, C:3）
var CHEST_COUNT = 11;

// ── 出生點 ────────────────────────────────────────────────────
var playerStart = { x: 1, y: 1 };

// ── 視野半徑 ──────────────────────────────────────────────────
var visionRadius = 3;

// ── 玩家數值 ──────────────────────────────────────────────────
var playerStats = {
  name:   "勇者",
  hp:     100,
  maxHp:  100,
  atk:    10,
  def:    5,
  money:  25,
  keys:   0,
  skills: ["power_strike"]
};

// ── 敵人（A 區 Tier 1） ───────────────────────────────────────
var enemies = [
  { name: "哥布林",   hp: 42,  maxHp: 42,  atk: 11, def: 3,  reward: { money: 22 } },
  { name: "獸人",     hp: 60,  maxHp: 60,  atk: 13, def: 4,  reward: { money: 27 } },
  { name: "石像鬼",   hp: 56,  maxHp: 56,  atk: 16, def: 5,  reward: { money: 28 } },
  { name: "惡魔蝙蝠", hp: 38,  maxHp: 38,  atk: 15, def: 2,  reward: { money: 25 } }
];

// ── 敵人（B 區 Tier 2）────────────────────────────────────────
var enemiesTier2 = [
  { name: "魔法師",   hp: 250, maxHp: 250, atk: 19, def: 10, reward: { money: 67 } },
  { name: "黑騎士★",  hp: 10,  maxHp: 10,  atk: 28, def:  0, reward: { money: 90 }, isMiniBarrier: true, noOneShot: true },
  { name: "地獄犬",   hp: 190, maxHp: 190, atk: 25, def:  8, reward: { money: 73 } },
  { name: "狼人雙煞", hp: 120, maxHp: 120, atk: 21, def:  5, reward: { money: 77 }, isPaired: true }
];

// ── 敵人（C 區 Tier 3）────────────────────────────────────────
var enemiesTier3 = [
  { name: "死靈法師",  hp: 420, maxHp: 420, atk: 43, def: 15, reward: { money: 80 } },
  { name: "暗黑巨龍",  hp: 510, maxHp: 510, atk: 35, def: 18, reward: { money: 94 } },
  { name: "冥界雙衛", hp: 200, maxHp: 200, atk: 42, def: 12, reward: { money: 85 }, isPaired: true }
];

// ── 最終 Boss ─────────────────────────────────────────────────
// HP 500；血量低於 60% 時召喚 3 個分身（各 HP 40）
var finalBoss = {
  name: "黑暗魔王", hp: 1250, maxHp: 1250, atk: 50, def: 42,
  reward: { money: 150 }
};

// ── 寶箱獎勵 ──────────────────────────────────────────────────
var chestRewards = [
  { money: 25,  message: "你找到了 25 枚金幣！" },
  { atk:   3,   message: "你找到了力量秘藥，攻擊力永久提升 3！" },
  { def:   2,   message: "你找到了盾牌碎片，防禦力永久提升 2！" },
  { money: 35,  message: "大寶箱！你找到了 35 枚金幣！" },
  { reviveAlly: true, message: "你找到了友軍復活藥水！" }
];

// ── 技能定義 ──────────────────────────────────────────────────
var skillDefs = [
  { id: "power_strike", name: "強力打擊", icon: "💥",
    desc: "造成 2× 傷害（冷卻 2 回合）", type: "innate",  cooldown: 2 },
  { id: "heal_magic",   name: "治療術",   icon: "💚",
    desc: "戰鬥中恢復 25 HP（無冷卻）", type: "shop", price: 40, cooldown: 0 },
  { id: "shield_bash",  name: "盾擊",     icon: "🛡️",
    desc: "防禦並造成 0.5× 傷害（冷卻 2 回合）", type: "shop", price: 35, cooldown: 2 },
  { id: "berserk",      name: "狂戰士",   icon: "😤",
    desc: "造成 3× 傷害，自損 15 HP（冷卻 3 回合）",
    type: "craft", recipe: ["power_strike", "heal_magic"], cooldown: 3 },
  { id: "chain_slash",  name: "連斬",     icon: "🌀",
    desc: "同時攻擊所有分身，各造成 ATK 傷害（冷卻 3 回合）",
    type: "shop", price: 60, cooldown: 3 }
];

// ── 商店道具 ──────────────────────────────────────────────────
// isConsumable:false = 立即永久生效
// isConsumable:true  = 加入背包，戰鬥中手動使用（臨時加成或回血）
var shopItems = [
  // 永久升級
  { name: "攻擊強化藥水", price: 25, effect: { atk: 3        }, desc: "攻擊力永久 +3",      isConsumable: false },
  { name: "防禦強化藥水", price: 15, effect: { def: 3        }, desc: "防禦力永久 +3",      isConsumable: false },
  { name: "生命強化藥水", price: 30, effect: { maxHp: 20     }, desc: "最大 HP 永久 +20",   isConsumable: false },
  { name: "血量恢復藥水", price: 10, effect: { hp:  30       }, desc: "立即回復 30 HP",     isConsumable: false },
  { name: "大恢復藥水",   price: 25, effect: { hp:  80       }, desc: "立即回復 80 HP",     isConsumable: false },
  // 戰鬥消耗品（放入背包，戰鬥中使用）
  { name: "攻擊爆發劑", price: 18, effect: { tempAtk: 12 },
    desc: "戰鬥中使用：本場 ATK +12",  isConsumable: true },
  { name: "鋼甲藥水",   price: 14, effect: { tempDef: 8  },
    desc: "戰鬥中使用：本場 DEF +8",   isConsumable: true },
  { name: "狂暴藥水",   price: 22, effect: { tempAtk: 25, selfHp: -15 },
    desc: "戰鬥中使用：ATK +25 但損失 15 HP", isConsumable: true },
  { name: "治癒藥水",   price: 16, effect: { hp: 50 },
    desc: "戰鬥中使用：立即回復 50 HP", isConsumable: true },
  // 同伴復活（永久，立即選擇目標）
  { name: "友軍復活藥水", price: 50, effect: { reviveAlly: true },
    desc: "復活一名陣亡的同伴（恢復 50% HP）", isConsumable: false },
  // 同伴強化（永久，立即提升所有同伴 ATK+5）
  { name: "同伴強化石", price: 30, effect: { allAllyAtk: 5 },
    desc: "立即提升所有同伴 ATK +5（永久）", isConsumable: false },
  // 同伴治癒（消耗品，戰鬥中治療 HP 最低的同伴）
  { name: "同伴治癒藥水", price: 18, effect: { allyHeal: 40 },
    desc: "戰鬥中使用：治療 HP 最低的同伴 40 HP", isConsumable: true }
];

// ── 同伴定義（可在商店招募，最多 2 人） ──────────────────────
var allyDefs = [
  { id: "archer", name: "弓箭手", icon: "🏹",
    hp: 80, maxHp: 80, atk: 18, def: 3, price: 80, critChance: 0.5,
    skill: { id: "volley",     name: "箭雨",    icon: "🌧️",
             desc: "攻擊全體敵人各造成 ATK 點傷害（冷卻 3 回合）",
             isAoe: true,    multiplier: 1,   cooldown: 2 } },
  { id: "wizard", name: "法師",   icon: "🧙",
    hp: 55, maxHp: 55, atk: 22, def: 2, price: 100,
    skill: { id: "blizzard",   name: "冰矛",    icon: "❄️",
             desc: "對單體造成 ATK×2 點傷害（冷卻 3 回合）",
             isAoe: false,   multiplier: 2,   cooldown: 3 } },
  { id: "knight", name: "聖騎士", icon: "⚔️",
    hp: 130, maxHp: 130, atk: 14, def: 20, price: 100,
    skill: { id: "holy_guard", name: "護衛",     icon: "🔰",
             desc: "本回合替玩家承受敵人攻擊（以自身 DEF 減傷，冷卻 3 回合）",
             isTaunt: true,  multiplier: 0,   cooldown: 3 } }
];

// ── 小遊戲設定 ────────────────────────────────────────────────
var MG_TARGET          = 5;
var MG_TIME            = 20;
var MG_ENEMY_DURATION  = 1500;
var MG_SPAWN_INTERVAL  = 1000;

// ── 戰鬥模式 ─────────────────────────────────────────────────
var COMBAT_MODE       = "traditional";
var PRESS_TURN_TOKENS = 3;

// ── 對話文本 ──────────────────────────────────────────────────
var dialogues = {
  intro: [
    { speaker: "",     text: "黑暗迷宮的大門，緩緩地打開了..." },
    { speaker: "勇者", text: "這裡就是傳說中的黑暗迷宮嗎？" },
    { speaker: "勇者", text: "不管如何，我一定要找到出口！" }
  ],
  boss_pre: [
    { speaker: "黑暗魔王", text: "哦？沒想到你居然能來到這裡。" },
    { speaker: "黑暗魔王", text: "你的勇氣值得讚揚。但也僅止於此了。" },
    { speaker: "勇者",     text: "魔王！今天就是你的末日！" }
  ],
  shop_first: [
    { speaker: "神秘商人", text: "旅行者，你看起來精疲力竭啊。" },
    { speaker: "神秘商人", text: "我這裡有不少好東西，要看看嗎？" }
  ]
};
