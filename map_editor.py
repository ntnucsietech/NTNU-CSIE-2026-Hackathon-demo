#!/usr/bin/env python3
"""
迷宮 RPG 地圖編輯器 v2
針對 https://ntnucsietech.github.io/NTNU-CSIE-2026-Hackathon-demo/ 設計

地圖圖塊代碼說明：
  0  = 空地（可通行）
  1  = 牆壁
  2  = 寶箱（💰）
  3  = 敵人（👺）
  4  = 鎖（🔑）
  5  = 小遊戲（🌀）
  6  = 商店（🛒）
  7  = 玩家出生點（S）
  8  = 傳送門（⚡）  ← 兩個一組，需設定配對編號
  9  = 出口（E）     ← 可多個，需設定編號

傳送門規則：每組由兩格組成，共享同一個「配對 ID」（1, 2, 3, ...）
出口規則：可有多個，每個出口需要一個編號（1, 2, 3, ...）
鎖 vs 小遊戲：數量必須相等
玩家出生點：只能有一個
"""

import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog
import json
import copy
from collections import deque

# ── 常數 ─────────────────────────────────────────────────────────────────────

TILE_TYPES = {
    0: {"label": "空地",       "color": "#f5f0e8", "emoji": ""},
    1: {"label": "牆壁",       "color": "#3d3d3d", "emoji": "X"},
    2: {"label": "寶箱",       "color": "#ff9800", "emoji": "$"},
    3: {"label": "敵人",       "color": "#f44336", "emoji": "!"},
    4: {"label": "鎖",         "color": "#9c27b0", "emoji": "K"},
    5: {"label": "小遊戲",     "color": "#e91e63", "emoji": "G"},
    6: {"label": "商店",       "color": "#00bcd4", "emoji": "M"},
    7: {"label": "玩家出生點", "color": "#4caf50", "emoji": "S"},
    8: {"label": "傳送門",     "color": "#ff6f00", "emoji": "P"},
    9: {"label": "出口",       "color": "#2196f3", "emoji": "E"},
}

TILE_NEEDS_ID = {8, 9}  # 傳送門需配對 ID；出口需編號

CELL_SIZE = 38

# ── 預設地圖 ──────────────────────────────────────────────────────────────────

DEFAULT_MAP = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,7,0,0,1,0,0,0,0,1,0,0,0,0,0,0,1,0,0,1],
    [1,0,1,0,1,0,1,1,0,1,0,1,1,1,0,1,1,0,1,1],
    [1,0,1,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,3,1],
    [1,0,1,1,1,1,0,1,1,1,1,1,0,1,1,1,1,1,1,1],
    [1,0,0,0,0,1,0,0,0,0,3,0,0,0,0,1,4,0,0,1],
    [1,1,1,0,0,1,1,1,1,0,1,1,1,1,0,1,1,1,0,1],
    [1,0,0,0,6,0,0,0,1,0,0,0,0,1,0,0,0,0,0,1],
    [1,0,1,1,1,1,0,0,1,1,1,0,1,1,1,0,1,0,1,1],
    [1,0,1,2,0,0,0,3,0,0,0,0,0,0,1,0,1,0,0,1],
    [1,0,1,1,1,0,1,1,1,1,1,1,0,0,1,0,1,1,0,1],
    [1,0,0,0,1,0,0,0,1,5,0,0,0,0,1,0,0,1,0,1],
    [1,1,1,0,1,1,0,0,1,1,1,1,1,0,1,1,0,1,0,1],
    [1,0,0,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,9,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
]

DEFAULT_PORTALS: dict = {}
DEFAULT_EXITS: dict = {1: (13, 18)}


# ── 主程式 ────────────────────────────────────────────────────────────────────

class MapEditor:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("迷宮 RPG 地圖編輯器 v2 ── 師大資工黑客松")
        self.root.configure(bg="#1e1e2e")

        self.map_data: list[list[int]] = copy.deepcopy(DEFAULT_MAP)
        self.rows = len(self.map_data)
        self.cols = len(self.map_data[0])

        # portals[pair_id] = [[r1,c1], [r2,c2]]
        self.portals: dict[int, list] = copy.deepcopy(DEFAULT_PORTALS)
        # exits[exit_num] = (r, c)
        self.exits: dict[int, tuple] = copy.deepcopy(DEFAULT_EXITS)

        # enemy_names[(row, col)] = "怪物名稱"（空字串或不存在 = 隨機）
        self.enemy_names: dict[tuple, str] = {}
        # 各區域允許出現的怪物名稱清單（空 = 該 tier 全部怪物）
        self.zone_enemies: dict[str, list] = {"A": [], "B": [], "C": []}
        # 視野半徑（匯出 map.js 時帶入）
        self.vision_radius: int = 2

        self.current_tile = 1
        self.history: list[dict] = []
        self.drawing = False

        # StringVars 先建，select_tile 會用到
        self.status_var = tk.StringVar(value="就緒")
        self.info_var   = tk.StringVar()

        self._build_ui()
        self._draw_map()

    # ── Snapshot helpers ─────────────────────────────────────────────────────

    def _snapshot(self) -> dict:
        return {
            "map":          copy.deepcopy(self.map_data),
            "portals":      copy.deepcopy(self.portals),
            "exits":        copy.deepcopy(self.exits),
            "enemy_names":  copy.deepcopy(self.enemy_names),
            "zone_enemies": copy.deepcopy(self.zone_enemies),
        }

    def _restore(self, snap: dict):
        self.map_data    = snap["map"]
        self.portals     = snap["portals"]
        self.exits       = snap["exits"]
        self.enemy_names = snap.get("enemy_names", {})
        self.zone_enemies = snap.get("zone_enemies", {"A": [], "B": [], "C": []})
        self.rows = len(self.map_data)
        self.cols = len(self.map_data[0])

    def _on_zone_entry_change(self, zone: str, sv: tk.StringVar):
        """Entry 欄位變動時同步回 self.zone_enemies"""
        raw = sv.get()
        names = [n.strip() for n in raw.split(",") if n.strip()]
        self.zone_enemies[zone] = names

    def _sync_zone_entries(self):
        """從 self.zone_enemies 同步更新 Entry 欄位（載入地圖後呼叫）"""
        if not hasattr(self, "_zone_vars"):
            return
        for zone, sv in self._zone_vars.items():
            sv.set(",".join(self.zone_enemies.get(zone, [])))

    def _save_history(self):
        if len(self.history) > 50:
            self.history.pop(0)
        self.history.append(self._snapshot())

    # ── UI ───────────────────────────────────────────────────────────────────

    def _build_ui(self):
        # 頂部工具列
        toolbar = tk.Frame(self.root, bg="#313244", pady=6, padx=8)
        toolbar.pack(side=tk.TOP, fill=tk.X)

        btn_s = {"bg": "#45475a", "fg": "#cdd6f4", "relief": tk.FLAT,
                 "padx": 10, "pady": 4, "cursor": "hand2",
                 "font": ("Helvetica", 10)}

        tk.Button(toolbar, text="[開啟]",        command=self.load_map,       **btn_s).pack(side=tk.LEFT, padx=2)
        tk.Button(toolbar, text="[儲存 JSON]",  command=self.save_json,      **btn_s).pack(side=tk.LEFT, padx=2)
        tk.Button(toolbar, text="[複製 JS]",    command=self.copy_js,        **btn_s).pack(side=tk.LEFT, padx=2)
        tk.Button(toolbar, text="[匯出 map.js]",command=self.export_map_js,
                  **{**btn_s, "bg": "#a6e3a1", "fg": "#1e1e2e"}).pack(side=tk.LEFT, padx=2)
        tk.Button(toolbar, text="[還原]",        command=self.undo,           **btn_s).pack(side=tk.LEFT, padx=2)
        tk.Button(toolbar, text="[清空]",        command=self.clear_map,      **btn_s).pack(side=tk.LEFT, padx=2)
        tk.Button(toolbar, text="[調整大小]",    command=self.resize_dialog,  **btn_s).pack(side=tk.LEFT, padx=2)
        tk.Button(toolbar, text="[管理傳送門]",  command=self.portal_manager, **btn_s).pack(side=tk.LEFT, padx=2)
        tk.Button(toolbar, text="[管理出口]",    command=self.exit_manager,   **btn_s).pack(side=tk.LEFT, padx=2)
        tk.Button(toolbar, text="[驗證]",        command=self.validate_map,   **btn_s).pack(side=tk.LEFT, padx=2)

        # 主體
        main = tk.Frame(self.root, bg="#1e1e2e")
        main.pack(fill=tk.BOTH, expand=True)

        # 左側調色盤
        palette = tk.Frame(main, bg="#313244", width=175, padx=8, pady=8)
        palette.pack(side=tk.LEFT, fill=tk.Y)
        palette.pack_propagate(False)

        tk.Label(palette, text="圖塊種類", bg="#313244", fg="#cba6f7",
                 font=("Helvetica", 11, "bold")).pack(pady=(4, 8))

        self.tile_buttons: dict[int, tk.Button] = {}
        for tid, info in TILE_TYPES.items():
            hint = " [ID]" if tid == 8 else (" [#]" if tid == 9 else "")
            lbl = f"  [{info['emoji']}] {info['label']}{hint}"
            btn = tk.Button(
                palette, text=lbl,
                bg=info["color"],
                fg="white" if _is_dark(info["color"]) else "#1e1e2e",
                relief=tk.FLAT, anchor="w", padx=6, pady=5,
                font=("Helvetica", 10), cursor="hand2",
                command=lambda t=tid: self.select_tile(t),
            )
            btn.pack(fill=tk.X, pady=1)
            self.tile_buttons[tid] = btn

        tk.Label(palette,
                 text="[ID] = 需配對編號\n[#]  = 需出口編號",
                 bg="#313244", fg="#a6adc8",
                 font=("Helvetica", 8), justify=tk.LEFT).pack(pady=(8,0), anchor="w")

        self.select_tile(self.current_tile)

        # 中央畫布
        canvas_frame = tk.Frame(main, bg="#1e1e2e")
        canvas_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=8, pady=8)

        h_scroll = tk.Scrollbar(canvas_frame, orient=tk.HORIZONTAL)
        v_scroll = tk.Scrollbar(canvas_frame, orient=tk.VERTICAL)
        h_scroll.pack(side=tk.BOTTOM, fill=tk.X)
        v_scroll.pack(side=tk.RIGHT,  fill=tk.Y)

        self.canvas = tk.Canvas(
            canvas_frame, bg="#181825", cursor="crosshair",
            xscrollcommand=h_scroll.set, yscrollcommand=v_scroll.set,
            highlightthickness=0,
        )
        self.canvas.pack(fill=tk.BOTH, expand=True)
        h_scroll.config(command=self.canvas.xview)
        v_scroll.config(command=self.canvas.yview)

        self.canvas.bind("<ButtonPress-1>",   self._on_press)
        self.canvas.bind("<B1-Motion>",       self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", self._on_release)
        self.canvas.bind("<ButtonPress-3>",   self._on_right_press)
        self.canvas.bind("<B3-Motion>",       self._on_right_drag)

        # 右側資訊面板
        info_panel = tk.Frame(main, bg="#313244", width=195, padx=10, pady=10)
        info_panel.pack(side=tk.RIGHT, fill=tk.Y)
        info_panel.pack_propagate(False)

        tk.Label(info_panel, text="地圖資訊", bg="#313244", fg="#cba6f7",
                 font=("Helvetica", 11, "bold")).pack(pady=(4, 8))
        tk.Label(info_panel, textvariable=self.info_var, bg="#313244",
                 fg="#cdd6f4", font=("Courier", 9), justify=tk.LEFT,
                 wraplength=175).pack(anchor="w")

        tk.Label(info_panel, text="\n圖例", bg="#313244", fg="#cba6f7",
                 font=("Helvetica", 10, "bold")).pack(anchor="w")
        for tid, info in TILE_TYPES.items():
            row_f = tk.Frame(info_panel, bg="#313244")
            row_f.pack(fill=tk.X, pady=1)
            tk.Label(row_f, text="  ", bg=info["color"], width=2).pack(side=tk.LEFT)
            tk.Label(row_f, text=f" {tid}: {info['label']}", bg="#313244",
                     fg="#cdd6f4", font=("Courier", 9)).pack(side=tk.LEFT)

        # 視野半徑設定
        tk.Label(info_panel, text="\n視野半徑 (visionRadius)",
                 bg="#313244", fg="#cba6f7",
                 font=("Helvetica", 9, "bold")).pack(anchor="w", pady=(6, 0))
        self._vision_var = tk.IntVar(value=self.vision_radius)
        vr_box = tk.Spinbox(info_panel, textvariable=self._vision_var,
                            from_=1, to=10, width=5,
                            bg="#45475a", fg="#cdd6f4",
                            buttonbackground="#45475a", relief=tk.FLAT)
        vr_box.pack(anchor="w", padx=4, pady=2)
        self._vision_var.trace_add("write", lambda *_: setattr(self, "vision_radius", self._vision_var.get()))

        # 怪物生成池設定（各區域允許出現的怪物，逗號分隔）
        tk.Label(info_panel, text="\n各區怪物池（逗號分隔）",
                 bg="#313244", fg="#cba6f7",
                 font=("Helvetica", 9, "bold")).pack(anchor="w", pady=(6, 0))
        tk.Label(info_panel, text="空白 = 使用該 tier 所有怪物",
                 bg="#313244", fg="#a6adc8",
                 font=("Helvetica", 8)).pack(anchor="w")

        self._zone_vars: dict[str, tk.StringVar] = {}
        for zone, tier_hint in [("A", "tier1"), ("B", "tier2"), ("C", "tier3")]:
            row_f = tk.Frame(info_panel, bg="#313244")
            row_f.pack(fill=tk.X, pady=2)
            tk.Label(row_f, text=f"{zone} ({tier_hint}):", bg="#313244",
                     fg="#cdd6f4", font=("Courier", 8), width=10,
                     anchor="w").pack(side=tk.LEFT)
            sv = tk.StringVar(value=",".join(self.zone_enemies.get(zone, [])))
            self._zone_vars[zone] = sv
            entry = tk.Entry(row_f, textvariable=sv, bg="#45475a", fg="#cdd6f4",
                             insertbackground="#cdd6f4", relief=tk.FLAT,
                             font=("Courier", 8), width=16)
            entry.pack(side=tk.LEFT, padx=2)
            sv.trace_add("write", lambda *_, z=zone, s=sv: self._on_zone_entry_change(z, s))

        # 底部狀態列
        tk.Label(self.root, textvariable=self.status_var, bg="#181825", fg="#a6e3a1",
                 font=("Courier", 9), anchor="w", padx=6).pack(side=tk.BOTTOM, fill=tk.X)

        self._update_info()

    # ── 繪圖 ─────────────────────────────────────────────────────────────────

    def _draw_map(self):
        self.canvas.delete("all")
        cs = CELL_SIZE

        portal_pos: dict[tuple, int] = {}
        for pid, cells in self.portals.items():
            for cell in cells:
                portal_pos[tuple(cell)] = pid

        exit_pos: dict[tuple, int] = {}
        for eid, cell in self.exits.items():
            exit_pos[tuple(cell)] = eid

        for r in range(self.rows):
            for c in range(self.cols):
                self._draw_cell(r, c, portal_pos, exit_pos)

        self.canvas.config(scrollregion=(0, 0, self.cols * cs, self.rows * cs))
        self._update_info()

    def _draw_cell(self, r: int, c: int,
                   portal_pos: dict | None = None,
                   exit_pos:   dict | None = None):
        cs   = CELL_SIZE
        tid  = self.map_data[r][c]
        info = TILE_TYPES[tid]
        x0, y0 = c * cs, r * cs
        x1, y1 = x0 + cs, y0 + cs
        tag = f"cell_{r}_{c}"

        self.canvas.delete(tag)
        self.canvas.create_rectangle(
            x0, y0, x1, y1,
            fill=info["color"], outline="#181825", width=1, tags=tag,
        )
        fg = "white" if _is_dark(info["color"]) else "#1e1e2e"

        if tid == 1:
            self.canvas.create_line(x0, y0, x1, y1, fill="#666", width=1, tags=tag)
            self.canvas.create_line(x1, y0, x0, y1, fill="#666", width=1, tags=tag)

        elif tid == 8:
            if portal_pos is None:
                portal_pos = {tuple(rc): pid for pid, cells in self.portals.items()
                              for rc in cells}
            pid = portal_pos.get((r, c))
            label = f"P{pid}" if pid is not None else "P?"
            self.canvas.create_text(
                x0 + cs // 2, y0 + cs // 2,
                text=label, font=("Helvetica", 10, "bold"), fill=fg, tags=tag,
            )

        elif tid == 9:
            if exit_pos is None:
                exit_pos = {tuple(cell): eid for eid, cell in self.exits.items()}
            eid = exit_pos.get((r, c))
            label = f"E{eid}" if eid is not None else "E?"
            self.canvas.create_text(
                x0 + cs // 2, y0 + cs // 2,
                text=label, font=("Helvetica", 10, "bold"), fill=fg, tags=tag,
            )

        elif tid == 3:
            # 敵人格：有指定怪物時顯示名稱前 3 字，否則顯示 !
            ename = self.enemy_names.get((r, c), "")
            if ename:
                self.canvas.create_text(
                    x0 + cs // 2, y0 + cs // 2,
                    text=info["emoji"], font=("Helvetica", 12, "bold"), fill=fg, tags=tag,
                )
                self.canvas.create_text(
                    x0 + cs - 2, y0 + cs - 2,
                    text=ename[:3], font=("Courier", 7), fill="white",
                    anchor="se", tags=tag,
                )
            else:
                self.canvas.create_text(
                    x0 + cs // 2, y0 + cs // 2,
                    text=info["emoji"], font=("Helvetica", 12, "bold"), fill=fg, tags=tag,
                )

        elif info["emoji"]:
            self.canvas.create_text(
                x0 + cs // 2, y0 + cs // 2,
                text=info["emoji"], font=("Helvetica", 12, "bold"), fill=fg, tags=tag,
            )

    # ── 滑鼠事件 ─────────────────────────────────────────────────────────────

    def _cell_from_event(self, event):
        cx = self.canvas.canvasx(event.x)
        cy = self.canvas.canvasy(event.y)
        c = int(cx // CELL_SIZE)
        r = int(cy // CELL_SIZE)
        if 0 <= r < self.rows and 0 <= c < self.cols:
            return r, c
        return None

    def _on_press(self, event):
        self.drawing = True
        self._save_history()
        pos = self._cell_from_event(event)
        if pos:
            self._place_tile(*pos, ask=True)

    def _on_drag(self, event):
        if not self.drawing:
            return
        pos = self._cell_from_event(event)
        if pos:
            # 拖曳時不彈出對話框（傳送門/出口直接放，之後可用管理視窗補齊）
            self._place_tile(*pos, ask=False)

    def _on_release(self, event):
        self.drawing = False

    def _on_right_press(self, event):
        self._save_history()
        pos = self._cell_from_event(event)
        if pos:
            self._erase(*pos)

    def _on_right_drag(self, event):
        pos = self._cell_from_event(event)
        if pos:
            self._erase(*pos)

    # ── 圖塊放置 ─────────────────────────────────────────────────────────────

    def _place_tile(self, r: int, c: int, ask: bool = True):
        tid     = self.current_tile
        old_tid = self.map_data[r][c]

        if old_tid == tid:
            return

        self._remove_special(r, c, old_tid)

        if tid == 8 and ask:
            self._place_portal(r, c)
        elif tid == 9 and ask:
            self._place_exit(r, c)
        elif tid == 3 and ask:
            self._place_enemy(r, c)
        else:
            self._set_tile_raw(r, c, tid)

    def _set_tile_raw(self, r: int, c: int, tid: int):
        self.map_data[r][c] = tid
        self._draw_cell(r, c)
        self.status_var.set(f"設定 ({r},{c}) -> {TILE_TYPES[tid]['label']}")
        self._update_info()

    def _erase(self, r: int, c: int):
        old_tid = self.map_data[r][c]
        self._remove_special(r, c, old_tid)
        self._set_tile_raw(r, c, 0)

    def _remove_special(self, r: int, c: int, tid: int):
        """清除傳送門、出口或怪物指定的附加資料，並重繪受影響的格子"""
        if tid == 3:
            self.enemy_names.pop((r, c), None)
        elif tid == 8:
            to_del = [pid for pid, cells in self.portals.items()
                      if any(list(rc) == [r, c] or tuple(rc) == (r, c) for rc in cells)]
            for pid in to_del:
                # 重繪同組另一格
                for rc in self.portals[pid]:
                    if tuple(rc) != (r, c):
                        self.map_data[rc[0]][rc[1]] = 0
                        self._draw_cell(rc[0], rc[1])
                del self.portals[pid]
        elif tid == 9:
            to_del = [eid for eid, cell in self.exits.items()
                      if tuple(cell) == (r, c)]
            for eid in to_del:
                del self.exits[eid]

    # ── 傳送門放置對話框 ──────────────────────────────────────────────────────

    def _place_portal(self, r: int, c: int):
        incomplete = {pid: cells for pid, cells in self.portals.items() if len(cells) < 2}
        new_id = max(self.portals.keys(), default=0) + 1

        dlg = tk.Toplevel(self.root)
        dlg.title("設定傳送門配對")
        dlg.configure(bg="#313244")
        dlg.resizable(False, False)
        dlg.grab_set()
        dlg.transient(self.root)

        tk.Label(dlg, text=f"在格子 ({r}, {c}) 放置傳送門",
                 bg="#313244", fg="#cba6f7",
                 font=("Helvetica", 11, "bold")).pack(padx=20, pady=(14, 4))
        tk.Label(dlg,
                 text="每組傳送門需恰好兩格，共享同一配對 ID。",
                 bg="#313244", fg="#a6adc8",
                 font=("Helvetica", 9)).pack(padx=20, pady=(0, 8))

        chosen = tk.IntVar(value=list(incomplete.keys())[0] if incomplete else new_id)

        frame = tk.LabelFrame(dlg, text="選擇配對 ID",
                              bg="#313244", fg="#cdd6f4",
                              font=("Helvetica", 10))
        frame.pack(padx=20, pady=4, fill=tk.X)

        if incomplete:
            tk.Label(frame, text="配對到未完成的組：",
                     bg="#313244", fg="#a6e3a1",
                     font=("Helvetica", 9)).pack(anchor="w", padx=6, pady=(4, 0))
            for pid, cells in incomplete.items():
                tk.Radiobutton(frame,
                               text=f"ID {pid}  (已有 {len(cells)} 格，位置：{[tuple(c) for c in cells]})",
                               variable=chosen, value=pid,
                               bg="#313244", fg="#cdd6f4",
                               selectcolor="#45475a",
                               font=("Helvetica", 10),
                               activebackground="#45475a").pack(anchor="w", padx=12)

        tk.Label(frame, text=f"新建配對：",
                 bg="#313244", fg="#f9e2af",
                 font=("Helvetica", 9)).pack(anchor="w", padx=6, pady=(6, 0))
        tk.Radiobutton(frame,
                       text=f"新建 ID {new_id}",
                       variable=chosen, value=new_id,
                       bg="#313244", fg="#cdd6f4",
                       selectcolor="#45475a",
                       font=("Helvetica", 10),
                       activebackground="#45475a").pack(anchor="w", padx=12, pady=(0, 6))

        result = {"ok": False}

        def confirm():
            result["ok"] = True
            dlg.destroy()

        btn_row = tk.Frame(dlg, bg="#313244")
        btn_row.pack(pady=12)
        tk.Button(btn_row, text="確定", command=confirm,
                  bg="#cba6f7", fg="#1e1e2e", relief=tk.FLAT,
                  padx=20, pady=4).pack(side=tk.LEFT, padx=8)
        tk.Button(btn_row, text="取消", command=dlg.destroy,
                  bg="#45475a", fg="#cdd6f4", relief=tk.FLAT,
                  padx=20, pady=4).pack(side=tk.LEFT, padx=8)

        dlg.wait_window()

        if not result["ok"]:
            return

        pid = chosen.get()
        if pid not in self.portals:
            self.portals[pid] = []

        if len(self.portals[pid]) >= 2:
            messagebox.showwarning("傳送門",
                f"配對 ID {pid} 已滿（共兩格）。\n請選其他 ID 或先刪除該組。")
            return

        self.map_data[r][c] = 8
        self.portals[pid].append([r, c])
        self._draw_map()
        n = len(self.portals[pid])
        if n == 1:
            self.status_var.set(f"傳送門 ({r},{c}) -> 配對 ID {pid}（等待第 2 格）")
        else:
            self.status_var.set(f"傳送門 ({r},{c}) -> 配對 ID {pid} 完成！")

    # ── 出口放置對話框 ────────────────────────────────────────────────────────

    def _place_exit(self, r: int, c: int):
        existing = sorted(self.exits.keys())
        new_id = max(existing, default=0) + 1

        ans = simpledialog.askinteger(
            "設定出口編號",
            f"格子 ({r},{c}) 的出口編號\n（現有：{existing}，建議：{new_id}）：",
            parent=self.root, minvalue=1, maxvalue=99, initialvalue=new_id,
        )
        if ans is None:
            return

        if ans in self.exits:
            old = self.exits[ans]
            if not messagebox.askyesno("覆蓋確認",
                    f"出口編號 {ans} 已存在於 ({old[0]},{old[1]})，要覆蓋嗎？",
                    parent=self.root):
                return
            self.map_data[old[0]][old[1]] = 0
            del self.exits[ans]

        self.map_data[r][c] = 9
        self.exits[ans] = (r, c)
        self._draw_map()
        self.status_var.set(f"出口 ({r},{c}) -> 編號 {ans}")

    # ── 敵人格子怪物指定 ──────────────────────────────────────────────────────

    def _place_enemy(self, r: int, c: int):
        self._set_tile_raw(r, c, 3)
        name = simpledialog.askstring(
            "指定怪物（選填）",
            f"格子 ({r}, {c}) 觸發戰鬥時要出現哪隻怪物？\n"
            "（留空 = 從 data.js 的 enemies 隨機選取）\n"
            "名稱需與 data.js 中 enemies 陣列的 name 欄位一致。",
            parent=self.root,
        )
        if name and name.strip():
            self.enemy_names[(r, c)] = name.strip()
            self.status_var.set(f"敵人 ({r},{c}) -> 指定「{name.strip()}」")
        else:
            self.enemy_names.pop((r, c), None)
            self.status_var.set(f"敵人 ({r},{c}) -> 隨機")
        self._draw_cell(r, c)

    # ── 傳送門管理視窗 ────────────────────────────────────────────────────────

    def portal_manager(self):
        dlg = tk.Toplevel(self.root)
        dlg.title("傳送門管理")
        dlg.configure(bg="#313244")
        dlg.resizable(True, True)
        dlg.grab_set()

        tk.Label(dlg, text="傳送門配對清單",
                 bg="#313244", fg="#cba6f7",
                 font=("Helvetica", 11, "bold")).pack(padx=20, pady=(14, 4))
        tk.Label(dlg,
                 text="每組必須恰好兩格。可刪除整組（格子會清為空地）。",
                 bg="#313244", fg="#a6adc8",
                 font=("Helvetica", 9)).pack(padx=20, pady=(0, 8))

        list_frame = tk.Frame(dlg, bg="#313244")
        list_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=4)

        def refresh():
            for w in list_frame.winfo_children():
                w.destroy()
            if not self.portals:
                tk.Label(list_frame, text="（尚無傳送門）",
                         bg="#313244", fg="#a6adc8").pack()
                return
            for pid in sorted(self.portals.keys()):
                cells  = self.portals[pid]
                status = "✅ 完整" if len(cells) == 2 else "❌ 未配對（需再加 1 格）"
                cell_str = "  ".join(f"({rc[0]},{rc[1]})" for rc in cells)
                row_f = tk.Frame(list_frame, bg="#3d3d55", relief=tk.GROOVE, bd=1)
                row_f.pack(fill=tk.X, pady=3, ipady=2, ipadx=4)
                tk.Label(row_f,
                         text=f"ID {pid:>2} | {cell_str:<22} | {status}",
                         bg="#3d3d55", fg="#cdd6f4",
                         font=("Courier", 10), anchor="w").pack(side=tk.LEFT, padx=4)

                def del_portal(p=pid):
                    self._save_history()
                    for rc in self.portals[p]:
                        self.map_data[rc[0]][rc[1]] = 0
                    del self.portals[p]
                    self._draw_map()
                    refresh()

                tk.Button(row_f, text="刪除此組", command=del_portal,
                          bg="#f38ba8", fg="#1e1e2e", relief=tk.FLAT,
                          padx=8).pack(side=tk.RIGHT, padx=4)

        refresh()
        tk.Button(dlg, text="關閉", command=dlg.destroy,
                  bg="#45475a", fg="#cdd6f4", relief=tk.FLAT,
                  padx=24, pady=4).pack(pady=12)

    # ── 出口管理視窗 ──────────────────────────────────────────────────────────

    def exit_manager(self):
        dlg = tk.Toplevel(self.root)
        dlg.title("出口管理")
        dlg.configure(bg="#313244")
        dlg.resizable(True, True)
        dlg.grab_set()

        tk.Label(dlg, text="出口清單",
                 bg="#313244", fg="#cba6f7",
                 font=("Helvetica", 11, "bold")).pack(padx=20, pady=(14, 4))

        list_frame = tk.Frame(dlg, bg="#313244")
        list_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=4)

        def refresh():
            for w in list_frame.winfo_children():
                w.destroy()
            if not self.exits:
                tk.Label(list_frame, text="（尚無出口）",
                         bg="#313244", fg="#a6adc8").pack()
                return
            for eid in sorted(self.exits.keys()):
                r, c = self.exits[eid]
                row_f = tk.Frame(list_frame, bg="#3d3d55", relief=tk.GROOVE, bd=1)
                row_f.pack(fill=tk.X, pady=3, ipady=2, ipadx=4)
                tk.Label(row_f, text=f"出口 #{eid:>2}  位置 ({r},{c})",
                         bg="#3d3d55", fg="#cdd6f4",
                         font=("Courier", 10), anchor="w").pack(side=tk.LEFT, padx=4)

                def del_exit(e=eid):
                    self._save_history()
                    rr, cc = self.exits[e]
                    self.map_data[rr][cc] = 0
                    del self.exits[e]
                    self._draw_map()
                    refresh()

                def rename_exit(e=eid):
                    rr, cc = self.exits[e]
                    new_id = simpledialog.askinteger(
                        "重新編號",
                        f"出口 ({rr},{cc}) 的新編號：",
                        parent=dlg, minvalue=1, maxvalue=99, initialvalue=e,
                    )
                    if new_id is None or new_id == e:
                        return
                    if new_id in self.exits:
                        messagebox.showwarning("衝突", f"編號 {new_id} 已被使用。", parent=dlg)
                        return
                    self._save_history()
                    self.exits[new_id] = self.exits.pop(e)
                    self._draw_map()
                    refresh()

                tk.Button(row_f, text="改號", command=rename_exit,
                          bg="#f9e2af", fg="#1e1e2e", relief=tk.FLAT, padx=8
                          ).pack(side=tk.RIGHT, padx=2)
                tk.Button(row_f, text="刪除", command=del_exit,
                          bg="#f38ba8", fg="#1e1e2e", relief=tk.FLAT, padx=8
                          ).pack(side=tk.RIGHT, padx=2)

        refresh()
        tk.Button(dlg, text="關閉", command=dlg.destroy,
                  bg="#45475a", fg="#cdd6f4", relief=tk.FLAT,
                  padx=24, pady=4).pack(pady=12)

    # ── 選擇圖塊 ─────────────────────────────────────────────────────────────

    def select_tile(self, tid: int):
        for t, btn in self.tile_buttons.items():
            btn.config(relief=tk.RIDGE if t == tid else tk.FLAT,
                       bd=3 if t == tid else 0)
        self.current_tile = tid
        self.status_var.set(f"選取：{TILE_TYPES[tid]['label']}")

    # ── Undo / Clear ─────────────────────────────────────────────────────────

    def undo(self):
        if not self.history:
            messagebox.showinfo("還原", "沒有可還原的操作。")
            return
        self._restore(self.history.pop())
        self._draw_map()
        self.status_var.set("已還原上一步")

    def clear_map(self):
        if not messagebox.askyesno("清空確認",
                "確定要清空整張地圖（含傳送門/出口資料）嗎？"):
            return
        self._save_history()
        self.map_data = [[0] * self.cols for _ in range(self.rows)]
        self.portals.clear()
        self.exits.clear()
        self._draw_map()
        self.status_var.set("地圖已清空")

    # ── 調整大小 ──────────────────────────────────────────────────────────────

    def resize_dialog(self):
        dlg = tk.Toplevel(self.root)
        dlg.title("調整地圖大小")
        dlg.configure(bg="#313244")
        dlg.resizable(False, False)
        dlg.grab_set()

        tk.Label(dlg, text="列數：", bg="#313244", fg="#cdd6f4"
                 ).grid(row=0, column=0, padx=12, pady=8, sticky="e")
        row_var = tk.IntVar(value=self.rows)
        tk.Spinbox(dlg, textvariable=row_var, from_=5, to=60, width=6
                   ).grid(row=0, column=1, padx=12)

        tk.Label(dlg, text="欄數：", bg="#313244", fg="#cdd6f4"
                 ).grid(row=1, column=0, padx=12, pady=8, sticky="e")
        col_var = tk.IntVar(value=self.cols)
        tk.Spinbox(dlg, textvariable=col_var, from_=5, to=80, width=6
                   ).grid(row=1, column=1, padx=12)

        def apply():
            nr = row_var.get()
            nc = col_var.get()
            self._save_history()
            new_map = [
                [self.map_data[r][c] if r < self.rows and c < self.cols else 1
                 for c in range(nc)]
                for r in range(nr)
            ]
            self.portals = {pid: cells for pid, cells in self.portals.items()
                            if all(rc[0] < nr and rc[1] < nc for rc in cells)}
            self.exits   = {eid: cell for eid, cell in self.exits.items()
                            if cell[0] < nr and cell[1] < nc}
            self.map_data = new_map
            self.rows, self.cols = nr, nc
            self._draw_map()
            dlg.destroy()
            self.status_var.set(f"地圖調整為 {nr}x{nc}")

        tk.Button(dlg, text="套用", command=apply,
                  bg="#cba6f7", fg="#1e1e2e", relief=tk.FLAT,
                  padx=20, pady=6).grid(row=2, column=0, columnspan=2, pady=12)

    # ── 地圖資訊 ─────────────────────────────────────────────────────────────

    def _update_info(self):
        counts = {tid: 0 for tid in TILE_TYPES}
        for row in self.map_data:
            for tid in row:
                if tid in counts:
                    counts[tid] += 1

        lines = [f"大小：{self.rows} x {self.cols}", ""]
        for tid, info in TILE_TYPES.items():
            n = counts[tid]
            if n > 0:
                lines.append(f"[{info['emoji'] or ' '}] {info['label']}：{n}")

        lines += [
            "",
            f"傳送門配對：{len(self.portals)} 組",
        ]
        complete   = sum(1 for c in self.portals.values() if len(c) == 2)
        incomplete = len(self.portals) - complete
        if incomplete:
            lines.append(f"  !! 未完成：{incomplete} 組")
        lines.append(f"出口：{len(self.exits)} 個")
        self.info_var.set("\n".join(lines))

    # ── 驗證 ─────────────────────────────────────────────────────────────────

    def _collect_validation_issues(self) -> tuple:
        """回傳 (errors, warnings) 兩個清單，供 validate_map 與 export_map_js 共用"""
        errors: list[str]   = []
        warnings: list[str] = []

        player_cells   = []
        portal_cells   = []
        exit_cells     = []
        lock_cells     = []
        minigame_cells = []

        for r in range(self.rows):
            for c in range(self.cols):
                tid = self.map_data[r][c]
                if tid == 7: player_cells.append((r, c))
                if tid == 8: portal_cells.append((r, c))
                if tid == 9: exit_cells.append((r, c))
                if tid == 4: lock_cells.append((r, c))
                if tid == 5: minigame_cells.append((r, c))

        # ── 規則 1：玩家出生點唯一 ────────────────────────────────────────────
        if len(player_cells) == 0:
            errors.append("玩家出生點（圖塊 7）：找不到，請放置一個。")
        elif len(player_cells) > 1:
            errors.append(
                f"玩家出生點只能有一個，目前有 {len(player_cells)} 個：\n  " +
                "  ".join(f"({r},{c})" for r, c in player_cells)
            )

        # ── 規則 2：出口需有編號 ──────────────────────────────────────────────
        if len(exit_cells) == 0:
            errors.append("出口（圖塊 9）：找不到，請放置至少一個。")
        else:
            registered = {tuple(v) for v in self.exits.values()}
            unregistered = [(r, c) for r, c in exit_cells if (r, c) not in registered]
            if unregistered:
                errors.append(
                    "以下出口格未設定編號（請重新放置或用「管理出口」設定）：\n  " +
                    "  ".join(f"({r},{c})" for r, c in unregistered)
                )
            phantom = [eid for eid, cell in self.exits.items()
                       if self.map_data[cell[0]][cell[1]] != 9]
            if phantom:
                warnings.append(
                    f"出口編號 {phantom} 所在的格子已不是出口圖塊，"
                    "建議在「管理出口」中刪除。"
                )

        # ── 規則 3：傳送門必須兩個一組 ───────────────────────────────────────
        reg_cells = {tuple(rc) for cells in self.portals.values() for rc in cells}
        unreg_portals = [(r, c) for r, c in portal_cells if (r, c) not in reg_cells]
        if unreg_portals:
            errors.append(
                "以下傳送門格未登記配對（請重新放置）：\n  " +
                "  ".join(f"({r},{c})" for r, c in unreg_portals)
            )

        incomplete_pairs = [(pid, cells) for pid, cells in self.portals.items()
                            if len(cells) != 2]
        if incomplete_pairs:
            details = "\n  ".join(
                f"ID {pid}：{len(cells)} 格  {[tuple(x) for x in cells]}"
                for pid, cells in incomplete_pairs
            )
            errors.append(
                "傳送門配對不完整（每組必須恰好兩格）：\n  " + details
            )

        # 同一格重複登記
        seen: dict[tuple, int] = {}
        for pid, cells in self.portals.items():
            for rc in cells:
                key = tuple(rc)
                if key in seen:
                    errors.append(
                        f"格子 {key} 同時屬於配對 ID {seen[key]} 和 {pid}，請修正。"
                    )
                seen[key] = pid

        # ── 規則 4：鎖 == 小遊戲 ─────────────────────────────────────────────
        n_lock     = len(lock_cells)
        n_minigame = len(minigame_cells)
        if n_lock != n_minigame:
            errors.append(
                f"鎖（圖塊 4）數量（{n_lock}）與小遊戲（圖塊 5）數量（{n_minigame}）不相等。"
            )

        # ── 規則 5：連通性（BFS，傳送門視為通道）─────────────────────────────
        if player_cells and exit_cells:
            start = player_cells[0]
            reachable = self._bfs_with_portals(start)
            unreachable = [(r, c) for r, c in exit_cells if (r, c) not in reachable]
            if unreachable:
                errors.append(
                    "以下出口無法從玩家出生點抵達（地圖不連通）：\n  " +
                    "  ".join(f"({r},{c})" for r, c in unreachable)
                )

        return errors, warnings

    def validate_map(self):
        errors, warnings = self._collect_validation_issues()

        # 為了在「通過」時顯示統計，重新掃描一次（輕量）
        n_exit = sum(1 for row in self.map_data for t in row if t == 9)
        n_portal = sum(1 for row in self.map_data for t in row if t == 8)
        n_lock = sum(1 for row in self.map_data for t in row if t == 4)

        parts: list[str] = []
        if errors:
            parts.append("【錯誤】（必須修正）\n" +
                         "\n".join(f"  ❌ {e}" for e in errors))
        if warnings:
            parts.append("【警告】（建議檢查）\n" +
                         "\n".join(f"  ⚠ {w}" for w in warnings))
        if not errors and not warnings:
            parts.append(
                "驗證全部通過！\n\n"
                f"  玩家出生點：1 個\n"
                f"  出口：{n_exit} 個（均已編號）\n"
                f"  傳送門：{len(self.portals)} 組（共 {n_portal} 格）\n"
                f"  鎖 = 小遊戲：各 {n_lock} 個\n"
                f"  所有出口皆可由玩家抵達"
            )

        icon = "✅ 地圖驗證結果" if not errors else "❌ 地圖驗證結果"
        messagebox.showinfo(icon, "\n\n".join(parts))

    def _bfs_with_portals(self, start: tuple) -> set:
        teleport: dict[tuple, tuple] = {}
        for cells in self.portals.values():
            if len(cells) == 2:
                a, b = tuple(cells[0]), tuple(cells[1])
                teleport[a] = b
                teleport[b] = a

        visited = {start}
        queue   = deque([start])
        while queue:
            r, c = queue.popleft()
            if (r, c) in teleport:
                dest = teleport[(r, c)]
                if dest not in visited:
                    visited.add(dest)
                    queue.append(dest)
            for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nr, nc = r + dr, c + dc
                if (0 <= nr < self.rows and 0 <= nc < self.cols
                        and (nr, nc) not in visited
                        and self.map_data[nr][nc] != 1):
                    visited.add((nr, nc))
                    queue.append((nr, nc))
        return visited

    # ── 檔案操作 ─────────────────────────────────────────────────────────────

    def save_json(self):
        path = filedialog.asksaveasfilename(
            defaultextension=".json",
            filetypes=[("JSON 檔案", "*.json"), ("所有檔案", "*.*")],
            title="儲存地圖",
        )
        if not path:
            return
        payload = {
            "rows":         self.rows,
            "cols":         self.cols,
            "tileKey":      {str(k): v["label"] for k, v in TILE_TYPES.items()},
            "map":          self.map_data,
            "portals":      {str(k): v for k, v in self.portals.items()},
            "exits":        {str(k): list(v) for k, v in self.exits.items()},
            "enemy_names":  {f"{r},{c}": name for (r, c), name in self.enemy_names.items()},
            "zone_enemies": self.zone_enemies,
            "visionRadius": self.vision_radius,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        messagebox.showinfo("儲存成功", f"地圖已儲存至：\n{path}")
        self.status_var.set(f"已儲存：{path}")

    def load_map(self):
        path = filedialog.askopenfilename(
            filetypes=[("JSON 檔案", "*.json"), ("所有檔案", "*.*")],
            title="開啟地圖",
        )
        if not path:
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                payload = json.load(f)
            self._save_history()
            if isinstance(payload, list):
                self.map_data    = payload
                self.portals.clear()
                self.exits.clear()
                self.enemy_names.clear()
                self.zone_enemies = {"A": [], "B": [], "C": []}
            else:
                self.map_data    = payload["map"]
                self.portals     = {int(k): v for k, v in payload.get("portals", {}).items()}
                self.exits       = {int(k): tuple(v) for k, v in payload.get("exits", {}).items()}
                self.enemy_names = {
                    tuple(int(x) for x in k.split(",")): v
                    for k, v in payload.get("enemy_names", {}).items()
                }
                ze = payload.get("zone_enemies", {"A": [], "B": [], "C": []})
                self.zone_enemies = {z: list(ze.get(z, [])) for z in ("A", "B", "C")}
                vr = payload.get("visionRadius", 2)
                self.vision_radius = vr
                if hasattr(self, "_vision_var"):
                    self._vision_var.set(vr)
            self.rows = len(self.map_data)
            self.cols = len(self.map_data[0])
            self._sync_zone_entries()
            self._draw_map()
            self.status_var.set(f"已載入：{path}")
        except Exception as e:
            messagebox.showerror("載入失敗", str(e))

    def _build_map_js_content(self) -> str:
        """產生完整 map.js 內容字串（tile 7 出生點轉換為 0）"""
        player_start = {"x": 1, "y": 1}
        export_map = []
        for r, row in enumerate(self.map_data):
            new_row = []
            for c, tid in enumerate(row):
                if tid == 7:
                    player_start = {"x": c, "y": r}
                    new_row.append(0)
                else:
                    new_row.append(tid)
            export_map.append(new_row)

        lines = [
            "// =========================================================",
            "// map.js  ── 地圖設定檔（由地圖編輯器 map_editor_2.py 匯出）",
            "// 使用方式：直接把此檔案的全部內容貼上，取代原本的 map.js",
            "// =========================================================",
            "",
            "var MAP_TILE = {",
            "  EMPTY: 0, WALL: 1, CHEST: 2, ENEMY: 3, DOOR: 4,",
            "  MINI_GAME: 5, SHOP: 6, PORTAL: 8, FINAL_BOSS: 9",
            "};",
            "",
            "var mapGrid = [",
        ]
        for i, row in enumerate(export_map):
            comma = "," if i < len(export_map) - 1 else ""
            lines.append("  " + str(row) + comma)
        lines.append("];")

        lines += [
            "",
            f"var playerStart = {{ x: {player_start['x']}, y: {player_start['y']} }};",
            "",
            f"var visionRadius = {self.vision_radius};",
            "",
            "var portals = {",
        ]
        for pid, cells in sorted(self.portals.items()):
            lines.append(f"  {pid}: {[list(c) for c in cells]},")
        lines.append("};")

        lines += ["", "var tileEnemyMap = {"]
        for (r, c), name in sorted(self.enemy_names.items()):
            escaped = name.replace('"', '\\"')
            lines.append(f'  "{r},{c}": "{escaped}",')
        lines.append("};")

        lines += [
            "",
            "// 各區域允許出現的怪物名稱（空陣列 = 該 tier 所有怪物）",
            "// A 區 → data.js enemies（tier1），B 區 → enemiesTier2，C 區 → enemiesTier3",
            "var zoneEnemies = {",
        ]
        for zone in ("A", "B", "C"):
            names = self.zone_enemies.get(zone, [])
            if names:
                escaped_names = ['"' + n.replace('"', '\\"') + '"' for n in names]
                lines.append(f"  {zone}: [{', '.join(escaped_names)}],")
            else:
                lines.append(f"  {zone}: [],")
        lines.append("};")

        return "\n".join(lines)

    def export_map_js(self):
        # 先驗證
        errors, warnings = self._collect_validation_issues()
        if errors:
            messagebox.showerror("驗證失敗（無法匯出）",
                "請先修正以下錯誤：\n\n" + "\n".join(f"❌ {e}" for e in errors))
            return
        if warnings:
            proceed = messagebox.askyesno("驗證警告",
                "地圖有以下警告，是否仍要繼續匯出？\n\n" +
                "\n".join(f"⚠ {w}" for w in warnings))
            if not proceed:
                return

        path = filedialog.asksaveasfilename(
            defaultextension=".js",
            filetypes=[("JavaScript 檔案", "*.js"), ("所有檔案", "*.*")],
            initialfile="map.js",
            title="匯出 map.js",
        )
        if not path:
            return

        content = self._build_map_js_content()
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

        messagebox.showinfo("匯出成功",
            f"map.js 已儲存至：\n{path}\n\n"
            "請將此檔案放到遊戲資料夾，\n"
            "取代原本的 map.js 即可。\n\n"
            "（如需手動複製內容，請按工具列的 [複製 JS]）")
        self.status_var.set(f"已匯出 map.js：{path}")

    def copy_js(self):
        js_str = self._build_map_js_content()
        self.root.clipboard_clear()
        self.root.clipboard_append(js_str)
        messagebox.showinfo("已複製",
            "已複製完整 map.js 內容到剪貼簿！\n"
            "請開啟 map.js，全選後貼上即可。")


# ── 工具函式 ──────────────────────────────────────────────────────────────────

def _is_dark(hex_color: str) -> bool:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return 0.299 * r + 0.587 * g + 0.114 * b < 128


# ── 入口 ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    root = tk.Tk()
    root.geometry("1160x740")
    root.minsize(900, 560)
    app = MapEditor(root)
    root.mainloop()
