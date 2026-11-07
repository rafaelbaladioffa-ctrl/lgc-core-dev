-- P04 adds explicit approval and receipt-confirmation phases to BPM activities.
ALTER TYPE "BpmActivityPhase" ADD VALUE IF NOT EXISTS 'approval';
ALTER TYPE "BpmActivityPhase" ADD VALUE IF NOT EXISTS 'confirmation';
