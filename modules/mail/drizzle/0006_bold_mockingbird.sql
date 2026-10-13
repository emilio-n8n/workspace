ALTER TABLE "mail_messages" ADD COLUMN "bcc_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL;
