-- K13: a method version is immutable once a run has used it.
-- Rows of before_method that are no longer present unchanged in method, restricted to methods a run refers to.
-- EXCEPT compares whole rows, so a change to any column the DDL adds is caught without naming it.
SELECT b.method_id
FROM (SELECT * FROM before_method EXCEPT SELECT * FROM method) b
WHERE EXISTS (SELECT 1 FROM run r WHERE r.method_id = b.method_id)
