-- K10: lineage_edge is acyclic. Walk the edges from every start item; a walk that returns to its start is a cycle.
-- The depth is capped by the number of edges, so the query ends even on a cyclic graph. Returns each item that lies on a cycle.
WITH RECURSIVE walk(start_id, node, depth) AS (
  SELECT from_item_id, to_item_id, 1 FROM lineage_edge
  UNION ALL
  SELECT w.start_id, e.to_item_id, w.depth + 1
  FROM walk w
  JOIN lineage_edge e ON e.from_item_id = w.node
  WHERE w.depth < (SELECT COUNT(*) FROM lineage_edge)
)
SELECT DISTINCT start_id FROM walk WHERE node = start_id
