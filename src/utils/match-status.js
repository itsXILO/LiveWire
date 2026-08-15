import { eq } from 'drizzle-orm';
import { MATCH_STATUS } from '../validation/matches.js';

export function getMatchStatus(startTime, endTime, now = new Date()) {
    const start = new Date(startTime);
    const end = new Date(endTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
    }

    if (now < start) {
        return MATCH_STATUS.SCHEDULED;
    }

    if (now >= end) {
        return MATCH_STATUS.FINISHED;
    }

    return MATCH_STATUS.LIVE;
}

export async function syncMatchStatus(match, updateStatus) {
    const nextStatus = getMatchStatus(match.startTime, match.endTime);
    if (!nextStatus) {
        return match.status;
    }
    if (match.status !== nextStatus) {
        await updateStatus(nextStatus);
        match.status = nextStatus;
    }
    return match.status;
}

// Reconcile the persisted `status` column with the times in the database.
// Returns the rows whose status changed so callers can broadcast updates.
export async function syncAllMatchStatuses(db, matchesTable) {
    const rows = await db.select().from(matchesTable);

    const changed = [];
    for (const row of rows) {
        const nextStatus = getMatchStatus(row.startTime, row.endTime);
        if (!nextStatus || row.status === nextStatus) {
            continue;
        }
        await db
            .update(matchesTable)
            .set({ status: nextStatus })
            .where(eq(matchesTable.id, row.id));
        changed.push({ ...row, status: nextStatus });
    }

    return changed;
}