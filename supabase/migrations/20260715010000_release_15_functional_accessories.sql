-- Release 15: functional accessories.
--
-- Every accessory now does something on the pet stage, keyed by a "slot" in
-- its meta (one active per slot, enforced client-side like plants):
--   bed  — pets nap on it during focus
--   toy  — a ball pets kick around
--   bowl — pets wander over for snacks
--   hat / face — worn by the pets
-- The cosmetic-only Party Hat is removed (its emoji was confetti and it did
-- nothing) in favor of the Bouncy Ball at the same level; a Snack Bowl fills
-- the previously-empty level 13. Mirror of src/petCatalog.ts — keep in sync.

-- Party Hat out (user rows first for the FK).
delete from public.user_rewards where reward_id = 'party_hat';
delete from public.reward_catalog where id = 'party_hat';

-- Make room for the Snack Bowl at sort 13 (guarded so a re-run can't bump twice).
update public.reward_catalog set sort = sort + 1
 where sort >= 13
   and not exists (select 1 from public.reward_catalog where id = 'snack_bowl');

-- Slots for the existing accessories.
update public.reward_catalog set meta = meta || '{"slot":"bed"}'::jsonb  where id = 'pet_bed';
update public.reward_catalog set meta = meta || '{"slot":"hat"}'::jsonb  where id in ('crown', 'study_cap', 'top_hat');
update public.reward_catalog set meta = meta || '{"slot":"face"}'::jsonb where id = 'cool_shades';

-- New functional accessories.
insert into public.reward_catalog(id, kind, name, unlock_level, meta, sort) values
  ('ball',       'accessory', 'Bouncy Ball', 7,  '{"emoji":"🎾","slot":"toy"}',  7),
  ('snack_bowl', 'accessory', 'Snack Bowl',  13, '{"emoji":"🥣","slot":"bowl"}', 13)
on conflict (id) do nothing;
