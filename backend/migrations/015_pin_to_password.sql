-- Migration 015: Rename pin_hash to password_hash
-- This migration renames the column to reflect the change from PIN to password authentication

ALTER TABLE users RENAME COLUMN pin_hash TO password_hash;
