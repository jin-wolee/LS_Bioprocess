-- Applied after good.sql: an edge closes the X1 to X4 diamond into a cycle (K10).
INSERT INTO lineage_edge (edge_id, from_item_id, to_item_id, relation, occurred_at, available_at) VALUES ('ED-X', 'X4', 'X1', 'rerun_of', TIMESTAMP '2030-01-07 12:00:00', TIMESTAMP '2030-01-07 12:00:00');
