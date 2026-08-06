-- Japan Trip Companion — finer shopping categories.
-- The shopping screen now groups items into per-category carousels, so the
-- single "beauty" bucket was too coarse: hair care and skin care are separate
-- shopping trips in practice, and drugstore/pharmacy finds are their own thing.
-- Splits beauty → haircare | skincare | health and re-maps existing rows.
-- Run after 0007_shopping_list.sql.

-- Order matters: drop the old check, move the rows, only then add the new check
-- (adding it first fails against any row still sitting in 'beauty').
alter table shopping_items drop constraint if exists shopping_items_category_check;

-- Generic "beauty" lands in skincare; the seeded hair and drugstore items move
-- to their more specific homes.
update shopping_items set category = 'skincare' where category = 'beauty';
update shopping_items set category = 'haircare' where id in ('buy-ichikami', 'buy-hair-mask');
update shopping_items set category = 'health'   where id in ('buy-throat-spray');

alter table shopping_items
  add constraint shopping_items_category_check
  check (category in ('clothes','haircare','skincare','health','snacks','tech','home','souvenir','other'));
