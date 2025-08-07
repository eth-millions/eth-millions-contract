module.exports = {
    env: {
        browser: false,
        es6: true,
        mocha: true,
        node: true,
    },
    plugins: ["@typescript-eslint"],
    extends: [
        "eslint:recommended",
        "@typescript-eslint/recommended",
        "prettier",
    ],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
    },
    rules: {
        "@typescript-eslint/no-unused-vars": [
            "error",
            { argsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-non-null-assertion": "warn",
        "prefer-const": "error",
        "no-var": "error",
    },
    ignorePatterns: [
        "node_modules/",
        "artifacts/",
        "cache/",
        "typechain-types/",
        "dist/",
        "coverage/",
    ],
};
