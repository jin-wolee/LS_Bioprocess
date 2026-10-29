-- Hand fixture of Card B2 (prompts/60_user_track.md): all ancestors of an item through lineage_edge, one row per distinct ancestor at its minimum depth.
-- Explicit column lists only; synthetic times. Edges point in the direction of derivation (from_item_id derives to_item_id); the relation is any of the eight values of data_model
-- section 12 and the query ignores it. Expected answers are in expected_lineage.csv.
--
--   S1 > A1 > P1 > P1a > P2         P1 > P1b > P2        S2 > A2 > P1
-- Walking the edges backwards from the root P2, breadth first, the minimum depth of each ancestor is:
--   depth 1: P1a, P1b (the two parents of P2)           depth 2: P1 (the parent of both P1a and P1b: reached twice, counted once, at 2)
--   depth 3: A1, A2 (the parents of P1)                 depth 4: S1, S2
-- Ordered by depth, then ancestor_id: (P1a,1) (P1b,1) (P1,2) (A1,3) (A2,3) (S1,4) (S2,4). The root is never its own ancestor. With a depth cap of 2 only the first three rows remain.
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('E-1', 'S1', 'A1', 'aliquot_of', TIMESTAMP '2030-01-07 08:00:00', TIMESTAMP '2030-01-07 08:00:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('E-2', 'S2', 'A2', 'aliquot_of', TIMESTAMP '2030-01-07 08:00:00', TIMESTAMP '2030-01-07 08:00:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('E-3', 'A1', 'P1', 'pooled_into', TIMESTAMP '2030-01-07 08:10:00', TIMESTAMP '2030-01-07 08:10:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('E-4', 'A2', 'P1', 'pooled_into', TIMESTAMP '2030-01-07 08:10:00', TIMESTAMP '2030-01-07 08:10:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('E-5', 'P1', 'P1a', 'split_into', TIMESTAMP '2030-01-07 08:20:00', TIMESTAMP '2030-01-07 08:20:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('E-6', 'P1', 'P1b', 'split_into', TIMESTAMP '2030-01-07 08:20:00', TIMESTAMP '2030-01-07 08:20:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('E-7', 'P1a', 'P2', 'pooled_into', TIMESTAMP '2030-01-07 08:30:00', TIMESTAMP '2030-01-07 08:30:00');
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('E-8', 'P1b', 'P2', 'pooled_into', TIMESTAMP '2030-01-07 08:30:00', TIMESTAMP '2030-01-07 08:30:00');
