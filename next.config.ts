import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static resolves to a real binary in node_modules — keep it external
  // (runtime require) and force the binary into the video route's trace so the
  // Vercel function actually ships it.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/video/overlay": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/ai/transcribe": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
