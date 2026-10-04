-- Credential tracker: a person's own exams, vouchers, earned certifications, renewals and continuing education hours.
-- Private to the person. Nothing here is shared or visible to other users or admins through the API.
CREATE TABLE content.credentials (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  issuer text NOT NULL DEFAULT '',
  archive_id uuid REFERENCES content.master_items(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'scheduled', 'earned', 'retired')),
  credential_number text NOT NULL DEFAULT '',
  exam_date date,
  exam_time text CHECK (exam_time IS NULL OR exam_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  exam_mode text NOT NULL DEFAULT 'unknown' CHECK (exam_mode IN ('unknown', 'test_center', 'online')),
  exam_location text NOT NULL DEFAULT '',
  voucher_code text NOT NULL DEFAULT '',
  voucher_expires date,
  earned_on date,
  expires_on date,
  renewal_alert_days int NOT NULL DEFAULT 90 CHECK (renewal_alert_days BETWEEN 1 AND 730),
  ceu_required numeric(7, 2) CHECK (ceu_required IS NULL OR ceu_required > 0),
  ceu_unit text NOT NULL DEFAULT 'CEU' CHECK (ceu_unit IN ('CEU', 'PDU', 'CPE', 'hours')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credentials_user ON content.credentials (user_id, updated_at DESC);
CREATE INDEX credentials_archive ON content.credentials (archive_id);

CREATE TABLE content.ceu_entries (
  id uuid PRIMARY KEY,
  credential_id uuid NOT NULL REFERENCES content.credentials(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  units numeric(7, 2) NOT NULL CHECK (units > 0),
  earned_on date NOT NULL,
  category text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ceu_entries_credential ON content.ceu_entries (credential_id, earned_on DESC);
