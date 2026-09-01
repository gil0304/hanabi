"use client";

import { useCallback, useEffect, useState } from "react";
import type { FireworkRecord, FireworkStatus } from "@/types";
import { getStore } from "@/lib/store/client";
import FireworkCard from "@/components/admin/FireworkCard";
import styles from "@/components/admin/admin.module.css";

export default function FireworkList() {
  // null = 読み込み中
  const [items, setItems] = useState<FireworkRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await getStore().listAll();
      list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      setItems(list);
      setError(null);
    } catch {
      setError("投稿一覧を読み込めませんでした");
      setItems((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = getStore().subscribeNewFireworks((fw) => {
        setItems((prev) => {
          if (!prev) return [fw];
          if (prev.some((f) => f.id === fw.id)) return prev;
          return [fw, ...prev];
        });
      });
    } catch {
      // 購読に失敗しても一覧表示 (再読み込み) は使えるので握りつぶす
    }
    return () => {
      unsubscribe?.();
    };
  }, [load]);

  const handleSetStatus = useCallback(
    async (id: string, next: FireworkStatus) => {
      let prevStatus: FireworkStatus | undefined;
      // 楽観的更新: 先に UI を切り替える
      setItems((cur) => {
        if (!cur) return cur;
        return cur.map((f) => {
          if (f.id !== id) return f;
          prevStatus = f.status;
          return { ...f, status: next };
        });
      });
      try {
        await getStore().setStatus(id, next);
        setError(null);
      } catch {
        const rollback = prevStatus;
        if (rollback) {
          setItems(
            (cur) =>
              cur?.map((f) =>
                f.id === id ? { ...f, status: rollback } : f,
              ) ?? cur,
          );
        }
        setError("状態を変更できませんでした");
      }
    },
    [],
  );

  const handleDeleteAll = useCallback(async () => {
    setDeleting(true);
    try {
      await getStore().deleteAll();
      setConfirming(false);
      setError(null);
      await load();
    } catch {
      setError("削除に失敗しました");
    } finally {
      setDeleting(false);
    }
  }, [load]);

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            投稿一覧
            {items && <span className={styles.count}>{items.length}件</span>}
          </h2>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => void load()}
          >
            再読み込み
          </button>
        </div>

        {error && <p className={styles.errorNote}>{error}</p>}

        {items === null ? (
          <p className={styles.loading}>読み込み中…</p>
        ) : items.length === 0 ? (
          <p className={styles.empty}>まだ投稿がありません</p>
        ) : (
          <div className={styles.grid}>
            {items.map((fw) => (
              <FireworkCard
                key={fw.id}
                record={fw}
                onSetStatus={(id, status) => void handleSetStatus(id, status)}
              />
            ))}
          </div>
        )}
      </section>

      <section className={`${styles.section} ${styles.dangerSection}`}>
        {confirming ? (
          <div className={styles.confirmBar}>
            <span className={styles.confirmText}>
              本当にすべて削除しますか？
            </span>
            <button
              type="button"
              className={styles.confirmDeleteBtn}
              disabled={deleting}
              onClick={() => void handleDeleteAll()}
            >
              {deleting ? "削除中…" : "削除する"}
            </button>
            <button
              type="button"
              className={styles.cancelBtn}
              disabled={deleting}
              onClick={() => setConfirming(false)}
            >
              やめる
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={() => setConfirming(true)}
          >
            全削除
          </button>
        )}
      </section>
    </>
  );
}
