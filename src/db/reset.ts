// "Reset everything to zero" for cleaning and testing (§8.3 "Delete all data"). Local only.
import type { OrbitDB } from './db';

/**
 * Erase every captured account, connection, setting, activity line and health record, for all
 * Instagram accounts. The viewer records stay (minus import and coverage info) so Orbit still
 * knows which account is logged in and the import button keeps working without a page reload.
 */
export async function resetAllData(db: OrbitDB): Promise<void> {
  await db.transaction(
    'rw',
    [db.nodes, db.edges, db.settings, db.activity, db.diagnostics, db.viewers],
    async () => {
      await Promise.all([
        db.nodes.clear(),
        db.edges.clear(),
        db.settings.clear(),
        db.activity.clear(),
        db.diagnostics.clear(),
      ]);
      await db.viewers.toCollection().modify((v) => {
        delete v.importedExportAt;
        delete v.followingCoverage;
        delete v.followersCoverage;
      });
    },
  );
}
