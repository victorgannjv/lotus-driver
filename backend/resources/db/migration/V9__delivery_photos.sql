-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
-- Reintroduces photo storage (dropped along with manifest-photo OCR) for
-- delivery-outcome proof photos -- the driver snaps a photo whether an order is
-- marked Delivered or Failed. No object storage is available on this platform, so
-- photos live as LONGBLOB rows, same as before.
--
-- Column and its foreign key are added in separate statements (adding both in one
-- ALTER TABLE fails on OceanBase -- "Column not found", see deploy-contract.md).

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

ALTER TABLE delivery_events ADD COLUMN photo_id BIGINT NULL;
ALTER TABLE delivery_events ADD CONSTRAINT fk_events_photo FOREIGN KEY (photo_id) REFERENCES photos(id);
