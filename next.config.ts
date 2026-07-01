import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static + sharp are native binaries — keep them external (runtime
  // require) so Vercel ships the real binary instead of bundling/breaking it.
  // ffmpeg-static: video/overlay + transcribe. sharp: brand-kit/analyze (image
  // downscale → base64 for Claude vision).
  serverExternalPackages: ["ffmpeg-static", "sharp"],
  outputFileTracingIncludes: {
    "/api/video/overlay": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/ai/transcribe": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
