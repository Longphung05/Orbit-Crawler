// Detect the logged-in account from data the page already contains (§9 Viewer).
// Reads inline <script> text only; never cookies. Only the numeric id (and username, where a
// strategy provides one) is extracted; nothing else in those scripts is kept.

export interface ViewerDetection {
  viewerId: string | null;
  username?: string;
  /** Which strategy matched ('none' when logged out or when every pattern drifted). */
  strategy: string;
}

interface Strategy {
  name: string;
  id: RegExp;
  username?: RegExp;
}

/** Ordered most- to least-specific. Keep every Instagram-specific pattern here. */
const STRATEGIES: Strategy[] = [
  { name: 'current-user-initial-data', id: /"NON_FACEBOOK_USER_ID":"(\d{1,25})"/ },
  {
    name: 'shared-data-viewer',
    id: /"viewer":\{[^{}]*?"id":"(\d{1,25})"/,
    username: /"viewer":\{[^{}]*?"username":"([A-Za-z0-9._]{1,30})"/,
  },
  { name: 'viewer-id', id: /"viewerId":"(\d{1,25})"/ },
  { name: 'viewer_id', id: /"viewer_id":"(\d{1,25})"/ },
];

export function detectViewer(scriptTexts: readonly string[]): ViewerDetection {
  for (const s of STRATEGIES) {
    for (const text of scriptTexts) {
      const m = s.id.exec(text);
      const id = m?.[1];
      if (!id || id === '0') continue; // "0" is what logged-out pages carry
      const result: ViewerDetection = { viewerId: id, strategy: s.name };
      const u = s.username?.exec(text);
      if (u?.[1]) result.username = u[1];
      return result;
    }
  }
  return { viewerId: null, strategy: 'none' };
}
