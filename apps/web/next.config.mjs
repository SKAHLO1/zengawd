/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@zengawd/db", "@zengawd/telegraph", "@zengawd/engine"],
  serverExternalPackages: ["postgres", "@electric-sql/pglite"],
  images: { unoptimized: true },
};

export default nextConfig;
