module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/test/**/*.test.ts", "**/test/**/*.test.js"],
  moduleFileExtensions: ["ts", "js"],
  globals: { "ts-jest": { isolatedModules: true } },
};
