"use client";

import AdminConsole from "@/components/admin/AdminConsole";

// 認証は無し: イベント会場でのローカル運用前提のため (仕様 §42)
export default function AdminPage() {
  return <AdminConsole />;
}
