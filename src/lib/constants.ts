/** 花火として明るく見える色に限定したパレット (仕様 §11) */
export const FIREWORK_COLORS: { name: string; hex: string }[] = [
  { name: "赤", hex: "#ff4d5e" },
  { name: "オレンジ", hex: "#ff9a3d" },
  { name: "黄色", hex: "#ffd94d" },
  { name: "緑", hex: "#5dff8f" },
  { name: "水色", hex: "#5ddfff" },
  { name: "青", hex: "#5d8bff" },
  { name: "紫", hex: "#b06bff" },
  { name: "ピンク", hex: "#ff6bd6" },
  { name: "白", hex: "#fff6e8" },
];

export const DEFAULT_COLOR = FIREWORK_COLORS[0].hex;

/** 描画キャンバスの内部解像度 (仕様 §9) */
export const CANVAS_SIZE = 512;
