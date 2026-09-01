import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 公開サーバー (npm run public) はビルド出力を .next-prod に分離する。
  // これにより、公開中に npm run dev を動かしても .next を取り合って
  // 公開側の静的ファイルが 400 になる事故が起きない。
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
