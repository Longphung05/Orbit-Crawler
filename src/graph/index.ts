// Pure graph engine (CLAUDE.md §7).
// Must not import browser APIs, Dexie, or adapters (enforced by ESLint).
export { OrbitGraph, type GraphEdge, type GraphNodeInfo, type BuildOptions } from './graph';
export {
  computeReach,
  groupPathsByConnector,
  ReachResult,
  DEFAULT_REACH_OPTIONS,
  type Confidence,
  type Degree,
  type PathOptions,
  type PathsResult,
  type Reach,
  type ReachOptions,
} from './reach';
