-- The "Nivel VIP 7 dias" reward was demo seed data promising a temporary Gold
-- tier that no code path actually grants. Deactivate it so it can no longer be
-- redeemed; existing redemptions (if any) keep their history intact.
UPDATE loyalty_rewards
SET active = FALSE, stock = 0
WHERE name = 'Nivel VIP 7 dias';
