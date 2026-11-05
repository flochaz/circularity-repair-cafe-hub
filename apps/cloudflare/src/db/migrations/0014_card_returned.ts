// A visitor keeps their numbered card until they collect the item at the exit,
// not until a repairer marks the repair finished. The card number stays in use
// until a volunteer ticks "card given back", then it is free for the next
// visitor.
//
// Older hubs freed the number as soon as the job left waiting / in progress /
// awaiting return. Stamp those finished jobs as already returned so the same
// numbers stay free after the change. The old partial index is replaced by one
// on the cards that are still out.
export default `ALTER TABLE repair_jobs ADD COLUMN card_returned_at TIMESTAMP;
UPDATE repair_jobs
   SET card_returned_at = COALESCE(completed_at, updated_at, created_at)
 WHERE card_number IS NOT NULL
   AND status NOT IN ('waiting', 'in_progress', 'awaiting_return');
DROP INDEX IF EXISTS idx_repair_jobs_event_card_open;
CREATE UNIQUE INDEX idx_repair_jobs_event_card_held
  ON repair_jobs(event_id, card_number)
  WHERE card_number IS NOT NULL AND card_returned_at IS NULL;`;
