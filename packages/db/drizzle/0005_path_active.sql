-- Retiring a delivery channel without losing what it measured. The row and its arrivals stay —
-- those measurements were real — but the channel stops being offered as a lane, so a provider we
-- no longer collect from does not sit on the compare screen for ever reading "not delivering".
-- Default true: every channel that exists today is one we are still collecting.
ALTER TABLE "delivery_paths" ADD COLUMN "active" boolean DEFAULT true NOT NULL;
