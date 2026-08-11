import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src/tests"],
  testMatch: ["**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["src/**/*.ts", "!src/tests/**", "!src/server.ts"],
  coverageDirectory: "coverage",
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          strict: true,
          esModuleInterop: true,
          module: "CommonJS",
          target: "ES2022",
        },
      },
    ],
  },
};

export default config;
