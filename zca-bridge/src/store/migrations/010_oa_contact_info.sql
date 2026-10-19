ALTER TABLE zalo_conversations ADD COLUMN info_requested_at TIMESTAMPTZ;

CREATE TABLE oa_info_card (
  account_id  INTEGER PRIMARY KEY REFERENCES zalo_accounts(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  title       TEXT NOT NULL DEFAULT 'Cập nhật thông tin liên hệ',
  subtitle    TEXT NOT NULL DEFAULT 'Vui lòng chia sẻ thông tin để chúng tôi hỗ trợ bạn nhanh và chính xác hơn.',
  image_url   TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
