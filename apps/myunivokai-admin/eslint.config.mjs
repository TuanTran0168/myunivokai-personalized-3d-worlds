import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-config-next@15's shareable configs are still eslintrc-format
// (`{extends: [...]}`), so ESLint 9's flat config needs the FlatCompat
// bridge to consume them — the standard Next.js 15 + ESLint 9 template.
const compat = new FlatCompat({
  baseDirectory: __dirname
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"] }
];

export default eslintConfig;
