-- New role: access_delegate. Lets a non-admin manage which groups can see the courses they were delegated.
ALTER TABLE auth.role_assignments DROP CONSTRAINT IF EXISTS role_assignments_role_check;
ALTER TABLE auth.role_assignments
  ADD CONSTRAINT role_assignments_role_check CHECK (role IN ('platform_admin', 'org_admin', 'author', 'learner', 'access_delegate'));
