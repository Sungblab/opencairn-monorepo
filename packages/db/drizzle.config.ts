import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import path from "path";

// Load root .env so drizzle-kit can pick up DATABASE_URL when run from packages/db
config({ path: path.resolve(__dirname, "../../.env") });

export default defineConfig({
  schema: "./src/schema/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
