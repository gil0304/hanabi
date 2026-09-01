"use client";

import Link from "next/link";
import SettingsPanel from "@/components/admin/SettingsPanel";
import FireworkList from "@/components/admin/FireworkList";
import styles from "@/components/admin/admin.module.css";

export default function AdminConsole() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>管理</h1>
        <nav className={styles.nav}>
          <Link href="/" className={styles.navLink}>
            投稿画面
          </Link>
          <Link
            href="/screen"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.navLink}
          >
            スクリーン ↗
          </Link>
        </nav>
      </header>

      <SettingsPanel />
      <FireworkList />
    </main>
  );
}
