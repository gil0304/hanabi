import type { FireworkStore } from "./types";
import { createLocalStore } from "./local";
import { createSupabaseStore } from "./supabase";

/**
 * 環境変数でバックエンドを自動選択する (仕様 §37):
 * NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY が両方あれば Supabase、無ければローカル。
 */

let store: FireworkStore | null = null;

export function getStore(): FireworkStore {
  if (store) return store;
  // NEXT_PUBLIC_* はビルド時にインライン展開されるためリテラル参照が必要
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  store = url && key ? createSupabaseStore() : createLocalStore();
  return store;
}
