/// <reference types="@testing-library/jest-dom" />

// Anchors the jest-dom matcher augmentation (e.g. `toBeInTheDocument`,
// `toHaveClass`) into the TypeScript program so tsc picks it up across
// every `*.test.tsx`. Runtime wiring lives in `test-setup.ts`, but
// the runtime import alone didn't propagate `declare module 'vitest'`
// into tsc's type resolution — this explicit reference does.
