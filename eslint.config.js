import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/target/**", "**/node_modules/**", "**/gen/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      // Ambient .d.ts files (mp4box, FSA) must reach consumers that compile
      // our source directly — path references are the deliberate mechanism.
      "@typescript-eslint/triple-slash-reference": ["error", { path: "always" }],
    },
  },
);
