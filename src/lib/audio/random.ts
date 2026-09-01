/** 乱数ユーティリティ (音の仕様 §36-38: 毎回すこし揺らぐこと) */

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

export function chance(p: number): boolean {
  return Math.random() < p;
}

/** 乗算ゆらぎ: 1 ± amount */
export function jitter(amount: number): number {
  return 1 + (Math.random() * 2 - 1) * amount;
}
