-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.

CREATE TABLE users (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    role            ENUM('driver','admin') NOT NULL,
    email           VARCHAR(255) NOT NULL,
    phone           VARCHAR(32)  NULL,
    password_hash   VARCHAR(255) NULL,        -- NULL for admin rows: SSO-only, no password
    name            VARCHAR(255) NOT NULL,
    status          ENUM('active','disabled') NOT NULL DEFAULT 'active',
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_role (role)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE statuses (
    code                 VARCHAR(32)  NOT NULL,
    label                VARCHAR(64)  NOT NULL,
    sort_order           INT          NOT NULL DEFAULT 0,
    requires_photo       TINYINT(1)   NOT NULL DEFAULT 0,
    is_terminal_success  TINYINT(1)   NOT NULL DEFAULT 0,  -- triggers OCR-match-to-job flow
    is_active            TINYINT(1)   NOT NULL DEFAULT 1,
    PRIMARY KEY (code)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE photos (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    content_type  VARCHAR(64)  NOT NULL,
    byte_size     INT          NOT NULL,
    data          LONGBLOB     NOT NULL,
    uploaded_by   BIGINT       NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_photos_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE manifests (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    driver_id         BIGINT       NOT NULL,
    work_date         DATE         NOT NULL,
    photo_id          BIGINT       NOT NULL,
    ocr_status        ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
    ocr_error         VARCHAR(512) NULL,
    ocr_raw_response  MEDIUMTEXT   NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_manifests_driver_date (driver_id, work_date),
    CONSTRAINT fk_manifests_driver FOREIGN KEY (driver_id) REFERENCES users(id),
    CONSTRAINT fk_manifests_photo  FOREIGN KEY (photo_id)  REFERENCES photos(id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE delivery_jobs (
    id               BIGINT       NOT NULL AUTO_INCREMENT,
    manifest_id      BIGINT       NOT NULL,
    tracking_no      VARCHAR(128) NULL,
    recipient_name   VARCHAR(255) NULL,
    address          VARCHAR(512) NULL,
    raw_ocr_json     JSON         NULL,        -- whatever fields OCR legibly extracted
    status_code      VARCHAR(32)  NOT NULL DEFAULT 'pending',
    needs_review     TINYINT(1)   NOT NULL DEFAULT 0,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_jobs_manifest (manifest_id),
    KEY idx_jobs_status (status_code),
    KEY idx_jobs_tracking_no (tracking_no),
    KEY idx_jobs_status_created (status_code, created_at),
    CONSTRAINT fk_jobs_manifest FOREIGN KEY (manifest_id) REFERENCES manifests(id),
    CONSTRAINT fk_jobs_status   FOREIGN KEY (status_code) REFERENCES statuses(code)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE delivery_events (
    id                      BIGINT        NOT NULL AUTO_INCREMENT,
    driver_selected_job_id  BIGINT        NOT NULL,  -- job the driver tapped Check-In from
    job_id                  BIGINT        NULL,       -- resolved link; NULL = orphan, needs admin review
    driver_id               BIGINT        NOT NULL,
    status_code             VARCHAR(32)   NOT NULL,
    occurred_at             DATETIME      NOT NULL,
    lat                     DECIMAL(10,7) NULL,
    lng                     DECIMAL(10,7) NULL,
    photo_id                BIGINT        NULL,
    ocr_candidate_text      VARCHAR(255)  NULL,
    match_type              ENUM('exact','fuzzy','none','n_a') NOT NULL DEFAULT 'n_a',
    needs_review            TINYINT(1)    NOT NULL DEFAULT 0,
    resolved_by             BIGINT        NULL,
    resolved_at             DATETIME      NULL,
    created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_events_job_time (job_id, occurred_at),
    KEY idx_events_selected_job (driver_selected_job_id),
    KEY idx_events_driver (driver_id),
    KEY idx_events_needs_review (needs_review, occurred_at),
    CONSTRAINT fk_events_selected_job FOREIGN KEY (driver_selected_job_id) REFERENCES delivery_jobs(id),
    CONSTRAINT fk_events_job          FOREIGN KEY (job_id)         REFERENCES delivery_jobs(id),
    CONSTRAINT fk_events_driver       FOREIGN KEY (driver_id)      REFERENCES users(id),
    CONSTRAINT fk_events_status       FOREIGN KEY (status_code)    REFERENCES statuses(code),
    CONSTRAINT fk_events_photo        FOREIGN KEY (photo_id)       REFERENCES photos(id),
    CONSTRAINT fk_events_resolved_by  FOREIGN KEY (resolved_by)    REFERENCES users(id)
) DEFAULT CHARSET=utf8mb4;
