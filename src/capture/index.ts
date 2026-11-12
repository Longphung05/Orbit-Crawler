export { CaptureCoordinator, type ProcessedResult, type SenderInfo } from './coordinator';
export {
  computeHealth,
  diagnosticsReport,
  isFailing,
  recordDomMutuals,
  recordOutcome,
  recordViewerDetection,
  type Health,
} from './diagnostics';
export { installObserver, type ObservableWindow, type ObserverDeps } from './main-world-observer';
export {
  MAX_FORWARDED_BYTES,
  PageMessageSchema,
  RuntimeMessageSchema,
  type PageMessage,
  type RuntimeMessage,
} from './messages';
export { applyDomMutuals, applyEvents, remapSelfIds, type ApplySummary } from './pipeline';
export { ACTIVITY_KEEP, describeEvents, recordActivity, type ActivityItem } from './activity';
export { ListSessions } from './sessions';
export { watchRoute } from './route-watcher';
export { createDomScanner, SCAN_DELAYS_MS, type DomScanDeps, type DomScanner } from './dom-scan';
