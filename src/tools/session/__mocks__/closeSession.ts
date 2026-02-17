import { vi } from 'vitest';

const closeSession = vi.fn();
const findUnrecordedCommits = vi.fn();
const findSessionCommits = vi.fn();
const runPhase1Analysis = vi.fn();
const runPhase2Finalization = vi.fn();
export {
  closeSession,
  findUnrecordedCommits,
  findSessionCommits,
  runPhase1Analysis,
  runPhase2Finalization,
};
