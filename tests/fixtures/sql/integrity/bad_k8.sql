-- Applied after good.sql: the value of a released result is edited in place instead of a new version (K8).
UPDATE result SET value = 9.9 WHERE result_id = 'RES-1';
