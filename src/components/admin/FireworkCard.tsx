"use client";

import type { FireworkRecord, FireworkStatus } from "@/types";
import FireworkThumb from "@/components/admin/FireworkThumb";
import styles from "@/components/admin/admin.module.css";

const dateFmt = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return dateFmt.format(d);
}

const STATUS_LABEL: Record<FireworkStatus, string> = {
  approved: "公開中",
  hidden: "非表示",
  pending: "審査中",
};

const STATUS_CLASS: Record<FireworkStatus, string> = {
  approved: styles.badgeApproved,
  hidden: styles.badgeHidden,
  pending: styles.badgePending,
};

function actionFor(status: FireworkStatus): {
  label: string;
  next: FireworkStatus;
  accent: boolean;
} {
  if (status === "approved")
    return { label: "非表示にする", next: "hidden", accent: false };
  if (status === "hidden")
    return { label: "再表示する", next: "approved", accent: true };
  // pending は公開操作のみ
  return { label: "公開する", next: "approved", accent: true };
}

export default function FireworkCard({
  record,
  onSetStatus,
}: {
  record: FireworkRecord;
  onSetStatus: (id: string, status: FireworkStatus) => void;
}) {
  const action = actionFor(record.status);

  return (
    <article className={styles.card}>
      <FireworkThumb drawing={record.drawing_data} size={120} />
      <div className={styles.cardBody}>
        <p className={record.message ? styles.cardMsg : styles.cardMsgEmpty}>
          {record.message || "—"}
        </p>
        <div className={styles.cardMeta}>
          <span className={`${styles.badge} ${STATUS_CLASS[record.status]}`}>
            {STATUS_LABEL[record.status]}
          </span>
          <span>{formatCreatedAt(record.created_at)}</span>
          <span>打上 {record.shown_count}回</span>
        </div>
        <button
          type="button"
          className={`${styles.cardBtn} ${action.accent ? styles.cardBtnAccent : ""}`}
          onClick={() => onSetStatus(record.id, action.next)}
        >
          {action.label}
        </button>
      </div>
    </article>
  );
}
