/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@zengawd/db", "@zengawd/telegraph", "@zengawd/engine"],
  serverExternalPackages: ["better-sqlite3"],
  images: { unoptimized: true },
};

export default nextConfig;
