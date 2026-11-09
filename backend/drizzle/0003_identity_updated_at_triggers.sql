-- updated_at triggers for the identity tables that gained an updated_at column in 0002.
CREATE TRIGGER user_sessions_set_updated_at
  BEFORE UPDATE ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER auth_verifications_set_updated_at
  BEFORE UPDATE ON auth_verifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
