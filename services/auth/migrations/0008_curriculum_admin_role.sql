-- The access_delegate role became curriculum_admin: full access to every course and its settings.
-- People who held access_delegate are moved to the new role.
ALTER TABLE auth.role_assignments DROP CONSTRAINT IF EXISTS role_assignments_role_check;
UPDATE auth.role_assignments SET role = 'curriculum_admin' WHERE role = 'access_delegate';
ALTER TABLE auth.role_assignments
  ADD CONSTRAINT role_assignments_role_check CHECK (role IN ('platform_admin', 'org_admin', 'author', 'learner', 'curriculum_admin'));
