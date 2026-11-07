// The profile badge and its paths popover (§8.1, §8.2). Rendered inside a Shadow DOM by the
// content script. Display only: it asks the background for data and renders what comes back.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PathsView, Person, ProfileViewOk } from '../query/schemas';
import {
  badgeModel,
  freshnessLine,
  headline,
  hueFor,
  initials,
  notes,
  profileUrl,
} from './badge-model';

export interface OverlayProps {
  view: ProfileViewOk;
  /** 'floating' = the username anchor wasn't found; the badge sits in a corner pill. */
  placement: 'inline' | 'floating';
  theme: 'light' | 'dark';
  loadPaths: () => Promise<PathsView>;
  now: () => number;
}

function Avatar({ person, large }: { person: Person; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      class={large ? 'orbit-avatar orbit-avatar-lg' : 'orbit-avatar'}
      style={{ '--h': hueFor(person.id) }}
      aria-hidden="true"
    >
      {person.profilePicUrl && !broken ? (
        <img
          src={person.profilePicUrl}
          alt=""
          referrerpolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        initials(person)
      )}
    </span>
  );
}

function PersonLink({ person }: { person: Person }) {
  return (
    <a class="orbit-person" href={profileUrl(person.username)}>
      <Avatar person={person} />@{person.username}
    </a>
  );
}

function PathRow({ path }: { path: Person[] }) {
  const last = path.length - 1;
  return (
    <li class="orbit-path">
      {path.map((p, i) => (
        <span key={`${i}:${p.id}`} class="orbit-hop">
          {i > 0 && <span class="orbit-arrow">→ </span>}
          {i === 0 ? (
            <span class="orbit-you">You</span>
          ) : i === last ? (
            <span class="orbit-target">@{p.username}</span>
          ) : (
            <PersonLink person={p} />
          )}
        </span>
      ))}
    </li>
  );
}

function PathGroups({ paths }: { paths: Extract<PathsView, { status: 'ok' }> }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(paths.groups[0] ? [paths.groups[0].connector.id] : []),
  );
  const toggle = (id: string): void =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (paths.groups.length === 0) {
    return <p class="orbit-muted orbit-wait">No paths to show.</p>;
  }
  const listed = paths.groups.reduce((n, g) => n + g.paths.length, 0);
  return (
    <>
      <ul class="orbit-groups">
        {paths.groups.map((g) => {
          const expanded = open.has(g.connector.id);
          return (
            <li key={g.connector.id}>
              <button
                type="button"
                class="orbit-group-btn"
                aria-expanded={expanded}
                onClick={() => toggle(g.connector.id)}
              >
                <Avatar person={g.connector} large />
                <span class="orbit-group-name">@{g.connector.username}</span>
                <span class="orbit-muted">
                  {g.paths.length} {g.paths.length === 1 ? 'path' : 'paths'}
                </span>
                <span class="orbit-chevron" aria-hidden="true">
                  {expanded ? '▲' : '▼'}
                </span>
              </button>
              {expanded && (
                <ul class="orbit-paths">
                  {g.paths.map((p, i) => (
                    <PathRow key={i} path={p} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {(paths.truncated || paths.total > listed) && (
        <p class="orbit-note">
          Showing {listed.toLocaleString('en-US')} of {paths.total.toLocaleString('en-US')} known
          paths.
        </p>
      )}
    </>
  );
}

function Popover({ view, loadPaths, now }: Pick<OverlayProps, 'view' | 'loadPaths' | 'now'>) {
  const [paths, setPaths] = useState<PathsView | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadPaths()
      .then((p) => live && setPaths(p))
      .catch(() => live && setPaths({ status: 'error' }));
    return () => {
      live = false;
    };
  }, [loadPaths]);

  // Keep the popover on screen when the badge sits near the right edge.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    const overflow = r.right - (window.innerWidth - 8);
    if (overflow > 0) el.style.transform = `translateX(${-Math.min(overflow, r.left - 8)}px)`;
  }, [paths]);

  return (
    <div class="orbit-pop" role="dialog" aria-label="How you connect" ref={ref}>
      <h2>{headline(view)}</h2>
      {paths === undefined && <p class="orbit-muted orbit-wait">Loading…</p>}
      {paths?.status === 'ok' && <PathGroups paths={paths} />}
      {paths && paths.status !== 'ok' && (
        <p class="orbit-muted orbit-wait">Couldn't load the paths. Try again in a moment.</p>
      )}
      {notes(view).map((n) => (
        <p key={n} class="orbit-note">
          {n}
        </p>
      ))}
      <p class="orbit-foot">{freshnessLine(view, now())}</p>
    </div>
  );
}

export function Overlay({ view, placement, theme, loadPaths, now }: OverlayProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const model = badgeModel(view);

  // A new profile starts closed.
  useEffect(() => setOpen(false), [view.username]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: Event): void => {
      // Inside the shadow root the event is retargeted to the host, so test the composed path.
      if (rootRef.current && !e.composedPath().includes(rootRef.current)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div class="orbit" ref={rootRef} data-theme={theme} data-placement={placement}>
      <button
        type="button"
        class={`orbit-badge orbit-tone-${model.tone}`}
        data-clickable={model.hasPaths}
        title={model.title}
        aria-haspopup={model.hasPaths ? 'dialog' : undefined}
        aria-expanded={model.hasPaths ? open : undefined}
        onClick={() => model.hasPaths && setOpen((o) => !o)}
      >
        {view.connectors.length > 0 && (
          <span class="orbit-stack">
            {view.connectors.map((c) => (
              <Avatar key={c.id} person={c} />
            ))}
          </span>
        )}
        <span>{model.label}</span>
      </button>
      {open && model.hasPaths && <Popover view={view} loadPaths={loadPaths} now={now} />}
    </div>
  );
}
