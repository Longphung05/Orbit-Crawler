// The "what is Orbit doing, and what should I do next" card for the popup and side panel.
// Pure wording logic: the component only renders it. Orbit never acts on its own, so every
// "next" step is something the person does.
import type { StatusView } from '../query/schemas';
import type { ViewerMeta } from '../shared/types';
import { badgeModel, guidance } from './badge-model';

export type GuideTone = 'wait' | 'next' | 'ok';

export interface Guide {
  tone: GuideTone;
  title: string;
  lines: string[];
}

export interface GuideInput {
  /** undefined = still loading, null = no account detected yet. */
  viewer: ViewerMeta | null | undefined;
  /** The profile the badge is showing in the most recently active Instagram tab. */
  viewing: StatusView['viewing'];
}

/** Does Orbit know who the viewer follows (from an export or from a fully scrolled list)? */
export function hasFollowingList(viewer: ViewerMeta): boolean {
  return viewer.importedExportAt !== undefined || viewer.followingCoverage === 'complete';
}

function viewingLines(viewing: NonNullable<StatusView['viewing']>): string[] {
  const name = `@${viewing.username}`;
  const view = viewing.view;
  if (!view || view.status !== 'ok') {
    return viewing.calculating ? [`Looking at ${name}: working out their orbit…`] : [];
  }
  if (view.state === 'self') return ["You're on your own profile."];
  const label = badgeModel(view).label;
  const lines = [
    viewing.calculating
      ? `Looking at ${name}: recalculating… (was ${label})`
      : `Looking at ${name}: ${label}`,
  ];
  if (view.state === 'out_of_orbit') lines.push(`Orbit has no connection data for ${name} yet.`);
  return [...lines, ...guidance(view)];
}

export function buildGuide({ viewer, viewing }: GuideInput): Guide {
  if (viewer === undefined) return { tone: 'wait', title: 'Loading…', lines: [] };
  if (viewer === null) {
    return {
      tone: 'wait',
      title: 'Waiting for Instagram',
      lines: [
        'Open instagram.com in this browser and log in.',
        'Orbit detects your account by itself. It never sees your password.',
      ],
    };
  }
  if (!viewer.username) {
    return {
      tone: 'next',
      title: 'Account detected',
      lines: ['Next: open your own profile once so Orbit learns your @username.'],
    };
  }
  if (!hasFollowingList(viewer)) {
    return {
      tone: 'next',
      title: `Logged in as @${viewer.username}. Next: tell Orbit who you follow`,
      lines: [
        'Fastest: import your Instagram data export in the Orbit side panel. It is read here, nothing is uploaded.',
        'Or open your own Following list on Instagram and scroll it to the end.',
      ],
    };
  }
  const mine = viewing && viewing.viewerId === viewer.viewerId ? viewing : undefined;
  return {
    tone: 'ok',
    title: `Ready · @${viewer.username}`,
    lines: mine
      ? viewingLines(mine)
      : ["Browse Instagram normally. A badge appears next to each profile's username."],
  };
}
