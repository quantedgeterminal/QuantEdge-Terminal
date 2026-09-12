-- Symbols are added with a temporary default to get past the existing rows; then
-- they are filled from the current "BASE/QUOTE · venue" label and the default is dropped —
-- the seed overwrites them with the real symbols from MARKET_SYMBOLS.
ALTER TABLE "markets" ADD COLUMN "base_symbol" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "quote_symbol" text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE "markets" SET "base_symbol" = split_part("label", '/', 1), "quote_symbol" = split_part(split_part("label", '/', 2), ' ', 1);--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "base_symbol" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "quote_symbol" DROP DEFAULT;
