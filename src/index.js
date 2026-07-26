import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { matches } from './db/schema.js';

async function main() {
  try {
    console.log('Performing CRUD operations...');

    const [newMatch] = await db
      .insert(matches)
      .values({
        sport: 'Football',
        homeTeam: 'Team A',
        awayTeam: 'Team B',
      })
      .returning();

    if (!newMatch) {
      throw new Error('Failed to create match');
    }

    console.log('CREATE: New match created:', newMatch);

    const foundMatch = await db.select().from(matches).where(eq(matches.id, newMatch.id));
    console.log('READ: Found match:', foundMatch[0]);

    const [updatedMatch] = await db
      .update(matches)
      .set({ homeScore: 2 })
      .where(eq(matches.id, newMatch.id))
      .returning();

    if (!updatedMatch) {
      throw new Error('Failed to update match');
    }

    console.log('UPDATE: Match updated:', updatedMatch);

    await db.delete(matches).where(eq(matches.id, newMatch.id));
    console.log('DELETE: Match deleted.');

    console.log('\nCRUD operations completed successfully.');
  } catch (error) {
    console.error('Error performing CRUD operations:', error);
    process.exit(1);
  }
}

main();
