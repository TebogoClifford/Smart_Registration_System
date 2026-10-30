// ESLint config for the Node.js/Express backend (CommonJS).
import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      // allow unused function args that start with _ (Express error handlers need all 4 args)
      "no-unused-vars": ["error", { argsIgnorePattern: "^_|^next$" }],
    },
  },
  { ignores: ["node_modules/**", "src/generated/**"] },
];
