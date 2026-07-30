import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Without `globals: true`, Testing Library cannot self-register its auto-cleanup, and renders
// accumulate in document.body across tests — which shows up as confusing "found multiple
// elements" failures rather than as an obvious setup problem.
afterEach(() => {
  cleanup()
})
