-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
-- Password-reset tokens for driver "forgot password" flow (admins have no password --
-- they authenticate via Google SSO, so this table is only ever used for role='driver').

CREATE TABLE password_reset_tokens (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    user_id     BIGINT       NOT NULL,
    token_hash  CHAR(64)     NOT NULL,   -- sha256 hex digest; the raw token only ever appears in the emailed link
    expires_at  DATETIME     NOT NULL,
    used_at     DATETIME     NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_password_reset_tokens_token_hash (token_hash),
    KEY idx_password_reset_tokens_user (user_id),
    CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users(id)
) DEFAULT CHARSET=utf8mb4;
