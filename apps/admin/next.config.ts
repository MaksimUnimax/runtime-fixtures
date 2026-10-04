import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_ADMIN_BASE_PATH ?? "";
if (basePath !== "" && basePath !== "/admin")
  throw new Error("ADMIN_BASE_PATH_INVALID");

const config: NextConfig = {
  basePath,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
