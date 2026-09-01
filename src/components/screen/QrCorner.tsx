"use client";

import styles from "@/components/screen/screen.module.css";

interface QrCornerProps {
  dataUrl: string | null;
  /** QRの宛先ホスト名 (スキャンできない人向けの小さな表示) */
  host?: string | null;
}

/** 投稿ページへ誘導する右下のQRカード (仕様 §41) */
export default function QrCorner({ dataUrl, host }: QrCornerProps) {
  if (!dataUrl) return null;
  return (
    <div className={styles.qrCard}>
      <span className={styles.qrLabel}>花火を作る</span>
      <img
        className={styles.qrImg}
        src={dataUrl}
        alt="投稿ページのQRコード"
        width={92}
        height={92}
      />
      {host && <span className={styles.qrHost}>{host}</span>}
    </div>
  );
}
