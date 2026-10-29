-- The second fixture of Card B2: lineage_fixture.sql plus one bad edge, P2 > P1. It closes the cycle P1 > P1a > P2 > P1, which K10 forbids in valid data (the schema cannot forbid it:
-- acyclicity is checked by a query, data_model section 13), so the recorded world can hold it. The query must still terminate and return the same seven rows as without the edge:
-- the walk from the root P2 reaches P1 at depth 2 as before, and the edge P2 > P1 only leads back to the root, which is never its own ancestor.
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('E-9', 'P2', 'P1', 'split_into', TIMESTAMP '2030-01-07 08:40:00', TIMESTAMP '2030-01-07 08:40:00');
