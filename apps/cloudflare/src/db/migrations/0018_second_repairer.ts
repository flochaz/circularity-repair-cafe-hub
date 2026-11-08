// Sometimes two volunteers work on the same item. A job keeps its primary
// repairer in repairer_id and may name a second one in repairer2_id. The
// second is optional and is always cleared with the first.
export default `ALTER TABLE repair_jobs ADD COLUMN repairer2_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_repair_jobs_repairer2_id ON repair_jobs(repairer2_id);`;
