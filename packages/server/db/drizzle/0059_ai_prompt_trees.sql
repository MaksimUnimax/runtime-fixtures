-- Data-only AI trees. Existing grants, profile assignments and command history are untouched.
-- The template starts as an explicitly unpublished empty draft: no prompt content is invented.
CREATE TABLE ai_prompt_tree_heads (
  target text PRIMARY KEY,
  ai_id uuid UNIQUE REFERENCES ai_adapters(id) ON DELETE RESTRICT,
  draft_revision integer NOT NULL DEFAULT 1 CHECK (draft_revision > 0),
  draft jsonb NOT NULL,
  template_revision integer,
  published_version integer NOT NULL DEFAULT 0 CHECK (published_version >= 0),
  CHECK ((target = 'template' AND ai_id IS NULL) OR (ai_id IS NOT NULL AND target = ai_id::text)),
  CHECK (jsonb_typeof(draft) = 'object' AND octet_length(draft::text) <= 131072)
);
--> statement-breakpoint
CREATE TABLE ai_prompt_tree_publications (
  target text NOT NULL REFERENCES ai_prompt_tree_heads(target) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  body jsonb NOT NULL,
  content_sha256 varchar(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  author_id uuid NOT NULL REFERENCES admin_principals(id),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  source_version integer,
  PRIMARY KEY(target, version),
  FOREIGN KEY(target, source_version) REFERENCES ai_prompt_tree_publications(target, version),
  CHECK (source_version IS NULL OR source_version < version),
  CHECK (jsonb_typeof(body) = 'object' AND octet_length(body::text) <= 131072)
);
--> statement-breakpoint
CREATE FUNCTION protect_ai_prompt_tree_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AI_TREE_PUBLICATION_IMMUTABLE'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_prompt_tree_publication_immutable BEFORE UPDATE OR DELETE
ON ai_prompt_tree_publications FOR EACH ROW EXECUTE FUNCTION protect_ai_prompt_tree_publication();
--> statement-breakpoint
INSERT INTO ai_prompt_tree_heads(target,draft) VALUES
('template','{"format":"octoport_prompt_tree_v1","root":null,"nodes":[]}'::jsonb);
--> statement-breakpoint
INSERT INTO ai_prompt_tree_heads(target,ai_id,draft,template_revision)
SELECT a.id::text,a.id,t.draft,t.draft_revision FROM ai_adapters a CROSS JOIN ai_prompt_tree_heads t
WHERE t.target='template' ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- A DB trigger covers both new and older API instances during upgrade/rollback.
-- Lock the template first, then read its immutable publication in a new statement.
CREATE FUNCTION initialize_ai_prompt_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE template_version integer; template_body jsonb;
BEGIN
  SELECT published_version INTO template_version FROM ai_prompt_tree_heads
    WHERE target='template' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_TREE_TEMPLATE_MISSING'; END IF;
  IF template_version > 0 THEN
    SELECT body INTO template_body FROM ai_prompt_tree_publications
      WHERE target='template' AND version=template_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'AI_TREE_TEMPLATE_PUBLICATION_MISSING'; END IF;
  ELSE
    template_body := '{"format":"octoport_prompt_tree_v1","root":null,"nodes":[]}'::jsonb;
  END IF;
  INSERT INTO ai_prompt_tree_heads(target,ai_id,draft,template_revision)
    VALUES(NEW.id::text,NEW.id,template_body,template_version)
    ON CONFLICT(target) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_adapter_prompt_tree_copy AFTER INSERT ON ai_adapters
FOR EACH ROW EXECUTE FUNCTION initialize_ai_prompt_tree();
