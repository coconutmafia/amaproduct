import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static + sharp are native binaries — keep them external (runtime
  // require) so Vercel ships the real binary instead of bundling/breaking it.
  // ffmpeg-static: video/overlay + transcribe. sharp: brand-kit/analyze (image
  // downscale → base64 for Claude vision).
  serverExternalPackages: ["ffmpeg-static", "sharp"],
  outputFileTracingIncludes: {
    // Font TTFs are read at runtime from public/fonts via readFile
    // (lib/carousel/engine.tsx). Vercel serves public/ statically but does NOT
    // bundle it into the serverless function, so without tracing these the
    // render throws ENOENT and EVERY carousel/story/video render fails.
    "/api/video/overlay": ["./node_modules/ffmpeg-static/ffmpeg*", "./public/fonts/**"],
    "/api/ai/transcribe": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/carousel/render": ["./public/fonts/**"],
    // Background transcription job runner (roadmap #8) — same ffmpeg-static
    // dependency as /api/ai/transcribe, needed on both legs (start + continue).
    "/api/jobs/transcribe": ["./node_modules/ffmpeg-static/ffmpeg*"],
    "/api/jobs/continue": ["./node_modules/ffmpeg-static/ffmpeg*"],
  },
};

export default nextConfig;
