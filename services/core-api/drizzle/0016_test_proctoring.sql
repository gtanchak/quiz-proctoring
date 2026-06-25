ALTER TABLE "tests" ADD COLUMN "proctoring" jsonb DEFAULT '{"camera":false,"microphone":false,"screen":false}'::jsonb NOT NULL;
