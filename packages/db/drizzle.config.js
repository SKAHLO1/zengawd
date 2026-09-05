import { defineConfig } from "drizzle-kit";
export default defineConfig({
    dialect: "sqlite",
    schema: "./src/schema.ts",
    out: "./drizzle",
});
//# sourceMappingURL=drizzle.config.js.map