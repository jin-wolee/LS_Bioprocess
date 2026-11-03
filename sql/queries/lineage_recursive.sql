-- Card B2: all ancestors of an item through lineage_edge, one row per distinct ancestor at its minimum depth, safe against cycles.
-- Written by AI under ADR-0022, clean-room from the specification (data_model sections 12 and 13); the author did not write it.
-- Acceptance: tests/user_track/test_queries.py. Standard SQL (WITH RECURSIVE) with named parameters.
--
-- Parameters:  $root_id (the item), $max_depth (how many edges to walk back at most).
-- Output:      ancestor_id, depth ordered by depth, ancestor_id. The root is never its own ancestor, even when a cycle leads back to it.
--
-- Decisions that are not obvious, and what was rejected:
-- 1. Edges point in the direction of derivation (from_item_id derives to_item_id), so the ancestors of the root are found by walking the
--    edges backwards: from the edges that END at the root, to the edges that end at what those start from. The relation is ignored.
-- 2. The walk is breadth first, one level per round, and every round keeps the pair (ancestor_id, depth). UNION (not UNION ALL) drops a pair
--    that an earlier round already made. A diamond (P1 reached through P1a and P1b) therefore produces P1 once per depth it is found at,
--    not once per path, and the final GROUP BY keeps the minimum depth. Rejected: carrying the whole path in an array or a string to
--    spot a cycle (the number of paths grows with every diamond, and arrays are not in the portable subset of the schema).
-- 3. Termination does not rest on the data being acyclic (K10 forbids a cycle, the schema cannot, so the recorded world can hold one).
--    The depth cap does it: a round only runs while depth < $max_depth, and the pairs (ancestor, depth) are finite, so the recursion
--    ends after at most $max_depth rounds on any graph. The price is that a huge cap on a cyclic graph runs that many rounds; the
--    answer stays correct, because a repeated node only comes back at a larger depth and MIN(depth) ignores it.
-- 4. The root is removed after the walk, not during it: a cycle that returns to the root makes the root appear at depth k, and it is
--    dropped by the last WHERE; the walk may go on through it, which cannot create an ancestor that was not already reachable.

WITH RECURSIVE walk(ancestor_id, depth) AS (
  SELECT from_item_id, 1
  FROM lineage_edge
  WHERE to_item_id = $root_id
  UNION
  SELECT e.from_item_id, w.depth + 1
  FROM walk w
  JOIN lineage_edge e ON e.to_item_id = w.ancestor_id
  WHERE w.depth < $max_depth
)
SELECT ancestor_id, MIN(depth) AS depth
FROM walk
WHERE ancestor_id <> $root_id
GROUP BY ancestor_id
ORDER BY depth, ancestor_id
