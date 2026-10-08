-- School Test + Analysis System schema (PostgreSQL). Safe to run on every start.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_current BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  grade INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','teacher','student')),
  full_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS teachers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT,
  email TEXT
);
CREATE TABLE IF NOT EXISTS subjects (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  name TEXT NOT NULL,
  UNIQUE (class_id, name)
);
CREATE TABLE IF NOT EXISTS teacher_assignments (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE (teacher_id, subject_id)
);
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  student_code TEXT UNIQUE,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  father_name TEXT,
  mother_name TEXT,
  dob DATE,
  gender TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS student_class_history (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  roll_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
  UNIQUE (student_id, session_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_roll_active ON student_class_history (session_id, class_id, roll_no) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS tests (
  id SERIAL PRIMARY KEY,
  test_code TEXT NOT NULL,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  test_no INTEGER NOT NULL,
  seq_no INTEGER,
  test_date DATE NOT NULL,
  original_date DATE NOT NULL,
  test_type TEXT NOT NULL DEFAULT '',
  syllabus TEXT NOT NULL DEFAULT '',
  full_syllabus BOOLEAN NOT NULL DEFAULT false,
  max_marks NUMERIC(6,2),
  duration_min INTEGER,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Completed','Postponed','Cancelled')),
  marks_locked BOOLEAN NOT NULL DEFAULT false,
  locked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ,
  UNIQUE (session_id, class_id, test_no),
  UNIQUE (session_id, test_code)
);
CREATE INDEX IF NOT EXISTS ix_tests_class_date ON tests (class_id, test_date);
CREATE TABLE IF NOT EXISTS chapters (
  id SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  chapter_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  UNIQUE (subject_id, chapter_no)
);
CREATE TABLE IF NOT EXISTS test_chapters (
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  PRIMARY KEY (test_id, chapter_id)
);
CREATE TABLE IF NOT EXISTS marks (
  id SERIAL PRIMARY KEY,
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  marks NUMERIC(6,2),
  status TEXT NOT NULL CHECK (status IN ('present','absent')),
  entered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (test_id, student_id),
  CHECK ((status = 'absent' AND marks IS NULL) OR (status = 'present' AND marks IS NOT NULL AND marks >= 0))
);
CREATE INDEX IF NOT EXISTS ix_marks_student ON marks (student_id);
CREATE TABLE IF NOT EXISTS marks_history (
  id SERIAL PRIMARY KEY,
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  old_marks NUMERIC(6,2),
  old_status TEXT,
  new_marks NUMERIC(6,2),
  new_status TEXT,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS ix_marks_history_test ON marks_history (test_id);
CREATE TABLE IF NOT EXISTS student_imports (
  id SERIAL PRIMARY KEY,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  class_id INTEGER REFERENCES classes(id),
  filename TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'preview',
  payload TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS student_import_errors (
  id SERIAL PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES student_imports(id) ON DELETE CASCADE,
  row_no INTEGER,
  message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_logs (created_at);
CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
