export { CaptureCoordinator, type ProcessedResult, type SenderInfo } from './coordinator';
export {
  computeHealth,
  diagnosticsReport,
  isFailing,
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
export { applyEvents, type ApplySummary } from './pipeline';
export { ListSessions } from './sessions';
export { watchRoute } from './route-watcher';
