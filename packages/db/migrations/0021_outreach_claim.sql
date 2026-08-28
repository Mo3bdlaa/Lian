-- A lease on a piece of outreach, so two schedulers cannot deliver it twice.
--
-- tick.ts has always carried this comment: "It is idempotent: outreach rows
-- carry a dedupe key, and one that has been sent is not selected again. A
-- scheduler that fires twice costs nothing."
--
-- That was true SEQUENTIALLY and false CONCURRENTLY, which is the only way it
-- ever mattered. `sent_at` is written AFTER delivery, so two ticks that
-- overlap — a cron that fires while the previous run is still working, a
-- container that gets two replicas, a retried webhook — both select the same
-- rows, both find sent_at IS NULL, and both push. Two identical notifications
-- from someone who is supposed to sound like a person, and two charged turns.
--
-- LESSONS §24, exactly: a word in the source is not the behaviour it names.
--
-- The lease rather than SELECT ... FOR UPDATE SKIP LOCKED because delivering
-- is slow (a model turn and a push round trip) and a row lock held across it
-- would hold a database connection across it too. A claim is a write that
-- ends; a lock is a connection that waits.
ALTER TABLE outreach ADD COLUMN claimed_at timestamptz;

-- The selection reads it on every tick, and a partial index keeps that read
-- to the rows that are still candidates — which is a handful, against a table
-- that only grows.
CREATE INDEX outreach_unclaimed_idx ON outreach (scheduled_for)
  WHERE sent_at IS NULL AND cancelled_at IS NULL;
