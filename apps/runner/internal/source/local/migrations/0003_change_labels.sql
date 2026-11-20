-- local.db v3 (MIROIR-7): a local change's labels, as `miroir pr create
-- --label` and `pr edit --add-label|--remove-label` write them, a JSON array
-- of strings in their order.
ALTER TABLE changes ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';
