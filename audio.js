// ============================================================
//  audio.js  ── 音效與背景音樂系統
//
//  功能：
//    1. 音效 (SFX)  ── 動作發生時播放短音效（攻擊、進入戰鬥…）
//    2. 背景音樂 (BGM) ── 依情境自動切換，支援 Loop 起始 / 結束點
//
//  快速上手：
//    ① 把音檔放進 assets/audio/ 資料夾
//    ② 在下方「★ 音效設定區」填入檔名
//    ③ 在「★ BGM 音軌設定區」填入 BGM 檔名與循環點
//    ④ 在「★ 情境對應表」設定哪個畫面播哪首 BGM
//
//  ⚠️  瀏覽器自動播放政策：音訊需要使用者先點擊畫面才能播放。
//      第一次使用者點擊後，所有音效/BGM 都會正常運作。
// ============================================================

var AudioSystem = (function () {

  // ── Web Audio API 核心 ────────────────────────────────────
  var ctx = null;   // AudioContext 全域實例

  // ============================================================
  //  ★ 音效 (SFX) 設定區
  //    key  : playSound() 呼叫時傳入的名稱（engine.js 已定義的名稱）
  //    value: 音檔路徑（相對於 index.html 的位置）
  //
  //  ── engine.js 中已呼叫的 playSound 名稱 ──────────────────
  //    "encounter" → 進入戰鬥
  //    "attack"    → 射擊小遊戲擊中 / 攻擊
  //    "victory"   → 擊敗敵人
  //    "defeat"    → 玩家死亡
  //    "flee"      → 逃跑成功
  //    "chest"     → 打開寶箱
  //    "key"       → 小遊戲通關得到鑰匙
  //
  //  ── 學員可自行新增 ─────────────────────────────────────
  //    在 student.js 裡呼叫 playSound("your_name") 並在此補上路徑即可
  // ============================================================
  //  SFX_CONFIG 支援兩種格式：
  //    "path/to/file.mp3"               → 使用預設音量 1.0
  //    { src: "path/to/file.mp3", volume: 0.8 } → 個別音量（0.0 ~ 1.0）
  var SFX_CONFIG = {
    encounter  : null,   // 尚無音檔
    shield     : null,
    dodge      : { src: "assets/audio/SFX/dodge.mp3",  volume: 0.5 },
    attack     : { src: "assets/audio/SFX/attack.wav", volume: 1.0 },
    flash_token: { src: "assets/audio/SFX/flash.wav",  volume: 0.8 },
    victory    : null,
    defeat     : null,
    flee       : null,
    chest      : { src: "assets/audio/SFX/open_chest.mp3", volume: 0.5 },
    locked_door: { src: "assets/audio/SFX/locked.mp3",        volume: 1.0 },
    unlock_door: { src: "assets/audio/SFX/open_the_door.mp3", volume: 1.0 },
    teleport   : { src: "assets/audio/SFX/teleport.mp3",   volume: 1.0 },
    buy        : { src: "assets/audio/SFX/buy.wav",        volume: 1.0 },
    //小遊戲
    shot       : { src: "assets/audio/SFX/shot.wav",       volume: 1.0 },
    key        : null,
  };

  // 音效主音量 0.0 ~ 1.0
  var sfxMasterVolume = 1.0;

  // ============================================================
  //  ★ BGM 音軌設定區
  //
  //    src       : 音檔路徑
  //    volume    : 此音軌的基礎音量（0.0 ~ 1.0）
  //    loopStart : 循環起始點（秒）。0 = 從頭開始循環
  //    loopEnd   : 循環結束點（秒）。到此時間後跳回 loopStart
  //                設為 null 或 0 = 播放到檔案結尾後循環
  //
  //  範例（loop 說明）：
  //    loopStart: 4.2, loopEnd: 58.3
  //    → 音樂播放到 58.3 秒時，跳回 4.2 秒繼續循環
  //    → 開頭 0 ~ 4.2 秒只在第一次播放（前奏不重複）
  // ============================================================
  var BGM_TRACKS = {
    map: {
      src       : null,   // 尚無音檔
      volume    : 0.6,
      loopStart : 0,
      loopEnd   : null
    },
    battle1: {
      src       : "assets/audio/bgm_battle1.mp3",
      volume    : 0.8,
      loopStart : 0,
      loopEnd   : null
    },
    battle2: {
      src       : null,   // 尚無音檔
      volume    : 0.8,
      loopStart : 0,
      loopEnd   : null
    },
    boss: {
      src       : "assets/audio/bgm_boss.mp3",
      volume    : 0.9,
      loopStart : 0,
      loopEnd   : null
    },
    shop: {
      src       : null,   // 尚無音檔
      volume    : 0.5,
      loopStart : 0,
      loopEnd   : null
    },
    clear: {
      src       : null,   // 尚無音檔
      volume    : 0.7,
      loopStart : 0,
      loopEnd   : null
    },
    gameover: {
      src       : null,   // 尚無音檔
      volume    : 0.7,
      loopStart : 0,
      loopEnd   : null
    },
    minigame: {
      src       : "assets/audio/mini_game.mp3",
      volume    : 0.9,
      loopStart : 0,
      loopEnd   : null
    },
    // ↓ 學員可自行新增音軌
    // dungeon: {
    //   src: "assets/audio/bgm_dungeon.mp3",
    //   volume: 0.6, loopStart: 2.0, loopEnd: 120.0
    // },
  };

  // ============================================================
  //  ★ 情境對應表
  //    key  : showScreen() 傳入的畫面 ID（去掉 "screen-" 前綴）
  //    value: BGM_TRACKS 中的音軌名稱
  //           設為 null 或不填 = 靜音（停止 BGM）
  //
  //  畫面 ID 對照：
  //    "map"       → 主地圖畫面
  //    "combat"    → 戰鬥畫面（一般敵人）
  //    "shop"      → 商店畫面
  //    "minigame"  → 射擊小遊戲
  //    "dialogue"  → 對話框（不切換，沿用前一首）
  //    "gameover"  → 遊戲結束
  //    "clear"     → 通關畫面
  // ============================================================
  var SITUATION_BGM = {
    map      : "map",
    combat   : "battle1",  // 一般戰鬥 → battle BGM
    boss     : "boss",     // ← 此項由 triggerFinalBoss 另行觸發
    shop     : "shop",
    minigame : "minigame",
    gameover : "gameover",
    clear    : "clear",
    dialogue : null        // null = 不切換，保持當前 BGM
  };


  // ── 內部狀態（學員不需修改）─────────────────────────────
  var sfxBuffers       = {};   // { name: AudioBuffer }
  var bgmBuffers       = {};   // { trackName: AudioBuffer }
  var currentBgmSource = null; // 正在播放的 BGM AudioBufferSourceNode
  var currentBgmGain   = null; // 正在播放的 BGM GainNode
  var currentBgmName   = null; // 正在播放的音軌名稱
  var bgmMasterVolume  = 1.0;  // BGM 主音量倍率 0.0 ~ 1.0

  // ── 初始化 ────────────────────────────────────────────────
  function init() {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn("[AudioSystem] 瀏覽器不支援 Web Audio API，音效功能停用。");
      return;
    }
    _preloadAll();
    // 第一次使用者互動後解除瀏覽器自動播放限制
    document.addEventListener("click",    _resumeContext, { once: true });
    document.addEventListener("keydown",  _resumeContext, { once: true });
    document.addEventListener("touchend", _resumeContext, { once: true });
  }

  function _resumeContext() {
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  // ── SFX 設定解析（支援字串或物件）────────────────────────
  function _sfxSrc(cfg)    { return cfg && (typeof cfg === "string" ? cfg : cfg.src);    }
  function _sfxVolume(cfg) { return cfg && typeof cfg === "object" && cfg.volume != null ? cfg.volume : 1.0; }

  // ── 批次預載 ──────────────────────────────────────────────
  function _preloadAll() {
    if (!ctx) return;
    for (var sfxName in SFX_CONFIG) {
      (function (n) {
        _loadBuffer(_sfxSrc(SFX_CONFIG[n]), function (buf) {
          sfxBuffers[n] = buf;
        });
      })(sfxName);
    }
    for (var trackName in BGM_TRACKS) {
      (function (t) {
        _loadBuffer(BGM_TRACKS[t].src, function (buf) {
          bgmBuffers[t] = buf;
        });
      })(trackName);
    }
  }

  // ── XHR 載入並解碼音訊 ────────────────────────────────────
  function _loadBuffer(url, callback) {
    if (!ctx || !url) return;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = function () {
      if (xhr.status === 200 || xhr.status === 0) {
        ctx.decodeAudioData(
          xhr.response,
          function (buf) { callback(buf); },
          function (e)   { console.warn("[AudioSystem] 解碼失敗：" + url, e); }
        );
      } else {
        console.warn("[AudioSystem] HTTP 錯誤 " + xhr.status + "：" + url);
      }
    };
    xhr.onerror = function () { console.warn("[AudioSystem] 找不到檔案：" + url); };
    xhr.send();
  }


  // ============================================================
  //  音效 (SFX) 公開函式
  // ============================================================

  /**
   * 播放一次性音效。
   * @param {buy} name  SFX_CONFIG 中的鍵名
   * @param {shot} name
   * @param {chest} name
   * @param {dodge} name
   * @param {teleport} name
   */
  function playSfx(name) {
    if (!ctx || !sfxBuffers[name]) return;
    _resumeContext();

    var cfg    = SFX_CONFIG[name];
    var source = ctx.createBufferSource();
    var gain   = ctx.createGain();
    source.buffer   = sfxBuffers[name];
    gain.gain.value = _sfxVolume(cfg) * sfxMasterVolume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  }

  /**
   * 設定所有音效的主音量。
   * @param {number} vol  0.0（靜音）～ 1.0（最大）
   */
  function setSfxVolume(vol) {
    sfxMasterVolume = Math.max(0, Math.min(1, Number(vol) || 0));
  }

  /**
   * 設定單一音效的個別音量（下次播放時生效）。
   * @param {string} name  SFX_CONFIG 中的鍵名
   * @param {number} vol   0.0（靜音）～ 1.0（最大）
   */
  function setSfxEntryVolume(name, vol) {
    if (!(name in SFX_CONFIG)) return;
    var cfg = SFX_CONFIG[name];
    var src = _sfxSrc(cfg);
    SFX_CONFIG[name] = { src: src, volume: Math.max(0, Math.min(1, Number(vol) || 0)) };
  }


  // ============================================================
  //  背景音樂 (BGM) 公開函式
  // ============================================================

  /**
   * 播放指定 BGM 音軌（與目前相同時不重播）。
   * @param {minigame} trackName  BGM_TRACKS 中的鍵名
   */
  function playBgm(trackName) {
    if (!ctx) return;
    if (currentBgmName === trackName) return;  // 已在播放，不重複

    stopBgm();  // 先停目前的

    var track = BGM_TRACKS[trackName];
    if (!track) {
      console.warn("[AudioSystem] 找不到 BGM 音軌：" + trackName);
      return;
    }

    currentBgmName = trackName;  // 預先標記，避免非同步競態

    var buf = bgmBuffers[trackName];
    if (!buf) {
      // 尚未載入完成 → 等載入後再播
      _loadBuffer(track.src, function (b) {
        bgmBuffers[trackName] = b;
        // 確認等待期間情境沒有改變
        if (currentBgmName === trackName) _startBgm(trackName, b);
      });
    } else {
      _startBgm(trackName, buf);
    }
  }

  /**
   * 建立並啟動 BGM AudioBufferSourceNode（含 loop 設定）。
   * @private
   */
  function _startBgm(trackName, buf) {
    if (!ctx) return;
    _resumeContext();

    var track  = BGM_TRACKS[trackName];
    var source = ctx.createBufferSource();
    var gain   = ctx.createGain();

    source.buffer = buf;
    source.loop   = true;

    // ── Loop 起始 / 結束點 ──────────────────────────────────
    var loopStart = (track.loopStart != null) ? Number(track.loopStart) : 0;
    var loopEnd   = (track.loopEnd   != null && track.loopEnd > 0)
                    ? Number(track.loopEnd)
                    : buf.duration;   // null / 0 → 播到結尾

    source.loopStart = loopStart;
    source.loopEnd   = loopEnd;

    // ── 音量 ────────────────────────────────────────────────
    gain.gain.value = (track.volume || 1.0) * bgmMasterVolume;

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);

    currentBgmSource = source;
    currentBgmGain   = gain;
    // currentBgmName 已在 playBgm() 設定
  }

  /**
   * 停止目前播放的 BGM（含 0.3 秒淡出）。
   */
  function stopBgm() {
    if (currentBgmSource) {
      var FADE = 0.3;
      var src  = currentBgmSource;
      var gain = currentBgmGain;
      if (gain && ctx) {
        gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE);
      }
      setTimeout(function() {
        try { src.stop(); } catch (e) {}
      }, FADE * 1000 + 20);
      currentBgmSource = null;
      currentBgmGain   = null;
    }
    currentBgmName = null;
  }

  /**
   * 根據遊戲情境自動切換 BGM（由 showScreen hook 呼叫）。
   * @param {string} situation  SITUATION_BGM 中的鍵名
   */
  function playBgmForSituation(situation) {
    var trackName = SITUATION_BGM[situation];
    if (trackName === undefined) return;   // 未定義的情境 → 不動作
    if (trackName === null)      { stopBgm(); return; }  // null → 靜音
    playBgm(trackName);
  }

  /**
   * 設定 BGM 主音量（即時生效，同時影響目前播放中的音軌）。
   * @param {number} vol  0.0（靜音）～ 1.0（最大）
   */
  function setBgmVolume(vol) {
    bgmMasterVolume = Math.max(0, Math.min(1, Number(vol) || 0));
    if (currentBgmGain && currentBgmName && BGM_TRACKS[currentBgmName]) {
      var baseVol = BGM_TRACKS[currentBgmName].volume || 1.0;
      currentBgmGain.gain.value = baseVol * bgmMasterVolume;
    }
  }


  // ============================================================
  //  進階 API（學員可選用）
  // ============================================================

  /**
   * 動態修改音軌的 loop 點（下次播放時生效）。
   * @param {string} trackName
   * @param {number} loopStart  秒
   * @param {number|null} loopEnd  秒，null = 播到結尾
   */
  function setTrackLoop(trackName, loopStart, loopEnd) {
    if (!BGM_TRACKS[trackName]) return;
    BGM_TRACKS[trackName].loopStart = loopStart;
    BGM_TRACKS[trackName].loopEnd   = loopEnd;
  }

  /**
   * 動態修改音軌的基礎音量（下次播放時生效）。
   * @param {string} trackName
   * @param {number} vol  0.0 ~ 1.0
   */
  function setTrackVolume(trackName, vol) {
    if (!BGM_TRACKS[trackName]) return;
    BGM_TRACKS[trackName].volume = Math.max(0, Math.min(1, vol));
    // 若目前正在播放這首，即時更新
    if (currentBgmName === trackName && currentBgmGain) {
      currentBgmGain.gain.value = BGM_TRACKS[trackName].volume * bgmMasterVolume;
    }
  }

  /**
   * 動態新增一個 BGM 音軌（不影響已播放的）。
   * @param {string} name
   * @param {{ src, volume, loopStart, loopEnd }} config
   */
  function addBgmTrack(name, config) {
    BGM_TRACKS[name] = config;
  }

  /**
   * 設定某情境對應的 BGM 音軌名稱。
   * @param {string} situation
   * @param {string|null} trackName  null = 靜音
   */
  function setSituationBgm(situation, trackName) {
    SITUATION_BGM[situation] = trackName;
  }

  // ── 公開 API ─────────────────────────────────────────────
  return {
    init             : init,
    // 音效
    playSfx          : playSfx,
    setSfxVolume     : setSfxVolume,
    setSfxEntryVolume: setSfxEntryVolume,
    // BGM
    playBgm          : playBgm,
    stopBgm          : stopBgm,
    playBgmForSituation : playBgmForSituation,
    setBgmVolume     : setBgmVolume,
    // 進階
    setTrackLoop     : setTrackLoop,
    setTrackVolume   : setTrackVolume,
    addBgmTrack      : addBgmTrack,
    setSituationBgm  : setSituationBgm,
    getCurrentBgm    : function () { return currentBgmName; }
  };

})();


// ============================================================
//  engine.js 定義了空的 playSound(name){}，此處替換為真正的實作。
// ============================================================
function playSound(name) {
  AudioSystem.playSfx(name);
}


// ============================================================
//  ── 接管 showScreen，自動切換 BGM ────────────────────────
//  每次切換畫面時根據 SITUATION_BGM 表決定播哪首 BGM。
//
//  特殊處理：
//    "screen-combat" → 若遇到 Final Boss，改播 "boss" BGM
//    "screen-dialogue" → 維持當前 BGM 不切換
// ============================================================
(function () {
  var _origShowScreen = showScreen;

  showScreen = function (screenId) {
    _origShowScreen(screenId);

    // 對話框不切換 BGM（維持目前氣氛）
    if (screenId === "screen-dialogue") return;

    // 取出去掉 "screen-" 前綴的情境名稱
    var situation = screenId.replace("screen-", "");

    // 戰鬥畫面：判斷是否為 Boss 戰
    if (situation === "combat") {
      if (typeof currentEnemy !== "undefined" &&
          currentEnemy !== null && currentEnemy.isFinalBoss) {
        situation = "boss";
      }
    }

    AudioSystem.playBgmForSituation(situation);
  };
})();


// ============================================================
//  ── 初始化（在所有 script 載入後、window.onload 之前）──────
// ============================================================
(function () {
  var _origOnload = window.onload;
  window.onload = function () {
    AudioSystem.init();
    if (_origOnload) _origOnload();
  };
})();
