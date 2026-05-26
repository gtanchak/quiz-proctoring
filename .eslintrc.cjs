/**
 * Root ESLint config, inherited by every package/app/service.
 * Pinned to ESLint 8 so this legacy `.eslintrc.cjs` format is used.
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  env: {
    es2022: true,
    node: true,
    browser: true,
  },
  ignorePatterns: ["dist/", "node_modules/", "*.cjs", "vite.config.ts"],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
};
